import type { CharacterState, IdleConfig } from './types'
import { state } from './main'
import { getActivityMode } from './activity-modes'
import { DEFAULT_BASE_IDLE_ACTION, loadAndPlayAction, playBaseIdle, warmupAnimationCache } from './animation'
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
const queryParams = new URLSearchParams(window.location.search)
const isFollower = queryParams.has('noidle')
const isEmbedMode = queryParams.has('embed')
const isBackgroundOnly = queryParams.has('bgonly')
const shouldWarmupAnimations = !isBackgroundOnly && (!isEmbedMode || !isFollower)

export function setIdleAnimationsEnabled(enabled: boolean) {
  state.idleAnimationsEnabled = enabled
}

// Meeting mode: limited idle animations (subtle only), respond to speak commands
let meetingMode = false
export function setMeetingMode(enabled: boolean) { meetingMode = enabled }

// Meeting-friendly idle categories — subtle seated/standing animations only
const MEETING_IDLE_CATEGORIES: string[] = [
  DEFAULT_BASE_IDLE_ACTION,
  'dm_0',
  'dm_5',
  'dm_6',
  'dm_7',
  'dm_13',
  'dm_14',
  'dm_15',
  '86_Talking',
  'dm_120',
  'dm_121',
  'dm_128',
]

// Animation taxonomy based on Dongping's manual review (2026-02-19)
const IDLE_CATEGORIES = {
  // Talking — use during conversation (very important)
  talking: ['dm_0', 'dm_5', 'dm_6', 'dm_7', 'dm_13', 'dm_14', 'dm_15', 'dm_90', '86_Talking'],

  // Happy/Encouraging reactions
  happy: ['19_Clapping', 'dm_2', 'dm_28', 'dm_45', 'dm_53'],

  // Hello/Greeting
  hello: ['79_Standing Greeting', '161_Waving', 'dm_4', 'dm_10', 'dm_11', 'dm_12', 'dm_39'],

  // Thinking/Working
  thinking: ['88_Thinking', 'dm_3', 'dm_108'],

  // Sad/Defeated
  sad: ['22_Crying', '23_Crying_2', '26_Defeat', '142_Sad Idle'],

  // Angry
  angry: ['0_Angry', '94_Angry Gesture'],

  // Taunt/Playful
  taunt: ['53_Loser', '56_No', '116_Happy Hand Gesture', 'dm_8', 'dm_9'],

  // Affection (blow kiss, heart)
  affection: ['dm_20', 'dm_21', 'dm_29', 'dm_41'],

  // Cute poses
  cute: ['dm_26', 'dm_30', 'dm_31', 'dm_43', 'dm_47', 'dm_48', 'dm_56', 'dm_57'],

  // Dance
  dance: ['1_Arms Hip Hop Dance', '3_Bboy Hip Hop Move', '4_Belly Dance', '5_Bellydancing', '18_Chicken Dance', '25_Dancing Twerk', '41_Hip Hop Dancing', '42_Hip Hop Dancing_2', '43_Hip Hop Dancing_3', '44_Hip Hop Dancing_4', '45_House Dancing', '46_House Dancing_2', '47_Jazz Dancing', '54_Macarena Dance', '67_Rumba Dancing', '70_Silly Dancing', '78_Snake Hip Hop Dance', '83_Swing Dancing', '84_Swing Dancing_2', '85_Swing Dancing_3', 'dm_38', 'reze_dance_hard'],

  // Idle (standing)
  idle: ['dm_22', 'dm_23', 'dm_24', 'dm_33', 'dm_46', 'dm_59', 'dm_63', 'dm_82', 'dm_86', 'dm_88', 'dm_89', 'dm_101', 'dm_120', 'dm_121', 'dm_122', 'dm_123', 'dm_124', 'dm_125', 'dm_126', 'dm_127', 'dm_128', 'dm_138', 'dm_139'],

  // Night/Sleepy idle
  tired: ['29_Drunk Idle Variation', '30_Drunk Idle', '64_Rejected', '127_Leaning', 'dm_17', 'dm_110', 'dm_111', 'dm_129'],

  // Sitting idle
  sitting: ['75_Sitting', '76_Sitting_2', '149_Sitting Idle', 'dm_85', 'dm_87', 'dm_114'],

  // Oneshot micro-actions
  oneshot: ['49_Joyful Jump', '131_Neck Stretching', '155_Talking On Phone', 'dm_19', 'dm_32', 'dm_134', 'dm_135'],

  // Other reactions
  refuse: ['95_Annoyed Head Shake', '144_Shaking Head No', 'dm_27'],
  agree: ['118_Head Nod Yes'],
  grateful: ['156_Thankful'],
  shy: ['dm_51', 'dm_40'],
  singing: ['71_Singing', 'dm_97'],
  shush: ['dm_42', 'dm_52'],
  whatever: ['93_Whatever Gesture', '145_Shrugging'],
}

