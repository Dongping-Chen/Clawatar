import * as THREE from 'three'
import { scene, renderer, camera, controls, teardownRoomBloom } from '../scene'
import { getAsset, loadGLB } from './asset-registry'
import { disableRoomMode, isRoomMode } from '../room-scene'
import { suppressBackgrounds } from '../backgrounds'
import type { SceneDescription, SceneObject, LightOverride } from './scene-types'

// 5-step gradient for visible anime cel-shading bands
const toonGradient = new THREE.DataTexture(
  new Uint8Array([40, 80, 140, 200, 255]), 5, 1, THREE.RedFormat
)
toonGradient.minFilter = THREE.NearestFilter
toonGradient.magFilter = THREE.NearestFilter
toonGradient.needsUpdate = true

let currentGroup: THREE.Group | null = null
let currentLights: THREE.Light[] = []
let currentWalkBounds = { minX: -1.5, maxX: 1.5, minZ: -1.2, maxZ: 1.2 }
let hiddenSceneLights: { obj: THREE.Object3D; intensity: number }[] = []

/** Scene layer index — scene GLB meshes go here for dual-pass rendering */
export const SCENE_LAYER = 1

/** Exposure multipliers (kept for export compatibility but not used in single-pass mode) */
export const SCENE_EXPOSURE = 0.15
export const CHAR_EXPOSURE = 1.0

/** How much to dim scene GLB emissive materials (0.0=black, 1.0=original).
 *  Blender bakes ALL rendering into emissive — values 0-25.
 *  Applied to emissiveIntensity only (NOT emissive color).
 *  0.12 gives natural room brightness without blowout. */
const SCENE_EMISSIVE_SCALE = 0.12

/** How much to scale character lights in scene mode.
 *  Higher = softer face/body lighting preserved from "holy light" rig.
 *  0.55 keeps the nice face glow without overexposure. */
const SCENE_LIGHT_SCALE = 0.55

/** Per-scene camera & lighting overrides.
 *  Keys match the GLB filename without extension (e.g. "cozy-bedroom-v6"). */
const SCENE_CONFIGS: Record<string, {
  cameraPos?: [number, number, number]
  cameraTarget?: [number, number, number]
  fov?: number
  exposure?: number
  minAzimuth?: number
  maxAzimuth?: number
  walkBounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
  charLightBoost?: number  // multiplier on scene-char lights (default 1.0)
  modelOffset?: [number, number, number]  // shift the entire GLB (x, y, z)
  modelRotation?: number  // extra Y rotation in radians (on top of default Math.PI)
  emissiveScale?: number  // per-scene emissive dimming (default SCENE_EMISSIVE_SCALE)
  glbLightScale?: number  // scale for embedded Blender lights instead of disabling (default 0 = disabled)
  bgColor?: number  // scene background color (default 0x1a1520)
  emissiveColorBoost?: number  // multiply emissive COLOR for scenes with sub-1.0 baked strengths (default 1.0)
  supplementalLights?: Array<{
    type: 'ambient' | 'directional' | 'point'
    color: number
    intensity: number
    position?: [number, number, number]
  }>
}> = {
  'cozy-bedroom-v6': {
    cameraPos: [0, 1.35, 4.0],
    cameraTarget: [0, 0.85, 0],
    fov: 42,
    exposure: 1.0,
    charLightBoost: 1.2,
  },
  'cozy-bedroom-v8': {
    cameraPos: [0, 1.35, 4.0],
    cameraTarget: [0, 0.85, 0],
    fov: 42,
    exposure: 1.0,
    charLightBoost: 1.2,
  },
  'cozy-bedroom-v9': {
    cameraPos: [0, 1.35, 4.0],
    cameraTarget: [0, 0.85, 0],
    fov: 42,
    exposure: 1.0,
    charLightBoost: 1.2,
  },
  'swimming-pool': {
    cameraPos: [0, 1.6, 5.0],
    cameraTarget: [0, 0.6, 0],
    fov: 48,
    exposure: 1.1,
    charLightBoost: 2.5,
    emissiveScale: 0.5,  // v8: emissive-only — pool has deep rendering issue with alpha:true canvas, WIP
    minAzimuth: -Math.PI / 2,
    maxAzimuth: Math.PI / 2,
    walkBounds: { minX: -0.5, maxX: 0.5, minZ: -0.3, maxZ: 0.5 },
  },
  'cafe': {
    modelOffset: [0, 0, -1.5],  // push counter further behind to avoid table clipping char
    cameraPos: [0, 1.3, 4.2],  // slightly further back
    cameraTarget: [0, 0.85, 0],
    fov: 48,  // wider to see more café
    exposure: 0.95,
    charLightBoost: 1.1,
  },
  'phone-booth': {
    // Outdoor night street — booth at (-1.0, 0.8) in Blender → (1.0, 0, -0.8) after PI rot
    // Shift scene so booth lands beside the character, not overlapping
    modelOffset: [-0.8, 0, 0.5],  // booth at (0.2, 0, -0.3) — just right of character
    cameraPos: [0, 1.35, 4.0],  // standard distance
    cameraTarget: [0, 0.85, 0],
    fov: 46,  // balanced FOV
    exposure: 0.90,
    emissiveScale: 0.05,
    minAzimuth: -Math.PI / 2,
    maxAzimuth: Math.PI / 2,
    charLightBoost: 3.5,
    walkBounds: { minX: -0.8, maxX: 0.8, minZ: -0.5, maxZ: 0.5 },
  },
  'sunset-balcony': {
    modelOffset: [0, 0, -0.5],
    cameraPos: [0, 1.4, 3.5],
    cameraTarget: [0, 0.85, -0.5],
    fov: 48,
    exposure: 0.95,
    charLightBoost: 1.5,
    emissiveScale: 0.25,
    bgColor: 0x4a2040,
    minAzimuth: -Math.PI / 2,
    maxAzimuth: Math.PI / 2,
    walkBounds: { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.3 },
  },
  'izakaya': {
    modelOffset: [0, 0, -0.8],  // gently push table behind char; keep room visible
    cameraPos: [0, 1.3, 3.8],
    cameraTarget: [0, 0.85, 0],
    fov: 44,
    exposure: 0.90,
    charLightBoost: 1.3,
    walkBounds: { minX: -0.3, maxX: 0.3, minZ: -0.3, maxZ: 0.3 },
  },
}

