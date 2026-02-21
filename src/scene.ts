import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
// OutlineEffect removed per Dongping's request

export let scene: THREE.Scene
export let camera: THREE.PerspectiveCamera
export let renderer: THREE.WebGLRenderer
export let controls: any
export let clock: THREE.Clock
export let composer: EffectComposer | null = null
export const outlineEffect: null = null
export let lightingRig: {
  ambient: THREE.AmbientLight
  skyFill: THREE.HemisphereLight
  key: THREE.DirectionalLight
  rim: THREE.DirectionalLight
  bounce: THREE.PointLight
}

export type BackgroundThemeKey =
  | 'sakura'
  | 'sunset'
  | 'ocean'
  | 'night'
  | 'forest'
  | 'lavender'
  | 'minimal'

type ThemeRGB = { r: number; g: number; b: number }

type ThemeGradient = {
  top: ThemeRGB
  bottom: ThemeRGB
}

export type ContactShadowDynamics = {
  lift?: number
  stance?: number
}

export type ContactShadowAnchor = {
  x: number
  z: number
  lift?: number
  stance?: number
  visible?: boolean
}

let contactShadowReceiver: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
let contactShadowEnabled = false
let contactShadowRuntimeEnabled = true
let contactShadowCharacterVisible = true
let contactShadowBaseOpacity = 0.34
let contactShadowExternalAnchor: ContactShadowAnchor | null = null
let contactShadowExternalAnchorTs = 0
const topDownShadowHeight = 4.8
const contactShadowExternalAnchorTTL = 260

function configureKeyLightShadowCasting() {
  if (!lightingRig?.key) return

  const key = lightingRig.key
  // Stylized mode: disable geometry-accurate cast shadow to avoid human-shape outlines.
  key.castShadow = false
}

function ensureContactShadowReceiver() {
  if (contactShadowReceiver) return

  const shadowCanvas = document.createElement('canvas')
  shadowCanvas.width = 512
  shadowCanvas.height = 512
  const ctx = shadowCanvas.getContext('2d')
  if (!ctx) {
    throw new Error('Failed to create stylized shadow texture context')
  }

  const center = 256
  const radius = 256
  const grad = ctx.createRadialGradient(center, center, 0, center, center, radius)
  // Center dark, outer smooth fade for a "puffed" soft blob look.
  grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.82)')
  grad.addColorStop(0.2, 'rgba(0, 0, 0, 0.58)')
  grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.30)')
  grad.addColorStop(0.72, 'rgba(0, 0, 0, 0.10)')
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)')
  ctx.clearRect(0, 0, shadowCanvas.width, shadowCanvas.height)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, shadowCanvas.width, shadowCanvas.height)

  const shadowTexture = new THREE.CanvasTexture(shadowCanvas)
  shadowTexture.colorSpace = THREE.SRGBColorSpace
  shadowTexture.minFilter = THREE.LinearFilter
  shadowTexture.magFilter = THREE.LinearFilter
  shadowTexture.needsUpdate = true

  const receiver = new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 0.74),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      opacity: 0.32,
    })
  )
  receiver.name = 'shadow-receiver'
  receiver.rotation.x = -Math.PI / 2
  receiver.position.set(0, 0.001, 0)
  receiver.receiveShadow = false
  receiver.frustumCulled = false
  receiver.renderOrder = 1
  receiver.visible = false
  receiver.material.depthWrite = false

  contactShadowReceiver = receiver
  scene.add(receiver)
}

function setContactShadowOpacity(opacity: number) {
  contactShadowBaseOpacity = opacity
  if (!contactShadowReceiver) return
  contactShadowReceiver.material.opacity = opacity
}

