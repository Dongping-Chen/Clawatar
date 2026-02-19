import * as THREE from 'three'
import { lightingRig, scene } from './scene'
import { isGradientBackgroundActive } from './gradient-background'

type BackgroundPreset = 'default' | 'sakura' | 'night' | 'cafe' | 'sunset' | 'ocean' | 'forest' | 'lavender' | 'minimal'

/** When true, scene-system controls the background — skip all background effects */
let _suppressedByScene = false
export function suppressBackgrounds(v: boolean) { _suppressedByScene = v }
export function isBackgroundSuppressed() { return _suppressedByScene }

type LightConfig = {
  ambient: [number, number]
  sky: [number, number, number]
  key: [number, number]
  rim: [number, number]
  bounce: [number, number]
}

const LIGHT_PRESETS: Record<BackgroundPreset, LightConfig> = {
  default: {
    ambient: [0xfff2f6, 0.9],
    sky: [0xffdae8, 0xf0e3ff, 0.55],
    key: [0xffd7e7, 1.2],
    rim: [0xf6d7ff, 0.48],
    bounce: [0xffd2e3, 0.28],
  },
  sakura: {
    ambient: [0xffecf4, 1.08],
    sky: [0xffd8e9, 0xffeaf6, 0.78],
    key: [0xffd2e5, 1.38],
    rim: [0xffdff3, 0.62],
    bounce: [0xffbfdc, 0.38],
  },
  night: {
    ambient: [0x93a4d2, 0.38],
    sky: [0x22305d, 0x121830, 0.42],
    key: [0x7fa9ff, 0.84],
    rim: [0x4f6cc4, 0.5],
    bounce: [0x35508d, 0.18],
  },
  cafe: {
    ambient: [0xffd2b2, 0.82],
    sky: [0xd5976f, 0x4d3529, 0.5],
    key: [0xffbd80, 1.04],
    rim: [0xd48b61, 0.36],
    bounce: [0xffb57a, 0.25],
  },
  sunset: {
    ambient: [0xffd2bd, 0.96],
    sky: [0xff9fa0, 0x7c4b87, 0.58],
    key: [0xffb168, 1.24],
    rim: [0xff7bb7, 0.56],
    bounce: [0xf59564, 0.34],
  },
  ocean: {
    ambient: [0xb8daf0, 0.78],
    sky: [0x6aa8d4, 0x3a6e98, 0.52],
    key: [0x8ec8f0, 1.1],
    rim: [0x5ea0d0, 0.44],
    bounce: [0x4a8ab8, 0.22],
  },
  forest: {
    ambient: [0xd4e8c4, 0.85],
    sky: [0x8fbc8f, 0x5a8a4a, 0.55],
    key: [0xc8e0a8, 1.15],
    rim: [0xa0c880, 0.42],
    bounce: [0x78a858, 0.24],
  },
  lavender: {
    ambient: [0xe8d8f4, 0.92],
    sky: [0xd0b8e8, 0xb898d8, 0.6],
    key: [0xe0c8f0, 1.2],
    rim: [0xc8a8e0, 0.5],
    bounce: [0xb090d0, 0.3],
  },
  minimal: {
    ambient: [0xf5f3f0, 0.95],
    sky: [0xf0eee8, 0xe8e6e0, 0.5],
    key: [0xf8f6f0, 1.1],
    rim: [0xe8e4dc, 0.38],
    bounce: [0xf0ece4, 0.2],
  },
}

// Bounds for particles (portrait/iPhone optimized)
const X_BOUND = 0.65
const Y_MIN = 0.2
const Y_MAX = 3.0
const Z_BOUND = 0.65

let activeTexture: THREE.Texture | null = null
let activeParticles: THREE.Points | null = null
let activeShootingStars: THREE.Points | null = null
let activeInstancedMesh: THREE.InstancedMesh | null = null
let particlePreset: BackgroundPreset = 'default'
let particleVelocities: Float32Array | null = null
let particlePhases: Float32Array | null = null
let shootingStarData: { velocities: Float32Array; lifetimes: Float32Array; maxLifetimes: Float32Array } | null = null

