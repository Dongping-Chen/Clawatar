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
  // Boost rim light for more "stage presence"
  lightingRig.rim.intensity = 0.65
  lightingRig.rim.color.set(0xffb8e0) // Warmer pink rim

  // Add a subtle back light for hair highlight
  const backLight = new THREE.SpotLight(0xffd0e8, 0.4, 10, Math.PI / 6, 0.5)
  backLight.position.set(0, 3, -2)
  backLight.target.position.set(0, 1.2, 0)
  scene.add(backLight)
  scene.add(backLight.target)

  // Keep key light close to original
  lightingRig.key.intensity = 1.25

  // Slightly warmer bounce
  lightingRig.bounce.intensity = 0.32
  lightingRig.bounce.color.set(0xffe0ec)
}
