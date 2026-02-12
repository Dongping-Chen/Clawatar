import { createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import type { VRMAnimation } from '@pixiv/three-vrm-animation'
import type { AnimationAction, AnimationClip } from 'three'
import { LoopOnce, LoopRepeat } from 'three'
import { state } from './main'
import { loadVRMA } from './vrm-loader'
import type { CrossfadeConfig } from './types'

const animationCache = new Map<string, VRMAnimation>()
let currentAction: AnimationAction | null = null
let baseIdleAction: AnimationAction | null = null

export const crossfadeConfig: CrossfadeConfig = {
  minCrossfadeDuration: 0.35,
  maxCrossfadeDuration: 0.8,
}

function getCrossfadeDuration(fromClip: AnimationClip | null, toClip: AnimationClip | null): number {
  // Use longer crossfade for very different actions
  if (!fromClip || !toClip) return crossfadeConfig.minCrossfadeDuration
  // Heuristic: if durations differ a lot, use longer crossfade
  const ratio = Math.abs(fromClip.duration - toClip.duration) / Math.max(fromClip.duration, toClip.duration, 0.1)
  return crossfadeConfig.minCrossfadeDuration + ratio * (crossfadeConfig.maxCrossfadeDuration - crossfadeConfig.minCrossfadeDuration)
}

async function getVRMA(actionId: string): Promise<VRMAnimation> {
  if (animationCache.has(actionId)) return animationCache.get(actionId)!
  const url = `/animations/${actionId}.vrma`
  const vrma = await loadVRMA(url)
  animationCache.set(actionId, vrma)
  return vrma
}

export async function loadAndPlayAction(actionId: string, loop: boolean = false, onFinished?: () => void): Promise<AnimationAction | null> {
  const { vrm, mixer } = state
  if (!vrm || !mixer) return null

  const vrma = await getVRMA(actionId)
  const clip = createVRMAnimationClip(vrma, vrm)
  const newAction = mixer.clipAction(clip)

  const fadeDuration = getCrossfadeDuration(currentAction?.getClip() ?? null, clip)

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
  const { vrm, mixer } = state
  if (!vrm || !mixer) return

  const vrma = await getVRMA(actionId)
  const clip = createVRMAnimationClip(vrma, vrm)
  const action = mixer.clipAction(clip)

  const fadeDuration = getCrossfadeDuration(currentAction?.getClip() ?? null, clip)

  action.reset()
  if (currentAction && currentAction !== action) {
    currentAction.crossFadeTo(action, fadeDuration, true)
  } else {
    action.fadeIn(fadeDuration)
  }
  action.setLoop(LoopRepeat, Infinity)
  action.play()

  baseIdleAction = action
  currentAction = action
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
