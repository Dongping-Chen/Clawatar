import * as THREE from 'three'
import { initScene, initContactShadow, updateContactShadow, scene, camera, renderer, controls, clock, composer, outlineEffect, warmTintVRMMaterials, setTransparentBackground } from './scene'
import { initLookAt, updateLookAt, setMeetingLookAt } from './look-at'
import { updateBlink } from './blink'
import { updateLipSync } from './lip-sync'
import { applyExpressionOverrides, updateExpressionTransitions } from './expressions'
import { connectWS, initChatAndVoice } from './ws-control'
import { initUI } from './ui'
import { loadVRM } from './vrm-loader'
import { playBaseIdle } from './animation'
import { updateBreathing } from './breathing'
import { updateStateMachine, setMeetingMode } from './action-state-machine'
import { initTouchReactions } from './touch-reactions'
import { initReactiveIdle, updateReactiveIdle } from './reactive-idle'
import { initEmotionBar } from './emotion-bar'
import { initBackgrounds, updateBackgroundEffects } from './backgrounds'
import { initGradientBackground, updateGradientBackground } from './gradient-background'
import { initCameraPresets, updateCameraPresets } from './camera-presets'
import { initRoomScene, enableRoomMode, isRoomMode, getWalkableBounds, updateRoom, clampCameraToRoom, updateRoomWallTransparency } from './room-scene'
import { updateActivityMode } from './activity-modes'
import { loadRoomGLB, isSceneLoaded, getSceneWalkBounds, SCENE_LAYER, SCENE_EXPOSURE, CHAR_EXPOSURE } from './scene-system'
import { broadcastSyncCommand } from './sync-bridge'
import { initAmbientMusic, getMusicState, toggleMusic } from './ambient-music'
import { initAmbienceMixer } from './ambience-mixer'
import type { AppState } from './types'

export const state: AppState = {
  vrm: null,
  mixer: null,
  autoBlinkEnabled: true,
  idleAnimationsEnabled: true,
  touchReactionsEnabled: true,
  mouseLookEnabled: true,
  characterState: 'idle',
}

// Debug: expose state + scene for console material inspection
;(window as any).__app_state = state
;(window as any).__three_scene = scene

// Expose character visibility toggle for iOS (hide character on chat page, keep bg rendering)
;(window as any).setCharacterVisible = (visible: boolean) => {
  if (state.vrm) {
    state.vrm.scene.visible = visible
  }
}

// Pre-allocated vectors for render loop (avoid per-frame GC pressure)
const _hipsWorld = new THREE.Vector3()
const _headPos = new THREE.Vector3()
const _pushDir = new THREE.Vector3()

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
    const resp = await fetch('./clawatar.config.json')
    if (resp.ok) {
      const config = await resp.json()
      configModelUrl = config.model?.url || ''
    }
  } catch {}

  // Try localStorage
  const savedUrl = localStorage.getItem('vrm-model-url')
  const modelUrl = configModelUrl || savedUrl

  if (modelUrl && !isBgOnly) {
    try {
      const vrm = await loadVRM(modelUrl)
      vrm.scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
        }
      })
      // Warm-tint materials for high-key anime skin look
      if (isEmbed) warmTintVRMMaterials()
      localStorage.setItem('vrm-model-url', modelUrl)
      hideDropPrompt()
      console.log('Auto-loaded model:', modelUrl)
      // Expose to native app (iOS WKWebView)
      ;(window as any).__clawatar = { vrm: true, ready: true }
      try { (window as any).webkit?.messageHandlers?.clawatar?.postMessage({event: 'modelLoaded'}) } catch {}
      await playBaseIdle('119_Idle')

      // Auto-load room GLB if ?room= param is set
      const roomParam = params.get('room')
      if (roomParam) {
        const roomPath = roomParam.endsWith('.glb') ? roomParam : `scenes/${roomParam}.glb`
        console.log('[autoLoad] Loading room:', roomPath)
        try {
          await loadRoomGLB(roomPath)
          console.log('[autoLoad] Room loaded OK')
        } catch (e) {
          console.warn('[autoLoad] Room load failed:', e)
        }
      }
      return
    } catch (e) {
      console.warn('Auto-load failed:', e)
    }
  }

  // No model — show prompt
  showDropPrompt()
}

// Check if running in embed mode (iOS app / iframe) or meeting mode (OBS virtual camera)
const params = new URLSearchParams(window.location.search)
const isEmbed = params.has('embed')
const isMeeting = params.has('meeting')
const isTransparent = params.has('transparent')
const isBgOnly = params.has('bgonly')
const initialTheme = params.get('theme') || 'sakura'

