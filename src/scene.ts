import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export let scene: THREE.Scene
export let camera: THREE.PerspectiveCamera
export let renderer: THREE.WebGLRenderer
export let controls: OrbitControls
export let clock: THREE.Clock
export let composer: EffectComposer | null = null
export let lightingRig: {
  ambient: THREE.AmbientLight
  skyFill: THREE.HemisphereLight
  key: THREE.DirectionalLight
  rim: THREE.DirectionalLight
  bounce: THREE.PointLight
}

export function initScene(canvas: HTMLCanvasElement) {
  clock = new THREE.Clock()
  scene = new THREE.Scene()

  scene.background = new THREE.Color(0xf8e8f0)

  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100)
  camera.position.set(0, 1.2, 3.0)

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  renderer.setClearColor(0xf8e8f0, 1)

  const ambient = new THREE.AmbientLight(0xfff2f6, 0.9)
  ambient.name = 'ambient-light'
  scene.add(ambient)

  const skyFill = new THREE.HemisphereLight(0xffdae8, 0xf0e3ff, 0.55)
  skyFill.name = 'sky-fill-light'
  scene.add(skyFill)

  const key = new THREE.DirectionalLight(0xffd7e7, 1.2)
  key.name = 'key-light'
  key.position.set(2.1, 2.8, 2.3)
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

  const platform = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf7cadf,
      transparent: true,
      opacity: 0.48
    })
  )
  platform.rotation.x = -Math.PI / 2
  platform.position.set(0, 0.02, 0)
  scene.add(platform)

  const platformGlow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf8ddee,
      transparent: true,
      opacity: 0.25
    })
  )
  platformGlow.rotation.x = -Math.PI / 2
  platformGlow.position.set(0, 0.01, 0)
  scene.add(platformGlow)

  controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0.9, 0)
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.minDistance = 1.5   // Prevent user from zooming inside the model
  controls.maxDistance = 8.0   // Don't let camera go too far either
  controls.update()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })
}

export function setTransparentBackground(transparent: boolean) {
  if (transparent) {
    scene.background = null
    renderer.setClearColor(0x000000, 0)
    // Hide platform circles on transparent bg
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.CircleGeometry) {
        obj.visible = false
      }
    })
  } else {
    scene.background = new THREE.Color(0xf8e8f0)
    renderer.setClearColor(0xf8e8f0, 1)
  }
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

export function enhanceLightingForEmbed() {
  // === "BATHED IN LIGHT" — Character pops against soft background ===
  // Goal: character should be noticeably brighter than background, like a spotlight on stage

  // 1. Base ambient — moderate, not too bright (let spotlights do the work)
  lightingRig.ambient.intensity = 0.85
  lightingRig.ambient.color.set(0xfff8fa)

  // 2. Hemisphere: warm from above, cool from below — provides shape
  lightingRig.skyFill.intensity = 0.6
  lightingRig.skyFill.color.set(0xffebd6)  // Warm peach sky
  lightingRig.skyFill.groundColor.set(0xd8c8e8)  // Cool lavender ground

  // 3. HERO KEY LIGHT — strong frontal spot, the "holy light" effect
  //    Bright, warm, slightly above — like studio beauty dish
  lightingRig.key.position.set(0.3, 3.5, 3.0)  // High, front-center
  lightingRig.key.intensity = 2.1  // VERY STRONG — character must pop
  lightingRig.key.color.set(0xfff6f2)  // Near-white with tiny warm tint

  // 4. Face fill — bright point light right in front of face
  const faceFill = new THREE.PointLight(0xfff8f4, 1.0, 5)
  faceFill.name = 'face-fill'
  faceFill.position.set(0, 1.5, 2.0)
  scene.add(faceFill)

  // 5. Body fill — illuminates torso and legs more evenly
  const bodyFill = new THREE.PointLight(0xfff2f0, 0.75, 6)
  bodyFill.name = 'body-fill'
  bodyFill.position.set(0, 0.8, 2.5)
  scene.add(bodyFill)

  // 6. Under-chin fill — no harsh shadows under nose/chin
  const chinFill = new THREE.PointLight(0xffe8f0, 0.35, 3)
  chinFill.name = 'chin-fill'
  chinFill.position.set(0, 0.9, 1.5)
  scene.add(chinFill)

  // 7. Rim light — pink edge glow for separation from background
  lightingRig.rim.intensity = 0.7
  lightingRig.rim.color.set(0xffb0d8)  // Pink rim
  lightingRig.rim.position.set(-2.5, 2.0, -1.5)

  // 8. Second rim (opposite side) — creates "halo" silhouette
  const rim2 = new THREE.DirectionalLight(0xd8c0ff, 0.5)  // Lavender
  rim2.name = 'rim2'
  rim2.position.set(2.5, 2.0, -1.5)
  scene.add(rim2)

  // 9. Hair top light — creates highlight crown on head
  const topSpot = new THREE.SpotLight(0xfff0e8, 0.6, 8, Math.PI / 5, 0.7)
  topSpot.name = 'top-spot'
  topSpot.position.set(0, 4, 0.5)
  topSpot.target.position.set(0, 1.4, 0)
  scene.add(topSpot)
  scene.add(topSpot.target)

  // 10. Warm bounce from below — floor reflection feel
  lightingRig.bounce.intensity = 0.35
  lightingRig.bounce.color.set(0xffdce8)
  lightingRig.bounce.position.set(0, 0.1, 1.5)

  // Boost tone mapping exposure — character should GLOW
  renderer.toneMappingExposure = 1.15
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
  lightingRig.key.position.set(0.3, 3.5, 3.0)
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
