import { state } from './main'

let nextBlinkTime = 0
let blinkPhase: 'idle' | 'closing' | 'opening' = 'idle'
let blinkProgress = 0

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
    state.vrm.expressionManager.setValue('blink', blinkProgress)
    if (blinkProgress >= 1) blinkPhase = 'opening'
  } else if (blinkPhase === 'opening') {
    blinkProgress = Math.max(0, blinkProgress - speed * (1/60))
    state.vrm.expressionManager.setValue('blink', blinkProgress)
    if (blinkProgress <= 0) {
      blinkPhase = 'idle'
      nextBlinkTime = now + 2 + Math.random() * 4
    }
  }
}
