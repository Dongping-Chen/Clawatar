import type { CharacterState, IdleConfig } from './types'
import { state } from './main'
import { getActivityMode } from './activity-modes'
import { loadAndPlayAction, playBaseIdle, warmupAnimationCache } from './animation'
import { setExpression, resetExpressionsImmediately } from './expressions'
import { triggerSpeak, playAudioLipSync, resetLipSync } from './lip-sync'
import { broadcastSyncCommand } from './sync-bridge'

export const idleConfig: IdleConfig = {
  idleActionInterval: 6,     // Check every 6 seconds (was 12)
  idleActionChance: 0.4,     // 40% chance to act (was 20%)
  idleMinHoldSeconds: 8,     // Hold at least 8s (was 16)
  idleMaxHoldSeconds: 18,    // Hold at most 18s (was 30)
}

// noidle mode: follower instances skip idle animation picks, only respond to WS commands
const isFollower = new URLSearchParams(window.location.search).has('noidle')

export function setIdleAnimationsEnabled(enabled: boolean) {
  state.idleAnimationsEnabled = enabled
}

// Meeting mode: limited idle animations (subtle only), respond to speak commands
let meetingMode = false
export function setMeetingMode(enabled: boolean) { meetingMode = enabled }

// Meeting-friendly idle categories — subtle seated/standing animations only
const MEETING_IDLE_CATEGORIES: string[] = [
  '40_Happy Idle',
  '88_Thinking',
  '118_Head Nod Yes',
  '125_Laughing',
  '119_Idle',
  '161_Waving',
  '145_Shrugging',
]

// DM Motionpack animations organized by emotion (from vrma_catalog.json)
// These are high-quality Booth companion animations
const IDLE_CATEGORIES = {
  // Happy — cheerful greetings, cute gestures, peace signs (23 anims)
  happy: [
    'dm_4',   // wave_greet
    'dm_10',  // raise_hand_bow_greet
    'dm_11',  // raise_hand_bow_greet_2
    'dm_24',  // cat_paw_cute
    'dm_26',  // jump_peace_sign
    'dm_27',  // hands_behind_sway
    'dm_29',  // heart_gesture
    'dm_41',  // happy_sway
    'dm_42',  // cute_attention_call
    'dm_44',  // lean_to_side_curious
    'dm_46',  // crossed_legs_hands_hips
    'dm_47',  // high_five_request
    'dm_48',  // fist_bump_request
    'dm_124', // standing_idle_happy_shy
    'dm_125', // standing_idle_hands_near_face
  ],
  // Neutral — presenting, thinking, natural waiting (36 anims)
  neutral: [
    'dm_0',   // present_alternate_hands
    'dm_3',   // chin_rest_think
    'dm_5',   // present_one_hand
    'dm_6',   // present_one_hand_2
    'dm_7',   // present_one_hand_3
    'dm_120', // standing_idle_natural_wait
    'dm_121', 'dm_122', 'dm_123',
    'dm_126', 'dm_127', 'dm_128',
    'dm_130', 'dm_131', 'dm_132', 'dm_133',
    'dm_134', 'dm_135', 'dm_136', 'dm_137',
  ],
  // Loving — heart gestures, blowing kisses (7 anims)
  loving: [
    'dm_16',  // hands_heart_speak
    'dm_20',  // blow_kiss
    'dm_21',  // blow_kiss_bow
    'dm_29',  // heart_gesture
    'dm_30',  // half_heart_right
    'dm_31',  // half_heart_left
    'dm_32',  // big_heart
  ],
  // Excited — cheering, jumping, celebrating (8 anims)
  excited: [
    'dm_2',   // cheer_arms_swing
    'dm_15',  // fist_pump_speak
    'dm_18',  // big_jump_celebrate
    'dm_19',  // small_jump_attention
    'dm_28',  // hands_hips_cheer
    'dm_34',  // thumbs_up_dance
  ],
  // Shy — cute fidgeting, finger poking (5 anims)
  shy: [
    'dm_40',  // finger_poke_shy
    'dm_51',  // shy_twist_chest
    'dm_124', // standing_idle_happy_shy
    'dm_125', // standing_idle_hands_near_face
    'dm_129', // standing_idle_cute_shy
  ],
  // Tired — yawning, sleepy, stretching (11 anims, for evening/night)
  tired: [
    'dm_17',  // drooping_tired
    'dm_110', // yawn_tired
    'dm_111', // tired_rub_eyes
    'dm_112', // lie_down_yawn_stand
    'dm_113', // lie_down_rub_eyes_stand
    'dm_114', 'dm_115', 'dm_116', 'dm_117', 'dm_118', 'dm_119',
  ],
  // Stretching — morning/self-care (10 anims)
  stretching: [
    'dm_80', 'dm_81', 'dm_82', 'dm_83', 'dm_84',
    'dm_85', 'dm_86', 'dm_87', 'dm_88', 'dm_89',
  ],
  // Proud — confident, cool poses (8 anims)
  proud: [
    'dm_14',  // arms_up_tsundere
    'dm_23',  // finger_guns_cool
    'dm_33',  // single_finger_gun
    'dm_34',  // thumbs_up_dance
    'dm_36',  // confident_dance
    'dm_37', 'dm_38', 'dm_39',
  ],
  // Dance — Reze's signature dances (HIGHEST PRIORITY for dance picks)
  dance: [
    'reze_dance_soft',  // Reze dance — soft/gentle version
    'reze_dance_hard',  // Reze dance — hard/energetic version
  ],
}