// InstancedMesh particle data
type InstancedParticleData = {
  positions: Float32Array  // x,y,z per instance
  velocities: Float32Array // fall speed per instance
  phases: Float32Array     // random phase per instance
  rotations: Float32Array  // current rotation x,y,z per instance
  rotSpeeds: Float32Array  // rotation speed x,y,z per instance
  scales: Float32Array     // scale per instance
  count: number
}
let instancedData: InstancedParticleData | null = null
const _dummy = new THREE.Object3D()

export function initBackgrounds() {
  const select = document.getElementById('background-select') as HTMLSelectElement | null
  const requested = ((select?.value ?? 'default') as BackgroundPreset)
  applyBackgroundScene(requested)

  if (!select) return
  select.addEventListener('change', () => {
    applyBackgroundScene((select.value as BackgroundPreset) || 'default')
  })
}

export function updateBackgroundEffects(elapsed: number, delta: number) {
  if (_suppressedByScene) return

  // Update instanced mesh particles (petals/leaves)
  if (activeInstancedMesh && instancedData) {
    switch (particlePreset) {
      case 'sakura':
        updateInstancedPetals(elapsed, delta)
        break
      case 'forest':
        updateInstancedLeaves(elapsed, delta)
        break
    }
  }

  if (!activeParticles) return
  const pos = activeParticles.geometry.getAttribute('position') as THREE.BufferAttribute | null
  if (!pos) return

  const arr = pos.array as Float32Array

  switch (particlePreset) {
    case 'sunset':
      updateSunsetDust(arr, elapsed, delta)
      break
    case 'ocean':
      updateBubbles(arr, elapsed, delta)
      break
    case 'night':
      updateStars(elapsed, delta)
      updateShootingStars(delta)
      break
    case 'lavender':
      updateSnowflakes(arr, elapsed, delta)
      break
    case 'cafe':
      updateCafeDust(arr, elapsed, delta)
      break
    case 'minimal':
      updateMinimalDust(arr, elapsed, delta)
      break
    default:
      return
  }

  if (particlePreset !== 'night') {
    pos.needsUpdate = true
  }
}

// --- InstancedMesh update functions ---

function updateInstancedPetals(elapsed: number, delta: number) {
  if (!activeInstancedMesh || !instancedData) return
  const d = instancedData
  for (let i = 0; i < d.count; i++) {
    const i3 = i * 3
    // Fall
    d.positions[i3 + 1] -= d.velocities[i] * delta
    // Sway
    d.positions[i3] += Math.sin(elapsed * 0.9 + d.phases[i]) * 0.003
    d.positions[i3 + 2] += Math.cos(elapsed * 0.7 + d.phases[i]) * 0.002
    // Tumble rotation
    d.rotations[i3] += d.rotSpeeds[i3] * delta
    d.rotations[i3 + 1] += d.rotSpeeds[i3 + 1] * delta
    d.rotations[i3 + 2] += d.rotSpeeds[i3 + 2] * delta
    // Reset if below ground
    if (d.positions[i3 + 1] < Y_MIN) {
      d.positions[i3] = (Math.random() - 0.5) * X_BOUND * 2
      d.positions[i3 + 1] = Y_MAX + Math.random() * 0.4
      d.positions[i3 + 2] = (Math.random() - 0.5) * Z_BOUND * 2
    }
    // Update matrix
    _dummy.position.set(d.positions[i3], d.positions[i3 + 1], d.positions[i3 + 2])
    _dummy.rotation.set(d.rotations[i3], d.rotations[i3 + 1], d.rotations[i3 + 2])
    _dummy.scale.setScalar(d.scales[i])
    _dummy.updateMatrix()
    activeInstancedMesh!.setMatrixAt(i, _dummy.matrix)
  }
  activeInstancedMesh!.instanceMatrix.needsUpdate = true
}