function initMusicToggleButton() {
  const button = document.createElement('button')
  button.id = 'music-toggle-btn'
  button.type = 'button'
  button.textContent = '🎵'
  button.setAttribute('aria-label', 'Toggle ambient music')
  button.title = 'Toggle ambient music'

  Object.assign(button.style, {
    position: 'fixed',
    right: '58px',
    bottom: '14px',
    zIndex: '56',
    width: '32px',
    height: '28px',
    borderRadius: '999px',
    border: '1px solid rgba(242, 150, 182, 0.44)',
    background: 'rgba(255, 245, 250, 0.8)',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 8px 18px rgba(166, 84, 126, 0.2)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    lineHeight: '1',
    padding: '0',
  })

  const syncVisual = () => {
    const { playing } = getMusicState()
    button.style.opacity = playing ? '1' : '0.55'
    button.style.filter = playing ? 'none' : 'grayscale(0.4)'
  }

  button.addEventListener('click', () => {
    const nextEnabled = !getMusicState().playing
    void toggleMusic(nextEnabled)
    window.setTimeout(syncVisual, 50)
  })

  syncVisual()
  document.body.appendChild(button)
}

function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  initScene(canvas)
  initContactShadow()
  if (!isTransparent) {
    initGradientBackground(scene, initialTheme)
  }
  initLookAt(canvas)

  // Enhanced lighting for both modes — embed gets full "holy light", web gets a toned-down version
  import('./scene').then(m => {
    if (isTransparent) {
      // Transparent mode: character only, no gradient, transparent canvas
      m.enhanceLightingForEmbed()
      m.setTransparentBackground(true)
      hideAllUI()
      m.camera.position.set(0, 1.2, 3.0)
      m.controls.target.set(0, 0.9, 0)
      m.controls.update()
      m.controls.enableRotate = false
      m.controls.enablePan = false
      m.controls.enableZoom = false
    } else if (isEmbed) {
      // Embed mode: full intensity with gradient background
      m.enhanceLightingForEmbed()
      hideAllUI()
      m.camera.position.set(0, 1.2, 3.0)
      m.controls.target.set(0, 0.9, 0)
      m.controls.update()
      m.controls.enableRotate = false
      m.controls.enablePan = false
      m.controls.enableZoom = false
    } else if (isMeeting) {
      // Meeting mode: hide UI, keep room, head-tracking camera, lock eyes to camera
      m.enhanceLightingForWeb()
      hideAllUI()
      // Narrow FOV for webcam-like framing
      m.camera.fov = 28
      m.camera.updateProjectionMatrix()
      m.controls.update()
      m.controls.enableRotate = false
      m.controls.enablePan = false
      m.controls.enableZoom = false
      // Use meeting camera preset with head bone tracking + calibration UI
      import('./camera-presets').then(cp => cp.setCameraPreset('meeting', 0.5))
      import('./meeting-calibration').then(mc => mc.initMeetingCalibration())
      // Meeting behavior: no random idle, eyes locked to camera
      setMeetingMode(true)
      setMeetingLookAt(true)
      // Meeting lighting: night theme + kill all bloom/glow
      import('./room-scene').then(rm => {
        rm.enableRoomMode()
        rm.setRoomTheme('night')
        // After room fully builds, kill all bright elements
        setTimeout(() => {
          rm.setMeetingLighting()
          // Kill bloom AFTER room bloom is set up
          import('./scene').then(sc => {
            if (sc.roomBloomPass) sc.roomBloomPass.strength = 0.0
            sc.renderer.toneMappingExposure = 0.85
          })
        }, 1000)
      })
      // Add meeting-specific face lighting
      import('./scene').then(sc => {
        import('three').then(THREE => {
          // Soft frontal key light for face (like a ring light)
          const faceFill = new THREE.PointLight(0xfff5f0, 1.2, 5)
          faceFill.position.set(0, 1.5, 1.5)  // In front of face
          sc.scene.add(faceFill)
          // Gentle side fill to reduce shadows
          const sideFill = new THREE.PointLight(0xffe8e0, 0.5, 4)
          sideFill.position.set(-0.8, 1.5, 1.0)
          sc.scene.add(sideFill)
        })
      })
    } else {
      // Web mode: same light setup but reduced intensity (solid bg adds brightness)
      m.enhanceLightingForWeb()
    }
  })

  if (!isEmbed && !isMeeting) {
    initUI()
  }

  // Meeting mode: set flags EARLY (before animate loop) to prevent any random idles
  if (isMeeting) {
    setMeetingMode(true)
    setMeetingLookAt(true)
  }

  if (!isMeeting) {
    initTouchReactions(canvas)
    initReactiveIdle(canvas)
    initEmotionBar()
  }
  initBackgrounds(initialTheme)
  initCameraPresets()
  initRoomScene()
  if (!isEmbed) {
    // Enable room mode by default for web and meeting
    enableRoomMode()
  }
  initAmbientMusic()
  initAmbienceMixer()
  if (!isEmbed && !isMeeting) {
    initMusicToggleButton()
  }

  initChatAndVoice()
  connectWS()
  autoLoad()

  // ═══ KEYBOARD SHORTCUTS for scene switching (works in ALL modes incl. embed/meeting) ═══
  const ROOM_KEYS: Record<string, string> = {
    '1': 'scenes/cozy-bedroom-v8.glb',
    '2': 'scenes/swimming-pool.glb',
    '3': 'scenes/cafe.glb',
    '4': 'scenes/phone-booth.glb',
    '5': 'scenes/sunset-balcony.glb',
    '6': 'scenes/izakaya.glb',
    '0': '',  // unload
  }
  document.addEventListener('keydown', async (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    // Disable scene hotkeys in embed mode (iOS/iPad WKWebView)
    const isEmbed = new URLSearchParams(window.location.search).has('embed')
    if (isEmbed) return
    const roomPath = ROOM_KEYS[e.key]
    if (roomPath !== undefined) {
      if (roomPath === '') {
        const { unloadScene } = await import('./scene-system')
        unloadScene()
        broadcastSyncCommand({ type: 'set_scene', room: '' })
        console.log('[keyboard] Scene unloaded')
      } else {
        try {
          const mod = await import('./scene-system')
          await mod.loadRoomGLB(roomPath)
          broadcastSyncCommand({ type: 'set_scene', room: roomPath })
          console.log('[keyboard] Loaded:', roomPath)
        } catch (err) {
          console.error('[keyboard] Load failed:', err)
        }
      }
      // Sync dropdown if it exists
      const sel = document.getElementById('room-select') as HTMLSelectElement | null
      if (sel) sel.value = roomPath
    }
  })

  animate()
}

