import { createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import type { AnimationAction, AnimationClip } from 'three'
import { LoopOnce, LoopRepeat, Quaternion, Vector3 } from 'three'
import { state } from './app-state'
import { loadVRMA } from './vrm-loader'

const animationCache = new Map<string, VRMAnimation>()
const animationLoadPromises = new Map<string, Promise<VRMAnimation>>()
const clipCache = new Map<string, AnimationClip>()
const actionCache = new Map<string, AnimationAction>()
const clipBoundaryCache = new WeakMap<AnimationClip, ClipBoundaryPose>()

let cachedSceneRef: object | null = null
let currentAction: AnimationAction | null = null
let currentActionKey: string | null = null
let baseIdleAction: AnimationAction | null = null
export let currentCategory: string = 'idle'
export const DEFAULT_BASE_IDLE_ACTION = 'dm_128'

/** Scale factor for crossfade duration. Higher = slower transitions. Adjust via WS or console. */
export let crossfadeScale = 1.2
const CROSSFADE_MIN = 0.28
const CROSSFADE_MAX = 1.35
const ACTION_TO_IDLE_MIN_FADE = 0.45
const IDLE_TO_ACTION_MIN_FADE = 0.38
const POSITION_DISTANCE_NORMALIZER = 0.45

type PoseQuatMap = Map<string, Quaternion>
type PosePosMap = Map<string, Vector3>

interface ClipBoundaryPose {
  startQuat: PoseQuatMap
  endQuat: PoseQuatMap
  startPos: PosePosMap
  endPos: PosePosMap
  seamDistance: number
}

export function setCrossfadeScale(s: number) {
  crossfadeScale = Math.max(0.1, s)
  console.log(`[animation] crossfadeScale = ${crossfadeScale}`)
}

function buildActionKey(actionId: string, loop: boolean): string {
  return `${actionId}::${loop ? 'loop' : 'oneshot'}`
}

function ensureRuntimeCachesForCurrentModel(): void {
  const sceneRef = state.vrm?.scene ?? null
  if (sceneRef === cachedSceneRef) {
    return
  }

  cachedSceneRef = sceneRef
  clipCache.clear()
  actionCache.clear()
  currentAction = null
  currentActionKey = null
  baseIdleAction = null
  currentCategory = 'idle'
}

/**
 * Compute pose distance between current VRM skeleton and a target clip's first frame.
 * Returns 0–1 (0 = identical pose, 1 = maximally different).
 */
function computePoseDistance(targetClip: AnimationClip): number {
  const { vrm } = state
  if (!vrm) return 0.5

  const tmpQuat = new Quaternion()
  let totalAngle = 0
  let count = 0

  for (const track of targetClip.tracks) {
    if (!track.name.endsWith('.quaternion') || track.values.length < 4) continue
    const nodeName = track.name.replace('.quaternion', '')
    const node = vrm.scene.getObjectByName(nodeName)
    if (!node) continue

    tmpQuat.set(track.values[0], track.values[1], track.values[2], track.values[3])
    totalAngle += node.quaternion.angleTo(tmpQuat)
    count++
  }

  // Average angular distance normalized to 0–1 (PI radians = max)
  return count > 0 ? (totalAngle / count) / Math.PI : 0.5
}

function trimClip(clip: AnimationClip, enabled: boolean, trimStartSec = 0.33, trimEndSec = 0.33): AnimationClip {
  if (!enabled) return clip

  const newDuration = clip.duration - trimStartSec - trimEndSec
  if (newDuration <= 0.5) return clip

  for (const track of clip.tracks) {
    const times = track.times
    const values = track.values
    const valueSize = values.length / times.length

    let startIdx = 0
    while (startIdx < times.length && times[startIdx] < trimStartSec) startIdx++

    let endIdx = times.length - 1
    const endTime = clip.duration - trimEndSec
    while (endIdx > startIdx && times[endIdx] > endTime) endIdx--

    if (endIdx < startIdx) continue

    const newTimes = new Float32Array(endIdx - startIdx + 1)
    const newValues = new Float32Array((endIdx - startIdx + 1) * valueSize)

    for (let i = startIdx; i <= endIdx; i++) {
      newTimes[i - startIdx] = Math.max(0, times[i] - trimStartSec)
      for (let v = 0; v < valueSize; v++) {
        newValues[(i - startIdx) * valueSize + v] = values[i * valueSize + v]
      }
    }

    track.times = newTimes
    track.values = newValues
  }

  clip.duration = newDuration
  return clip
}

function getClipBoundaryPose(clip: AnimationClip): ClipBoundaryPose {
  const cached = clipBoundaryCache.get(clip)
  if (cached) {
    return cached
  }

  const startQuat: PoseQuatMap = new Map()
  const endQuat: PoseQuatMap = new Map()
  const startPos: PosePosMap = new Map()
  const endPos: PosePosMap = new Map()

  for (const track of clip.tracks) {
    const values = track.values
    if (track.name.endsWith('.quaternion') && values.length >= 4) {
      const nodeName = track.name.replace('.quaternion', '')
      const start = new Quaternion(values[0], values[1], values[2], values[3]).normalize()
      const endOffset = values.length - 4
      const end = new Quaternion(values[endOffset], values[endOffset + 1], values[endOffset + 2], values[endOffset + 3]).normalize()
      startQuat.set(nodeName, start)
      endQuat.set(nodeName, end)
      continue
    }

    if (track.name.endsWith('.position') && values.length >= 3) {
      const nodeName = track.name.replace('.position', '')
      const start = new Vector3(values[0], values[1], values[2])
      const endOffset = values.length - 3
      const end = new Vector3(values[endOffset], values[endOffset + 1], values[endOffset + 2])
      startPos.set(nodeName, start)
      endPos.set(nodeName, end)
    }
  }

  const boundary: ClipBoundaryPose = {
    startQuat,
    endQuat,
    startPos,
    endPos,
    seamDistance: computePoseMapDistance(startQuat, startPos, endQuat, endPos),
  }

  clipBoundaryCache.set(clip, boundary)
  return boundary
}

function computePoseMapDistance(
  fromQuat: PoseQuatMap,
  fromPos: PosePosMap,
  toQuat: PoseQuatMap,
  toPos: PosePosMap,
): number {
  let quatTotal = 0
  let quatCount = 0
  let posTotal = 0
  let posCount = 0

  for (const [name, from] of fromQuat) {
    const to = toQuat.get(name)
    if (!to) continue
    quatTotal += from.angleTo(to) / Math.PI
    quatCount++
  }

  for (const [name, from] of fromPos) {
    const to = toPos.get(name)
    if (!to) continue
    const normalized = Math.min(1, from.distanceTo(to) / POSITION_DISTANCE_NORMALIZER)
    posTotal += normalized
    posCount++
  }

  const quatScore = quatCount > 0 ? quatTotal / quatCount : 0
  const posScore = posCount > 0 ? posTotal / posCount : 0

  if (quatCount > 0 && posCount > 0) {
    return quatScore * 0.78 + posScore * 0.22
  }
  if (quatCount > 0) return quatScore
  if (posCount > 0) return posScore
  return 0.5
}

function getClipSeamDistance(clip: AnimationClip): number {
  return getClipBoundaryPose(clip).seamDistance
}

function computeClipBoundaryDistance(fromClip: AnimationClip, toClip: AnimationClip): number {
  const fromBoundary = getClipBoundaryPose(fromClip)
  const toBoundary = getClipBoundaryPose(toClip)
  return computePoseMapDistance(fromBoundary.endQuat, fromBoundary.endPos, toBoundary.startQuat, toBoundary.startPos)
}

/** Crossfade duration based on live + boundary pose difference × scale. */
function getCrossfadeDuration(targetClip: AnimationClip, targetCategory: string, targetLoop: boolean): number {
  const liveDistance = computePoseDistance(targetClip)
  let boundaryDistance = liveDistance
  let seamPenalty = targetLoop ? getClipSeamDistance(targetClip) : 0

  if (currentActionKey) {
    const currentClip = clipCache.get(currentActionKey)
    if (currentClip && currentClip !== targetClip) {
      boundaryDistance = computeClipBoundaryDistance(currentClip, targetClip)
      seamPenalty = Math.max(seamPenalty, getClipSeamDistance(currentClip))
    }
  }

  const differenceScore = Math.max(liveDistance, boundaryDistance * 0.85)
  const seamScore = Math.min(1, seamPenalty * 1.15)
  let duration = CROSSFADE_MIN + (differenceScore * 0.58 + seamScore * 0.42) * crossfadeScale * 0.9

  // Action -> idle needs a gentler transition to avoid torso twist/lean artifacts.
  if (targetCategory === 'idle' && currentCategory !== 'idle') {
    duration = Math.max(duration, ACTION_TO_IDLE_MIN_FADE)
  }

  if (targetCategory !== 'idle' && currentCategory === 'idle' && differenceScore > 0.48) {
    duration = Math.max(duration, IDLE_TO_ACTION_MIN_FADE)
  }

  return Math.min(Math.max(duration, CROSSFADE_MIN), CROSSFADE_MAX)
}

async function getVRMA(actionId: string): Promise<VRMAnimation> {
  const cached = animationCache.get(actionId)
  if (cached) {
    return cached
  }

  const inflight = animationLoadPromises.get(actionId)
  if (inflight) {
    return inflight
  }

  const url = `/animations/${actionId}.vrma`
  const loadPromise = loadVRMA(url)
    .then((vrma) => {
      animationCache.set(actionId, vrma)
      animationLoadPromises.delete(actionId)
      return vrma
    })
    .catch((error) => {
      animationLoadPromises.delete(actionId)
      throw error
    })

  animationLoadPromises.set(actionId, loadPromise)
  return loadPromise
}

export async function preloadAction(actionId: string): Promise<void> {
  if (!actionId) {
    return
  }

  await getVRMA(actionId)
}

/**
 * Warm the VRMA cache in background.
 * Keeps concurrency low to avoid blocking render/main thread work.
 */
export async function warmupAnimationCache(actionIds: string[], maxConcurrent: number = 2): Promise<void> {
  const queue = Array.from(new Set(actionIds.filter(Boolean)))
  if (queue.length === 0) {
    return
  }

  let index = 0
  const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, async () => {
    while (index < queue.length) {
      const actionId = queue[index++]
      try {
        await getVRMA(actionId)
      } catch (error) {
        console.warn(`[animation] warmup failed for ${actionId}:`, error)
      }
    }
  })

  await Promise.all(workers)
}