const LOOP_IDLE_CATEGORIES = {
  idle: IDLE_CATEGORIES.idle,
  tired: IDLE_CATEGORIES.tired,
  sitting: IDLE_CATEGORIES.sitting,
  talking: IDLE_CATEGORIES.talking,
} as const

type IdleLoopCategory = keyof typeof LOOP_IDLE_CATEGORIES

const HOT_SYNC_ACTIONS: string[] = Array.from(new Set([
  // Core idles
  DEFAULT_BASE_IDLE_ACTION,
  '88_Thinking',
  '118_Head Nod Yes',
  '145_Shrugging',
  '149_Sitting Idle',
  '75_Sitting',
  // Fast-response talking/greeting actions
  '86_Talking',
  '137_Quick Formal Bow',
  '138_Quick Informal Bow',
  '79_Standing Greeting',
  '161_Waving',
  'dm_0',
  'dm_5',
  'dm_6',
  'dm_7',
  // Common emotion picks
  '19_Clapping',
  '53_Loser',
  '0_Angry',
  '22_Crying',
  '23_Crying_2',
  '65_Relieved Sigh',
  '71_Singing',
]))

let warmupStarted = false

function ensureAnimationWarmupStarted() {
  if (warmupStarted || !shouldWarmupAnimations || !state.vrm) return
  warmupStarted = true

  // Delay warmup slightly so initial model decode + first frame land faster.
  const delayMs = isEmbedMode ? 1200 : 300
  window.setTimeout(() => {
    void warmupAnimationCache(HOT_SYNC_ACTIONS, isEmbedMode ? 1 : 2)
  }, delayMs)
}

// Idle loop pool weights.
const CATEGORY_WEIGHTS: Array<[IdleLoopCategory, number]> = [
  ['idle', 0.64],
  ['tired', 0.14],
  ['talking', 0.12],
  ['sitting', 0.10],
]

