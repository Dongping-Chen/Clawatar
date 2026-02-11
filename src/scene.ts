import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export let scene: THREE.Scene
export let camera: THREE.PerspectiveCamera
export let renderer: THREE.WebGLRenderer
export let controls: OrbitControls
export let clock: THREE.Clock
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
  } else {
    scene.background = new THREE.Color(0xf8e8f0)
    renderer.setClearColor(0xf8e8f0, 1)
  }
}
