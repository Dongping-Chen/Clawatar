import { createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import type { AnimationAction, AnimationClip } from 'three'
import { LoopOnce, LoopRepeat, Quaternion } from 'three'
import { state } from './main'
import { loadVRMA } from './vrm-loader'

const animationCache = new Map<string, VRMAnimation>()
const animationLoadPromises = new Map<string, Promise<VRMAnimation>>()
const clipCache = new Map<string, AnimationClip>()
const actionCache = new Map<string, AnimationAction>()

let cachedSceneRef: object | null = null
let currentAction: AnimationAction | null = null
let baseIdleAction: AnimationAction | null = null
export let currentCategory: string = 'idle'

/** Scale factor for crossfade duration. Higher = slower transitions. Adjust via WS or console. */
export let crossfadeScale = 2.0
const CROSSFADE_MIN = 0.1
const CROSSFADE_MAX = 2.0
const ACTION_TO_IDLE_MIN_FADE = 0.45

export function setCrossfadeScale(s: number) {
  crossfadeScale = Math.max(0.1, s)
  console.log(`[animation] crossfadeScale = ${crossfadeScale}`)
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

/** Crossfade duration based on actual pose difference × scale. */
function getCrossfadeDuration(targetClip: AnimationClip, targetCategory: string): number {
  const distance = computePoseDistance(targetClip)
  let duration = CROSSFADE_MIN + distance * crossfadeScale

  // Action -> idle needs a gentler transition to avoid torso twist/lean artifacts.
  if (targetCategory === 'idle' && currentCategory !== 'idle') {
    duration = Math.max(duration, ACTION_TO_IDLE_MIN_FADE)
  }

  return Math.min(duration, CROSSFADE_MAX)
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

async function getOrCreateClip(actionId: string): Promise<AnimationClip | null> {
  const { vrm } = state
  if (!vrm) {
    return null
  }

  ensureRuntimeCachesForCurrentModel()

  const cachedClip = clipCache.get(actionId)
  if (cachedClip) {
    return cachedClip
  }

  const vrma = await getVRMA(actionId)
  const clip = createVRMAnimationClip(vrma, vrm)
  clipCache.set(actionId, clip)
  return clip
}

function getOrCreateAction(actionId: string, clip: AnimationClip): AnimationAction | null {
  const { mixer } = state
  if (!mixer) {
    return null
  }

  ensureRuntimeCachesForCurrentModel()

  const cachedAction = actionCache.get(actionId)
  if (cachedAction) {
    return cachedAction
  }

  const action = mixer.clipAction(clip)
  actionCache.set(actionId, action)
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

  const clip = await getOrCreateClip(actionId)
  if (!clip) return null

  const newAction = getOrCreateAction(actionId, clip)
  if (!newAction) return null

  const targetCategory = category || 'action'
  const fadeDuration = getCrossfadeDuration(clip, targetCategory)
  const previousAction = currentAction

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

export async function playBaseIdle(actionId: string = '119_Idle') {
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
    currentCategory = 'idle'

    window.setTimeout(() => {
      if (currentAction !== actionToStop) {
        actionToStop.stop()
      }
    }, 600)
  }
}
