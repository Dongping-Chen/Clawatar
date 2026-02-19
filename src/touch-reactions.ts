import * as THREE from 'three'
import { camera } from './scene'
import { state } from './main'
import { setExpression } from './expressions'
import { requestAction } from './action-state-machine'

interface TouchReaction {
  expression: string
  intensity: number
  actionId: string
  particle: 'star' | 'heart' | 'diamond' | 'sparkle' | 'circle'
}

type ZoneName = 'head' | 'face' | 'hands' | 'torso' | 'lowerBody' | 'legs'

const ZONE_REACTIONS: Record<ZoneName, TouchReaction[]> = {
  head: [
    { expression: 'happy', intensity: 0.8, actionId: 'dm_124', particle: 'sparkle' },
    { expression: 'happy', intensity: 0.7, actionId: 'dm_125', particle: 'heart' },
    { expression: 'happy', intensity: 0.6, actionId: 'dm_40', particle: 'star' },
    { expression: 'happy', intensity: 0.9, actionId: 'dm_41', particle: 'sparkle' },
    { expression: 'relaxed', intensity: 0.5, actionId: 'dm_27', particle: 'heart' },
  ],
  face: [
    { expression: 'surprised', intensity: 0.8, actionId: 'dm_124', particle: 'star' },
    { expression: 'happy', intensity: 0.5, actionId: 'dm_40', particle: 'sparkle' },
    { expression: 'surprised', intensity: 0.7, actionId: 'dm_125', particle: 'diamond' },
    { expression: 'happy', intensity: 0.6, actionId: 'dm_129', particle: 'heart' },
  ],
  hands: [
    { expression: 'happy', intensity: 0.8, actionId: 'dm_47', particle: 'star' },
    { expression: 'happy', intensity: 0.9, actionId: 'dm_48', particle: 'sparkle' },
    { expression: 'happy', intensity: 0.7, actionId: 'dm_4', particle: 'circle' },
  ],
  torso: [
    { expression: 'surprised', intensity: 0.9, actionId: 'dm_46', particle: 'diamond' },
    { expression: 'angry', intensity: 0.5, actionId: 'dm_14', particle: 'star' },
    { expression: 'surprised', intensity: 0.7, actionId: 'dm_19', particle: 'sparkle' },
    { expression: 'happy', intensity: 0.4, actionId: 'dm_44', particle: 'circle' },
  ],
  lowerBody: [
    { expression: 'surprised', intensity: 0.8, actionId: 'dm_51', particle: 'diamond' },
    { expression: 'happy', intensity: 0.4, actionId: 'dm_129', particle: 'sparkle' },
    { expression: 'surprised', intensity: 0.6, actionId: 'dm_19', particle: 'star' },
  ],
  legs: [
    { expression: 'happy', intensity: 0.7, actionId: 'dm_18', particle: 'sparkle' },
    { expression: 'surprised', intensity: 0.6, actionId: 'dm_19', particle: 'star' },
    { expression: 'happy', intensity: 0.8, actionId: 'dm_26', particle: 'circle' },
    { expression: 'relaxed', intensity: 0.5, actionId: 'dm_41', particle: 'heart' },
  ],
}

const EXCITED_COMBO: TouchReaction = {
  expression: 'happy', intensity: 1.0, actionId: 'dm_2', particle: 'sparkle',
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const meshBuffer: THREE.Object3D[] = []

const TAP_MAX_DISTANCE = 10
const TAP_MAX_DURATION = 300
const COOLDOWN_MS = 500
const COMBO_WINDOW_MS = 2000
const COMBO_TAPS = 3

let downX = 0, downY = 0, downTime = 0
let lastReactionTime = 0
let recentTaps: number[] = []

export function setTouchReactionsEnabled(enabled: boolean) {
  state.touchReactionsEnabled = enabled
  if (!enabled) {
    recentTaps = []
  }
}

export function initTouchReactions(canvas: HTMLCanvasElement) {
  injectParticleStyles()

  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downTime = performance.now()
  })

  canvas.addEventListener('pointerup', (e) => {
    if (!state.touchReactionsEnabled) return
    if (!state.vrm) return
    const dx = e.clientX - downX, dy = e.clientY - downY
    if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_DISTANCE) return
    if (performance.now() - downTime > TAP_MAX_DURATION) return

    const now = performance.now()
    if (now - lastReactionTime < COOLDOWN_MS) return
    lastReactionTime = now

    // Combo detection
    recentTaps.push(now)
    recentTaps = recentTaps.filter(t => now - t < COMBO_WINDOW_MS)

    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    meshBuffer.length = 0
    state.vrm.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshBuffer.push(obj)
    })

    const hit = raycaster.intersectObjects(meshBuffer, false)[0]
    if (!hit) return

    const local = hit.point.clone()
    state.vrm.scene.worldToLocal(local)

    // Combo check
    if (recentTaps.length >= COMBO_TAPS) {
      recentTaps = []
      triggerReaction(EXCITED_COMBO)
      spawnParticles('sparkle', e.clientX, e.clientY, 5)
      return
    }

    const zone = classifyZone(local)
    const reactions = ZONE_REACTIONS[zone]
    const reaction = reactions[Math.floor(Math.random() * reactions.length)]
    triggerReaction(reaction)
    spawnParticles(reaction.particle, e.clientX, e.clientY, 3)
  })
}

function classifyZone(p: THREE.Vector3): ZoneName {
  if (p.y > 1.3) return 'head'
  if (p.y > 1.1) return 'face'
  if (p.y > 0.7 && Math.abs(p.x) > 0.15) return 'hands'
  if (p.y > 0.7) return 'torso'
  if (p.y > 0.4) return 'lowerBody'
  return 'legs'
}

function triggerReaction(reaction: TouchReaction) {
  const expression = { name: reaction.expression, weight: reaction.intensity }
  setExpression(reaction.expression, reaction.intensity, 4.0)
  requestAction(reaction.actionId, { expression }).catch(() => {})
}

const PARTICLE_SHAPES: Record<string, string> = {
  star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  heart: 'polygon(50% 85%, 15% 55%, 0% 35%, 0% 20%, 10% 5%, 25% 0%, 40% 5%, 50% 20%, 60% 5%, 75% 0%, 90% 5%, 100% 20%, 100% 35%, 85% 55%)',
  diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  sparkle: 'polygon(50% 0%, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0% 50%, 40% 40%)',
  circle: 'circle(50%)',
}

const PARTICLE_COLORS = ['#ff6b9d', '#c084fc', '#fbbf24', '#34d399', '#60a5fa']

function spawnParticles(shape: string, cx: number, cy: number, count: number) {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'touch-particle'
    const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]
    const size = 8 + Math.random() * 12
    const offsetX = (Math.random() - 0.5) * 60
    const offsetY = (Math.random() - 0.5) * 60
    el.style.cssText = `
      left:${cx + offsetX}px;top:${cy + offsetY}px;
      width:${size}px;height:${size}px;
      background:${color};
      clip-path:${PARTICLE_SHAPES[shape] || PARTICLE_SHAPES.star};
    `
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1000)
  }
}

function injectParticleStyles() {
  if (document.getElementById('touch-particle-style')) return
  const style = document.createElement('style')
  style.id = 'touch-particle-style'
  style.textContent = `
    .touch-particle {
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      animation: touchParticleFade 1s ease-out forwards;
      transform: translate(-50%, -50%);
    }
    @keyframes touchParticleFade {
      0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -150%) scale(0.3); }
    }
  `
  document.head.appendChild(style)
}
