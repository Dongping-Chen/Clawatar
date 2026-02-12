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
// Booth animations (booth_*) are higher quality companion-style animations
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
    '116_Happy Hand Gesture',
    '72_Sitting Clap',
    '74_Sitting Thumbs Up',
  ],
  // Self-care / comfort (makes character feel alive)
  selfCare: [
    '108_Drinking',
    '163_Yawn',
    '96_Arm Stretching',
    '131_Neck Stretching',
  ],
  // DM Motionpack — real companion idle animations from Booth (140 total)
  // Split into groups to try a sampling of them
  dm_cute: [
    'dm_0', 'dm_1', 'dm_2', 'dm_3', 'dm_4', 'dm_5', 'dm_6', 'dm_7',
    'dm_8', 'dm_9', 'dm_10', 'dm_11', 'dm_12', 'dm_13', 'dm_14', 'dm_15',
    'dm_16', 'dm_17', 'dm_18', 'dm_19', 'dm_20', 'dm_21', 'dm_22', 'dm_23',
    'dm_24', 'dm_25', 'dm_26', 'dm_27', 'dm_28', 'dm_29', 'dm_30',
  ],
  dm_variety: [
    'dm_31', 'dm_32', 'dm_33', 'dm_34', 'dm_35', 'dm_36', 'dm_37', 'dm_38',
    'dm_39', 'dm_40', 'dm_50', 'dm_60', 'dm_70', 'dm_80', 'dm_90', 'dm_100',
    'dm_110', 'dm_120', 'dm_130', 'dm_139',
  ],
}

// Default weights (overridden by time-of-day)
const CATEGORY_WEIGHTS: Array<[keyof typeof IDLE_CATEGORIES, number]> = [
  ['dm_cute', 0.30],     // DM Motionpack — best companion animations
  ['dm_variety', 0.15],  // DM Motionpack variety
  ['relaxed', 0.18],
  ['active', 0.12],
  ['happy', 0.12],
  ['selfCare', 0.08],
  ['relaxed', 0.05],     // extra relaxed weight
]

// Time-of-day weight adjustments
function getTimeAdjustedWeights(): Array<[keyof typeof IDLE_CATEGORIES, number]> {
  const hour = new Date().getHours()

  if (hour >= 23 || hour < 6) {
    // Late night / early morning — sleepy, calm
    return [
      ['dm_cute', 0.30],
      ['relaxed', 0.25],
      ['selfCare', 0.20],   // Yawning, stretching
      ['dm_variety', 0.15],
      ['happy', 0.05],
      ['active', 0.05],
    ]
  } else if (hour >= 6 && hour < 10) {
    // Morning — waking up, stretching
    return [
      ['selfCare', 0.25],
      ['dm_cute', 0.25],
      ['relaxed', 0.20],
      ['dm_variety', 0.12],
      ['active', 0.10],
      ['happy', 0.08],
    ]
  } else if (hour >= 10 && hour < 18) {
    // Daytime — active, cheerful
    return [
      ['dm_cute', 0.28],
      ['active', 0.20],
      ['happy', 0.18],
      ['dm_variety', 0.14],
      ['relaxed', 0.12],
      ['selfCare', 0.08],
    ]
  } else {
    // Evening (18-23) — winding down, comfortable
    return [
      ['dm_cute', 0.30],
      ['relaxed', 0.22],
      ['dm_variety', 0.18],
      ['happy', 0.12],
      ['selfCare', 0.10],
      ['active', 0.08],
    ]
  }
}

function pickIdleAction(): string {
  // Time-aware weighted random category pick
  const weights = getTimeAdjustedWeights()
  const roll = Math.random()
  let cumulative = 0
  let category: keyof typeof IDLE_CATEGORIES = 'relaxed'
  for (const [cat, weight] of weights) {
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
