import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation'
import type { VRM } from '@pixiv/three-vrm'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import { camera, scene } from './scene'
import { state } from './app-state'
import type { VRMModelMeta } from './types'
// outline removed — will re-add properly later
import * as THREE from 'three'

let loader: GLTFLoader
let latestLoadRequestId = 0
let latestLoadPromise: Promise<VRM> | null = null
const VRM_ROOT_MARKER = '__clawatar_vrm_root'
let vrmSceneContainer: THREE.Group | null = null

function getLoader() {
  if (!loader) {
    loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
  }
  return loader
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function normalizeVRMMeta(meta: unknown): VRMModelMeta {
  const raw = meta
  const record = asRecord(meta)
  const metaVersionRaw = record?.metaVersion

  if (metaVersionRaw === '1') {
    const name = asString(record?.name)
    const authors = asStringArray(record?.authors)
    const license = asString(record?.licenseUrl) ?? asString(record?.otherLicenseUrl)
    return { metaVersion: '1', name, authors, license, raw }
  }

  if (metaVersionRaw === '0') {
    const name = asString(record?.title)
    const author = asString(record?.author)
    const authors = author ? [author] : []
    const license = asString(record?.licenseName) ?? asString(record?.otherLicenseUrl)
    return { metaVersion: '0', name, authors, license, raw }
  }

  return {
    metaVersion: 'unknown',
    name: asString(record?.name) ?? asString(record?.title),
    authors: asStringArray(record?.authors),
    license: asString(record?.licenseUrl) ?? asString(record?.licenseName),
    raw,
  }
}

function ensureLookAtQuaternionProxy(vrm: VRM): void {
  if (!vrm.lookAt) return

  const existingProxy = vrm.scene.children.find((child) => child instanceof VRMLookAtQuaternionProxy)
  if (existingProxy) {
    if (!existingProxy.name) {
      existingProxy.name = 'VRMLookAtQuaternionProxy'
    }
    return
  }

  const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
  proxy.name = 'VRMLookAtQuaternionProxy'
  vrm.scene.add(proxy)
}

const _modelWorld = new THREE.Vector3()
const _targetFront = new THREE.Vector3()
const _headDir = new THREE.Vector3()
const _visualFront = new THREE.Vector3()
const _rootForward = new THREE.Vector3()
const _leftEyeWorld = new THREE.Vector3()
const _rightEyeWorld = new THREE.Vector3()
const _headWorld = new THREE.Vector3()
const _neckWorld = new THREE.Vector3()
const _eyeMidWorld = new THREE.Vector3()
const _eyeOffset = new THREE.Vector3()
const _eyeAxis = new THREE.Vector3()
const _faceUp = new THREE.Vector3()
const _faceFront = new THREE.Vector3()
const _query = new URLSearchParams(window.location.search)
const _preferFixedFrontTarget = _query.has('embed') || _query.has('transparent') || _query.has('meeting')

function normalizeGroundDirection(direction: THREE.Vector3): boolean {
  direction.y = 0
  const lengthSq = direction.lengthSq()
  if (lengthSq <= 1e-6) {
    return false
  }
  direction.multiplyScalar(1 / Math.sqrt(lengthSq))
  return true
}

function computeTargetFrontDirection(vrm: VRM): THREE.Vector3 | null {
  if (_preferFixedFrontTarget) {
    // Native/embed shells always frame the avatar from +Z looking toward origin.
    // Keep facing normalization deterministic and independent from camera init timing.
    _targetFront.set(0, 0, 1)
    return _targetFront
  }

  vrm.scene.getWorldPosition(_modelWorld)
  _targetFront.subVectors(camera.position, _modelWorld)

  if (normalizeGroundDirection(_targetFront)) {
    return _targetFront
  }

  camera.getWorldDirection(_targetFront)
  _targetFront.multiplyScalar(-1)
  return normalizeGroundDirection(_targetFront) ? _targetFront : null
}

function computeVisualFrontDirection(vrm: VRM): THREE.Vector3 | null {
  const humanoid = vrm.humanoid
  const leftEye = humanoid?.getNormalizedBoneNode('leftEye')
  const rightEye = humanoid?.getNormalizedBoneNode('rightEye')
  const head = humanoid?.getNormalizedBoneNode('head')
  if (leftEye && rightEye && head) {
    const neck = humanoid?.getNormalizedBoneNode('neck')
    leftEye.getWorldPosition(_leftEyeWorld)
    rightEye.getWorldPosition(_rightEyeWorld)
    head.getWorldPosition(_headWorld)
    if (neck) {
      neck.getWorldPosition(_neckWorld)
      _faceUp.subVectors(_headWorld, _neckWorld)
    } else {
      _neckWorld.addVectors(_leftEyeWorld, _rightEyeWorld).multiplyScalar(0.5)
      _faceUp.subVectors(_headWorld, _neckWorld)
    }

    _eyeAxis.subVectors(_rightEyeWorld, _leftEyeWorld)
    if (_eyeAxis.lengthSq() > 1e-8 && _faceUp.lengthSq() > 1e-8) {
      _eyeAxis.normalize()
      _faceUp.normalize()
      // Right-handed basis: right(eyeAxis) x up(faceUp) => visual front
      _faceFront.crossVectors(_eyeAxis, _faceUp)
      if (normalizeGroundDirection(_faceFront)) {
        return _faceFront
      }
    }
  }

  const headBone = vrm.humanoid?.getNormalizedBoneNode('head')
  if (headBone) {
    headBone.getWorldDirection(_headDir)
    _visualFront.copy(_headDir)
    if (normalizeGroundDirection(_visualFront)) {
      return _visualFront
    }
  }

  vrm.scene.getWorldDirection(_rootForward)
  return normalizeGroundDirection(_rootForward) ? _rootForward : null
}

function computeFaceDepthAlongTarget(vrm: VRM, targetFront: THREE.Vector3): number | null {
  const humanoid = vrm.humanoid
  const leftEye = humanoid?.getNormalizedBoneNode('leftEye')
  const rightEye = humanoid?.getNormalizedBoneNode('rightEye')
  const head = humanoid?.getNormalizedBoneNode('head')
  if (!leftEye || !rightEye || !head) {
    return null
  }

  leftEye.getWorldPosition(_leftEyeWorld)
  rightEye.getWorldPosition(_rightEyeWorld)
  head.getWorldPosition(_headWorld)

  _eyeMidWorld.addVectors(_leftEyeWorld, _rightEyeWorld).multiplyScalar(0.5)
  _eyeOffset.subVectors(_eyeMidWorld, _headWorld)
  return _eyeOffset.dot(targetFront)
}

function autoCorrectFacingDirection(vrm: VRM): void {
  vrm.scene.updateWorldMatrix(true, true)
  const targetFront = computeTargetFrontDirection(vrm)
  if (!targetFront) {
    console.warn('[vrm-loader] orientation check skipped: missing camera-facing vector')
    return
  }

  // Prefer geometry-based test: if eyes are behind head relative to camera direction,
  // avatar is back-facing and needs a 180° root yaw flip.
  const faceDepth = computeFaceDepthAlongTarget(vrm, targetFront)
  if (faceDepth != null && Math.abs(faceDepth) > 1e-4) {
    if (faceDepth < 0) {
      vrm.scene.rotation.y += Math.PI
      vrm.scene.updateWorldMatrix(true, true)
      console.info(`[vrm-loader] auto-flipped facing by 180° (eyeDepth=${faceDepth.toFixed(4)})`)
    } else {
      console.info(`[vrm-loader] facing kept (eyeDepth=${faceDepth.toFixed(4)})`)
    }
    return
  }

  const visualFront = computeVisualFrontDirection(vrm)
  if (!visualFront) {
    console.warn('[vrm-loader] orientation check skipped: insufficient direction vectors')
    return
  }

  const facingDot = THREE.MathUtils.clamp(visualFront.dot(targetFront), -1, 1)
  const reverseThreshold = -0.35
  if (facingDot < reverseThreshold) {
    vrm.scene.rotation.y += Math.PI
    vrm.scene.updateWorldMatrix(true, true)
    console.info(`[vrm-loader] auto-flipped facing by 180° (dot=${facingDot.toFixed(3)})`)
    return
  }

  console.info(`[vrm-loader] facing kept (dot=${facingDot.toFixed(3)})`)
}

function ensureVRMSceneContainer(): THREE.Group {
  if (!vrmSceneContainer) {
    vrmSceneContainer = new THREE.Group()
    vrmSceneContainer.name = 'clawatar-vrm-container'
  }

  if (!vrmSceneContainer.parent) {
    scene.add(vrmSceneContainer)
  }

  return vrmSceneContainer
}

function detachAndDisposeVRMRoot(root: THREE.Object3D): void {
  if (root.parent) {
    root.parent.remove(root)
  }
  VRMUtils.deepDispose(root)
}

function clearLegacyMarkedVRMRoots(except?: THREE.Object3D): number {
  let removed = 0
  const children = [...scene.children]
  for (const child of children) {
    if (child === except) continue
    if ((child.userData as Record<string, unknown> | undefined)?.[VRM_ROOT_MARKER] === true) {
      detachAndDisposeVRMRoot(child)
      removed += 1
    }
  }
  return removed
}

function clearAllLoadedVRMRoots(): number {
  const container = ensureVRMSceneContainer()
  let removed = 0

  for (const child of [...container.children]) {
    if (child.userData) {
      ;(child.userData as Record<string, unknown>)[VRM_ROOT_MARKER] = true
    }
    detachAndDisposeVRMRoot(child)
    removed += 1
  }

  removed += clearLegacyMarkedVRMRoots()

  if (state.vrm?.scene) {
    const root = state.vrm.scene
    if (root.parent) {
      detachAndDisposeVRMRoot(root)
      removed += 1
    }
  }

  state.vrm = null
  return removed
}

async function waitForLatestModel(requestId: number): Promise<VRM> {
  if (requestId !== latestLoadRequestId) {
    const activePromise = latestLoadPromise
    if (activePromise) {
      try {
        return await activePromise
      } catch {
        // Fall through and surface the most recent in-memory model if available.
      }
    }
  }

  if (state.vrm) {
    return state.vrm
  }

  throw new Error('[vrm-loader] Model load was superseded by a newer request')
}

export async function loadVRM(urlOrBlob: string | Blob): Promise<VRM> {
  const requestId = ++latestLoadRequestId

  // Dispose every previously attached VRM root before starting a new load.
  const clearedRoots = clearAllLoadedVRMRoots()
  if (clearedRoots > 1) {
    console.warn(`[vrm-loader] cleared ${clearedRoots} stale VRM roots before load`)
  }
  state.mixer?.stopAllAction()
  state.mixer = null
  state.vrmMeta = null
  state.baseFacingYaw = 0

  const loadPromise = (async (): Promise<VRM> => {
    const url = urlOrBlob instanceof Blob ? URL.createObjectURL(urlOrBlob) : urlOrBlob
    let gltf: Awaited<ReturnType<GLTFLoader['loadAsync']>>
    try {
      gltf = await getLoader().loadAsync(url)
    } finally {
      if (urlOrBlob instanceof Blob) {
        URL.revokeObjectURL(url)
      }
    }

    if (requestId !== latestLoadRequestId) {
      try {
        VRMUtils.deepDispose(gltf.scene)
      } catch {}
      return waitForLatestModel(requestId)
    }

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

    ensureLookAtQuaternionProxy(vrm)

    if (requestId !== latestLoadRequestId) {
      try {
        VRMUtils.deepDispose(vrm.scene)
      } catch {}
      return waitForLatestModel(requestId)
    }

    const container = ensureVRMSceneContainer()
    ;(vrm.scene.userData as Record<string, unknown>)[VRM_ROOT_MARKER] = true
    container.add(vrm.scene)
    clearLegacyMarkedVRMRoots(vrm.scene)
    autoCorrectFacingDirection(vrm)

    let baseYaw = vrm.scene.rotation.y
    while (baseYaw > Math.PI) baseYaw -= 2 * Math.PI
    while (baseYaw < -Math.PI) baseYaw += 2 * Math.PI

    state.vrm = vrm
    state.mixer = new THREE.AnimationMixer(vrm.scene)
    state.vrmMeta = normalizeVRMMeta((vrm as any).meta)
    state.baseFacingYaw = baseYaw

    // Save URL for persistence (skip blob URLs)
    if (typeof urlOrBlob === 'string' && !urlOrBlob.startsWith('blob:')) {
      localStorage.setItem('vrm-model-url', urlOrBlob)
    }
    // Hide drop prompt if shown
    ;(window as any).__hideDropPrompt?.()
    ;(window as any).__clawatar_last_vrm_meta = state.vrmMeta

    const metaAuthors = state.vrmMeta.authors.length > 0 ? state.vrmMeta.authors.join(', ') : 'unknown'
    console.info(
      `[vrm-loader] loaded model metaVersion=${state.vrmMeta.metaVersion} name=${state.vrmMeta.name ?? 'unknown'} authors=${metaAuthors} license=${state.vrmMeta.license ?? 'unknown'}`,
    )
    console.log('VRM loaded:', vrm)
    return vrm
  })()

  latestLoadPromise = loadPromise
  try {
    return await loadPromise
  } finally {
    if (requestId === latestLoadRequestId && latestLoadPromise === loadPromise) {
      latestLoadPromise = null
    }
  }
}

export async function loadVRMA(urlOrBlob: string | Blob): Promise<VRMAnimation> {
  const url = urlOrBlob instanceof Blob ? URL.createObjectURL(urlOrBlob) : urlOrBlob
  const gltf = await getLoader().loadAsync(url)
  if (urlOrBlob instanceof Blob) URL.revokeObjectURL(url)

  const vrmAnimation = gltf.userData.vrmAnimations?.[0] as VRMAnimation
  if (!vrmAnimation) throw new Error('No VRM animation data in file')

  return vrmAnimation
}