const BACKGROUND_THEMES: Record<BackgroundThemeKey, ThemeGradient> = {
  sakura: {
    top: { r: 1.0, g: 0.87, b: 0.90 },
    bottom: { r: 0.95, g: 0.72, b: 0.82 },
  },
  sunset: {
    top: { r: 1.0, g: 0.82, b: 0.65 },
    bottom: { r: 0.95, g: 0.55, b: 0.65 },
  },
  ocean: {
    top: { r: 0.75, g: 0.92, b: 1.0 },
    bottom: { r: 0.55, g: 0.70, b: 0.95 },
  },
  night: {
    top: { r: 0.18, g: 0.15, b: 0.32 },
    bottom: { r: 0.08, g: 0.06, b: 0.18 },
  },
  forest: {
    top: { r: 0.82, g: 0.95, b: 0.82 },
    bottom: { r: 0.55, g: 0.80, b: 0.65 },
  },
  lavender: {
    top: { r: 0.92, g: 0.85, b: 1.0 },
    bottom: { r: 0.80, g: 0.70, b: 0.95 },
  },
  minimal: {
    top: { r: 0.97, g: 0.97, b: 0.97 },
    bottom: { r: 0.92, g: 0.90, b: 0.93 },
  },
}

const DEFAULT_THEME: BackgroundThemeKey = 'sakura'
let currentTheme: BackgroundThemeKey = DEFAULT_THEME
let themeBackgroundSuppressed = false
let transparentBackgroundEnabled = false
const platformMeshes: THREE.Mesh[] = []

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)))
}

function rgbToCss(rgb: ThemeRGB): string {
  return `rgb(${clampChannel(rgb.r)}, ${clampChannel(rgb.g)}, ${clampChannel(rgb.b)})`
}

function mixColor(a: ThemeRGB, b: ThemeRGB, t: number): ThemeRGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

function normalizeTheme(theme: string): BackgroundThemeKey {
  const key = (theme || '').toLowerCase().trim()
  if (key in BACKGROUND_THEMES) {
    return key as BackgroundThemeKey
  }
  return DEFAULT_THEME
}

function setPlatformVisibility(visible: boolean) {
  if (platformMeshes.length > 0) {
    for (const mesh of platformMeshes) {
      mesh.visible = visible
    }
    return
  }

  scene?.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.CircleGeometry) {
      obj.visible = visible
    }
  })
}

function applyThemeGradientToDOM(theme: BackgroundThemeKey) {
  const gradient = BACKGROUND_THEMES[theme]
  const mid = mixColor(gradient.top, gradient.bottom, 0.5)
  const topCSS = rgbToCss(gradient.top)
  const midCSS = rgbToCss(mid)
  const bottomCSS = rgbToCss(gradient.bottom)

  const root = document.documentElement
  root.style.setProperty('--theme-top', topCSS)
  root.style.setProperty('--theme-mid', midCSS)
  root.style.setProperty('--theme-bottom', bottomCSS)

  const animatedBg = document.getElementById('animated-bg') as HTMLElement | null
  if (animatedBg) {
    animatedBg.style.animation = transparentBackgroundEnabled ? 'none' : 'clawatar-theme-pan 16s ease-in-out infinite'
    animatedBg.style.opacity = transparentBackgroundEnabled ? '0' : '1'
    animatedBg.style.background = `linear-gradient(160deg, ${topCSS} 0%, ${midCSS} 52%, ${bottomCSS} 100%)`
    animatedBg.style.backgroundSize = '160% 160%'
  }

  document.body.style.background = transparentBackgroundEnabled
    ? 'transparent'
    : `linear-gradient(160deg, ${topCSS} 0%, ${midCSS} 52%, ${bottomCSS} 100%)`
}

function applyThemeSceneBackground() {
  if (themeBackgroundSuppressed) return
  if (transparentBackgroundEnabled) return
  setPlatformVisibility(true)
}

export function setThemeBackgroundSuppressed(suppressed: boolean) {
  themeBackgroundSuppressed = suppressed
  if (!suppressed && !transparentBackgroundEnabled) {
    applyThemeSceneBackground()
  }
}

export function getBackgroundTheme(): BackgroundThemeKey {
  return currentTheme
}

export function setBackgroundTheme(theme: string): BackgroundThemeKey {
  const normalized = normalizeTheme(theme)
  currentTheme = normalized
  applyThemeGradientToDOM(normalized)
  applyThemeSceneBackground()
  return normalized
}