function updateInstancedLeaves(elapsed: number, delta: number) {
  if (!activeInstancedMesh || !instancedData) return
  const d = instancedData
  for (let i = 0; i < d.count; i++) {
    const i3 = i * 3
    d.positions[i3 + 1] -= d.velocities[i] * delta
    d.positions[i3] += Math.sin(elapsed * 0.6 + d.phases[i]) * 0.008
    d.positions[i3 + 2] += Math.cos(elapsed * 0.4 + d.phases[i]) * 0.004
    d.rotations[i3] += d.rotSpeeds[i3] * delta
    d.rotations[i3 + 1] += d.rotSpeeds[i3 + 1] * delta
    d.rotations[i3 + 2] += d.rotSpeeds[i3 + 2] * delta
    if (d.positions[i3 + 1] < Y_MIN) {
      d.positions[i3] = (Math.random() - 0.5) * X_BOUND * 2
      d.positions[i3 + 1] = Y_MAX + Math.random() * 0.3
      d.positions[i3 + 2] = (Math.random() - 0.5) * Z_BOUND * 2
    }
    _dummy.position.set(d.positions[i3], d.positions[i3 + 1], d.positions[i3 + 2])
    _dummy.rotation.set(d.rotations[i3], d.rotations[i3 + 1], d.rotations[i3 + 2])
    _dummy.scale.setScalar(d.scales[i])
    _dummy.updateMatrix()
    activeInstancedMesh!.setMatrixAt(i, _dummy.matrix)
  }
  activeInstancedMesh!.instanceMatrix.needsUpdate = true
}

// --- Points update functions ---

function updateSunsetDust(arr: Float32Array, elapsed: number, delta: number) {
  if (!particlePhases) return
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3
    const p = particlePhases[idx]
    arr[i] += Math.sin(elapsed * 0.3 + p) * 0.001
    arr[i + 1] += Math.cos(elapsed * 0.2 + p) * 0.0007
    arr[i + 2] += Math.sin(elapsed * 0.25 + p * 1.3) * 0.0008
  }
}

function updateBubbles(arr: Float32Array, elapsed: number, delta: number) {
  if (!particleVelocities || !particlePhases) return
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3
    arr[i + 1] += particleVelocities[idx] * delta
    arr[i] += Math.sin(elapsed * 0.6 + particlePhases[idx]) * 0.0015
    arr[i + 2] += Math.cos(elapsed * 0.5 + particlePhases[idx]) * 0.001
    if (arr[i + 1] > Y_MAX) {
      arr[i] = (Math.random() - 0.5) * X_BOUND * 2
      arr[i + 1] = Y_MIN - Math.random() * 0.3
      arr[i + 2] = (Math.random() - 0.5) * Z_BOUND * 2
    }
  }
}

function updateStars(elapsed: number, delta: number) {
  if (!activeParticles) return
  activeParticles.rotation.y += delta * 0.02
  const material = activeParticles.material as THREE.PointsMaterial
  material.opacity = 0.55 + Math.sin(elapsed * 2.4) * 0.15
}

function updateShootingStars(delta: number) {
  if (!activeShootingStars || !shootingStarData) return
  const pos = activeShootingStars.geometry.getAttribute('position') as THREE.BufferAttribute
  const arr = pos.array as Float32Array
  const { velocities, lifetimes, maxLifetimes } = shootingStarData
  const material = activeShootingStars.material as THREE.PointsMaterial

  let anyActive = false
  for (let i = 0; i < lifetimes.length; i++) {
    const i3 = i * 3
    lifetimes[i] -= delta
    if (lifetimes[i] > 0) {
      anyActive = true
      arr[i3] += velocities[i * 2] * delta
      arr[i3 + 1] += velocities[i * 2 + 1] * delta
      const t = lifetimes[i] / maxLifetimes[i]
      material.opacity = t * 0.9
    } else if (Math.random() < 0.003) {
      arr[i3] = (Math.random() - 0.5) * X_BOUND * 1.5
      arr[i3 + 1] = 1.8 + Math.random() * 1.0
      arr[i3 + 2] = (Math.random() - 0.5) * Z_BOUND
      const angle = -Math.PI * 0.25 + (Math.random() - 0.5) * 0.3
      const speed = 1.5 + Math.random() * 1.0
      velocities[i * 2] = Math.cos(angle) * speed
      velocities[i * 2 + 1] = Math.sin(angle) * speed
      maxLifetimes[i] = 0.4 + Math.random() * 0.3
      lifetimes[i] = maxLifetimes[i]
    }
  }
  pos.needsUpdate = true
  if (!anyActive) material.opacity = 0
}

