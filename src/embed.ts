import * as THREE from 'three'
import { state } from './app-state'
import {
  camera,
  clock,
  composer,
  controls,
  enhanceLightingForEmbed,
  initContactShadow,
  initScene,
  renderer,
  scene,
  setBackgroundTheme,
  setContactShadowCharacterVisible,
  setContactShadowExternalAnchor,
  setContactShadowRuntimeEnabled,
  setTransparentBackground,
  updateContactShadow,
  warmTintVRMMaterials,
} from './scene'
import { initLookAt, updateLookAt } from './look-at'
import { setAutoBlinkEnabled, updateBlink } from './blink'
import { updateLipSync } from './lip-sync'
import {
  applyExpressionOverrides,
  resetExpressions,
  resetExpressionsImmediately,
  setExpression,
  updateExpressionTransitions,
} from './expressions'
import { DEFAULT_BASE_IDLE_ACTION, loadAndPlayAction, playBaseIdle, preloadAction } from './animation'
import { updateBreathing } from './breathing'
import { applyThemeParticles, initBackgrounds, updateBackgroundEffects } from './backgrounds'
import { initGradientBackground, setGradientTheme, updateGradientBackground } from './gradient-background'
import {
  adjustPresetOffset,
  enforceCameraSafetyShell,
  getCurrentCameraPreset,
  initCameraPresets,
  setCameraPreset,
  updateCameraPresets,
} from './camera-presets'
import { loadVRM } from './vrm-loader'

type AnyCommand = Record<string, any>

const params = new URLSearchParams(window.location.search)
const isEmbed = params.has('embed')
const isTransparent = params.has('transparent')
const isBgOnly = params.has('bgonly')
const disableAutoLoad = params.has('noautoload')
const initialTheme = params.get('theme') || 'sakura'

// Debug hooks for native hosts.
;(window as any).__app_state = state
;(window as any).__three_scene = scene

;(window as any).setCharacterVisible = (visible: boolean) => {
  if (state.vrm) {
    state.vrm.scene.visible = visible
  }
  setContactShadowCharacterVisible(visible)
}

let shadowStageActive = true
;(window as any).__setShadowStageActive = (active: boolean) => {
  shadowStageActive = !!active
}

const _leftFootWorld = new THREE.Vector3()
const _rightFootWorld = new THREE.Vector3()
let shadowGroundFootY: number | null = null

let lastShadowAnchorPost = 0
let lastShadowAnchorVisible = false
let lastShadowAnchorX = 0
let lastShadowAnchorZ = 0
let lastShadowAnchorLift = 0
let lastShadowAnchorStance = 0.28
let hasShadowAnchorSnapshot = false
const shadowAnchorPostIntervalMs = 33
const shadowAnchorHeartbeatMs = 120

function normalizeCommandPayload(payload: unknown): AnyCommand | null {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
    if (!parsed || typeof parsed !== 'object') return null

    const candidate = (parsed as AnyCommand).command && typeof (parsed as AnyCommand).command === 'object'
      ? (parsed as AnyCommand).command as AnyCommand
      : parsed as AnyCommand
    if (!candidate || typeof candidate !== 'object') return null

    return candidate
  } catch {
    return null
  }
}

function postLocalShadowAnchor(payload: {
  x: number
  z: number
  lift: number
  stance: number
  visible: boolean
}) {
  try {
    ;(window as any).webkit?.messageHandlers?.clawatar?.postMessage({
      type: 'sync',
      category: 'shadow_anchor',
      payload,
      ts: Date.now(),
    })
  } catch {}
}