type InitSceneOptions = {
  disableOrbitControls?: boolean
}

function createStaticControls() {
  return {
    target: new THREE.Vector3(0, 0.9, 0),
    enabled: false,
    enableDamping: false,
    dampingFactor: 0,
    minDistance: 0.3,
    maxDistance: 8.0,
    minPolarAngle: 0,
    maxPolarAngle: Math.PI,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
    enablePan: false,
    enableRotate: false,
    enableZoom: false,
    update() {},
  }
}

export async function initScene(canvas: HTMLCanvasElement, options: InitSceneOptions = {}) {
  clock = new THREE.Clock()
  scene = new THREE.Scene()
  scene.background = null

  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.01, 100)
  camera.position.set(0, 1.2, 3.0)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const ambient = new THREE.AmbientLight(0xfff2f6, 0.9)
  ambient.name = 'ambient-light'
  scene.add(ambient)

  const skyFill = new THREE.HemisphereLight(0xffdae8, 0xf0e3ff, 0.55)
  skyFill.name = 'sky-fill-light'
  scene.add(skyFill)

  const key = new THREE.DirectionalLight(0xffd7e7, 1.2)
  key.name = 'key-light'
  key.position.set(0, 5.8, 0.001)
  key.target.position.set(0, 0.95, 0)
  scene.add(key)

  const rim = new THREE.DirectionalLight(0xf6d7ff, 0.48)
  rim.name = 'rim-light'
  rim.position.set(-2.2, 1.6, -2.1)
  scene.add(rim)

  const bounce = new THREE.PointLight(0xffd2e3, 0.28, 8)
  bounce.name = 'bounce-light'
  bounce.position.set(0, 0.65, 1.7)
  scene.add(bounce)

  lightingRig = { ambient, skyFill, key, rim, bounce }
  configureKeyLightShadowCasting()

  // Platform circles removed — shader gradient background replaces them

  if (options.disableOrbitControls) {
    controls = createStaticControls()
  } else {
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')
    controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 0.9, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controls.minDistance = 0.3   // Keep a safe gap from target to avoid camera-inside-head artifacts
    controls.maxDistance = 8.0   // Don't let camera go too far either
    controls.update()
  }

  setBackgroundTheme(DEFAULT_THEME)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })
}

export function initContactShadow(enabled: boolean) {
  contactShadowEnabled = enabled
  if (!enabled) {
    if (contactShadowReceiver) {
      contactShadowReceiver.visible = false
      contactShadowReceiver.scale.set(1, 1, 1)
    }
    return
  }

  ensureContactShadowReceiver()
  configureKeyLightShadowCasting()
  if (contactShadowReceiver) {
    contactShadowReceiver.visible = false
    contactShadowReceiver.scale.set(1, 1, 1)
    contactShadowReceiver.material.opacity = contactShadowBaseOpacity
  }
}

