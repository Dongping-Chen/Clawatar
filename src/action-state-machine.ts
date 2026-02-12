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
  // Booth: cute companion animations (LovePoint_Cute)
  cute: [
    'booth_lp_LP_1', 'booth_lp_LP_2', 'booth_lp_LP_3', 'booth_lp_LP_4',
    'booth_lp_LP_5', 'booth_lp_LP_6', 'booth_lp_LP_7', 'booth_lp_LP_8',
    'booth_lp_LP_9', 'booth_lp_LP_10', 'booth_lp_LP_11', 'booth_lp_LP_12',
    'booth_lp_LP_13', 'booth_lp_LP_14', 'booth_lp_LP_15', 'booth_lp_LP_16',
  ],
  // Booth: emote/pose animations (PURUPURU)
  emote: [
    'booth_pp_Sample_1', 'booth_pp_Sample_2', 'booth_pp_Sample_3',
    'booth_pp_Sample_4', 'booth_pp_Sample_5', 'booth_pp_Sample_6',
    'booth_pp_Sample_7', 'booth_pp_Sample_8', 'booth_pp_Sample_9',
    'booth_pp_Sample_10',
  ],
  // Booth: cute sitting/sleeping (EmoteCollector)
  cozy: [
    'booth_ec_Sit_Girly', 'booth_ec_Sit_KneeBend',
    'booth_ec_AFK', 'booth_ec_Sleep_Side',
  ],
}

// Weighted category selection — Booth cute animations featured prominently
const CATEGORY_WEIGHTS: Array<[keyof typeof IDLE_CATEGORIES, number]> = [
  ['cute', 0.28],      // Booth LovePoint — best for companion feel
  ['relaxed', 0.22],
  ['active', 0.15],
  ['emote', 0.12],     // Booth PURUPURU
  ['happy', 0.10],
  ['selfCare', 0.08],
  ['cozy', 0.05],      // Booth EmoteCollector sitting/sleeping
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