function syncShadowAnchorFromStage(payload: {
  x: number
  z: number
  lift: number
  stance: number
  visible: boolean
}) {
  if (!isTransparent || !shadowStageActive) return

  const now = performance.now()
  const visibilityChanged = payload.visible !== lastShadowAnchorVisible
  const anchorChanged = !hasShadowAnchorSnapshot
    || Math.abs(payload.x - lastShadowAnchorX) > 0.002
    || Math.abs(payload.z - lastShadowAnchorZ) > 0.002
    || Math.abs(payload.lift - lastShadowAnchorLift) > 0.002
    || Math.abs(payload.stance - lastShadowAnchorStance) > 0.003
  const minInterval = visibilityChanged || anchorChanged
    ? shadowAnchorPostIntervalMs
    : shadowAnchorHeartbeatMs
  if (now - lastShadowAnchorPost < minInterval) {
    return
  }

  lastShadowAnchorPost = now
  lastShadowAnchorVisible = payload.visible
  lastShadowAnchorX = payload.x
  lastShadowAnchorZ = payload.z
  lastShadowAnchorLift = payload.lift
  lastShadowAnchorStance = payload.stance
  hasShadowAnchorSnapshot = true

  postLocalShadowAnchor({
    x: Number(payload.x.toFixed(4)),
    z: Number(payload.z.toFixed(4)),
    lift: Number(payload.lift.toFixed(4)),
    stance: Number(payload.stance.toFixed(4)),
    visible: payload.visible,
  })
}

async function loadModel(url: string) {
  if (!url || isBgOnly) return

  const preloadBaseIdle = preloadAction(DEFAULT_BASE_IDLE_ACTION).catch((error) => {
    console.warn('[embed] idle preload failed:', error)
  })

  const vrm = await loadVRM(url)
  await preloadBaseIdle

  vrm.scene.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
    }
  })

  if (isEmbed) warmTintVRMMaterials()
  await playBaseIdle(DEFAULT_BASE_IDLE_ACTION)

  ;(window as any).__clawatar = { vrm: true, ready: true }
  try {
    ;(window as any).webkit?.messageHandlers?.clawatar?.postMessage({ event: 'modelLoaded' })
  } catch {}

  // Warm common conversational clips after first paint.
  window.setTimeout(() => {
    void Promise.allSettled([
      preloadAction('86_Talking'),
      preloadAction('88_Thinking'),
    ])
  }, 250)
}

async function autoLoad() {
  if (isBgOnly) return

  let configModelUrl = ''
  try {
    const resp = await fetch('./clawatar.config.json')
    if (resp.ok) {
      const config = await resp.json()
      configModelUrl = config.model?.url || ''
    }
  } catch {}

  const savedUrl = localStorage.getItem('vrm-model-url')
  const modelUrl = configModelUrl || savedUrl
  if (!modelUrl) return

  try {
    await loadModel(modelUrl)
  } catch (error) {
    console.warn('[embed] auto-load failed:', error)
  }
}

async function handleSyncCommand(cmd: AnyCommand) {
  const category = String(cmd.category ?? '').toLowerCase()
  const payload = (cmd.payload && typeof cmd.payload === 'object') ? cmd.payload as AnyCommand : {}

  switch (category) {
    case 'theme': {
      const theme = typeof payload.theme === 'string' ? payload.theme : 'sakura'
      const appliedTheme = setBackgroundTheme(theme)
      applyThemeParticles(appliedTheme)
      setGradientTheme(appliedTheme)
      break
    }

    case 'camera': {
      const preset = typeof payload.preset === 'string' ? payload.preset : undefined
      if (!preset) break
      const hasAdjustment = typeof payload.distance === 'number' || typeof payload.height === 'number'
      const hasPresetTransition = typeof payload.duration === 'number' || !hasAdjustment
      if (hasPresetTransition) {
        const duration = typeof payload.duration === 'number' ? payload.duration : 0.6
        setCameraPreset(preset, duration)
      }
      if (hasAdjustment) {
        adjustPresetOffset(
          preset,
          typeof payload.distance === 'number' ? payload.distance : 1.0,
          typeof payload.height === 'number' ? payload.height : 0,
        )
      }
      break
    }

    case 'action': {
      const actionId = typeof payload.actionId === 'string' ? payload.actionId : undefined
      const loop = typeof payload.loop === 'boolean' ? payload.loop : false
      const actionCategory = typeof payload.category === 'string' ? payload.category : undefined
      const expression = typeof payload.expression === 'string' ? payload.expression : undefined
      const expressionWeight = typeof payload.expressionWeight === 'number' ? payload.expressionWeight : 0.5

      if (expression) {
        setExpression(expression, expressionWeight, undefined, { sync: false })
      } else {
        resetExpressionsImmediately()
      }

      if (actionId) {
        await loadAndPlayAction(actionId, loop, undefined, actionCategory)
      }
      break
    }

    case 'expression': {
      const name = typeof payload.name === 'string' ? payload.name : undefined
      if (!name) break
      const weight = typeof payload.weight === 'number' ? payload.weight : 1.0
      setExpression(name, weight, undefined, { sync: false })
      break
    }

    case 'avatar_config': {
      if (typeof payload.autoBlink === 'boolean') {
        setAutoBlinkEnabled(payload.autoBlink)
      }
      if (typeof payload.idleAnimations === 'boolean') {
        state.idleAnimationsEnabled = payload.idleAnimations
      }
      if (typeof payload.touchReactions === 'boolean') {
        state.touchReactionsEnabled = payload.touchReactions
      }
      break
    }

    case 'shadow_anchor': {
      if (payload.visible === false) {
        setContactShadowExternalAnchor(null)
        break
      }

      const x = typeof payload.x === 'number' ? payload.x : NaN
      const z = typeof payload.z === 'number' ? payload.z : NaN
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        setContactShadowExternalAnchor(null)
        break
      }

      setContactShadowExternalAnchor({
        x,
        z,
        lift: typeof payload.lift === 'number' ? payload.lift : undefined,
        stance: typeof payload.stance === 'number' ? payload.stance : undefined,
        visible: true,
      })
      break
    }

    case 'shadow_stage': {
      if (typeof payload.active === 'boolean') {
        const setShadowStageActive = (window as any).__setShadowStageActive
        if (typeof setShadowStageActive === 'function') {
          setShadowStageActive(payload.active)
        }
      }
      break
    }

    default:
      break
  }
}