export function updateContactShadow(vrmRoot?: THREE.Object3D | null, dynamics?: ContactShadowDynamics) {
  if (!contactShadowReceiver) return

  if (
    contactShadowExternalAnchor &&
    performance.now() - contactShadowExternalAnchorTs > contactShadowExternalAnchorTTL
  ) {
    contactShadowExternalAnchor = null
  }

  const hasLocalTarget = contactShadowCharacterVisible && !!vrmRoot
  const hasExternalTarget = !hasLocalTarget && !!contactShadowExternalAnchor
  const shouldShow = contactShadowEnabled && contactShadowRuntimeEnabled && (hasLocalTarget || hasExternalTarget)
  contactShadowReceiver.visible = shouldShow
  if (!shouldShow) {
    contactShadowReceiver.scale.set(1, 1, 1)
    return
  }

  const targetX = hasLocalTarget ? vrmRoot!.position.x : (contactShadowExternalAnchor?.x ?? 0)
  const targetZ = hasLocalTarget ? vrmRoot!.position.z : (contactShadowExternalAnchor?.z ?? 0)
  const liftInput = hasLocalTarget
    ? (dynamics?.lift ?? 0)
    : (contactShadowExternalAnchor?.lift ?? 0)
  const targetY = hasLocalTarget
    ? vrmRoot!.position.y + 0.95
    : (0.95 + THREE.MathUtils.clamp(liftInput * 0.2, 0, 0.16))

  contactShadowReceiver.position.x = targetX
  contactShadowReceiver.position.z = targetZ

  // Real-time stylized dynamics: jump higher => bigger and lighter blob.
  const lift = Math.max(0, liftInput)
  const stanceInput = hasLocalTarget
    ? (dynamics?.stance ?? 0.28)
    : (contactShadowExternalAnchor?.stance ?? 0.28)
  const stance = Math.max(0.2, stanceInput)
  const liftNorm = THREE.MathUtils.clamp(lift / 0.45, 0, 1)
  const stanceNorm = THREE.MathUtils.clamp((stance - 0.24) / 0.45, 0, 1)
  const scaleX = 1.0 + liftNorm * 0.28 + stanceNorm * 0.06
  const scaleZ = 1.0 + liftNorm * 0.22 + stanceNorm * 0.08
  contactShadowReceiver.scale.set(scaleX, 1, scaleZ)
  contactShadowReceiver.material.opacity = THREE.MathUtils.clamp(
    contactShadowBaseOpacity * (1 - liftNorm * 0.72),
    0.06,
    contactShadowBaseOpacity
  )

  const key = lightingRig.key
  key.target.position.set(targetX, targetY, targetZ)
  key.position.set(
    targetX,
    targetY + topDownShadowHeight,
    targetZ + 0.001
  )
  key.target.updateMatrixWorld()
}

export function setContactShadowCharacterVisible(visible: boolean) {
  contactShadowCharacterVisible = visible
  if (!visible && contactShadowReceiver) {
    contactShadowReceiver.visible = false
  }
}

export function setContactShadowRuntimeEnabled(enabled: boolean) {
  contactShadowRuntimeEnabled = enabled
  if (!enabled && contactShadowReceiver) {
    contactShadowReceiver.visible = false
    contactShadowReceiver.scale.set(1, 1, 1)
  }
}

export function setContactShadowExternalAnchor(anchor: ContactShadowAnchor | null) {
  if (!anchor || anchor.visible === false || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) {
    contactShadowExternalAnchor = null
    return
  }

  contactShadowExternalAnchor = {
    x: anchor.x,
    z: anchor.z,
    lift: Number.isFinite(anchor.lift) ? Math.max(0, anchor.lift ?? 0) : undefined,
    stance: Number.isFinite(anchor.stance) ? Math.max(0.2, anchor.stance ?? 0.28) : undefined,
    visible: true,
  }
  contactShadowExternalAnchorTs = performance.now()
}

export function setTransparentBackground(transparent: boolean) {
  transparentBackgroundEnabled = transparent

  if (transparent) {
    scene.background = null
    renderer.setClearColor(0x000000, 0)
    setPlatformVisibility(false)
  } else {
    renderer.setClearColor(0x000000, 0)
    applyThemeSceneBackground()
  }

  applyThemeGradientToDOM(currentTheme)
}

export function enableBloom() {
  composer = new EffectComposer(renderer)

  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.15,   // strength — very subtle glow
    0.4,    // radius
    0.92    // threshold — only bright areas bloom
  )
  composer.addPass(bloomPass)

  const outputPass = new OutputPass()
  composer.addPass(outputPass)

  // Handle resize
  const origResize = () => {
    composer?.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', origResize)
}

export let roomBloomPass: UnrealBloomPass | null = null

export function setupRoomBloom(): void {
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.3, 0.4, 0.85
  )
  roomBloomPass = bloomPass
  const outputPass = new OutputPass()
  composer = new EffectComposer(renderer)
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // Handle resize
  const onResize = () => { composer?.setSize(window.innerWidth, window.innerHeight) }
  window.addEventListener('resize', onResize)
}

