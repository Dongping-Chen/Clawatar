import { handleSceneCommand } from './scene-system'
import { loadVRM } from './vrm-loader'
import { DEFAULT_BASE_IDLE_ACTION, loadAndPlay, playBaseIdle, setCrossfadeScale } from './animation'
import { setExpression, resetExpressions, resetExpressionsImmediately } from './expressions'
import { setAutoBlinkEnabled } from './blink'
import { setLookAtTarget } from './look-at'
import { setBackgroundTheme, setContactShadowExternalAnchor, setContactShadowRuntimeEnabled } from './scene'
import { applyThemeParticles } from './backgrounds'
import { setGradientTheme } from './gradient-background'
import { detectEmotion } from './emotion-detect'
import { notifyUserActivity } from './reactive-idle'
import { requestAction, requestSpeak, requestSpeakAudio, requestSpeakAudioStream, requestFinishSpeaking, requestReset, getState, setIdleAnimationsEnabled } from './action-state-machine'
import { setTouchReactionsEnabled } from './touch-reactions'
import { streamingPlayer } from './streaming-audio'
import { addMessage } from './chat-ui'
import { initVoiceInput, toggleListening, setMicButton } from './voice-input'
import { initChatUI } from './chat-ui'
import { withSyncSuppressed } from './sync-bridge'
import { getMusicMoodForTheme, setMusicMood, setMusicVolume, skipTrack, toggleMusic } from './ambient-music'
import { applyPreset, setAmbience, setMasterVolume, setSoundVolume, toggleSound } from './ambience-mixer'

let ws: WebSocket | null = null
let reconnectTimer: number | null = null

// This device's ID — used for focus-based audio routing
const WEB_DEVICE_ID = `web-${crypto.randomUUID().slice(0, 8)}`
const queryParams = new URLSearchParams(window.location.search)
const isEmbedMode = queryParams.has('embed')
const isMeetingMode = queryParams.has('meeting')
const isBgOnlyMode = queryParams.has('bgonly')
const WEB_DEVICE_TYPE = isMeetingMode ? 'meeting' : isEmbedMode ? 'ios-embed' : 'web'
;(window as any).__clawatar_device_id = WEB_DEVICE_ID

function updateStatus(connected: boolean) {
  const dot = document.getElementById('ws-dot')
  const status = document.getElementById('status')
  if (dot) {
    dot.className = `ws-dot ${connected ? 'connected' : 'disconnected'}`
  }
  if (status) {
    status.innerHTML = `<span class="ws-dot ${connected ? 'connected' : 'disconnected'}"></span>WS: ${connected ? 'connected' : 'disconnected'}`
  }
}

function sendWS(data: any) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data))
  }
}

interface HandleCommandOptions {
  suppressSyncBroadcast?: boolean
  sendAck?: boolean
}

function normalizeCommandPayload(payload: unknown): any | null {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
    if (!parsed || typeof parsed !== 'object') return null

    const candidate = (parsed as any).command && typeof (parsed as any).command === 'object'
      ? (parsed as any).command
      : parsed

    if (!candidate || typeof candidate !== 'object') return null
    if (typeof (candidate as any).type !== 'string') return null

    return candidate
  } catch {
    return null
  }
}

function normalizeRoomPath(room: string): string {
  const trimmed = room.trim()
  if (!trimmed) return ''
  if (trimmed.endsWith('.glb')) return trimmed
  if (trimmed.startsWith('scenes/')) return `${trimmed}.glb`
  return `scenes/${trimmed}.glb`
}