const CSS_OVERLAY_IDS = ['animated-bg', 'particles-canvas'] as const

function setCssOverlayVisibility(visible: boolean): void {
  for (const id of CSS_OVERLAY_IDS) {
    const el = document.getElementById(id)
    if (el) el.style.display = visible ? '' : 'none'
  }
}

function toonMat(color: string | number): THREE.MeshToonMaterial {
  const c = typeof color === 'string' ? new THREE.Color(color) : color
  return new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient })
}

function createFloor(w: number, d: number, color: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d)
  const mat = toonMat(color)
  mat.side = THREE.DoubleSide
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  mesh.name = 'scene-floor'
  return mesh
}

function createCeiling(w: number, d: number, h: number, color: string): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d)
  const mat = toonMat(color)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = Math.PI / 2
  mesh.position.y = h
  mesh.receiveShadow = true
  mesh.name = 'scene-ceiling'
  return mesh
}

function createWalls(w: number, d: number, h: number, color: string): THREE.Group {
  const group = new THREE.Group()
  const halfW = w / 2
  const halfD = d / 2
  const mat = () => {
    const m = toonMat(color)
    m.side = THREE.DoubleSide
    m.transparent = true
    m.opacity = 1
    return m
  }

  const walls: Array<{ geo: [number, number]; pos: THREE.Vector3; rotY: number; name: string }> = [
    { geo: [w, h], pos: new THREE.Vector3(0, h / 2, -halfD), rotY: 0, name: 'wall-back' },
    { geo: [w, h], pos: new THREE.Vector3(0, h / 2, halfD), rotY: Math.PI, name: 'wall-front' },
    { geo: [d, h], pos: new THREE.Vector3(-halfW, h / 2, 0), rotY: Math.PI / 2, name: 'wall-left' },
    { geo: [d, h], pos: new THREE.Vector3(halfW, h / 2, 0), rotY: -Math.PI / 2, name: 'wall-right' },
  ]

  for (const wall of walls) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...wall.geo), mat())
    mesh.position.copy(wall.pos)
    mesh.rotation.y = wall.rotY
    mesh.receiveShadow = true
    mesh.castShadow = false
    mesh.name = wall.name
    group.add(mesh)
  }
  return group
}