export function teardownRoomBloom(): void {
  if (composer) {
    composer.dispose()
    composer = null
  }
  roomBloomPass = null
}

/**
 * Enable anime-style outline via OutlineEffect (MMD-style inverted hull).
 * Works with skinned meshes — uses three.js skinning chunks, follows skeleton.
 * Very subtle: thin dark edge for anime cel look.
 */
export function enhanceLightingForEmbed() {
  // === ANIME-STYLE LIGHTING — Bright, warm, character pops ===

  // 1) Hemisphere — warm pink sky, soft muted ground
  lightingRig.skyFill.color.set(0xffe0e8)
  lightingRig.skyFill.groundColor.set(0x806070)
  lightingRig.skyFill.intensity = 1.0

  // 2) Warm ambient base
  lightingRig.ambient.intensity = 1.2
  lightingRig.ambient.color.set(0xffe0c8)

  // 3) Key light — strong warm white
  lightingRig.key.position.set(0, 5.8, 0.001)
  lightingRig.key.target.position.set(0, 0.95, 0)
  lightingRig.key.intensity = 2.4
  lightingRig.key.color.set(0xfff5e6)

  // 4) Fill light — softer opposite side
  const fill = new THREE.DirectionalLight(0xfff0e8, 1.5)
  fill.name = 'fill-light'
  fill.position.set(-1, 2, -1)
  scene.add(fill)

  // 5) Rim light — back silhouette separation
  lightingRig.rim.position.set(0, 2, -3)
  lightingRig.rim.intensity = 2.0
  lightingRig.rim.color.set(0xffd0e8)

  // 6) Face fill — bright point light for face detail
  const faceFill = new THREE.PointLight(0xffd8b0, 2.5, 5.0)
  faceFill.name = 'face-fill'
  faceFill.position.set(0, 1.52, 1.5)
  scene.add(faceFill)

  // 7) Body fill — even torso/leg illumination
  const bodyFill = new THREE.PointLight(0xffd0b0, 1.2, 7.0)
  bodyFill.name = 'body-fill'
  bodyFill.position.set(0, 0.95, 2.0)
  scene.add(bodyFill)

  // 8) Under-chin fill — erase face shadows
  const chinFill = new THREE.PointLight(0xffd0b8, 0.6, 3.8)
  chinFill.name = 'chin-fill'
  chinFill.position.set(0, 0.92, 1.25)
  scene.add(chinFill)

  // 9) Hair highlight — warm shine crown
  const hairLight = new THREE.SpotLight(0xffdcc0, 0.8, 6, Math.PI / 6, 0.7)
  hairLight.name = 'hair-highlight'
  hairLight.position.set(0.3, 3.5, 1.0)
  hairLight.target.position.set(0, 1.6, 0)
  scene.add(hairLight)
  scene.add(hairLight.target)

  // 10) Secondary rim — warm separation other side
  const rim2 = new THREE.DirectionalLight(0xffd8c8, 0.75)
  rim2.name = 'rim2'
  rim2.position.set(2.1, 2.0, -1.2)
  scene.add(rim2)

  // 11) Crown light for anime top highlights on hair
  const topSpot = new THREE.SpotLight(0xffe0c8, 0.7, 8, Math.PI / 5, 0.8)
  topSpot.name = 'top-spot'
  topSpot.position.set(0, 4.1, 0.7)
  topSpot.target.position.set(0, 1.35, 0)
  scene.add(topSpot)
  scene.add(topSpot.target)

  // 12) Warm floor bounce
  lightingRig.bounce.intensity = 0.5
  lightingRig.bounce.color.set(0xffd0b8)
  lightingRig.bounce.position.set(0, 0.15, 1.45)

  // 13) Leg fill
  const legFill = new THREE.PointLight(0xffddd0, 0.5, 5.0)
  legFill.name = 'leg-fill'
  legFill.position.set(0, 0.3, 1.8)
  scene.add(legFill)

  // AgX tone mapping for warm color preservation
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1.65
  configureKeyLightShadowCasting()
  setContactShadowOpacity(0.42)
}