const HOT_SYNC_ACTIONS: string[] = Array.from(new Set([
  '119_Idle',
  ...MEETING_IDLE_CATEGORIES,
  ...Object.values(IDLE_CATEGORIES).flat(),
]))

let warmupStarted = false

function ensureAnimationWarmupStarted() {
  if (warmupStarted) return
  warmupStarted = true

  // Preload common/idle VRMA files in background so cross-device sync can start immediately.
  void warmupAnimationCache(HOT_SYNC_ACTIONS, 3)
}

// Default weights (overridden by time-of-day)
const CATEGORY_WEIGHTS: Array<[keyof typeof IDLE_CATEGORIES, number]> = [
  ['neutral', 0.22],
  ['happy', 0.20],
  ['dance', 0.12],   // Reze's signature dance — high priority!
  ['shy', 0.10],
  ['loving', 0.09],
  ['excited', 0.07],
  ['proud', 0.07],
  ['stretching', 0.07],
  ['tired', 0.06],
]

// Time-of-day weight adjustments
function getTimeAdjustedWeights(): Array<[keyof typeof IDLE_CATEGORIES, number]> {
  const hour = new Date().getHours()

  if (hour >= 23 || hour < 6) {
    // Late night — sleepy, tired, cozy (but still some dance~)
    return [
      ['tired', 0.35],
      ['neutral', 0.18],
      ['shy', 0.13],
      ['loving', 0.10],
      ['happy', 0.08],
      ['dance', 0.08],
      ['stretching', 0.05],
      ['excited', 0.02],
      ['proud', 0.01],
    ]
  } else if (hour >= 6 && hour < 10) {
    // Morning — stretching, waking up, gradually cheerful
    return [
      ['stretching', 0.25],
      ['neutral', 0.18],
      ['happy', 0.15],
      ['tired', 0.12],
      ['dance', 0.10],
      ['shy', 0.08],
      ['excited', 0.05],
      ['loving', 0.04],
      ['proud', 0.03],
    ]
  } else if (hour >= 10 && hour < 18) {
    // Daytime — active, happy, dancing!
    return [
      ['happy', 0.22],
      ['neutral', 0.18],
      ['dance', 0.15],    // Daytime = most dancing
      ['excited', 0.12],
      ['proud', 0.10],
      ['loving', 0.08],
      ['shy', 0.06],
      ['stretching', 0.05],
      ['tired', 0.04],
    ]
  } else {
    // Evening (18-23) — winding down, sweet, relaxed
    return [
      ['neutral', 0.20],
      ['happy', 0.18],
      ['loving', 0.13],
      ['shy', 0.12],
      ['dance', 0.12],
      ['tired', 0.08],
      ['stretching', 0.07],
      ['excited', 0.05],
      ['proud', 0.05],
    ]
  }
}

/**
 * Seeded PRNG (mulberry32) — ensures all devices pick the same animation
 * when using the same seed (time-window based).
 */
