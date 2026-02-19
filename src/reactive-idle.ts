import { setExpression, resetExpressions } from './expressions'
import { requestAction } from './action-state-machine'
import { state } from './main'

type ActivityType = 'typing' | 'click' | 'mouse' | 'speech'

let lastActivity = 0
let lastActivityType: ActivityType = 'mouse'
let wasAway = false
let boredTriggered = false
let returnGreeted = false

const BORED_TIMEOUT = 30       // seconds before bored behavior
const AWAY_THRESHOLD = 120     // seconds before "away" state
const BORED_ANIMATIONS = ['dm_3', 'dm_110', 'dm_120', 'dm_44']
const WAVE_ANIMATION = 'dm_4'

export function notifyUserActivity(type: ActivityType) {
  lastActivity = performance.now() / 1000
  lastActivityType = type
  boredTriggered = false

  // Reset bored state on any interaction
}

export function updateReactiveIdle(_elapsed: number, _delta: number) {
  if (!state.vrm) return
  if (state.characterState !== 'idle') {
    returnGreeted = false
    return
  }

  const now = performance.now() / 1000
  const timeSinceActivity = now - lastActivity

  // Handle user typing — curious tilt
  if (lastActivityType === 'typing' && timeSinceActivity < 2) {
    setExpression('happy', 0.15, 2.0)
    return
  }

  // Return greeting after being away
  if (timeSinceActivity < 1 && wasAway && !returnGreeted) {
    returnGreeted = true
    wasAway = false
    boredTriggered = false
    setExpression('happy', 0.5, 3.0)
    requestAction(WAVE_ANIMATION, {
      expression: { name: 'happy', weight: 0.5 },
    }).catch(() => {})
    return
  }

  // Track away state
  if (timeSinceActivity > AWAY_THRESHOLD) {
    wasAway = true
    returnGreeted = false
  }

  // Bored behavior
  if (timeSinceActivity > BORED_TIMEOUT && !boredTriggered) {
    boredTriggered = true
    const anim = BORED_ANIMATIONS[Math.floor(Math.random() * BORED_ANIMATIONS.length)]
    setExpression('relaxed', 0.3, 1.5)
    requestAction(anim, {
      expression: { name: 'relaxed', weight: 0.3 },
    }).catch(() => {})
  }
}

/** Initialize mouse tracking on canvas */
export function initReactiveIdle(canvas: HTMLCanvasElement) {
  canvas.addEventListener('mousemove', () => notifyUserActivity('mouse'))
  canvas.addEventListener('click', () => notifyUserActivity('click'))
  // Set initial activity time
  lastActivity = performance.now() / 1000
}
