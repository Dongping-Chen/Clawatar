import { state } from './app-state'

let breathingEnabled = true
let breathPhase = 0

/** Procedural breathing & micro-movement — additive bone layer */
export function updateBreathing(delta: number): void {
  if (!breathingEnabled || !state.vrm) return
  const humanoid = state.vrm.humanoid
  if (!humanoid) return

  breathPhase += delta

  // 1. BREATHING — chest/spine rises and falls
  const spine = humanoid.getNormalizedBoneNode('spine')
  const chest = humanoid.getNormalizedBoneNode('chest')
  if (spine) spine.rotation.x += Math.sin(breathPhase * 1.2) * 0.008
  if (chest) chest.rotation.x += Math.sin(breathPhase * 1.2 + 0.3) * 0.005

  // 2. WEIGHT SHIFT — subtle hip sway
  const hips = humanoid.getNormalizedBoneNode('hips')
  if (hips) {
    hips.rotation.z += Math.sin(breathPhase * 0.4) * 0.003
    hips.position.y += Math.sin(breathPhase * 0.4) * 0.001
  }

  // 3. HEAD MICRO-MOVEMENT
  const head = humanoid.getNormalizedBoneNode('head')
  if (head) {
    head.rotation.x += Math.sin(breathPhase * 0.3) * 0.005
    head.rotation.y += Math.sin(breathPhase * 0.2 + 1.5) * 0.008
  }

  // 4. SHOULDER MICRO-MOVEMENT
  const leftShoulder = humanoid.getNormalizedBoneNode('leftShoulder')
  const rightShoulder = humanoid.getNormalizedBoneNode('rightShoulder')
  if (leftShoulder) leftShoulder.rotation.z += Math.sin(breathPhase * 1.2) * 0.003
  if (rightShoulder) rightShoulder.rotation.z += Math.sin(breathPhase * 1.2 + Math.PI) * 0.003
}

export function setBreathingEnabled(enabled: boolean): void {
  breathingEnabled = enabled
}