function applyToonMaterial(obj: THREE.Object3D, tint?: string): void {
  obj.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    const oldMat = child.material as THREE.MeshStandardMaterial
    const color = tint ? new THREE.Color(tint) : (oldMat.color?.clone() ?? new THREE.Color(0xcccccc))
    child.material = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient,
    })
    oldMat.dispose() // prevent GPU memory leak
    child.castShadow = true
    child.receiveShadow = true
  })
}

function getEmissiveBrightness(mat: THREE.MeshStandardMaterial): number {
  const hsl = { h: 0, s: 0, l: 0 }
  mat.emissive.getHSL(hsl)
  return (mat.emissiveIntensity ?? 1) * hsl.l
}

async function placeObject(group: THREE.Group, obj: SceneObject): Promise<void> {
  const entry = getAsset(obj.assetId)
  if (!entry) {
    console.warn(`Asset not found: ${obj.assetId}`)
    return
  }
  const model = await loadGLB(entry.path)
  const scale = (obj.scale ?? 1) * entry.defaultScale
  model.scale.setScalar(scale)

  if (obj.rotation) {
    const [rx, ry, rz] = obj.rotation
    model.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz)
    )
  }

  // Snap model bottom to the target Y position (ground alignment)
  // Compute bounding box AFTER scale + rotation to get accurate min Y
  const box = new THREE.Box3().setFromObject(model)
  const bottomOffset = box.min.y  // how far below origin the model extends
  model.position.set(obj.position[0], obj.position[1] - bottomOffset, obj.position[2])

  applyToonMaterial(model, obj.tint)
  model.name = `obj-${obj.assetId}`
  group.add(model)
}

