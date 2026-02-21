import { state } from './main'

let nextBlinkTime = 0
let blinkPhase: 'idle' | 'closing' | 'opening' = 'idle'
let blinkProgress = 0
let warnedMissingBlink = false

function setBlinkIfAvailable(weight: number) {
  const manager = state.vrm?.expressionManager
  if (!manager) return

  if (manager.getExpression('blink') != null) {
    manager.setValue('blink', weight)
    return
  }

  if (!warnedMissingBlink) {
    warnedMissingBlink = true
    console.warn('[blink] Model does not define expression "blink", auto blink disabled for this model.')
  }
}

export function setAutoBlinkEnabled(enabled: boolean) {
  state.autoBlinkEnabled = enabled

  if (!enabled) {
    blinkPhase = 'idle'
    blinkProgress = 0
    setBlinkIfAvailable(0)
  }
}

export function updateBlink(elapsed: number) {
  if (!state.autoBlinkEnabled || !state.vrm?.expressionManager) return

  const now = elapsed

  if (blinkPhase === 'idle') {
    if (now >= nextBlinkTime) {
      blinkPhase = 'closing'
      blinkProgress = 0
    }
    return
  }

  const speed = 12 // blink speed

  if (blinkPhase === 'closing') {
    blinkProgress = Math.min(1, blinkProgress + speed * (1/60))
    setBlinkIfAvailable(blinkProgress)
    if (blinkProgress >= 1) blinkPhase = 'opening'
  } else if (blinkPhase === 'opening') {
    blinkProgress = Math.max(0, blinkProgress - speed * (1/60))
    setBlinkIfAvailable(blinkProgress)
    if (blinkProgress <= 0) {
      blinkPhase = 'idle'
      nextBlinkTime = now + 2 + Math.random() * 4
    }
  }
}
