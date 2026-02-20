import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
// OutlineEffect removed per Dongping's request
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js'

export let scene: THREE.Scene
export let camera: THREE.PerspectiveCamera
export let renderer: THREE.WebGLRenderer
export let controls: OrbitControls
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

export function initScene(canvas: HTMLCanvasElement) {
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
  renderer.shadowMap.enabled = false

  const ambient = new THREE.AmbientLight(0xfff2f6, 0.9)
  ambient.name = 'ambient-light'
  scene.add(ambient)

  const skyFill = new THREE.HemisphereLight(0xffdae8, 0xf0e3ff, 0.55)
  skyFill.name = 'sky-fill-light'
  scene.add(skyFill)

  const key = new THREE.DirectionalLight(0xffd7e7, 1.2)
  key.name = 'key-light'
  key.position.set(0.3, 8.0, 2.0)
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

  // Platform circles removed — shader gradient background replaces them

  controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0.9, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.minDistance = 0.3   // Keep a safe gap from target to avoid camera-inside-head artifacts
  controls.maxDistance = 8.0   // Don't let camera go too far either
  controls.update()

  setBackgroundTheme(DEFAULT_THEME)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })
}

// ═══ CONTACT SHADOW ═══
const SHADOW_OPACITY = 0.4
const SHADOW_BLUR_PASSES = 4
const SHADOW_AREA = 2.5
const SHADOW_RES = 256

let contactShadowRT: THREE.WebGLRenderTarget | null = null
let contactShadowBlurRT: THREE.WebGLRenderTarget | null = null
let contactShadowCamera: THREE.OrthographicCamera | null = null
let contactShadowPlane: THREE.Mesh | null = null
let contactShadowBlurPlane: THREE.Mesh | null = null
let blurHShader: THREE.ShaderMaterial | null = null
let blurVShader: THREE.ShaderMaterial | null = null
let shadowBlurScene: THREE.Scene | null = null
let shadowBlurCamera: THREE.OrthographicCamera | null = null
let shadowSilhouetteMaterial: THREE.MeshBasicMaterial | null = null

export function initContactShadow() {
  contactShadowRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES)
  contactShadowBlurRT = new THREE.WebGLRenderTarget(SHADOW_RES, SHADOW_RES)

  const half = SHADOW_AREA / 2
  contactShadowCamera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 10)
  contactShadowCamera.position.set(0, 4, 0)
  contactShadowCamera.lookAt(0, 0, 0)

  const geo = new THREE.PlaneGeometry(SHADOW_AREA, SHADOW_AREA)
  // Custom shader: radial fade so edges blend to transparent
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tShadow: { value: contactShadowRT.texture },
      uOpacity: { value: SHADOW_OPACITY },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tShadow;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec4 shadow = texture2D(tShadow, vUv);
        // Radial fade from center — fully opaque at center, transparent at edges
        vec2 centered = vUv - 0.5;
        float dist = length(centered) * 2.0; // 0 at center, 1 at corners
        float fade = 1.0 - smoothstep(0.3, 0.95, dist);
        float alpha = (1.0 - shadow.r) * uOpacity * fade;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  })

  contactShadowPlane = new THREE.Mesh(geo, mat)
  contactShadowPlane.rotation.x = -Math.PI / 2
  contactShadowPlane.position.y = 0.005
  contactShadowPlane.renderOrder = -1
  contactShadowPlane.name = 'contact-shadow'
  scene.add(contactShadowPlane)

  blurHShader = new THREE.ShaderMaterial(HorizontalBlurShader)
  blurHShader.depthTest = false

  blurVShader = new THREE.ShaderMaterial(VerticalBlurShader)
  blurVShader.depthTest = false

  contactShadowBlurPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))

  shadowBlurScene = new THREE.Scene()
  shadowBlurScene.add(contactShadowBlurPlane)

  shadowBlurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  shadowSilhouetteMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 })
}

export function updateContactShadow() {
  if (!contactShadowRT || !contactShadowBlurRT || !contactShadowCamera || !contactShadowPlane || !contactShadowBlurPlane || !blurHShader || !blurVShader || !shadowBlurScene || !shadowBlurCamera || !shadowSilhouetteMaterial) {
    return
  }

  contactShadowPlane.visible = false
  const hidden: THREE.Object3D[] = []
  scene.traverse((obj) => {
    if ((obj.name === 'gradient-background' || obj.name === 'background-bokeh' || obj.name === 'contact-shadow' || obj.name.startsWith('bg-')) && obj.visible) {
      obj.visible = false
      hidden.push(obj)
    }
  })

  const prevBg = scene.background
  const prevOverride = scene.overrideMaterial
  const prevClearColor = renderer.getClearColor(new THREE.Color())
  const prevClearAlpha = renderer.getClearAlpha()

  scene.background = null
  scene.overrideMaterial = shadowSilhouetteMaterial

  renderer.setClearColor(0xffffff, 1)
  renderer.setRenderTarget(contactShadowRT)
  renderer.clear()
  renderer.render(scene, contactShadowCamera)

  const blurAmount = 4.0 / SHADOW_RES
  for (let i = 0; i < SHADOW_BLUR_PASSES; i += 1) {
    blurHShader.uniforms.tDiffuse.value = contactShadowRT.texture
    blurHShader.uniforms.h.value = blurAmount * (SHADOW_BLUR_PASSES - i)
    contactShadowBlurPlane.material = blurHShader
    renderer.setRenderTarget(contactShadowBlurRT)
    renderer.clear()
    renderer.render(shadowBlurScene, shadowBlurCamera)

    blurVShader.uniforms.tDiffuse.value = contactShadowBlurRT.texture
    blurVShader.uniforms.v.value = blurAmount * (SHADOW_BLUR_PASSES - i)
    contactShadowBlurPlane.material = blurVShader
    renderer.setRenderTarget(contactShadowRT)
    renderer.clear()
    renderer.render(shadowBlurScene, shadowBlurCamera)
  }

  scene.overrideMaterial = prevOverride
  scene.background = prevBg
  renderer.setRenderTarget(null)
  renderer.setClearColor(prevClearColor, prevClearAlpha)

  contactShadowPlane.visible = true
  for (const obj of hidden) obj.visible = true

  ;(contactShadowPlane.material as THREE.ShaderMaterial).uniforms.tShadow.value = contactShadowRT.texture
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
  lightingRig.key.position.set(2, 3, 2)
  lightingRig.key.intensity = 3.5
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
  lightingRig.key.position.set(0.3, 8.0, 2.0)
  lightingRig.key.intensity = 1.4
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
}