// Time-of-day weight adjustments
function getTimeAdjustedWeights(): Array<[IdleLoopCategory, number]> {
  // Keep a stable distribution so idle remains dominant when not actively conversing.
  return CATEGORY_WEIGHTS
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

let idlePickCounter = 0

function pickIdleActionWithCategory(): { action: string; category: IdleLoopCategory } {
  // Keep sync by time window while varying repeated picks within the same window.
  const rng = seededRandom(getSyncSeed() + idlePickCounter++)
  const weights = getTimeAdjustedWeights()
  const roll = rng()
  let cumulative = 0
  let category: IdleLoopCategory = 'idle'
  for (const [cat, weight] of weights) {
    cumulative += weight
    if (roll <= cumulative) {
      category = cat
      break
    }
  }
  const actions = LOOP_IDLE_CATEGORIES[category]
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
function getExpressionForCategory(category: IdleLoopCategory): { name: string; weight: number } | null {
  switch (category) {
    case 'tired':     return { name: 'relaxed', weight: 0.4 }
    case 'talking':   return null
    case 'idle':      return null
    case 'sitting':   return null
    default: return null
  }
}

let currentIdleCategory: IdleLoopCategory = 'idle'

interface ActionSyncOptions {
  sync?: boolean
  expression?: { name: string; weight: number }
  loop?: boolean
  category?: string
}

function updateHoldWindow(elapsed: number, seedOffset = 99): void {
  const holdRng = seededRandom(getSyncSeed() + seedOffset)
  holdUntil = elapsed + idleConfig.idleMinHoldSeconds +
    holdRng() * (idleConfig.idleMaxHoldSeconds - idleConfig.idleMinHoldSeconds)
}

export function updateStateMachine(elapsed: number) {
  // Follower mode: don't pick idle animations, only respond to WS play_action
  if (isFollower) return
  // Background-only renderer has no avatar actions to drive.
  if (isBackgroundOnly) return
  if (!state.vrm) return
  ensureAnimationWarmupStarted()
  // Avatar config can disable random idle picks
  if (!state.idleAnimationsEnabled) return
  // Activity mode handles its own animations
  if (getActivityMode() !== 'free') return

  if (state.characterState !== 'idle') return
  if (elapsed < holdUntil) return
  if (elapsed - lastIdleAttempt < idleConfig.idleActionInterval) return

  lastIdleAttempt = elapsed

  // Use synced RNG for chance check too, and vary repeated checks within same seed window.
  const chanceRoll = seededRandom(getSyncSeed() + idlePickCounter++)()

  // Meeting mode: less frequent, subtle animations only
  if (meetingMode) {
    if (chanceRoll > 0.2) return  // 20% chance (less frequent)
    const meetRng = seededRandom(getSyncSeed() + 1)
    const pick = MEETING_IDLE_CATEGORIES[Math.floor(meetRng() * MEETING_IDLE_CATEGORIES.length)]
    setState('action')
    resetExpressionsImmediately()
    broadcastIdleAction(pick, null, 'idle')
    loadAndPlayAction(pick, true, undefined, 'idle').then(() => {
      setState('idle')
      updateHoldWindow(elapsed, 101)
    }).catch(() => {
      resetExpressionsImmediately()
      playBaseIdle().then(() => setState('idle'))
    })
    return
  }

  if (chanceRoll > idleConfig.idleActionChance) {
    console.log(`[IDLE] chance miss: ${chanceRoll.toFixed(2)} > ${idleConfig.idleActionChance}`)
    return
  }

  const { action: actionId, category } = pickIdleActionWithCategory()
  console.log(`[IDLE] picked loop: ${actionId} (${category})`)
  currentIdleCategory = category
  setState('action')
  resetExpressionsImmediately()

  // Broadcast to WS so follower instances play the same animation
  // Set subtle expression matching the animation's emotion
  const expr = getExpressionForCategory(category)
  if (expr) {
    setExpression(expr.name, expr.weight)
  }

  // Broadcast animation + expression to followers via WS
  broadcastIdleAction(actionId, expr, category)

  // Loop idles stay active continuously; hold window controls when to rotate to another loop.
  loadAndPlayAction(actionId, true, undefined, category).then(() => {
    setState('idle')
    updateHoldWindow(elapsed, 99)
  }).catch(() => {
    resetExpressionsImmediately()
    playBaseIdle().then(() => setState('idle'))
  })
}

/** Broadcast idle action + expression to relay + native bridge for cross-device sync */
function broadcastIdleAction(
  actionId: string,
  expression?: { name: string; weight: number } | null,
  category: IdleLoopCategory = 'idle',
) {
  const msg: any = {
    type: 'play_action',
    action_id: actionId,
    loop: true,
    category,
  }
  if (expression) {
    msg.expression = expression.name
    msg.expression_weight = expression.weight
  }
  broadcastSyncCommand(msg)
}

export async function requestAction(actionId: string, options: ActionSyncOptions = {}) {
  ensureAnimationWarmupStarted()

  const shouldSync = options.sync ?? true
  const loop = options.loop ?? false
  const targetCategory = options.category ?? (loop ? 'idle' : 'action')

  if (shouldSync) {
    const syncMessage: any = {
      type: 'play_action',
      action_id: actionId,
      loop,
      category: targetCategory,
    }
    if (options.expression) {
      syncMessage.expression = options.expression.name
      syncMessage.expression_weight = options.expression.weight
    }
    broadcastSyncCommand(syncMessage)
  }

  if (loop) {
    setState('idle')
    await loadAndPlayAction(actionId, true, undefined, targetCategory)
    return
  }

  setState('action')
  await loadAndPlayAction(actionId, false, () => {
    resetExpressionsImmediately()  // Clear expression overrides right when action ends
    playBaseIdle().then(() => setState('idle'))
  }, targetCategory)
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
