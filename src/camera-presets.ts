import * as THREE from 'three'
import { camera, controls } from './scene'
import { state } from './main'

type CameraPreset = 'face' | 'portrait' | 'full' | 'cinematic'

type CameraTransition = {
  startTime: number
  duration: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startTarget: THREE.Vector3
  endTarget: THREE.Vector3
}

// Base offsets: camera position RELATIVE to the head bone
// These get added to the live head position for tracking
const PRESETS: Record<CameraPreset, {
  // Offset from head bone for camera position (z = distance in front)
  posOffset: THREE.Vector3
  // Offset from head bone for look-at target
  targetOffset: THREE.Vector3
  // Whether to track head bone every frame
  trackHead: boolean
}> = {
  face: {
    posOffset: new THREE.Vector3(0, -0.02, 2.2),    // Face — far enough to never clip even during animations
    targetOffset: new THREE.Vector3(0, -0.03, 0),   // Look at face center
    trackHead: true,
  },
  portrait: {
    posOffset: new THREE.Vector3(0, -0.1, 2.5),     // Upper body — safe distance
    targetOffset: new THREE.Vector3(0, -0.25, 0),   // Target at upper chest
    trackHead: true,
  },
  full: {
    // Full body: fixed position (embed default), no tracking
    posOffset: new THREE.Vector3(0, 0, 0),
    targetOffset: new THREE.Vector3(0, 0, 0),
    trackHead: false,
  },
  cinematic: {
    posOffset: new THREE.Vector3(0.85, -0.1, 2.05),
    targetOffset: new THREE.Vector3(0, -0.17, 0),
    trackHead: false,
  },
}

// Fixed positions for non-tracking presets
const FIXED_FULL = {
  position: new THREE.Vector3(0, 1.1, 3.6),
  target: new THREE.Vector3(0, 0.82, 0),
}

let transition: CameraTransition | null = null
let currentPreset: CameraPreset = 'full'
let trackingSmooth = new THREE.Vector3()  // Smoothed head position
let trackingInitialized = false

export function initCameraPresets() {
  const panel = document.getElementById('camera-preset-buttons')
  if (!panel) return

  panel.querySelectorAll<HTMLButtonElement>('[data-camera-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const presetId = button.dataset.cameraPreset as CameraPreset | undefined
      if (!presetId || !(presetId in PRESETS)) return

      setCameraPreset(presetId, 0.8)
      pulseButton(button)
    })
  })
}

/** Get the VRM head bone world position */
function getHeadWorldPosition(): THREE.Vector3 | null {
  if (!state.vrm) return null
  const headBone = state.vrm.humanoid?.getNormalizedBoneNode('head')
  if (!headBone) return null
  const pos = new THREE.Vector3()
  headBone.getWorldPosition(pos)
  return pos
}

export function updateCameraPresets(nowSeconds: number) {
  // Handle transition animation (smooth lerp to new preset)
  if (transition) {
    const t = Math.min(1, (nowSeconds - transition.startTime) / transition.duration)
    const eased = easeOutCubic(t)

    camera.position.lerpVectors(transition.startPos, transition.endPos, eased)
    controls.target.lerpVectors(transition.startTarget, transition.endTarget, eased)

    if (t >= 1) {
      transition = null
    }
    return  // Don't track during transition
  }

  // Head tracking for portrait/face presets
  const preset = PRESETS[currentPreset]
  if (!preset.trackHead) return

  const headPos = getHeadWorldPosition()
  if (!headPos) return

  // Smooth the head position to avoid jitter (lerp factor)
  // Face mode needs much faster tracking to prevent clipping
  const smoothing = currentPreset === 'face' ? 0.25 : 0.10
  if (!trackingInitialized) {
    trackingSmooth.copy(headPos)
    trackingInitialized = true
  } else {
    trackingSmooth.lerp(headPos, smoothing)
  }

  // Camera position = smoothed head + adjusted offset (user customizable)
  const adjusted = getAdjustedOffsets(currentPreset)
  const targetPos = trackingSmooth.clone().add(adjusted.targetOffset)
  const camPos = trackingSmooth.clone().add(adjusted.posOffset)

  // Apply smooth tracking
  camera.position.lerp(camPos, smoothing)
  controls.target.lerp(targetPos, smoothing)

  // SAFETY: enforce minimum distance AFTER lerp — this is the final guard
  // Must check against the LIVE head position (not smoothed) for real-time safety
  const liveHeadPos = getHeadWorldPosition()
  if (liveHeadPos) {
    const minDistance = currentPreset === 'face' ? 1.8 : 2.0
    const headToCam = camera.position.clone().sub(liveHeadPos)
    const dist = headToCam.length()
    if (dist < minDistance) {
      // HARD push camera out — no lerp, instant correction
      headToCam.normalize().multiplyScalar(minDistance)
      camera.position.copy(liveHeadPos).add(headToCam)
    }
  }
}

/** Set camera to a named preset (callable from WS commands) */
export function setCameraPreset(presetId: string, duration = 0.8) {
  const preset = PRESETS[presetId as CameraPreset]
  if (!preset) return false

  currentPreset = presetId as CameraPreset
  trackingInitialized = false  // Reset tracking smoothing

  if (preset.trackHead) {
    // For tracking presets: transition to current head position + adjusted offset
    const headPos = getHeadWorldPosition()
    if (headPos) {
      const adjusted = getAdjustedOffsets(presetId as CameraPreset)
      const endPos = headPos.clone().add(adjusted.posOffset)
      const endTarget = headPos.clone().add(adjusted.targetOffset)
      startTransition({ position: endPos, target: endTarget }, duration)
    }
  } else {
    // Non-tracking: use fixed positions
    startTransition(FIXED_FULL, duration)
  }

  return true
}

function startTransition(target: { position: THREE.Vector3; target: THREE.Vector3 }, duration: number) {
  transition = {
    startTime: performance.now() / 1000,
    duration,
    startPos: camera.position.clone(),
    endPos: target.position.clone(),
    startTarget: controls.target.clone(),
    endTarget: target.target.clone(),
  }
}

/** Adjust a preset's distance/height from WS or settings UI.
 *  distance: multiplier on Z offset (1.0 = default)
 *  height: added to Y offset
 */
export function adjustPresetOffset(presetId: string, distance: number, height: number) {
  const preset = PRESETS[presetId as CameraPreset]
  if (!preset || !preset.trackHead) return false
  // Store custom offsets — applied as multiplier on Z and additive on Y
  customOffsets[presetId] = { distance, height }
  // If currently on this preset, re-trigger to apply
  if (currentPreset === presetId) {
    trackingInitialized = false
  }
  return true
}

// Custom user offsets per preset
const customOffsets: Record<string, { distance: number; height: number }> = {}

function getAdjustedOffsets(presetId: CameraPreset) {
  const preset = PRESETS[presetId]
  const custom = customOffsets[presetId]
  if (!custom) return { posOffset: preset.posOffset, targetOffset: preset.targetOffset }
  return {
    posOffset: new THREE.Vector3(
      preset.posOffset.x,
      preset.posOffset.y + custom.height,
      preset.posOffset.z * custom.distance
    ),
    targetOffset: new THREE.Vector3(
      preset.targetOffset.x,
      preset.targetOffset.y + custom.height * 0.5,
      preset.targetOffset.z
    ),
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function pulseButton(button: HTMLButtonElement) {
  button.classList.remove('is-popping')
  void button.offsetWidth
  button.classList.add('is-popping')
}