const LIGHTING_PRESETS: Record<string, () => THREE.Light[]> = {
  cozy: () => {
    // Warm amber bedroom feel — low ambient, warm key, soft fill
    const lights: THREE.Light[] = [
      Object.assign(new THREE.AmbientLight(0xffe8d0, 0.35), { name: 'scene-ambient' }),
      Object.assign(new THREE.HemisphereLight(0xffddb0, 0x664433, 0.25), { name: 'scene-hemi' }),
    ]
    const key = new THREE.DirectionalLight(0xffdfb0, 0.7)
    key.position.set(0.5, 2.5, 1.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.002
    key.name = 'scene-key'
    lights.push(key)
    // Soft fill from opposite side to prevent dark shadows
    const fill = new THREE.DirectionalLight(0xffd0a0, 0.25)
    fill.position.set(-1.5, 2, -0.5)
    fill.name = 'scene-fill'
    lights.push(fill)
    // Warm point for atmosphere
    const warm = new THREE.PointLight(0xffaa66, 0.3, 6)
    warm.position.set(0, 1.5, 0)
    warm.name = 'scene-warm'
    lights.push(warm)
    return lights
  },
  bright: () => {
    // Warm-bright — even but not clinical, slight warmth
    const lights: THREE.Light[] = [
      Object.assign(new THREE.AmbientLight(0xfff8ee, 0.4), { name: 'scene-ambient' }),
      Object.assign(new THREE.HemisphereLight(0xfff5e0, 0xccaa88, 0.3), { name: 'scene-hemi' }),
    ]
    const key = new THREE.DirectionalLight(0xfff0dd, 0.7)
    key.position.set(1, 3, 1.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.002
    key.name = 'scene-key'
    lights.push(key)
    const fill = new THREE.DirectionalLight(0xffe8cc, 0.25)
    fill.position.set(-1.5, 2.5, -0.5)
    fill.name = 'scene-fill'
    lights.push(fill)
    return lights
  },
  night: () => {
    // Cool blue moonlit feel
    const lights: THREE.Light[] = [
      Object.assign(new THREE.AmbientLight(0x334466, 0.2), { name: 'scene-ambient' }),
      Object.assign(new THREE.HemisphereLight(0x223355, 0x111122, 0.15), { name: 'scene-hemi' }),
    ]
    const key = new THREE.DirectionalLight(0x4466aa, 0.3)
    key.position.set(1, 2, 1)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.name = 'scene-key'
    lights.push(key)
    lights.push(Object.assign(new THREE.PointLight(0x6688cc, 0.3, 5), { name: 'scene-moon' }))
    return lights
  },
  studio: () => {
    // Warm golden study feel — focused desk lighting with soft ambient
    const lights: THREE.Light[] = [
      Object.assign(new THREE.AmbientLight(0xfff5e0, 0.4), { name: 'scene-ambient' }),
      Object.assign(new THREE.HemisphereLight(0xffeedd, 0x998866, 0.25), { name: 'scene-hemi' }),
    ]
    const key = new THREE.DirectionalLight(0xfff0d0, 0.8)
    key.position.set(1, 3, 1.5)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.002
    key.name = 'scene-key'
    lights.push(key)
    const fill = new THREE.DirectionalLight(0xeeddcc, 0.3)
    fill.position.set(-2, 2, -1)
    fill.name = 'scene-fill'
    lights.push(fill)
    // Subtle warm rim
    const rim = new THREE.PointLight(0xffddaa, 0.3, 6)
    rim.position.set(0, 1.5, 0)
    rim.name = 'scene-rim'
    lights.push(rim)
    return lights
  },
}

function createLighting(preset: string, overrides?: LightOverride[]): THREE.Light[] {
  const factory = LIGHTING_PRESETS[preset] ?? LIGHTING_PRESETS.bright
  const lights = factory()

  if (overrides) {
    for (const ov of overrides) {
      let light: THREE.Light
      if (ov.type === 'point') {
        light = new THREE.PointLight(ov.color ? new THREE.Color(ov.color) : 0xffffff, ov.intensity, 8)
      } else if (ov.type === 'spot') {
        light = new THREE.SpotLight(ov.color ? new THREE.Color(ov.color) : 0xffffff, ov.intensity)
      } else {
        light = new THREE.DirectionalLight(ov.color ? new THREE.Color(ov.color) : 0xffffff, ov.intensity)
      }
      light.position.set(...ov.position)
      lights.push(light)
    }
  }
  return lights
}

/** Scale down all existing character lights for scene mode.
 *  Stores original intensities for restore. Uses SCENE_LIGHT_SCALE factor. */
function suppressExistingLights(): void {
  hiddenSceneLights = []
  scene.traverse((obj) => {
    if (!(obj as any).isLight) return
    // Skip any lights we add ourselves (scene-char-*, scene-ambient, etc.)
    if (obj.name.startsWith('scene-')) return
    const light = obj as any
    hiddenSceneLights.push({ obj, intensity: light.intensity })
    light.intensity = light.intensity * SCENE_LIGHT_SCALE
  })
}

/** Restore lights hidden by suppressExistingLights */
function restoreExistingLights(): void {
  for (const { obj, intensity } of hiddenSceneLights) {
    ;(obj as any).intensity = intensity
    obj.visible = true
  }
  hiddenSceneLights = []
}

function addEmissiveLights(
  model: THREE.Object3D,
  targetScene: THREE.Scene,
  cfg: { charLightBoost?: number },
  lights: THREE.Light[]
): void {
  const candidates: Array<{ mesh: THREE.Mesh; brightness: number; color: THREE.Color }> = []
  const threshold = 0.5

  model.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return

    const storedBrightness = typeof child.userData.emissiveBrightness === 'number'
      ? child.userData.emissiveBrightness
      : 0
    const storedColor = child.userData.emissiveColor instanceof THREE.Color
      ? child.userData.emissiveColor
      : null

    let brightness = storedBrightness
    let color = storedColor

    if (!color || brightness <= 0) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      let brightest = 0
      let brightestColor: THREE.Color | null = null

      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue
        const candidateBrightness = getEmissiveBrightness(material)
        if (candidateBrightness > brightest) {
          brightest = candidateBrightness
          brightestColor = material.emissive?.clone() ?? null
        }
      }

      if (brightness <= 0) brightness = brightest
      if (!color && brightestColor) color = brightestColor
    }

    if (!color || brightness <= threshold) return
    candidates.push({ mesh: child, brightness, color })
  })

  if (candidates.length === 0) return

  candidates.sort((a, b) => b.brightness - a.brightness)

  const boost = cfg.charLightBoost ?? 1.0
  const maxLights = 8
  const lightDistance = 5
  const lightDecay = 2

  for (let i = 0; i < Math.min(maxLights, candidates.length); i++) {
    const { mesh, brightness, color } = candidates[i]
    const position = new THREE.Vector3()
    mesh.getWorldPosition(position)
    const light = new THREE.PointLight(color, brightness * 0.3 * boost, lightDistance, lightDecay)
    light.position.copy(position)
    light.name = `scene-emissive-${i + 1}`
    targetScene.add(light)
    lights.push(light)
  }
}

