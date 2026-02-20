import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import type { VRM } from '@pixiv/three-vrm'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import { scene } from './scene'
import { state } from './main'
// outline removed — will re-add properly later
import * as THREE from 'three'

let loader: GLTFLoader

function getLoader() {
  if (!loader) {
    loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  }
  return loader
}

export async function loadVRM(urlOrBlob: string | Blob): Promise<VRM> {
  // Dispose old
  if (state.vrm) {
    scene.remove(state.vrm.scene)
    VRMUtils.deepDispose(state.vrm.scene)
    state.mixer?.stopAllAction()
    state.mixer = null
  }

  const url = urlOrBlob instanceof Blob ? URL.createObjectURL(urlOrBlob) : urlOrBlob
  const gltf = await getLoader().loadAsync(url)
  if (urlOrBlob instanceof Blob) URL.revokeObjectURL(url)

  const vrm = gltf.userData.vrm as VRM
  if (!vrm) throw new Error('No VRM data in file')

  VRMUtils.removeUnnecessaryVertices(gltf.scene)
  VRMUtils.combineSkeletons(gltf.scene)

  // VRM models face +Z by default; camera looks down -Z
  // Most VRM models need rotation, but some don't — try 0 first
  vrm.scene.rotation.y = 0

  // Hide model until idle animation starts (avoid T-pose flash)
  vrm.scene.visible = false

  vrm.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
    }
  })

  scene.add(vrm.scene)

  state.vrm = vrm
  state.mixer = new THREE.AnimationMixer(vrm.scene)

  // Save URL for persistence (skip blob URLs)
  if (typeof urlOrBlob === 'string' && !urlOrBlob.startsWith('blob:')) {
    localStorage.setItem('vrm-model-url', urlOrBlob)
  }
  // Hide drop prompt if shown
  ;(window as any).__hideDropPrompt?.()

  console.log('VRM loaded:', vrm)
  return vrm
}

export async function loadVRMA(urlOrBlob: string | Blob): Promise<VRMAnimation> {
  const url = urlOrBlob instanceof Blob ? URL.createObjectURL(urlOrBlob) : urlOrBlob
  const gltf = await getLoader().loadAsync(url)
  if (urlOrBlob instanceof Blob) URL.revokeObjectURL(url)

  const vrmAnimation = gltf.userData.vrmAnimations?.[0] as VRMAnimation
  if (!vrmAnimation) throw new Error('No VRM animation data in file')

  return vrmAnimation
}