function updateSnowflakes(arr: Float32Array, elapsed: number, delta: number) {
  if (!particleVelocities || !particlePhases) return
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3
    const p = particlePhases[idx]
    arr[i + 1] -= particleVelocities[idx] * delta
    arr[i] += Math.sin(elapsed * 0.5 + p) * 0.0015
    arr[i + 2] += Math.cos(elapsed * 0.35 + p) * 0.001
    if (arr[i + 1] < Y_MIN) {
      arr[i] = (Math.random() - 0.5) * X_BOUND * 2
      arr[i + 1] = Y_MAX + Math.random() * 0.3
      arr[i + 2] = (Math.random() - 0.5) * Z_BOUND * 2
    }
  }
  const mat = activeParticles!.material as THREE.PointsMaterial
  mat.opacity = 0.55 + Math.sin(elapsed * 3.0) * 0.1
}

function updateCafeDust(arr: Float32Array, elapsed: number, delta: number) {
  if (!particlePhases) return
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3
    const p = particlePhases[idx]
    arr[i] += Math.sin(elapsed * 0.4 + p) * 0.0007
    arr[i + 1] += Math.cos(elapsed * 0.55 + p) * 0.0005
    arr[i + 2] += Math.sin(elapsed * 0.3 + p) * 0.0007
  }
}

function updateMinimalDust(arr: Float32Array, elapsed: number, delta: number) {
  if (!particlePhases) return
  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3
    const p = particlePhases[idx]
    arr[i] += Math.sin(elapsed * 0.2 + p) * 0.0004
    arr[i + 1] += Math.cos(elapsed * 0.15 + p) * 0.0003
    arr[i + 2] += Math.sin(elapsed * 0.18 + p * 1.2) * 0.0004
  }
}

// --- Particle creation functions ---

function randomInBounds(): [number, number, number] {
  return [
    (Math.random() - 0.5) * X_BOUND * 2,
    Y_MIN + Math.random() * (Y_MAX - Y_MIN),
    (Math.random() - 0.5) * Z_BOUND * 2,
  ]
}

function createPetalGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.5)
  shape.bezierCurveTo(0.3, -0.2, 0.4, 0.2, 0, 0.5)
  shape.bezierCurveTo(-0.4, 0.2, -0.3, -0.2, 0, -0.5)
  const geo = new THREE.ShapeGeometry(shape, 6)  // more segments for curvature

  // Add Z curvature — cup the petal like a real flower petal
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const distFromCenter = Math.sqrt(x * x + y * y)
    pos.setZ(i, distFromCenter * 0.15)  // curve outward from center
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()  // CRITICAL — normals needed for lighting
  return geo
}

function createLeafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.6)
  shape.bezierCurveTo(0.25, -0.3, 0.3, 0.1, 0.15, 0.4)
  shape.bezierCurveTo(0.05, 0.55, -0.05, 0.55, -0.15, 0.4)
  shape.bezierCurveTo(-0.3, 0.1, -0.25, -0.3, 0, -0.6)
  const geo = new THREE.ShapeGeometry(shape, 6)

  // Add Z curvature — cup the leaf
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const distFromCenter = Math.sqrt(x * x + y * y)
    pos.setZ(i, distFromCenter * 0.15)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

function createInstancedPetals(count: number): THREE.InstancedMesh {
  const geo = createPetalGeometry()
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffb0cc,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.4,
    metalness: 0.05,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'bg-petals'
  mesh.frustumCulled = false

  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count)
  const phases = new Float32Array(count)
  const rotations = new Float32Array(count * 3)
  const rotSpeeds = new Float32Array(count * 3)
  const scales = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    const i3 = i * 3
    positions[i3] = x; positions[i3 + 1] = y; positions[i3 + 2] = z
    velocities[i] = 0.1 + Math.random() * 0.24
    phases[i] = Math.random() * Math.PI * 2
    rotations[i3] = Math.random() * Math.PI * 2
    rotations[i3 + 1] = Math.random() * Math.PI * 2
    rotations[i3 + 2] = Math.random() * Math.PI * 2
    rotSpeeds[i3] = (Math.random() - 0.5) * 1.5
    rotSpeeds[i3 + 1] = (Math.random() - 0.5) * 1.2
    rotSpeeds[i3 + 2] = (Math.random() - 0.5) * 0.8
    scales[i] = 0.05 + Math.random() * 0.07 // 0.05-0.12

    _dummy.position.set(x, y, z)
    _dummy.rotation.set(rotations[i3], rotations[i3 + 1], rotations[i3 + 2])
    _dummy.scale.setScalar(scales[i])
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
  }

  instancedData = { positions, velocities, phases, rotations, rotSpeeds, scales, count }
  scene.add(mesh)
  return mesh
}

