import * as THREE from 'three'
import { lightingRig, scene } from './scene'

type BackgroundPreset = 'default' | 'sakura' | 'night' | 'cafe' | 'sunset'

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
}

let activeTexture: THREE.Texture | null = null
let activeParticles: THREE.Points | null = null
let particleMode: 'none' | 'petals' | 'stars' | 'dust' = 'none'
let particleVelocities: Float32Array | null = null
let particlePhases: Float32Array | null = null

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
  if (!activeParticles) return
  if (!activeParticles.geometry.getAttribute('position')) return

  if (particleMode === 'stars') {
    activeParticles.rotation.y += delta * 0.028
    const material = activeParticles.material as THREE.PointsMaterial
    material.opacity = 0.58 + Math.sin(elapsed * 2.4) * 0.16
    return
  }

  const positions = activeParticles.geometry.getAttribute('position') as THREE.BufferAttribute
  const arr = positions.array as Float32Array

  if (!particleVelocities || !particlePhases) return

  for (let i = 0; i < arr.length; i += 3) {
    const idx = i / 3

    if (particleMode === 'petals') {
      arr[i + 1] -= particleVelocities[idx] * delta
      arr[i] += Math.sin(elapsed * 0.9 + particlePhases[idx]) * 0.0026
      arr[i + 2] += Math.cos(elapsed * 0.7 + particlePhases[idx]) * 0.0016

      if (arr[i + 1] < 0.16) {
        arr[i] = (Math.random() - 0.5) * 4.4
        arr[i + 1] = 2.6 + Math.random() * 1.4
        arr[i + 2] = (Math.random() - 0.5) * 4.4
      }
    } else if (particleMode === 'dust') {
      arr[i] += Math.sin(elapsed * 0.4 + particlePhases[idx]) * 0.0007
      arr[i + 1] += Math.cos(elapsed * 0.55 + particlePhases[idx]) * 0.0005
      arr[i + 2] += Math.sin(elapsed * 0.3 + particlePhases[idx]) * 0.0007
    }
  }

  positions.needsUpdate = true
}

function applyBackgroundScene(name: BackgroundPreset) {
  clearParticles()
  clearTexture()
  applyLighting(name)

  switch (name) {
    case 'sakura':
      scene.background = buildGradientTexture(['#ffe7f4', '#f8cde7', '#efb7dc'] as const)
      activeParticles = createPetals(110)
      particleMode = 'petals'
      break
    case 'night':
      scene.background = buildGradientTexture(['#0f1630', '#192751', '#30477f'] as const)
      activeParticles = createStars(170)
      particleMode = 'stars'
      break
    case 'cafe':
      scene.background = buildGradientTexture(['#6f4a3b', '#9a6a4c', '#c28d5d'] as const)
      activeParticles = createDust(90)
      particleMode = 'dust'
      break
    case 'sunset':
      scene.background = buildGradientTexture(['#ff9f68', '#ff77a3', '#8f63bf'] as const)
      activeParticles = createDust(70)
      particleMode = 'dust'
      break
    case 'default':
    default:
      scene.background = new THREE.Color(0xf8e8f0)
      particleMode = 'none'
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

function createPetals(count: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  particleVelocities = new Float32Array(count)
  particlePhases = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    positions[i3] = (Math.random() - 0.5) * 4.2
    positions[i3 + 1] = 0.2 + Math.random() * 3.4
    positions[i3 + 2] = (Math.random() - 0.5) * 4.2
    particleVelocities[i] = 0.1 + Math.random() * 0.24
    particlePhases[i] = Math.random() * Math.PI * 2
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffbddb,
    size: 0.055,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'background-petals'
  points.frustumCulled = false
  scene.add(points)
  return points
}

function createStars(count: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
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

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xe6edff,
    size: 0.042,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'background-stars'
  points.frustumCulled = false
  scene.add(points)
  particleVelocities = null
  particlePhases = null
  return points
}

function createDust(count: number): THREE.Points {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  particleVelocities = new Float32Array(count)
  particlePhases = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    positions[i3] = (Math.random() - 0.5) * 3.8
    positions[i3 + 1] = 0.4 + Math.random() * 2.1
    positions[i3 + 2] = (Math.random() - 0.5) * 3.8
    particleVelocities[i] = 0
    particlePhases[i] = Math.random() * Math.PI * 2
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xffd8b8,
    size: 0.032,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'background-dust'
  points.frustumCulled = false
  scene.add(points)
  return points
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
  if (!activeParticles) return
  scene.remove(activeParticles)
  activeParticles.geometry.dispose()
  ;(activeParticles.material as THREE.Material).dispose()
  activeParticles = null
  particleVelocities = null
  particlePhases = null
}

function clearTexture() {
  if (!activeTexture) return
  activeTexture.dispose()
  activeTexture = null
}