/**
 * Warm-tint VRM MToon materials for high-key anime skin look.
 * Call after VRM model is loaded and added to scene.
 * Multiplies lit color toward warm peach and lifts shade color.
 */
export function warmTintVRMMaterials() {
  const warmTint = new THREE.Color(1.15, 1.05, 0.88) // stronger warm peach shift
  const shadeLift = new THREE.Color(1.25, 1.1, 0.95) // lift shades warm

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of mats) {
      if (!mat) continue
      const m = mat as any

      // Tint base color warmer (works for MToon and standard materials)
      if (m.color && m.color instanceof THREE.Color) {
        m.color.multiply(warmTint)
      }

      // MToon shade color uniforms (v1)
      if (m.uniforms?.shadeColor?.value) {
        m.uniforms.shadeColor.value.multiply(shadeLift)
      }

      // Search all uniforms for shade-related colors
      if (m.uniforms) {
        for (const [key, val] of Object.entries(m.uniforms)) {
          if (key.toLowerCase().includes('shade') && (val as any)?.value instanceof THREE.Color) {
            ;(val as any).value.multiply(shadeLift)
          }
        }
      }

      m.needsUpdate = true
    }
  })
}

/**
 * Enhanced lighting for web mode (solid background).
 * Same light structure as embed but ~40% lower intensity
 * to avoid overexposure against the solid pink background.
 */
export function enhanceLightingForWeb() {
  // 1. Ambient — slightly brighter to compensate for fewer fills
  lightingRig.ambient.intensity = 0.75
  lightingRig.ambient.color.set(0xfff8fa)

  // 2. Hemisphere
  lightingRig.skyFill.intensity = 0.5
  lightingRig.skyFill.color.set(0xffebd6)
  lightingRig.skyFill.groundColor.set(0xd8c8e8)

  // 3. Key light — strong but not blow-out
  lightingRig.key.position.set(0, 5.8, 0.001)
  lightingRig.key.target.position.set(0, 0.95, 0)
  lightingRig.key.intensity = 1.1
  lightingRig.key.color.set(0xfff6f2)

  // 4. Face fill
  const faceFill = new THREE.PointLight(0xfff8f4, 0.6, 5)
  faceFill.name = 'face-fill'
  faceFill.position.set(0, 1.5, 2.0)
  scene.add(faceFill)

  // 5. Body fill
  const bodyFill = new THREE.PointLight(0xfff2f0, 0.45, 6)
  bodyFill.name = 'body-fill'
  bodyFill.position.set(0, 0.8, 2.5)
  scene.add(bodyFill)

  // 6. Chin fill
  const chinFill = new THREE.PointLight(0xffe8f0, 0.2, 3)
  chinFill.name = 'chin-fill'
  chinFill.position.set(0, 0.9, 1.5)
  scene.add(chinFill)

  // 7. Rim — pink edge glow
  lightingRig.rim.intensity = 0.5
  lightingRig.rim.color.set(0xffb0d8)
  lightingRig.rim.position.set(-2.5, 2.0, -1.5)

  // 8. Second rim
  const rim2 = new THREE.DirectionalLight(0xd8c0ff, 0.35)
  rim2.name = 'rim2'
  rim2.position.set(2.5, 2.0, -1.5)
  scene.add(rim2)

  // 9. Hair top light
  const topSpot = new THREE.SpotLight(0xfff0e8, 0.4, 8, Math.PI / 5, 0.7)
  topSpot.name = 'top-spot'
  topSpot.position.set(0, 4, 0.5)
  topSpot.target.position.set(0, 1.4, 0)
  scene.add(topSpot)
  scene.add(topSpot.target)

  // 10. Bounce
  lightingRig.bounce.intensity = 0.25
  lightingRig.bounce.color.set(0xffdce8)
  lightingRig.bounce.position.set(0, 0.1, 1.5)

  // Moderate exposure — don't blow out against solid bg
  renderer.toneMappingExposure = 1.06
  configureKeyLightShadowCasting()
  setContactShadowOpacity(0.34)
}
