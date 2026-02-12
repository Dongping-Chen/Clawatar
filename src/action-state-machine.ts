import type { CharacterState, IdleConfig } from './types'
import { state } from './main'
import { loadAndPlayAction, playBaseIdle } from './animation'
import { setExpression, resetExpressions } from './expressions'
import { triggerSpeak, playAudioLipSync, resetLipSync } from './lip-sync'

export const idleConfig: IdleConfig = {
  idleActionInterval: 6,     // Check every 6 seconds (was 12)
  idleActionChance: 0.4,     // 40% chance to act (was 20%)
  idleMinHoldSeconds: 8,     // Hold at least 8s (was 16)
  idleMaxHoldSeconds: 18,    // Hold at most 18s (was 30)
}

// Categorized idle animations for more lifelike behavior
const IDLE_CATEGORIES = {
  // Relaxed micro-movements (most common — subtle, natural)
  relaxed: [
    '129_Looking Around',
    '162_Weight Shift Gesture',
    '128_Look Around',
    '127_Leaning',
    '65_Relieved Sigh',
    '52_Looking',
  ],
  // Active / alert gestures (engaged feel)
  active: [
    '88_Thinking',
    '39_Hand Raising',
    '118_Head Nod Yes',
    '55_Nervously Look Around',
    '96_Arm Stretching',
    '131_Neck Stretching',
  ],
  // Happy / cheerful (character enjoys being here)
  happy: [
    '40_Happy Idle',
    '150_Sitting Laughing',
    '72_Sitting Clap',
    '74_Sitting Thumbs Up',
    '116_Happy Hand Gesture',
  ],
  // Self-care / comfort (makes character feel alive)
  selfCare: [
    '108_Drinking',
    '163_Yawn',
    '96_Arm Stretching',
    '131_Neck Stretching',
    '59_Petting Animal',
  ],
  // Cozy / sitting (for longer idle periods)
  cozy: [
    '149_Sitting Idle',
    '148_Sitting Drinking',
    '151_Sleeping Idle',
    '147_Sit To Type',
    '142_Sad Idle',
  ],
}

// Weighted category selection — relaxed is most common
const CATEGORY_WEIGHTS: Array<[keyof typeof IDLE_CATEGORIES, number]> = [
  ['relaxed', 0.35],
  ['active', 0.25],
  ['happy', 0.18],
  ['selfCare', 0.15],
  ['cozy', 0.07],
]

function pickIdleAction(): string {
  // Weighted random category pick
  const roll = Math.random()
  let cumulative = 0
  let category: keyof typeof IDLE_CATEGORIES = 'relaxed'
  for (const [cat, weight] of CATEGORY_WEIGHTS) {
    cumulative += weight
    if (roll <= cumulative) {
      category = cat
      break
    }
  }
  const actions = IDLE_CATEGORIES[category]
  return actions[Math.floor(Math.random() * actions.length)]
}

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

  const actionId = pickIdleAction()
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
