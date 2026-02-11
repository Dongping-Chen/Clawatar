import { initScene, scene, camera, renderer, controls, clock } from './scene'
import { initLookAt, updateLookAt } from './look-at'
import { updateBlink } from './blink'
import { updateLipSync } from './lip-sync'
import { applyExpressionOverrides } from './expressions'
import { connectWS, initChatAndVoice } from './ws-control'
import { initUI } from './ui'
import { loadVRM } from './vrm-loader'
import { playBaseIdle } from './animation'
import { updateStateMachine } from './action-state-machine'
import { initTouchReactions } from './touch-reactions'
import { initEmotionBar } from './emotion-bar'
import { initBackgrounds, updateBackgroundEffects } from './backgrounds'
import { initCameraPresets, updateCameraPresets } from './camera-presets'
import type { AppState } from './types'

export const state: AppState = {
  vrm: null,
  mixer: null,
  autoBlinkEnabled: true,
  mouseLookEnabled: true,
  characterState: 'idle',
}

function showDropPrompt() {
  let prompt = document.getElementById('model-prompt')
  if (!prompt) {
    prompt = document.createElement('div')
    prompt.id = 'model-prompt'
    prompt.innerHTML = `
      <div class="prompt-icon">✨</div>
      <div class="prompt-title">Drop your VRM model here~ ✨</div>
      <div class="prompt-subtitle">or enter a URL in the model panel on the right</div>
    `
    document.body.appendChild(prompt)
  }
}

function hideDropPrompt() {
  document.getElementById('model-prompt')?.remove()
}

// Expose for use by vrm-loader
;(window as any).__hideDropPrompt = hideDropPrompt

async function autoLoad() {
  // Try config (fetched at runtime)
  let configModelUrl = ''
  try {
    const resp = await fetch('/clawatar.config.json')
    if (resp.ok) {
      const config = await resp.json()
      configModelUrl = config.model?.url || ''
    }
  } catch {}

  // Try localStorage
  const savedUrl = localStorage.getItem('vrm-model-url')
  const modelUrl = configModelUrl || savedUrl

  if (modelUrl) {
    try {
      await loadVRM(modelUrl)
      localStorage.setItem('vrm-model-url', modelUrl)
      hideDropPrompt()
      console.log('Auto-loaded model:', modelUrl)
      await playBaseIdle('119_Idle')
      return
    } catch (e) {
      console.warn('Auto-load failed:', e)
    }
  }

  // No model — show prompt
  showDropPrompt()
}

function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  initScene(canvas)
  initLookAt(canvas)
  initUI()
  initTouchReactions(canvas)
  initEmotionBar()
  initBackgrounds()
  initCameraPresets()
  initChatAndVoice()
  connectWS()
  autoLoad()
  animate()
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  const elapsed = clock.elapsedTime

  if (state.mixer) state.mixer.update(delta)
  applyExpressionOverrides()
  updateBlink(elapsed)
  updateLipSync()
  if (state.vrm) state.vrm.update(delta)

  updateStateMachine(elapsed)
  updateBackgroundEffects(elapsed, delta)
  updateCameraPresets(performance.now() / 1000)
  updateLookAt()

  controls.update()
  renderer.render(scene, camera)
}

init()
