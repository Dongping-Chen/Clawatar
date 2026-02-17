import { createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import type { AnimationAction, AnimationClip } from 'three'
import { LoopOnce, LoopRepeat, Quaternion } from 'three'
import { state } from './main'
import { loadVRMA } from './vrm-loader'

const animationCache = new Map<string, VRMAnimation>()
let currentAction: AnimationAction | null = null
let baseIdleAction: AnimationAction | null = null
export let currentCategory: string = 'idle'

/** Scale factor for crossfade duration. Higher = slower transitions. Adjust via WS or console. */
export let crossfadeScale = 2.0
const CROSSFADE_MIN = 0.1
const CROSSFADE_MAX = 2.0

export function setCrossfadeScale(s: number) {
  crossfadeScale = Math.max(0.1, s)
  console.log(`[animation] crossfadeScale = ${crossfadeScale}`)
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
function getCrossfadeDuration(targetClip: AnimationClip): number {
  const distance = computePoseDistance(targetClip)
  const duration = CROSSFADE_MIN + distance * crossfadeScale
  return Math.min(duration, CROSSFADE_MAX)
}

async function getVRMA(actionId: string): Promise<VRMAnimation> {
  if (animationCache.has(actionId)) return animationCache.get(actionId)!
  const url = `/animations/${actionId}.vrma`
  const vrma = await loadVRMA(url)
  animationCache.set(actionId, vrma)
  return vrma
}

export async function loadAndPlayAction(actionId: string, loop: boolean = false, onFinished?: () => void, category?: string): Promise<AnimationAction | null> {
  const { vrm, mixer } = state
  if (!vrm || !mixer) return null

  const vrma = await getVRMA(actionId)
  const clip = createVRMAnimationClip(vrma, vrm)
  const newAction = mixer.clipAction(clip)

  const targetCategory = category || 'action'
  const fadeDuration = getCrossfadeDuration(clip)
  currentCategory = targetCategory

  newAction.reset()
  if (currentAction && currentAction !== newAction) {
    currentAction.crossFadeTo(newAction, fadeDuration, true)
  } else {
    newAction.fadeIn(fadeDuration)
  }
  if (!loop) {
    newAction.setLoop(LoopOnce, 1)
    newAction.clampWhenFinished = true
  } else {
    newAction.setLoop(LoopRepeat, Infinity)
  }
  newAction.play()

  if (onFinished && !loop) {
    const handler = (e: any) => {
      if (e.action === newAction) {
        mixer.removeEventListener('finished', handler)
        onFinished()
      }
    }
    mixer.addEventListener('finished', handler)
  }

  currentAction = newAction
  return newAction
}

export async function playBaseIdle(actionId: string = '119_Idle') {
  const action = await loadAndPlayAction(actionId, true, undefined, 'idle')
  if (action) baseIdleAction = action
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
    currentAction = null
  }
}
