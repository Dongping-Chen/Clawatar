import * as THREE from 'three'
import { camera } from './scene'
import { state } from './main'
import { setExpression } from './expressions'
import { requestAction } from './action-state-machine'

type TouchReaction = {
  expression: string
  intensity: number
  actionId: string
  emoji: string
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const meshBuffer: THREE.Object3D[] = []

const HEAD_REACTION: TouchReaction = {
  expression: 'happy',
  intensity: 0.9,
  actionId: '116_Happy Hand Gesture',
  emoji: '✨',
}

const TORSO_REACTION: TouchReaction = {
  expression: 'surprised',
  intensity: 0.95,
  actionId: '121_Jump',
  emoji: '❗',
}

const SILLY_REACTIONS: TouchReaction[] = [
  { expression: 'happy', intensity: 0.86, actionId: '70_Silly Dancing', emoji: '🤪' },
  { expression: 'surprised', intensity: 0.88, actionId: '118_Head Nod Yes', emoji: '💫' },
  { expression: 'relaxed', intensity: 0.78, actionId: '163_Yawn', emoji: '😜' },
]

export function initTouchReactions(canvas: HTMLCanvasElement) {
  canvas.addEventListener('pointerdown', (event) => {
    if (!state.vrm) return

    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(pointer, camera)

    meshBuffer.length = 0
    state.vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        meshBuffer.push(obj)
      }
    })

    const intersections = raycaster.intersectObjects(meshBuffer, false)
    const hit = intersections[0]
    if (!hit) return

    const localPoint = hit.point.clone()
    state.vrm.scene.worldToLocal(localPoint)

    let reaction = TORSO_REACTION
    if (localPoint.y > 1.3) {
      reaction = HEAD_REACTION
    } else if (localPoint.y <= 0.7) {
      reaction = SILLY_REACTIONS[Math.floor(Math.random() * SILLY_REACTIONS.length)]
    }

    triggerTouchReaction(reaction)
    spawnTouchEmoji(reaction.emoji, event.clientX, event.clientY)
  })
}

function triggerTouchReaction(reaction: TouchReaction) {
  setExpression(reaction.expression, reaction.intensity)
  if (!state.vrm || !state.mixer) return
  requestAction(reaction.actionId).catch((err) => {
    console.warn('Touch reaction action failed:', err)
  })
}

function spawnTouchEmoji(emoji: string, clientX: number, clientY: number) {
  const node = document.createElement('div')
  node.className = 'touch-emoji-particle'
  node.textContent = emoji
  node.style.left = `${clientX}px`
  node.style.top = `${clientY}px`
  document.body.appendChild(node)
  window.setTimeout(() => node.remove(), 1150)
}
