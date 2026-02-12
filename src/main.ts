import { initScene, scene, camera, renderer, controls, clock, composer } from './scene'
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
      // Expose to native app (iOS WKWebView)
      ;(window as any).__clawatar = { vrm: true, ready: true }
      try { (window as any).webkit?.messageHandlers?.clawatar?.postMessage({event: 'modelLoaded'}) } catch {}
      await playBaseIdle('119_Idle')
      return
    } catch (e) {
      console.warn('Auto-load failed:', e)
    }
  }

  // No model — show prompt
  showDropPrompt()
}

// Check if running in embed mode (iOS app / iframe)
const isEmbed = new URLSearchParams(window.location.search).has('embed')

function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  initScene(canvas)
  initLookAt(canvas)

  if (isEmbed) {
    // Embed mode: hide ALL UI, transparent bg, bloom, enhanced lighting
    hideAllUI()
    import('./scene').then(m => {
      m.setTransparentBackground(true)
      // Note: bloom disabled for transparent bg (creates edge artifacts)
      // m.enableBloom()
      m.enhanceLightingForEmbed()
      // Adjust camera for mobile portrait: zoom out to show full body
      m.camera.position.set(0, 1.1, 3.6)
      m.controls.target.set(0, 0.82, 0)
      m.controls.update()
    })
  } else {
    initUI()
  }

  initTouchReactions(canvas)
  initEmotionBar()
  initBackgrounds()
  initCameraPresets()
  initChatAndVoice()
  connectWS()
  autoLoad()
  animate()
}

function hideAllUI() {
  // Inject CSS to hide ALL UI elements — only keep canvas
  const style = document.createElement('style')
  style.textContent = `
    #controls, #chat-container, #emotion-bar, #drop-overlay,
    #status, #model-prompt, body::before {
      display: none !important;
    }
    body {
      overflow: hidden !important;
      margin: 0 !important;
      background: transparent !important;
    }
    #canvas {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
    }
  `
  document.head.appendChild(style)

  // Also observe DOM for dynamically created model-prompt
  const observer = new MutationObserver(() => {
    const prompt = document.getElementById('model-prompt')
    if (prompt) prompt.style.display = 'none'
  })
  observer.observe(document.body, { childList: true })

  // Listen for postMessage commands from native app
  window.addEventListener('message', (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (data.type === 'loadModel' && data.url) {
        loadVRM(data.url).catch(console.error)
      }
    } catch {}
  })
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
  // Use composer (bloom) if available, otherwise direct render
  if (composer) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }
}

init()
