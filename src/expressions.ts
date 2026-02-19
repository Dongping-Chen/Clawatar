import { state } from './main'
import { broadcastSyncCommand } from './sync-bridge'

interface ExpressionTarget {
  target: number
  current: number
  speed: number
}

const expressionTargets: Map<string, ExpressionTarget> = new Map()
const DEFAULT_SPEED = 3.0

interface SetExpressionOptions {
  sync?: boolean
}

interface ResetExpressionOptions {
  immediate?: boolean
}

export function setExpression(
  name: string,
  targetWeight: number = 1.0,
  transitionSpeed: number = DEFAULT_SPEED,
  options: SetExpressionOptions = {},
) {
  const shouldSync = options.sync === true

  if (name === 'neutral') {
    resetExpressions(transitionSpeed)
    if (shouldSync) {
      broadcastSyncCommand({ type: 'set_expression', name: 'neutral', weight: 0 })
    }
    return
  }

  const existing = expressionTargets.get(name)
  if (existing) {
    existing.target = targetWeight
    existing.speed = transitionSpeed
  } else {
    expressionTargets.set(name, { target: targetWeight, current: 0, speed: transitionSpeed })
  }

  if (shouldSync) {
    broadcastSyncCommand({ type: 'set_expression', name, weight: targetWeight })
  }
}

export function resetExpressions(speed: number = DEFAULT_SPEED, options: ResetExpressionOptions = {}) {
  const { vrm } = state

  if (options.immediate) {
    for (const name of expressionTargets.keys()) {
      vrm?.expressionManager?.setValue(name, 0)
    }

    expressionTargets.clear()
    return
  }

  for (const entry of expressionTargets.values()) {
    entry.target = 0
    entry.speed = speed
  }
}

export function resetExpressionsImmediately() {
  resetExpressions(DEFAULT_SPEED, { immediate: true })
}

/** Called every frame to lerp expressions toward targets */
export function updateExpressionTransitions(delta: number) {
  const { vrm } = state
  if (!vrm?.expressionManager) return

  const toDelete: string[] = []

  for (const [name, entry] of expressionTargets) {
    const diff = entry.target - entry.current
    if (Math.abs(diff) < 0.001) {
      entry.current = entry.target
      if (entry.target === 0) toDelete.push(name)
    } else {
      entry.current += diff * Math.min(1, entry.speed * delta)
    }
  }

  for (const name of toDelete) {
    expressionTargets.delete(name)
    vrm.expressionManager.setValue(name, 0)
  }
}

/**
 * Apply expression overrides on top of animation.
 * Call this AFTER updateExpressionTransitions and mixer.update(), BEFORE vrm.update().
 */
export function applyExpressionOverrides() {
  const { vrm } = state
  if (!vrm?.expressionManager) return

  for (const [name, entry] of expressionTargets) {
    vrm.expressionManager.setValue(name, entry.current)
  }
}

export function getExpressionOverrides(): Map<string, number> {
  const result = new Map<string, number>()
  for (const [name, entry] of expressionTargets) {
    result.set(name, entry.current)
  }
  return result
}