function createInstancedLeaves(count: number): THREE.InstancedMesh {
  const geo = createLeafGeometry()
  const leafColors = [0x6b8e4e, 0xc4a035]
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x6b8e4e,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.5,
    metalness: 0.02,
    clearcoat: 0.2,
    clearcoatRoughness: 0.5,
  })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.name = 'bg-leaves'
  mesh.frustumCulled = false
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)

  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count)
  const phases = new Float32Array(count)
  const rotations = new Float32Array(count * 3)
  const rotSpeeds = new Float32Array(count * 3)
  const scales = new Float32Array(count)
  const _leafColor = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    const i3 = i * 3
    positions[i3] = x; positions[i3 + 1] = y; positions[i3 + 2] = z
    velocities[i] = 0.06 + Math.random() * 0.12
    phases[i] = Math.random() * Math.PI * 2
    rotations[i3] = Math.random() * Math.PI * 2
    rotations[i3 + 1] = Math.random() * Math.PI * 2
    rotations[i3 + 2] = Math.random() * Math.PI * 2
    rotSpeeds[i3] = (Math.random() - 0.5) * 1.8
    rotSpeeds[i3 + 1] = (Math.random() - 0.5) * 1.4
    rotSpeeds[i3 + 2] = (Math.random() - 0.5) * 1.0
    scales[i] = 0.06 + Math.random() * 0.08 // 0.06-0.14

    // Random green or golden color
    _leafColor.setHex(leafColors[Math.random() < 0.6 ? 0 : 1])
    mesh.setColorAt(i, _leafColor)

    _dummy.position.set(x, y, z)
    _dummy.rotation.set(rotations[i3], rotations[i3 + 1], rotations[i3 + 2])
    _dummy.scale.setScalar(scales[i])
    _dummy.updateMatrix()
    mesh.setMatrixAt(i, _dummy.matrix)
  }

  instancedData = { positions, velocities, phases, rotations, rotSpeeds, scales, count }
  scene.add(mesh)
  return mesh
}

function createSunsetDust(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  particleVelocities = null
  particlePhases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    particlePhases[i] = Math.random() * Math.PI * 2
  }
  return makePoints('bg-sunset-dust', positions, { color: 0xffc860, size: 0.08, opacity: 0.55 })
}

function createBubbles(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  particleVelocities = new Float32Array(count)
  particlePhases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    particleVelocities[i] = 0.06 + Math.random() * 0.12
    particlePhases[i] = Math.random() * Math.PI * 2
  }
  return makePoints('bg-bubbles', positions, { color: 0xc8e8ff, size: 0.14, opacity: 0.55, texture: getBubbleTexture() })
}

function createStars(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const r = 3.2 + Math.random() * 2
    const theta = Math.random() * Math.PI * 2
    const phi = Math.random() * Math.PI
    positions[i3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i3 + 1] = Math.abs(r * Math.cos(phi)) + 0.35
    positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  particleVelocities = null
  particlePhases = null
  return makePoints('bg-stars', positions, { color: 0xe6edff, size: 0.07, opacity: 0.7, additive: false })
}

function createShootingStars(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 2)
  const lifetimes = new Float32Array(count)
  const maxLifetimes = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0; positions[i * 3 + 1] = -10; positions[i * 3 + 2] = 0
    lifetimes[i] = 0
    maxLifetimes[i] = 0.5
  }
  shootingStarData = { velocities, lifetimes, maxLifetimes }
  return makePoints('bg-shooting-stars', positions, { color: 0xffffff, size: 0.07, opacity: 0 })
}