export async function loadScene(desc: SceneDescription): Promise<() => void> {
  // Disable legacy room if active
  if (isRoomMode()) disableRoomMode()

  console.log('[scene-loader] loadScene called:', desc.id)

  // Kill bloom/composer from legacy room or default mode
  teardownRoomBloom()

  // Suppress ALL existing lights (outdoor, web-enhancement, room)
  suppressExistingLights()

  // Hide platform circles
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.CircleGeometry && obj.parent === scene) {
      (obj as any)._sceneHidden = true
      obj.visible = false
    }
  })

  unloadCurrentScene()

  const group = new THREE.Group()
  group.name = `scene-${desc.id}`

  const { width, depth, height } = desc.room
  group.add(createFloor(width, depth, desc.floor.color))
  group.add(createCeiling(width, depth, height, desc.walls.color))
  group.add(createWalls(width, depth, height, desc.walls.color))

  const objectPromises = desc.objects.map(obj => placeObject(group, obj))
  await Promise.all(objectPromises)

  const lights = createLighting(desc.lighting.preset, desc.lighting.overrides)
  for (const light of lights) {
    group.add(light)
  }

  // Character-dedicated lighting — makes VRM pop from the background
  const charKey = new THREE.DirectionalLight(0xfff5ee, 0.6)
  charKey.position.set(0.3, 2.5, 2.5)
  charKey.name = 'scene-char-key'
  group.add(charKey)

  const charRim = new THREE.PointLight(0xffb0d8, 0.4, 5)
  charRim.position.set(-1.5, 1.8, -1)
  charRim.name = 'scene-char-rim'
  group.add(charRim)

  const charFace = new THREE.PointLight(0xfff0e0, 0.5, 4)
  charFace.position.set(0, 1.5, 1.8)
  charFace.name = 'scene-char-face'
  group.add(charFace)

  lights.push(charKey, charRim, charFace)
  currentLights = lights

  // Configure renderer for scene mode
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMappingExposure = 0.95
  scene.background = new THREE.Color(desc.walls.color)
  renderer.setClearColor(new THREE.Color(desc.walls.color), 1)
  scene.fog = null

  // Suppress the backgrounds system (stops it from overriding scene.background)
  suppressBackgrounds(true)

  setCssOverlayVisibility(false)

  // Camera: inside room looking at center, pulled slightly forward to avoid wall clipping
  const roomDepth = desc.room.depth
  camera.position.set(0, 1.5, roomDepth / 2 - 0.8) // safe distance from front wall
  controls.target.set(0, 0.8, 0)                     // look at room center
  camera.fov = 55
  camera.updateProjectionMatrix()
  controls.minDistance = 0.5
  controls.maxDistance = 8.0
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.6
  controls.update()

  scene.add(group)
  currentGroup = group
  console.log('[scene-loader] Scene group added to scene:', group.name, 'children:', group.children.length)
  console.log('[scene-loader] Camera at:', camera.position.toArray(), 'target:', controls.target.toArray())
  console.log('[scene-loader] Scene background:', scene.background)

  currentWalkBounds = { ...desc.character.walkBounds }

  return () => unloadCurrentScene()
}

export function unloadCurrentScene(): void {
  if (!currentGroup) return
  scene.remove(currentGroup)
  currentGroup.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.geometry?.dispose()
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose())
      } else {
        child.material?.dispose()
      }
    }
  })
  currentGroup = null

  // Remove scene-level character lights
  for (const light of currentLights) {
    scene.remove(light)
    if ('target' in light && (light as any).target) {
      scene.remove((light as any).target)
    }
  }
  currentLights = []

  // Restore suppressed lights
  restoreExistingLights()

  // Restore hidden platform circles
  scene.traverse((obj) => {
    if ((obj as any)._sceneHidden) {
      obj.visible = true
      delete (obj as any)._sceneHidden
    }
  })

  // Restore default renderer settings
  scene.background = new THREE.Color(0xf8e8f0)
  renderer.setClearColor(0xf8e8f0, 1)
  renderer.toneMappingExposure = 1.06

  // Reset camera orbit limits (remove azimuth restriction)
  controls.minAzimuthAngle = -Infinity
  controls.maxAzimuthAngle = Infinity

  // Restore background system and CSS overlays
  suppressBackgrounds(false)
  setCssOverlayVisibility(true)
}