async function getOrCreateClip(actionId: string, loop: boolean): Promise<AnimationClip | null> {
  const { vrm } = state
  if (!vrm) {
    return null
  }

  ensureRuntimeCachesForCurrentModel()

  const actionKey = buildActionKey(actionId, loop)
  const cachedClip = clipCache.get(actionKey)
  if (cachedClip) {
    return cachedClip
  }

  const vrma = await getVRMA(actionId)
  // Loop clips keep original boundaries to preserve loop integrity.
  const clip = trimClip(createVRMAnimationClip(vrma, vrm), !loop)
  clipCache.set(actionKey, clip)
  return clip
}

function getOrCreateAction(actionKey: string, clip: AnimationClip): AnimationAction | null {
  const { mixer } = state
  if (!mixer) {
    return null
  }

  ensureRuntimeCachesForCurrentModel()

  const cachedAction = actionCache.get(actionKey)
  if (cachedAction) {
    return cachedAction
  }

  const action = mixer.clipAction(clip)
  actionCache.set(actionKey, action)
  return action
}

function stopActionAfterFade(action: AnimationAction, fadeDuration: number): void {
  const delayMs = Math.max(120, Math.round((fadeDuration + 0.08) * 1000))

  window.setTimeout(() => {
    if (currentAction !== action) {
      action.stop()
    }
  }, delayMs)
}