function createSnowflakes(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  particleVelocities = new Float32Array(count)
  particlePhases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    particleVelocities[i] = 0.04 + Math.random() * 0.08
    particlePhases[i] = Math.random() * Math.PI * 2
  }
  return makePoints('bg-snowflakes', positions, { color: 0xe8d8f8, size: 0.07, opacity: 0.6, texture: getSnowflakeTexture() })
}

function createCafeDust(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  particleVelocities = null
  particlePhases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    particlePhases[i] = Math.random() * Math.PI * 2
  }
  return makePoints('bg-cafe-dust', positions, { color: 0xffd8b8, size: 0.07, opacity: 0.45 })
}

function createMinimalDust(count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  particleVelocities = null
  particlePhases = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = randomInBounds()
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    particlePhases[i] = Math.random() * Math.PI * 2
  }
  return makePoints('bg-minimal-dust', positions, { color: 0xe0ddd8, size: 0.05, opacity: 0.25 })
}

// Cached soft circle texture for all point particles
let _softCircleTexture: THREE.Texture | null = null
function getSoftCircleTexture(): THREE.Texture {
  if (_softCircleTexture) return _softCircleTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  _softCircleTexture = new THREE.CanvasTexture(canvas)
  return _softCircleTexture
}

// Snowflake texture — 6-pointed star with soft edges
let _snowflakeTexture: THREE.Texture | null = null
function getSnowflakeTexture(): THREE.Texture {
  if (_snowflakeTexture) return _snowflakeTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(255,255,255,0.6)'
  ctx.shadowBlur = 6
  // Draw 3 crossed lines (6 arms)
  for (let a = 0; a < 3; a++) {
    const angle = (a * Math.PI) / 3
    const dx = Math.cos(angle) * half * 0.75
    const dy = Math.sin(angle) * half * 0.75
    ctx.beginPath()
    ctx.moveTo(half - dx, half - dy)
    ctx.lineTo(half + dx, half + dy)
    ctx.stroke()
    // Small branches on each arm
    for (const sign of [-1, 1]) {
      const bx = Math.cos(angle) * half * 0.4
      const by = Math.sin(angle) * half * 0.4
      const branchAngle = angle + sign * Math.PI / 4
      const bl = half * 0.25
      ctx.beginPath()
      ctx.moveTo(half + bx, half + by)
      ctx.lineTo(half + bx + Math.cos(branchAngle) * bl, half + by + Math.sin(branchAngle) * bl)
      ctx.stroke()
    }
  }
  // Soft radial fade
  const fadeGrad = ctx.createRadialGradient(half, half, half * 0.5, half, half, half)
  fadeGrad.addColorStop(0, 'rgba(0,0,0,0)')
  fadeGrad.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = fadeGrad
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'source-over'
  _snowflakeTexture = new THREE.CanvasTexture(canvas)
  return _snowflakeTexture
}

// Bubble texture — ring highlight with semi-transparent center
let _bubbleTexture: THREE.Texture | null = null
function getBubbleTexture(): THREE.Texture {
  if (_bubbleTexture) return _bubbleTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2
  // Semi-transparent fill
  const fillGrad = ctx.createRadialGradient(half, half, 0, half, half, half)
  fillGrad.addColorStop(0, 'rgba(255,255,255,0.1)')
  fillGrad.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  fillGrad.addColorStop(0.85, 'rgba(255,255,255,0.7)')
  fillGrad.addColorStop(0.95, 'rgba(255,255,255,0.9)')
  fillGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = fillGrad
  ctx.fillRect(0, 0, size, size)
  // Specular highlight
  const hlGrad = ctx.createRadialGradient(half * 0.7, half * 0.65, 0, half * 0.7, half * 0.65, half * 0.25)
  hlGrad.addColorStop(0, 'rgba(255,255,255,0.8)')
  hlGrad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hlGrad
  ctx.fillRect(0, 0, size, size)
  _bubbleTexture = new THREE.CanvasTexture(canvas)
  return _bubbleTexture
}

function makePoints(
  name: string,
  positions: Float32Array,
  opts: { color: number; size: number; opacity: number; additive?: boolean; texture?: THREE.Texture },
): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: opts.color,
    size: opts.size,
    map: opts.texture ?? getSoftCircleTexture(),
    transparent: true,
    opacity: opts.opacity,
    depthWrite: false,
    blending: opts.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.name = name
  points.frustumCulled = false
  scene.add(points)
  return points
}

