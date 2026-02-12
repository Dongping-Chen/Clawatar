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

  camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100)
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
  // === PORTRAIT / BEAUTY LIGHTING for anime VRM ===

  // 1. Softer ambient — raise base illumination so shadows aren't harsh
  lightingRig.ambient.intensity = 1.1
  lightingRig.ambient.color.set(0xfff5f8)  // Warm white-pink

  // 2. Hemisphere: warm sky (peach) + cool ground (lavender) for soft fill
  lightingRig.skyFill.intensity = 0.7
  lightingRig.skyFill.color.set(0xffe4d6)  // Warm peach sky
  lightingRig.skyFill.groundColor.set(0xe8d8f0)  // Soft lavender ground

  // 3. Key light: "butterfly" position — above-front center, slightly warm
  //    Moved more frontal for softer face illumination
  lightingRig.key.position.set(0.5, 3.2, 2.5)  // More centered, higher
  lightingRig.key.intensity = 1.1  // Slightly reduced (ambient does more)
  lightingRig.key.color.set(0xffeef2)  // Very subtle warm tint

  // 4. Face fill light — soft point light at face height, frontal
  //    This is the key to soft anime-style face rendering
  const faceFill = new THREE.PointLight(0xfff0f4, 0.5, 4)
  faceFill.name = 'face-fill'
  faceFill.position.set(0, 1.5, 1.8)  // Right in front of face
  scene.add(faceFill)

  // 5. Under-chin fill — eliminates harsh shadows under nose/chin
  const chinFill = new THREE.PointLight(0xffe8f0, 0.25, 3)
  chinFill.name = 'chin-fill'
  chinFill.position.set(0, 0.9, 1.5)  // Below face, front
  scene.add(chinFill)

  // 6. Rim light — subtle pink edge separation
  lightingRig.rim.intensity = 0.55
  lightingRig.rim.color.set(0xffc0e0)

  // 7. Hair back light — creates highlight on hair edges
  const backLight = new THREE.SpotLight(0xffd0e8, 0.35, 10, Math.PI / 6, 0.6)
  backLight.name = 'hair-backlight'
  backLight.position.set(0, 3, -2)
  backLight.target.position.set(0, 1.4, 0)
  scene.add(backLight)
  scene.add(backLight.target)

  // 8. Bounce from below — warm reflection from "floor"
  lightingRig.bounce.intensity = 0.3
  lightingRig.bounce.color.set(0xffdce8)
  lightingRig.bounce.position.set(0, 0.3, 1.2)  // Lower, more frontal

  // 9. Slightly lower tone mapping exposure to prevent wash-out
  renderer.toneMappingExposure = 0.98
}