async function handleCommand(cmd: AnyCommand) {
  switch (cmd.type) {
    case 'loadModel':
      if (typeof cmd.url === 'string') await loadModel(cmd.url)
      return

    case 'sync_avatar_command':
      if (cmd.command && typeof cmd.command === 'object') {
        await handleCommand(cmd.command as AnyCommand)
      }
      return

    case 'play_action':
      if (typeof cmd.action_id === 'string') {
        if (typeof cmd.expression === 'string') {
          setExpression(cmd.expression, cmd.expression_weight ?? 0.5, undefined, { sync: false })
        } else {
          resetExpressionsImmediately()
        }
        await loadAndPlayAction(
          cmd.action_id,
          typeof cmd.loop === 'boolean' ? cmd.loop : false,
          undefined,
          typeof cmd.category === 'string' ? cmd.category : undefined
        )
      }
      return

    case 'set_expression':
      if (typeof cmd.name === 'string') {
        setExpression(cmd.name, cmd.weight ?? 1.0, undefined, { sync: false })
      }
      return

    case 'set_expressions':
      if (Array.isArray(cmd.expressions)) {
        resetExpressions()
        for (const expression of cmd.expressions) {
          if (typeof expression?.name === 'string') {
            setExpression(
              expression.name,
              typeof expression.weight === 'number' ? expression.weight : 1.0,
              undefined,
              { sync: false }
            )
          }
        }
      }
      return

    case 'reset':
      resetExpressionsImmediately()
      await playBaseIdle(DEFAULT_BASE_IDLE_ACTION)
      return

    case 'set_character_visible':
      if (typeof (window as any).setCharacterVisible === 'function') {
        (window as any).setCharacterVisible(!!cmd.visible)
      }
      return

    case 'set_contact_shadow_enabled':
      setContactShadowRuntimeEnabled(!!cmd.enabled)
      return

    case 'set_theme':
    case 'set_background_theme': {
      const theme = typeof cmd.theme === 'string' ? cmd.theme : 'sakura'
      const appliedTheme = setBackgroundTheme(theme)
      applyThemeParticles(appliedTheme)
      setGradientTheme(appliedTheme)
      return
    }

    case 'set_camera_preset':
      if (typeof cmd.preset === 'string') {
        setCameraPreset(cmd.preset, cmd.duration)
        if (typeof cmd.distance === 'number' || typeof cmd.height === 'number') {
          adjustPresetOffset(
            cmd.preset,
            typeof cmd.distance === 'number' ? cmd.distance : 1.0,
            typeof cmd.height === 'number' ? cmd.height : 0,
          )
        }
      }
      return

    case 'adjust_camera_preset':
      if (typeof cmd.preset === 'string') {
        adjustPresetOffset(
          cmd.preset,
          typeof cmd.distance === 'number' ? cmd.distance : 1.0,
          typeof cmd.height === 'number' ? cmd.height : 0,
        )
      }
      return

    case 'sync':
      await handleSyncCommand(cmd)
      return

    default:
      return
  }
}