function seededRandom(seed: number): () => number {
  let t = seed | 0
  return () => {
    t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Current sync seed — based on 10-second time windows so all devices align */
function getSyncSeed(): number {
  return Math.floor(Date.now() / 10000)
}

function pickIdleActionWithCategory(): { action: string; category: keyof typeof IDLE_CATEGORIES } {
  // Use time-synced seed so all devices pick the same animation
  const rng = seededRandom(getSyncSeed())
  const weights = getTimeAdjustedWeights()
  const roll = rng()
  let cumulative = 0
  let category: keyof typeof IDLE_CATEGORIES = 'neutral'
  for (const [cat, weight] of weights) {
    cumulative += weight
    if (roll <= cumulative) {
      category = cat
      break
    }
  }
  const actions = IDLE_CATEGORIES[category]
  const action = actions[Math.floor(rng() * actions.length)]
  return { action, category }
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

// Map animation categories to subtle expression settings
function getExpressionForCategory(category: keyof typeof IDLE_CATEGORIES): { name: string; weight: number } | null {
  switch (category) {
    case 'happy':    return { name: 'happy', weight: 0.3 }    // Subtle smile, not full squint
    case 'loving':   return { name: 'happy', weight: 0.35 }
    case 'excited':  return { name: 'happy', weight: 0.25 }
    case 'shy':      return { name: 'happy', weight: 0.15 }   // Tiny shy smile
    case 'tired':    return { name: 'relaxed', weight: 0.4 }  // Sleepy eyes
    case 'proud':    return { name: 'happy', weight: 0.2 }
    case 'dance':    return { name: 'happy', weight: 0.4 }    // Big smile while dancing!
    case 'neutral':  return null  // No expression override — natural
    case 'stretching': return null
    default: return null
  }
}

let currentIdleCategory: keyof typeof IDLE_CATEGORIES = 'neutral'

interface ActionSyncOptions {
  sync?: boolean
  expression?: { name: string; weight: number }
}

export function updateStateMachine(elapsed: number) {
  ensureAnimationWarmupStarted()

  // Follower mode: don't pick idle animations, only respond to WS play_action
  if (isFollower) return
  // Avatar config can disable random idle picks
  if (!state.idleAnimationsEnabled) return
  // Activity mode handles its own animations
  if (getActivityMode() !== 'free') return

  if (state.characterState !== 'idle') return
  if (elapsed < holdUntil) return
  if (elapsed - lastIdleAttempt < idleConfig.idleActionInterval) return

  lastIdleAttempt = elapsed

  // Use synced RNG for chance check too (so all devices agree on skip/act)
  const syncRng = seededRandom(getSyncSeed())
  // Consume first two values (used by pickIdleActionWithCategory), use 3rd for chance
  syncRng(); syncRng()
  const chanceRoll = syncRng()

  // Meeting mode: less frequent, subtle animations only
  if (meetingMode) {
    if (chanceRoll > 0.2) return  // 20% chance (less frequent)
    const meetRng = seededRandom(getSyncSeed() + 1)
    const pick = MEETING_IDLE_CATEGORIES[Math.floor(meetRng() * MEETING_IDLE_CATEGORIES.length)]
    setState('action')
    loadAndPlayAction(pick, false, () => {
      resetExpressionsImmediately()
      playBaseIdle().then(() => {
        setState('idle')
        holdUntil = elapsed + 12 + Math.random() * 15  // longer hold between meeting idles
      })
    }).catch(() => { setState('idle') })
    return
  }

  if (chanceRoll > idleConfig.idleActionChance) return

  const { action: actionId, category } = pickIdleActionWithCategory()
  currentIdleCategory = category
  setState('action')

  // Broadcast to WS so follower instances play the same animation
  // Set subtle expression matching the animation's emotion
  const expr = getExpressionForCategory(category)
  if (expr) {
    setExpression(expr.name, expr.weight)
  }

  // Broadcast animation + expression to followers via WS
  broadcastIdleAction(actionId, expr)

  loadAndPlayAction(actionId, false, () => {
    // ALWAYS reset expressions when idle animation finishes
    resetExpressionsImmediately()
    playBaseIdle().then(() => {
      setState('idle')
      // Use synced hold duration so devices stay in lockstep
      const holdRng = seededRandom(getSyncSeed() + 99)
      holdUntil = elapsed + idleConfig.idleMinHoldSeconds +
        holdRng() * (idleConfig.idleMaxHoldSeconds - idleConfig.idleMinHoldSeconds)
    })
  }, category).catch(() => {
    resetExpressionsImmediately()
    setState('idle')
  })
}

/** Broadcast idle action + expression to relay + native bridge for cross-device sync */
function broadcastIdleAction(actionId: string, expression?: { name: string; weight: number } | null) {
  const msg: any = { type: 'play_action', action_id: actionId }
  if (expression) {
    msg.expression = expression.name
    msg.expression_weight = expression.weight
  }
  broadcastSyncCommand(msg)
}

export async function requestAction(actionId: string, options: ActionSyncOptions = {}) {
  ensureAnimationWarmupStarted()

  const shouldSync = options.sync ?? true

  if (shouldSync) {
    const syncMessage: any = { type: 'play_action', action_id: actionId }
    if (options.expression) {
      syncMessage.expression = options.expression.name
      syncMessage.expression_weight = options.expression.weight
    }
    broadcastSyncCommand(syncMessage)
  }

  setState('action')
  await loadAndPlayAction(actionId, false, () => {
    resetExpressionsImmediately()  // Clear expression overrides right when action ends
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
  resetExpressionsImmediately()
  playBaseIdle().then(() => setState('idle'))
}

/**
 * Begin a streaming speak — sets expression & animation but does NOT
 * await audio (the streaming-audio module drives lip sync instead).
 * Call requestFinishSpeaking() when the stream ends.
 */
export async function requestSpeakAudioStream(
  actionId?: string,
  expression?: string,
  expressionWeight?: number,
): Promise<void> {
  setState('speaking')
  if (expression) setExpression(expression, expressionWeight ?? 0.8)
  if (actionId) {
    loadAndPlayAction(actionId, false, () => {}).catch(console.error)
  }
}

/** End a streaming speak — resets lip sync / expression and returns to idle. */
export function requestFinishSpeaking(): void {
  finishSpeaking()
}

export function requestReset() {
  resetLipSync()
  resetExpressionsImmediately()
  playBaseIdle().then(() => setState('idle'))
}

export function getState(): CharacterState {
  return state.characterState
}