export async function loadAndPlayAction(actionId: string, loop: boolean = false, onFinished?: () => void, category?: string): Promise<AnimationAction | null> {
  const { mixer } = state
  if (!mixer) return null

  const actionKey = buildActionKey(actionId, loop)
  const clip = await getOrCreateClip(actionId, loop)
  if (!clip) return null

  const newAction = getOrCreateAction(actionKey, clip)
  if (!newAction) return null

  const targetCategory = category || 'action'
  const fadeDuration = getCrossfadeDuration(clip, targetCategory, loop)
  const previousAction = currentAction

  if (previousAction === newAction && loop) {
    currentCategory = targetCategory
    return newAction
  }

  newAction.enabled = true
  newAction.reset()
  newAction.setEffectiveWeight(1)
  newAction.setEffectiveTimeScale(1)

  if (previousAction && previousAction !== newAction) {
    const isActionToIdleTransition = targetCategory === 'idle' && currentCategory !== 'idle'

    if (isActionToIdleTransition) {
      previousAction.fadeOut(fadeDuration)
      newAction.fadeIn(fadeDuration)
    } else {
      previousAction.crossFadeTo(newAction, fadeDuration, false)
    }

    stopActionAfterFade(previousAction, fadeDuration)
  } else {
    newAction.fadeIn(fadeDuration)
  }

  if (!loop) {
    newAction.setLoop(LoopOnce, 1)
    newAction.clampWhenFinished = true
  } else {
    newAction.setLoop(LoopRepeat, Infinity)
    newAction.clampWhenFinished = false
  }

  newAction.play()
  currentAction = newAction
  currentActionKey = actionKey
  currentCategory = targetCategory

  if (!loop) {
    const handler = (e: any) => {
      if (e.action !== newAction) return
      mixer.removeEventListener('finished', handler)
      onFinished?.()
    }

    mixer.addEventListener('finished', handler)
  }

  return newAction
}

export async function playBaseIdle(actionId: string = DEFAULT_BASE_IDLE_ACTION) {
  const action = await loadAndPlayAction(actionId, true, undefined, 'idle')
  if (action) baseIdleAction = action

  // Reveal model now that idle is playing (avoids T-pose flash)
  const { vrm } = state
  if (vrm && !vrm.scene.visible) {
    vrm.scene.visible = true
  }
}

export function getCurrentAction(): AnimationAction | null {
  return currentAction
}

// Legacy support
export async function loadAnimation(url: string, name?: string): Promise<string> {
  const vrma = await loadVRMA(url)
  const animName = name || `anim_${animationCache.size}`
  animationCache.set(animName, vrma)
  return animName
}

export async function loadAndPlay(url: string) {
  // Extract action ID from URL if possible
  const match = url.match(/\/([^/]+)\.vrma$/)
  if (match) {
    await loadAndPlayAction(match[1], false)
  } else {
    const name = await loadAnimation(url)
    await loadAndPlayAction(name, false)
  }
}

export function stopAnimation() {
  if (currentAction) {
    currentAction.fadeOut(0.5)
    const actionToStop = currentAction
    currentAction = null
    currentActionKey = null
    currentCategory = 'idle'

    window.setTimeout(() => {
      if (currentAction !== actionToStop) {
        actionToStop.stop()
      }
    }, 600)
  }
}