function hideAllUI() {
  // Inject CSS to hide UI. In embed mode, hard-lock to canvas-only rendering.
  const style = document.createElement('style')
  const hiddenSelector = isEmbed
    ? `body > :not(#canvas), body::before`
    : `#controls, #chat-container, #emotion-bar, #drop-overlay,
       #status, #model-prompt, #animated-bg,
       #name-card, body::before`

  style.textContent = `
    ${hiddenSelector} {
      display: none !important;
    }
    body {
      overflow: hidden !important;
      margin: 0 !important;
      background: transparent !important;
    }
    ${isEmbed ? `
    body {
      color: transparent !important;
      font-size: 0 !important;
    }
    ` : ''}
    #canvas {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      display: block !important;
      visibility: visible !important;
    }
  `
  document.head.appendChild(style)

  // Observe DOM for dynamically created UI nodes.
  const observer = new MutationObserver(() => {
    if (isEmbed) {
      for (const child of Array.from(document.body.children)) {
        const el = child as HTMLElement
        if (el.id !== 'canvas') {
          el.style.display = 'none'
        }
      }
      return
    }

    const prompt = document.getElementById('model-prompt')
    if (prompt) prompt.style.display = 'none'
  })
  observer.observe(document.body, { childList: true })

  // Listen for postMessage commands from native app
  window.addEventListener('message', (event) => {
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'loadModel' && data.url) {
        loadVRM(data.url)
          .then((vrm) => {
            vrm.scene.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true
              }
            })
            if (isEmbed) warmTintVRMMaterials()
            return playBaseIdle('119_Idle')
          })
          .catch(console.error)
        return
      }

      if (data.type === 'sync_avatar_command' && data.command) {
        ;(window as any).__clawatar_receive_sync_command?.(data.command)
        return
      }

      if (data.type === 'set_camera_preset') {
        import('./camera-presets')
          .then(m => m.setCameraPreset(data.preset ?? 'full', data.duration))
          .catch(console.error)
        return
      }

      if (data.type === 'adjust_camera_preset') {
        import('./camera-presets')
          .then(m => m.adjustPresetOffset(data.preset, data.distance ?? 1.0, data.height ?? 0))
          .catch(console.error)
        return
      }

      if (typeof data.type === 'string') {
        ;(window as any).__clawatar_receive_sync_command?.(data)
      }
    } catch {}
  })
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  const elapsed = clock.elapsedTime

  if (state.mixer) state.mixer.update(delta)
  updateBreathing(delta)
  updateExpressionTransitions(delta)
  applyExpressionOverrides()
  updateBlink(elapsed)
  updateLipSync()
  if (state.vrm) {
    state.vrm.update(delta)

  }

  // ROOM/SCENE MODE: Clamp VRM root position to walkable bounds
  // Some animations have root motion that moves the character into walls/furniture
  const inConstrainedMode = isRoomMode() || isSceneLoaded()
  if (state.vrm && inConstrainedMode) {
    const vrmScene = state.vrm.scene
    const bounds = isSceneLoaded() ? getSceneWalkBounds() : getWalkableBounds()
    // Clamp the VRM scene root (character position)
    vrmScene.position.x = Math.max(bounds.minX, Math.min(bounds.maxX, vrmScene.position.x))
    vrmScene.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, vrmScene.position.z))
    // Also clamp Y — character shouldn't fly above floor or sink below
    vrmScene.position.y = Math.max(0, Math.min(0.5, vrmScene.position.y))

    // Also check the hips bone which some animations translate directly
    const hipsBone = state.vrm.humanoid?.getNormalizedBoneNode('hips')
    if (hipsBone) {
      hipsBone.getWorldPosition(_hipsWorld)
      if (_hipsWorld.x < bounds.minX || _hipsWorld.x > bounds.maxX ||
          _hipsWorld.z < bounds.minZ || _hipsWorld.z > bounds.maxZ) {
        const rootPos = vrmScene.position
        const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, _hipsWorld.x))
        const clampedZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, _hipsWorld.z))
        rootPos.x += (clampedX - _hipsWorld.x)
        rootPos.z += (clampedZ - _hipsWorld.z)
      }
      // Also clamp hips Y rotation to prevent backward-facing
      const localRot = hipsBone.rotation.y
      if (Math.abs(localRot) > Math.PI / 3) {
        hipsBone.rotation.y = Math.sign(localRot) * Math.PI / 3
      }
    }

    // Clamp VRM root Y rotation (strict ±45° in room mode)
    {
      const root = state.vrm.scene
      let ry = root.rotation.y
      while (ry > Math.PI) ry -= 2 * Math.PI
      while (ry < -Math.PI) ry += 2 * Math.PI
      const MAX_YAW = Math.PI / 4
      root.rotation.y = Math.max(-MAX_YAW, Math.min(MAX_YAW, ry))
    }
  }

  // GLOBAL: Clamp VRM root Y rotation (lenient ±90°) — prevent 180° rotation in ALL modes
  if (state.vrm) {
    const root = state.vrm.scene
    let ry = root.rotation.y
    while (ry > Math.PI) ry -= 2 * Math.PI
    while (ry < -Math.PI) ry += 2 * Math.PI
    const MAX_YAW = Math.PI / 2
    root.rotation.y = Math.max(-MAX_YAW, Math.min(MAX_YAW, ry))
  }

  updateStateMachine(elapsed)
  updateReactiveIdle(elapsed, delta)
  updateActivityMode(elapsed)
  updateRoom(elapsed)
  updateBackgroundEffects(elapsed, delta)
  if (!isTransparent) updateGradientBackground(elapsed, delta)
  updateCameraPresets(performance.now() / 1000)
  clampCameraToRoom()
  updateRoomWallTransparency()

  // GLOBAL safety: prevent head from clipping through camera in ANY mode
  // This runs EVERY FRAME as the absolute last guard before render
  if (state.vrm) {
    const headBone = state.vrm.humanoid?.getNormalizedBoneNode('head')
    if (headBone) {
      headBone.getWorldPosition(_headPos)
      _pushDir.copy(_headPos).sub(camera.position)
      const dist = _pushDir.length()
      const minSafeDist = 1.5
      if (dist < minSafeDist) {
        _pushDir.normalize().multiplyScalar(-(minSafeDist - dist))
        camera.position.add(_pushDir)
      }
    }
  }


  updateLookAt()

  controls.update()

  // Single-pass rendering: scene GLB emissive is pre-dimmed in loadRoomGLB.
  // Use composer (with bloom) for ALL modes — character gets glow effect.
  updateContactShadow()

  if (composer) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }

  // NOTE: Alpha-clear fix removed — pool v7 now uses emissive-only materials
  // (same approach as all other working scenes). Standard PBR materials with
  // alpha:true WebGLRenderer = transparent black. Emissive-only = works.
}

init()
