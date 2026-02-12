import { camera, controls } from './scene'
import { loadAndPlayAction, playBaseIdle } from './animation'
import { setRoomTheme, enableRoomMode, isRoomMode } from './room-scene'
import { resetExpressions, setExpression } from './expressions'

export type ActivityMode = 'free' | 'study' | 'exercise' | 'chill'

let currentMode: ActivityMode = 'free'
let activityTimer = 0
let activityAnimIndex = 0
let isTransitioning = false

// Camera targets per mode
const MODE_CAMERAS: Record<Exclude<ActivityMode, 'free'>, { pos: [number, number, number]; target: [number, number, number] }> = {
  study:    { pos: [1.2, 1.6, 0.5],  target: [-1.0, 0.9, -1.0] },
  exercise: { pos: [0, 1.5, 3.5],    target: [0, 0.8, 0] },
  chill:    { pos: [-0.8, 1.3, 2.0], target: [0, 0.9, 0] },
}

const MODE_ANIMS: Record<Exclude<ActivityMode, 'free'>, string[]> = {
  study:    ['147_Sit To Type', '149_Sitting Idle', '148_Sitting Drinking', '72_Sitting Clap'],
  exercise: ['96_Arm Stretching', '11_Burpee', '134_Plank', '63_Push Up', '77_Situps', '123_Kettlebell Swing', '132_Overhead Squat', '97_Back Squat'],
  chill:    ['75_Sitting', '76_Sitting_2', '149_Sitting Idle', '150_Sitting Laughing', 'dm_17', 'dm_40'],
}

// Interval between activity animations (seconds)
const MODE_INTERVALS: Record<Exclude<ActivityMode, 'free'>, number> = {
  study: 15,
  exercise: 12,
  chill: 18,
}

// Lerp targets for smooth camera transition
let lerpTarget: { pos: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null = null
let lerpProgress = 0

export function getActivityMode(): ActivityMode {
  return currentMode
}

export function setActivityMode(mode: ActivityMode): void {
  if (mode === currentMode) return
  currentMode = mode
  activityTimer = 0
  activityAnimIndex = 0
  isTransitioning = false

  if (mode === 'free') {
    lerpTarget = null
    // Restore normal idle
    resetExpressions()
    playBaseIdle().catch(() => {})
    return
  }

  // Ensure room mode is on
  if (!isRoomMode()) {
    enableRoomMode()
  }

  // Set theme
  if (mode === 'study') {
    setRoomTheme('study')
  } else if (mode === 'chill') {
    const hour = new Date().getHours()
    setRoomTheme(hour >= 20 || hour < 6 ? 'night' : 'cozy')
  } else {
    setRoomTheme('cozy')
  }

  // Start smooth camera transition
  const cam = MODE_CAMERAS[mode]
  lerpTarget = {
    pos: { x: cam.pos[0], y: cam.pos[1], z: cam.pos[2] },
    target: { x: cam.target[0], y: cam.target[1], z: cam.target[2] },
  }
  lerpProgress = 0

  // Play first animation
  playActivityAnim()
}

function playActivityAnim(): void {
  if (currentMode === 'free') return
  const anims = MODE_ANIMS[currentMode]
  const animId = anims[activityAnimIndex % anims.length]
  activityAnimIndex++
  isTransitioning = true

  // Set expression
  if (currentMode === 'study') setExpression('neutral', 0.3)
  else if (currentMode === 'exercise') setExpression('happy', 0.2)
  else if (currentMode === 'chill') setExpression('relaxed', 0.4)

  loadAndPlayAction(animId, false, () => {
    isTransitioning = false
    if (currentMode !== 'free') {
      // For exercise, brief idle between exercises
      if (currentMode === 'exercise') {
        playBaseIdle().catch(() => {})
      }
    }
  }).catch(() => {
    isTransitioning = false
  })
}

/** Called every frame from animate loop */
export function updateActivityMode(elapsed: number): void {
  if (currentMode === 'free') return

  // Smooth camera lerp
  if (lerpTarget && lerpProgress < 1) {
    lerpProgress = Math.min(1, lerpProgress + 0.02)
    const t = lerpProgress * lerpProgress * (3 - 2 * lerpProgress) // smoothstep
    camera.position.x += (lerpTarget.pos.x - camera.position.x) * t * 0.1
    camera.position.y += (lerpTarget.pos.y - camera.position.y) * t * 0.1
    camera.position.z += (lerpTarget.pos.z - camera.position.z) * t * 0.1
    controls.target.x += (lerpTarget.target.x - controls.target.x) * t * 0.1
    controls.target.y += (lerpTarget.target.y - controls.target.y) * t * 0.1
    controls.target.z += (lerpTarget.target.z - controls.target.z) * t * 0.1
  }

  // Timer for next activity animation
  const interval = MODE_INTERVALS[currentMode]
  if (!isTransitioning) {
    activityTimer += 1 / 60 // approximate frame time
    if (activityTimer >= interval) {
      activityTimer = 0
      playActivityAnim()
    }
  }
}