function installNativeSyncReceiver() {
  ;(window as any).__clawatar_receive_sync_command = (payload: unknown) => {
    const cmd = normalizeCommandPayload(payload)
    if (!cmd) return
    void handleCommand(cmd)
  }

  window.addEventListener('message', (event) => {
    const cmd = normalizeCommandPayload(event.data)
    if (!cmd) return
    void handleCommand(cmd)
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
  if (state.vrm) state.vrm.update(delta)

  updateBackgroundEffects(elapsed, delta)
  if (!isTransparent) updateGradientBackground(elapsed, delta)
  updateCameraPresets(performance.now() / 1000)
  updateLookAt()

  controls.update()
  enforceCameraSafetyShell()

  let shadowLift = 0
  let shadowStance = 0.28
  if (state.vrm) {
    shadowLift = Math.max(0, state.vrm.scene.position.y)
    const humanoid = state.vrm.humanoid
    const leftFoot = humanoid?.getNormalizedBoneNode('leftFoot')
    const rightFoot = humanoid?.getNormalizedBoneNode('rightFoot')
    if (leftFoot && rightFoot) {
      leftFoot.getWorldPosition(_leftFootWorld)
      rightFoot.getWorldPosition(_rightFootWorld)
      const minFootY = Math.min(_leftFootWorld.y, _rightFootWorld.y)
      if (shadowGroundFootY == null) {
        shadowGroundFootY = minFootY
      }
      if (minFootY < shadowGroundFootY) {
        shadowGroundFootY = minFootY
      } else {
        shadowGroundFootY += (minFootY - shadowGroundFootY) * 0.02
      }
      shadowLift = Math.max(shadowLift, Math.max(0, minFootY - shadowGroundFootY))
      shadowStance = Math.hypot(
        _leftFootWorld.x - _rightFootWorld.x,
        _leftFootWorld.z - _rightFootWorld.z,
      )
    }
  } else {
    shadowGroundFootY = null
  }

  const shadowAllowedForPreset = getCurrentCameraPreset() === 'full'
  const hasVisibleCharacter = !!state.vrm && state.vrm.scene.visible
  updateContactShadow(
    shadowAllowedForPreset ? (state.vrm?.scene ?? null) : null,
    (shadowAllowedForPreset && hasVisibleCharacter) ? { lift: shadowLift, stance: shadowStance } : undefined
  )

  if (isTransparent) {
    if (shadowAllowedForPreset && hasVisibleCharacter && state.vrm) {
      syncShadowAnchorFromStage({
        x: state.vrm.scene.position.x,
        z: state.vrm.scene.position.z,
        lift: shadowLift,
        stance: shadowStance,
        visible: true,
      })
    } else {
      syncShadowAnchorFromStage({
        x: lastShadowAnchorX,
        z: lastShadowAnchorZ,
        lift: 0,
        stance: 0.28,
        visible: false,
      })
    }
  }

  if (composer) {
    composer.render()
  } else {
    renderer.render(scene, camera)
  }
}

async function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null
  if (!canvas) {
    throw new Error('Missing #canvas for embed renderer')
  }

  await initScene(canvas, { disableOrbitControls: true })
  const shouldRenderContactShadow = !isEmbed || isTransparent
  initContactShadow(shouldRenderContactShadow)
  if (!isTransparent) {
    initGradientBackground(scene, initialTheme)
  }
  initLookAt(canvas)

  enhanceLightingForEmbed()
  if (isTransparent) {
    setTransparentBackground(true)
  }

  // Embed surfaces are fully controlled by native gestures/UI.
  controls.enableRotate = false
  controls.enablePan = false
  controls.enableZoom = false

  initBackgrounds(initialTheme)
  initCameraPresets()
  installNativeSyncReceiver()

  if (!disableAutoLoad) {
    void autoLoad()
  }

  animate()
}

void init().catch((error) => {
  console.error('[embed] init failed:', error)
})