export function getSceneWalkBounds() {
  return { ...currentWalkBounds }
}

/**
 * Load a single complete GLB as the entire room/stage environment.
 * No JSON scene description needed — the GLB IS the scene.
 * Adds character lighting + camera limits to prevent seeing backstage.
 */
export async function loadRoomGLB(glbPath: string, opts?: {
  cameraPos?: [number, number, number]
  cameraTarget?: [number, number, number]
  exposure?: number
  minAzimuth?: number  // radians, default -Math.PI/3 (~60° left)
  maxAzimuth?: number  // radians, default Math.PI/3 (~60° right)
  fov?: number
}): Promise<() => void> {
  // Disable legacy room if active
  if (isRoomMode()) disableRoomMode()
  teardownRoomBloom()
  unloadCurrentScene()
  // Reduce character lights — too intense for scene mode
  suppressExistingLights()
  // NOTE: Do NOT use setupRoomBloom() — bloom causes whiteout with high-emissive GLBs.
  // Single-pass rendering through renderer.render() works correctly.

  // Hide CSS overlays and platform circles
  setCssOverlayVisibility(false)
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.CircleGeometry && obj.parent === scene) {
      (obj as any)._sceneHidden = true
      obj.visible = false
    }
  })

  // Suppress backgrounds
  suppressBackgrounds(true)

  // Look up per-scene config by filename (strip "scenes/" prefix and ".glb" suffix)
  const sceneName = glbPath.replace(/^scenes\//, '').replace(/\.glb$/, '')
  const cfg = SCENE_CONFIGS[sceneName] ?? {}

  console.log('[scene-loader] Loading room GLB:', glbPath, 'config:', sceneName, cfg)
  const model = await loadGLB(glbPath)

  // Blender Y→GLB -Z coordinate transform puts scene furniture at +Z (camera side).
  // Rotate 180° around Y so furniture faces the camera (moves to -Z behind avatar).
  model.rotation.y = Math.PI + (cfg.modelRotation ?? 0)

  // Optional model offset — shift entire scene to center character in a clear area
  if (cfg.modelOffset) {
    model.position.set(cfg.modelOffset[0], cfg.modelOffset[1], cfg.modelOffset[2])
  }

  const group = new THREE.Group()
  group.name = 'room-glb'
  group.add(model)

  // Dim scene emissive materials AND embedded Blender lights
  model.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
      const mat = child.material as THREE.MeshStandardMaterial
      const emScale = cfg.emissiveScale ?? SCENE_EMISSIVE_SCALE
      // Save pre-dimming brightness for addEmissiveLights() to find light sources
      if (mat.emissiveIntensity !== undefined && mat.emissive) {
        const hsl = { h: 0, s: 0, l: 0 }
        mat.emissive.getHSL(hsl)
        child.userData.emissiveBrightness = mat.emissiveIntensity * hsl.l
        child.userData.emissiveColor = mat.emissive.clone()
      }
      // Only scale emissiveIntensity — NOT the emissive color.
      // Scaling both would square the dimming (e.g., 0.35² = 0.12 instead of 0.35).
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity *= emScale
      }
      // For scenes with sub-1.0 Blender emission strengths, the strength gets baked
      // into the emissive color by glTF (emissiveIntensity stays 1.0).
      // emissiveColorBoost multiplies the emissive color to brighten these materials.
      const colorBoost = cfg.emissiveColorBoost ?? 1.0
      if (colorBoost !== 1.0 && mat.emissive) {
        mat.emissive.multiplyScalar(colorBoost)
      }
    }
    // Blender exports lights with extreme intensities (4000-6500+).
    // These are designed for Cycles renderer, NOT real-time Three.js.
    // Scale them by glbLightScale if set, otherwise disable entirely.
    if ((child as any).isLight) {
      const light = child as any
      const glbScale = cfg.glbLightScale ?? 0
      if (glbScale > 0) {
        const newIntensity = light.intensity * glbScale
        console.log(`[scene-loader] Scaled GLB light "${light.name}" ${light.intensity.toFixed(1)} → ${newIntensity.toFixed(2)}`)
        light.intensity = newIntensity
      } else {
        console.log(`[scene-loader] Disabled GLB light "${light.name}" (was ${light.intensity.toFixed(1)})`)
        light.intensity = 0
        light.visible = false
      }
    }
  })

  // Set dark background behind the stage
  const bgColor = new THREE.Color(cfg.bgColor ?? 0x1a1520)
  scene.background = bgColor
  renderer.setClearColor(bgColor, 1)
  scene.fog = null
  scene.add(group)

  // Camera setup — use per-scene config, then opts overrides, then defaults
  const camPos = opts?.cameraPos ?? cfg.cameraPos ?? [0, 1.35, 4.2]
  const camTarget = opts?.cameraTarget ?? cfg.cameraTarget ?? [0, 0.85, 0]
  camera.position.set(...camPos)
  controls.target.set(...camTarget)
  camera.fov = opts?.fov ?? cfg.fov ?? 42
  camera.updateProjectionMatrix()
  controls.update()

  // Add dedicated scene-character lights for soft face/body glow
  // These complement the dimmed existing lights to keep the "holy light" feel
  const boost = cfg.charLightBoost ?? 1.0
  const charFace = new THREE.PointLight(0xfff8f4, 1.2 * boost, 7)
  charFace.name = 'scene-char-face'
  charFace.position.set(0, 1.5, 2.5)
  scene.add(charFace)
  
  const charKey = new THREE.DirectionalLight(0xfff6f2, 1.4 * boost)
  charKey.name = 'scene-char-key'
  charKey.position.set(0.3, 3.0, 3.0)
  scene.add(charKey)
  
  const charRim = new THREE.PointLight(0xffb0d8, 0.5 * boost, 6)
  charRim.name = 'scene-char-rim'
  charRim.position.set(-1.5, 1.8, -1)
  scene.add(charRim)

  // Add warm ambient fill for indoor scenes (prevents completely black areas)
  const ambientFill = new THREE.AmbientLight(0xfff8f0, 0.15)
  ambientFill.name = 'scene-ambient-fill'
  scene.add(ambientFill)
  
  currentLights = [charFace, charKey, charRim, ambientFill]

  // Auto-generate point lights from the brightest emissive meshes in the GLB.
  // Uses pre-dim brightness stored in userData to find light sources.
  addEmissiveLights(model, scene, cfg, currentLights)

  // ── Supplemental Three.js lights (for scenes with dim emissive materials) ──
  if (cfg.supplementalLights) {
    for (const spec of cfg.supplementalLights) {
      let light: THREE.Light
      if (spec.type === 'ambient') {
        light = new THREE.AmbientLight(spec.color, spec.intensity)
      } else if (spec.type === 'directional') {
        const dl = new THREE.DirectionalLight(spec.color, spec.intensity)
        if (spec.position) dl.position.set(...spec.position)
        light = dl
      } else {
        const pl = new THREE.PointLight(spec.color, spec.intensity, 15, 2)
        if (spec.position) pl.position.set(...spec.position)
        light = pl
      }
      light.name = `scene-supplemental-${spec.type}`
      scene.add(light)
      currentLights.push(light)
      console.log(`[scene-loader] Added supplemental ${spec.type} light: ${spec.color.toString(16)} @ ${spec.intensity}`)
    }
  }

  // ── Renderer settings ──
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMappingExposure = opts?.exposure ?? cfg.exposure ?? 0.95

  // Camera orbit limits — CRITICAL: prevent seeing backstage
  controls.minDistance = 1.5
  controls.maxDistance = 6.0
  controls.minPolarAngle = 0.3  // prevent looking from directly above
  controls.maxPolarAngle = 1.5  // prevent looking from below
  controls.minAzimuthAngle = opts?.minAzimuth ?? cfg.minAzimuth ?? -Math.PI / 2.5
  controls.maxAzimuthAngle = opts?.maxAzimuth ?? cfg.maxAzimuth ?? Math.PI / 2.5
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.update()

  currentGroup = group
  // Per-scene walk bounds — keep character in clear center stage
  currentWalkBounds = cfg.walkBounds ?? { minX: -0.4, maxX: 0.4, minZ: -0.3, maxZ: 0.3 }

  console.log('[scene-loader] Room GLB loaded. Camera:', camera.position.toArray(),
    'Azimuth limits:', controls.minAzimuthAngle, '→', controls.maxAzimuthAngle)

  return () => unloadCurrentScene()
}

export function isSceneLoaded(): boolean {
  return currentGroup !== null
}
