import { state } from './main'

const PRESET_EXPRESSIONS = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'] as const

// Store desired expression overrides — applied AFTER animation mixer update each frame
const expressionOverrides: Map<string, number> = new Map()

export function setExpression(name: string, intensity: number = 1.0) {
  // Clear previous overrides
  expressionOverrides.clear()

  if (name === 'neutral') return

  expressionOverrides.set(name, intensity)
}

export function resetExpressions() {
  expressionOverrides.clear()
}

/**
 * Apply expression overrides on top of animation.
 * Call this AFTER mixer.update() and BEFORE vrm.update() in the render loop.
 */
export function applyExpressionOverrides() {
  const { vrm } = state
  if (!vrm?.expressionManager) return

  for (const [name, weight] of expressionOverrides) {
    vrm.expressionManager.setValue(name, weight)
  }
}

export function getExpressionOverrides(): Map<string, number> {
  return expressionOverrides
}
