import * as THREE from 'three'
import { camera, controls } from './scene'

type CameraPreset = 'face' | 'portrait' | 'full' | 'cinematic'

type CameraTransition = {
  startTime: number
  duration: number
  startPos: THREE.Vector3
  endPos: THREE.Vector3
  startTarget: THREE.Vector3
  endTarget: THREE.Vector3
}

const PRESETS: Record<CameraPreset, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  face: {
    position: new THREE.Vector3(0, 1.45, 0.8),
    target: new THREE.Vector3(0, 1.45, 0),
  },
  portrait: {
    position: new THREE.Vector3(0, 1.2, 1.5),
    target: new THREE.Vector3(0, 1.2, 0),
  },
  full: {
    position: new THREE.Vector3(0, 1.0, 3.0),
    target: new THREE.Vector3(0, 1.0, 0),
  },
  cinematic: {
    position: new THREE.Vector3(0.85, 1.35, 2.05),
    target: new THREE.Vector3(0, 1.18, 0),
  },
}

let transition: CameraTransition | null = null

export function initCameraPresets() {
  const panel = document.getElementById('camera-preset-buttons')
  if (!panel) return

  panel.querySelectorAll<HTMLButtonElement>('[data-camera-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const presetId = button.dataset.cameraPreset as CameraPreset | undefined
      if (!presetId || !(presetId in PRESETS)) return

      startTransition(PRESETS[presetId], 0.8)
      pulseButton(button)
    })
  })
}

export function updateCameraPresets(nowSeconds: number) {
  if (!transition) return

  const t = Math.min(1, (nowSeconds - transition.startTime) / transition.duration)
  const eased = easeOutCubic(t)

  camera.position.lerpVectors(transition.startPos, transition.endPos, eased)
  controls.target.lerpVectors(transition.startTarget, transition.endTarget, eased)

  if (t >= 1) {
    transition = null
  }
}

/** Set camera to a named preset (callable from WS commands) */
export function setCameraPreset(presetId: string, duration = 0.8) {
  const preset = PRESETS[presetId as CameraPreset]
  if (!preset) return false
  startTransition(preset, duration)
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function pulseButton(button: HTMLButtonElement) {
  button.classList.remove('is-popping')
  void button.offsetWidth
  button.classList.add('is-popping')
}