// --- Scene application ---

function isTransparentMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('transparent')
}

function applyBackgroundScene(name: BackgroundPreset) {
  clearParticles()
  clearTexture()
  applyLighting(name)

  const transparent = isTransparentMode()
  const skipSceneBg = isGradientBackgroundActive() || transparent
  if (skipSceneBg) {
    scene.background = null
  }

  particlePreset = name

  switch (name) {
    case 'sakura':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#ffe7f4', '#f8cde7', '#efb7dc'])
      activeInstancedMesh = createInstancedPetals(30)
      break
    case 'night':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#0f1630', '#192751', '#30477f'])
      activeParticles = createStars(140)
      activeShootingStars = createShootingStars(2)
      break
    case 'cafe':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#6f4a3b', '#9a6a4c', '#c28d5d'])
      activeParticles = createCafeDust(30)
      break
    case 'sunset':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#ff9f68', '#ff77a3', '#8f63bf'])
      activeParticles = createSunsetDust(30)
      break
    case 'ocean':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#5a9ec4', '#3a7aaa', '#2a5a80'])
      activeParticles = createBubbles(30)
      break
    case 'forest':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#a8d4a0', '#6a9e60', '#4a7a3a'])
      activeInstancedMesh = createInstancedLeaves(22)
      break
    case 'lavender':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#e8d0f4', '#d4b8e8', '#b898d8'])
      activeParticles = createSnowflakes(40)
      break
    case 'minimal':
      if (!skipSceneBg) scene.background = buildGradientTexture(['#f8f6f2', '#f2f0ec', '#eceae6'])
      activeParticles = createMinimalDust(18)
      break
    case 'default':
    default:
      if (!skipSceneBg) scene.background = new THREE.Color(0xf8e8f0)
      particlePreset = 'default'
      break
  }
}

function buildGradientTexture(colors: readonly [string, string, string]): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, colors[0])
    gradient.addColorStop(0.5, colors[1])
    gradient.addColorStop(1, colors[2])
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  activeTexture = texture
  return texture
}

function applyLighting(name: BackgroundPreset) {
  const preset = LIGHT_PRESETS[name]
  lightingRig.ambient.color.setHex(preset.ambient[0])
  lightingRig.ambient.intensity = preset.ambient[1]
  lightingRig.skyFill.color.setHex(preset.sky[0])
  lightingRig.skyFill.groundColor.setHex(preset.sky[1])
  lightingRig.skyFill.intensity = preset.sky[2]
  lightingRig.key.color.setHex(preset.key[0])
  lightingRig.key.intensity = preset.key[1]
  lightingRig.rim.color.setHex(preset.rim[0])
  lightingRig.rim.intensity = preset.rim[1]
  lightingRig.bounce.color.setHex(preset.bounce[0])
  lightingRig.bounce.intensity = preset.bounce[1]
}

function clearParticles() {
  if (activeParticles) {
    scene.remove(activeParticles)
    activeParticles.geometry.dispose()
    ;(activeParticles.material as THREE.Material).dispose()
    activeParticles = null
  }
  if (activeShootingStars) {
    scene.remove(activeShootingStars)
    activeShootingStars.geometry.dispose()
    ;(activeShootingStars.material as THREE.Material).dispose()
    activeShootingStars = null
    shootingStarData = null
  }
  if (activeInstancedMesh) {
    scene.remove(activeInstancedMesh)
    activeInstancedMesh.geometry.dispose()
    ;(activeInstancedMesh.material as THREE.Material).dispose()
    activeInstancedMesh = null
    instancedData = null
  }
  particleVelocities = null
  particlePhases = null
}

function clearTexture() {
  if (!activeTexture) return
  activeTexture.dispose()
  activeTexture = null
}

export function applyThemeParticles(theme: string) {
  const preset = (theme as BackgroundPreset)
  const valid: BackgroundPreset[] = ['sakura', 'sunset', 'night', 'cafe', 'ocean', 'forest', 'lavender', 'minimal']
  applyBackgroundScene(valid.includes(preset as BackgroundPreset) ? preset as BackgroundPreset : 'default')
}
