import type { CharacterState, IdleConfig } from './types'
import { state } from './main'
import { loadAndPlayAction, playBaseIdle } from './animation'
import { setExpression, resetExpressions } from './expressions'
import { triggerSpeak, playAudioLipSync, resetLipSync } from './lip-sync'

export const idleConfig: IdleConfig = {
  idleActionInterval: 12,
  idleActionChance: 0.2,
  idleMinHoldSeconds: 16,
  idleMaxHoldSeconds: 30,
}

const IDLE_MICRO_ACTIONS = [
  '129_Looking Around',
  '162_Weight Shift Gesture',
  '96_Arm Stretching',
  '128_Look Around',
  '163_Yawn',
  '88_Thinking',
  '127_Leaning',
  '131_Neck Stretching',
]

let lastIdleAttempt = 0
let holdUntil = 0
let stateChangeListeners: Array<(s: CharacterState) => void> = []

export function onStateChange(fn: (s: CharacterState) => void) {
  stateChangeListeners.push(fn)
}

function setState(s: CharacterState) {
  state.characterState = s
  stateChangeListeners.forEach(fn => fn(s))
}

export function updateStateMachine(elapsed: number) {
  if (state.characterState !== 'idle') return
  if (elapsed < holdUntil) return
  if (elapsed - lastIdleAttempt < idleConfig.idleActionInterval) return

  lastIdleAttempt = elapsed

  if (Math.random() > idleConfig.idleActionChance) return

  const actionId = IDLE_MICRO_ACTIONS[Math.floor(Math.random() * IDLE_MICRO_ACTIONS.length)]
  setState('action')

  loadAndPlayAction(actionId, false, () => {
    playBaseIdle().then(() => {
      setState('idle')
      holdUntil = elapsed + idleConfig.idleMinHoldSeconds +
        Math.random() * (idleConfig.idleMaxHoldSeconds - idleConfig.idleMinHoldSeconds)
    })
  }).catch(() => setState('idle'))
}

export async function requestAction(actionId: string) {
  setState('action')
  await loadAndPlayAction(actionId, false, () => {
    playBaseIdle().then(() => setState('idle'))
  })
}

/** Fallback text-based speak (no audio) */
export async function requestSpeak(text: string, actionId?: string, expression?: string, expressionWeight?: number) {
  setState('speaking')

  if (expression) {
    setExpression(expression, expressionWeight ?? 0.8)
  }

  triggerSpeak(text)

  if (actionId) {
    await loadAndPlayAction(actionId, false, () => {
      finishSpeaking()
    })
  } else {
    const duration = Math.max(1, text.length * 0.08)
    setTimeout(() => finishSpeaking(), duration * 1000)
  }
}

/** Audio-driven speak with real TTS audio */
export async function requestSpeakAudio(audioUrl: string, actionId?: string, expression?: string, expressionWeight?: number) {
  setState('speaking')

  if (expression) {
    setExpression(expression, expressionWeight ?? 0.8)
  }

  // Start action animation if specified
  if (actionId) {
    loadAndPlayAction(actionId, false, () => {
      // Action ended - if audio is still playing, go to idle pose but keep speaking state
      // Audio end will handle final cleanup
    }).catch(console.error)
  }

  try {
    // Play audio and drive lip sync - this promise resolves when audio ends
    await playAudioLipSync(audioUrl)
  } catch (e) {
    console.error('Audio playback failed:', e)
  }

  finishSpeaking()
}

function finishSpeaking() {
  resetLipSync()
  resetExpressions()
  playBaseIdle().then(() => setState('idle'))
}

export function requestReset() {
  resetLipSync()
  resetExpressions()
  playBaseIdle().then(() => setState('idle'))
}

export function getState(): CharacterState {
  return state.characterState
}