async function handleSyncCommand(cmd: any) {
  const origin = typeof cmd.origin === 'string' ? cmd.origin : ''
  if (origin && origin === WEB_DEVICE_ID) {
    return
  }

  const category = String(cmd.category ?? '').toLowerCase()
  const payload = (cmd.payload && typeof cmd.payload === 'object') ? cmd.payload : {}

  switch (category) {
    case 'theme': {
      const theme = typeof payload.theme === 'string' ? payload.theme : 'sakura'
      const appliedTheme = setBackgroundTheme(theme)
      applyThemeParticles(appliedTheme)
      setGradientTheme(appliedTheme)
      await setMusicMood(getMusicMoodForTheme(appliedTheme))
      break
    }

    case 'music': {
      if (typeof payload.mood === 'string') {
        await setMusicMood(payload.mood)
      }
      if (typeof payload.volume === 'number') {
        setMusicVolume(payload.volume)
      }
      if (typeof payload.enabled === 'boolean') {
        await toggleMusic(payload.enabled)
      }
      if (payload.skip === true) {
        await skipTrack()
      }
      break
    }

    case 'ambience': {
      if (Array.isArray(payload.sounds)) {
        const sounds = payload.sounds
          .filter((s: any) => typeof s?.id === 'string')
          .map((s: any) => ({ id: s.id, volume: typeof s.volume === 'number' ? s.volume : 0.52 }))
        await setAmbience(sounds)
      }
      if (typeof payload.id === 'string' && typeof payload.enabled === 'boolean') {
        await toggleSound(payload.id, payload.enabled)
      }
      if (typeof payload.id === 'string' && typeof payload.volume === 'number') {
        setSoundVolume(payload.id, payload.volume)
      }
      if (typeof payload.masterVolume === 'number') {
        setMasterVolume(payload.masterVolume)
      }
      if (typeof payload.preset === 'string') {
        await applyPreset(payload.preset)
      }
      break
    }

    case 'camera': {
      const preset = typeof payload.preset === 'string' ? payload.preset : undefined
      if (!preset) break

      const hasAdjustment = typeof payload.distance === 'number' || typeof payload.height === 'number'
      const hasPresetTransition = typeof payload.duration === 'number' || !hasAdjustment
      const { setCameraPreset, adjustPresetOffset } = await import('./camera-presets')

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

    case 'scene': {
      const roomRaw = typeof payload.room === 'string' ? payload.room : ''
      const roomPath = normalizeRoomPath(roomRaw)
      const { loadRoomGLB, unloadScene } = await import('./scene-system')

      if (!roomPath) {
        unloadScene()
      } else {
        await loadRoomGLB(roomPath)
      }

      const roomSelect = document.getElementById('room-select') as HTMLSelectElement | null
      if (roomSelect) {
        roomSelect.value = roomPath
      }
      break
    }

    case 'action': {
      const actionId = typeof payload.actionId === 'string' ? payload.actionId : undefined
      const loop = typeof payload.loop === 'boolean' ? payload.loop : false
      const category = typeof payload.category === 'string' ? payload.category : undefined
      const expression = typeof payload.expression === 'string' ? payload.expression : undefined
      const expressionWeight = typeof payload.expressionWeight === 'number' ? payload.expressionWeight : 0.5

      if (typeof cmd.ts === 'number' && actionId) {
        const relayLatency = Date.now() - cmd.ts
        if (relayLatency >= 0) {
          console.debug(`[sync] action ${actionId} relay latency: ${relayLatency}ms`)
        }
      }

      if (expression) {
        setExpression(expression, expressionWeight, undefined, { sync: false })
      } else {
        resetExpressionsImmediately()
      }

      if (actionId) {
        await requestAction(actionId, {
          sync: false,
          loop,
          category,
        })
      }
      break
    }

    case 'avatar_config': {
      if (typeof payload.autoBlink === 'boolean') {
        setAutoBlinkEnabled(payload.autoBlink)
      }

      if (typeof payload.idleAnimations === 'boolean') {
        setIdleAnimationsEnabled(payload.idleAnimations)
      }

      if (typeof payload.touchReactions === 'boolean') {
        setTouchReactionsEnabled(payload.touchReactions)
      }
      break
    }

    case 'expression': {
      const name = typeof payload.name === 'string' ? payload.name : undefined
      if (name) {
        const weight = typeof payload.weight === 'number' ? payload.weight : 1.0
        setExpression(name, weight, undefined, { sync: false })
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

async function handleCommand(cmd: any, options: HandleCommandOptions = {}) {
  const { suppressSyncBroadcast = true, sendAck = true } = options

  console.log('WS command:', cmd)

  const executeCommand = async () => {
    switch (cmd.type) {
      case 'play_action':
        if (cmd.action_id) {
          const loop = typeof cmd.loop === 'boolean' ? cmd.loop : false
          const category = typeof cmd.category === 'string' ? cmd.category : undefined
          // Apply expression from master if provided (follower sync)
          if (cmd.expression) {
            setExpression(cmd.expression, cmd.expression_weight ?? 0.5, undefined, { sync: false })
          } else {
            resetExpressionsImmediately()
          }
          await requestAction(cmd.action_id, {
            sync: false,
            loop,
            category,
          })
        }
        break
      case 'set_expression':
        if (cmd.name) {
          setExpression(cmd.name, cmd.weight ?? 1.0, undefined, { sync: false })
        }
        break
      case 'set_expressions':
        if (cmd.expressions) {
          resetExpressions()
          for (const e of cmd.expressions) {
            setExpression(e.name, e.weight, undefined, { sync: false })
          }
        }
        break
      case 'speak':
        // Fallback if server didn't handle TTS (no API key, etc.)
        await requestSpeak(cmd.text ?? '', cmd.action_id, cmd.expression, cmd.expression_weight)
        break
      case 'speak_audio':
      case 'tts_audio': {
        // Audio-driven speech from TTS server
        if (cmd.text) addMessage('avatar', cmd.text)
        // Auto-detect emotion if server didn't provide expression
        let actionId = cmd.action_id
        let expression = cmd.expression
        let expressionWeight = cmd.expression_weight
        if (!expression && cmd.text) {
          const emotion = detectEmotion(cmd.text)
          if (emotion.primary !== 'neutral') {
            expression = emotion.expression
            expressionWeight = emotion.expressionWeight
            if (!actionId && emotion.animation) actionId = emotion.animation
          }
        }
        // Focus-based audio: only play audio if this device is the target (or no target specified)
        const shouldPlayAudio = !cmd.audio_device || cmd.audio_device === WEB_DEVICE_ID || cmd.audio_device === WEB_DEVICE_TYPE
        if (shouldPlayAudio) {
          await requestSpeakAudio(cmd.audio_url, actionId, expression, expressionWeight)
        } else {
          // Still show animation + expression, just no audio
          await requestAction(actionId || '86_Talking', { sync: false })
          if (expression) {
            const { setExpression } = await import('./expressions')
            setExpression(expression, expressionWeight ?? 0.8, undefined, { sync: false })
          }
        }
        break
      }
      /* ── streaming audio (voice/chat mode) ── */
      case 'audio_start': {
        // Begin streaming playback — sets up MSE + analyser + animation
        await streamingPlayer.startStream()
        let sActionId = cmd.action_id
        let sExpr = cmd.expression
        let sExprW = cmd.expression_weight
        if (!sExpr && cmd.text) {
          const emo = detectEmotion(cmd.text)
          if (emo.primary !== 'neutral') {
            sExpr = emo.expression
            sExprW = emo.expressionWeight
            if (!sActionId && emo.animation) sActionId = emo.animation
          }
        }
        await requestSpeakAudioStream(sActionId, sExpr, sExprW)
        break
      }
      case 'audio_chunk': {
        if (cmd.audio) streamingPlayer.feedChunk(cmd.audio)
        break
      }
      case 'audio_end': {
        if (cmd.text) addMessage('avatar', cmd.text)
        await streamingPlayer.endStream()
        requestFinishSpeaking()
        break
      }
      case 'streaming_mode': {
        // Server confirmed streaming mode change — nothing to do client-side
        console.log(`[ws] Streaming mode: ${cmd.enabled}`)
        break
      }

      case 'set_character_visible':
        if (typeof (window as any).setCharacterVisible === 'function') {
          (window as any).setCharacterVisible(!!cmd.visible)
        }
        break
      case 'set_contact_shadow_enabled':
        setContactShadowRuntimeEnabled(!!cmd.enabled)
        break
      case 'user_typing':
        notifyUserActivity('typing')
        break
      case 'reset':
        requestReset()
        break
      case 'get_state':
        sendWS({ type: 'state', state: getState() })
        return
      case 'tts_error':
        console.error('TTS error from server:', cmd.message)
        break

      case 'sync':
        await handleSyncCommand(cmd)
        break

      // Legacy protocol
      case 'loadModel':
        if (isBgOnlyMode) {
          break
        }
        if (cmd.url) {
          await loadVRM(cmd.url)
          await playBaseIdle(DEFAULT_BASE_IDLE_ACTION)
          try {
            ;(window as any).webkit?.messageHandlers?.clawatar?.postMessage({ event: 'modelLoaded' })
          } catch {}
        }
        break
      case 'loadAnimation':
        if (cmd.url) await loadAndPlay(cmd.url)
        break
      case 'setExpression':
        if (cmd.name) setExpression(cmd.name, cmd.intensity ?? 1.0, undefined, { sync: false })
        break
      case 'resetExpressions':
        resetExpressions()
        break
      case 'lookAt':
        setLookAtTarget(cmd.x ?? 0, cmd.y ?? 1.5, cmd.z ?? -1)
        break
      case 'set_theme':
      case 'set_background_theme': {
        const appliedTheme = setBackgroundTheme(cmd.theme ?? 'sakura')
        applyThemeParticles(appliedTheme)
        setGradientTheme(appliedTheme)
        await setMusicMood(getMusicMoodForTheme(appliedTheme))
        break
      }
      case 'set_music_mood':
        if (typeof cmd.mood === 'string') {
          await setMusicMood(cmd.mood)
        }
        break
      case 'set_music_volume':
        if (typeof cmd.volume === 'number') {
          setMusicVolume(cmd.volume)
        }
        break
      case 'music_toggle':
        if (typeof cmd.enabled === 'boolean') {
          await toggleMusic(cmd.enabled)
        }
        break
      case 'music_skip':
        await skipTrack()
        break
      case 'set_ambience':
        if (Array.isArray(cmd.sounds)) {
          const sounds = cmd.sounds
            .filter((s: any) => typeof s?.id === 'string')
            .map((s: any) => ({ id: s.id, volume: typeof s.volume === 'number' ? s.volume : 0.52 }))
          await setAmbience(sounds)
        }
        break
      case 'ambience_toggle':
        if (typeof cmd.id === 'string' && typeof cmd.enabled === 'boolean') {
          await toggleSound(cmd.id, cmd.enabled)
        }
        break
      case 'ambience_volume':
        if (typeof cmd.id === 'string' && typeof cmd.volume === 'number') {
          setSoundVolume(cmd.id, cmd.volume)
        }
        break
      case 'ambience_master_volume':
        if (typeof cmd.volume === 'number') {
          setMasterVolume(cmd.volume)
        }
        break
      case 'ambience_preset':
        if (typeof cmd.preset === 'string') {
          await applyPreset(cmd.preset)
        }
        break
      case 'set_camera_preset':
        import('./camera-presets').then(m => {
          m.setCameraPreset(cmd.preset, cmd.duration)
          if (typeof cmd.distance === 'number' || typeof cmd.height === 'number') {
            m.adjustPresetOffset(
              cmd.preset,
              typeof cmd.distance === 'number' ? cmd.distance : 1.0,
              typeof cmd.height === 'number' ? cmd.height : 0,
            )
          }
        })
        break
      case 'adjust_camera_preset':
        import('./camera-presets').then(m => m.adjustPresetOffset(cmd.preset, cmd.distance ?? 1.0, cmd.height ?? 0))
        break
      case 'set_room_mode':
        import('./room-scene').then(m => {
          if (cmd.enabled) m.enableRoomMode()
          else m.disableRoomMode()
        })
        break
      case 'set_room_theme':
        import('./room-scene').then(m => m.setRoomTheme(cmd.theme ?? 'cozy'))
        break
      case 'set_activity_mode':
        import('./activity-modes').then(m => m.setActivityMode(cmd.mode ?? 'free'))
        break
      case 'set_crossfade_scale':
        if (typeof cmd.scale === 'number') setCrossfadeScale(cmd.scale)
        break
      case 'load_scene':
      case 'load_room':
      case 'list_scenes':
      case 'unload_scene':
      case 'list_assets':
        handleSceneCommand(cmd)
        break
    }
  }

  try {
    if (suppressSyncBroadcast) {
      await withSyncSuppressed(executeCommand)
    } else {
      await executeCommand()
    }

    // Send ack for commands, but NOT for status messages (prevents broadcast loops)
    if (sendAck && cmd.type !== 'speak_audio' && cmd.type !== 'tts_audio' && cmd.type !== 'tts_error' && !(cmd as any).status) {
      sendWS({ status: 'ok', type: cmd.type })
    }
  } catch (e: any) {
    if (sendAck) {
      sendWS({ status: 'error', type: cmd.type, message: e.message })
    }
  }
}

export function initNativeSyncReceiver() {
  const globalWindow = window as any
  if (globalWindow.__clawatar_native_sync_receiver_installed) {
    return
  }

  globalWindow.__clawatar_native_sync_receiver_installed = true
  globalWindow.__clawatar_receive_sync_command = (payload: unknown) => {
    const cmd = normalizeCommandPayload(payload)
    if (!cmd) {
      return
    }

    void handleCommand(cmd, {
      suppressSyncBroadcast: true,
      sendAck: false,
    })
  }
}

export function initChatAndVoice() {
  // Init chat UI - sends user text through WS with device ID for focus routing
  initChatUI((text: string) => {
    sendWS({ type: 'user_speech', text, source_device: WEB_DEVICE_ID })
  })

  // Init voice input - sends transcribed speech through WS
  initVoiceInput((text: string) => {
    addMessage('user', text)
    sendWS({ type: 'user_speech', text, source_device: WEB_DEVICE_ID })
  })

  // Mic button
  const micBtn = document.getElementById('mic-btn') as HTMLButtonElement
  if (micBtn) {
    setMicButton(micBtn)
    micBtn.addEventListener('click', toggleListening)
  }
}

export function connectWS(port = 8765) {
  initNativeSyncReceiver()

  if (ws) ws.close()

  ws = new WebSocket(`ws://localhost:${port}`)
  // Expose WS for idle animation sync (action-state-machine.ts)
  ;(window as any).__clawatar_ws = ws

  ws.onopen = () => {
    updateStatus(true)
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    // Register this device for focus-based audio routing
    sendWS({ type: 'register_device', deviceId: WEB_DEVICE_ID, deviceType: WEB_DEVICE_TYPE, name: WEB_DEVICE_TYPE === 'meeting' ? 'Meeting OBS' : WEB_DEVICE_TYPE === 'ios-embed' ? 'iOS Embed' : 'Web Browser' })
  }

  ws.onmessage = (e) => {
    const cmd = normalizeCommandPayload(e.data)
    if (!cmd) {
      return
    }

    void handleCommand(cmd, {
      suppressSyncBroadcast: true,
      sendAck: true,
    })
  }

  ws.onclose = () => {
    updateStatus(false)
    addMessage('system', 'WebSocket disconnected — AI chat unavailable. Standalone features still work.')
    reconnectTimer = window.setTimeout(() => connectWS(port), 5000)
  }

  ws.onerror = () => ws?.close()
}
