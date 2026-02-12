import * as THREE from 'three'
import { state } from './main'
import { camera } from './scene'

const target = new THREE.Vector3(0, 1.5, -1)
const mouseNDC = new THREE.Vector2(0, 0)
let meetingMode = false

export function initLookAt(canvas: HTMLCanvasElement) {
  canvas.addEventListener('mousemove', (e) => {
    if (meetingMode) return  // Don't follow mouse in meeting mode
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1
  })
}

export function setLookAtTarget(x: number, y: number, z: number) {
  target.set(x, y, z)
}

/** Meeting mode: lock eyes to camera, no mouse follow */
export function setMeetingLookAt(enabled: boolean) {
  meetingMode = enabled
}

export function updateLookAt() {
  if (!state.vrm?.lookAt) return

  if (meetingMode) {
    // Always look directly at camera (eye contact with viewer)
    state.vrm.lookAt.target = camera
    return
  }

  if (!state.mouseLookEnabled) return

  // Convert mouse to world position in front of camera
  const lookTarget = new THREE.Vector3(mouseNDC.x * 0.5, 1.3 + mouseNDC.y * 0.3, 0)
  lookTarget.applyMatrix4(camera.matrixWorld)

  target.lerp(lookTarget, 0.1)
  state.vrm.lookAt.target = camera
}
