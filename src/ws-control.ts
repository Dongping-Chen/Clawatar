import { handleSceneCommand } from './scene-system'
import type { WSCommand } from './types'
import { loadVRM } from './vrm-loader'
import { loadAndPlay, setCrossfadeScale } from './animation'
import { setExpression, resetExpressions } from './expressions'
import { triggerSpeak } from './lip-sync'
import { setLookAtTarget } from './look-at'
import { detectEmotion } from './emotion-detect'
import { notifyUserActivity } from './reactive-idle'
import { requestAction, requestSpeak, requestSpeakAudio, requestSpeakAudioStream, requestFinishSpeaking, requestReset, getState } from './action-state-machine'
import { streamingPlayer } from './streaming-audio'
import { addMessage } from './chat-ui'
import { initVoiceInput, toggleListening, setMicButton } from './voice-input'
import { initChatUI } from './chat-ui'

let ws: WebSocket | null = null
let reconnectTimer: number | null = null

// This device's ID — used for focus-based audio routing
const WEB_DEVICE_ID = `web-${crypto.randomUUID().slice(0, 8)}`
const isEmbedMode = new URLSearchParams(window.location.search).has('embed')
const isMeetingMode = new URLSearchParams(window.location.search).has('meeting')
const WEB_DEVICE_TYPE = isMeetingMode ? 'meeting' : isEmbedMode ? 'ios-embed' : 'web'

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

async function handleCommand(cmd: any) {
  console.log('WS command:', cmd)
  try {
    switch (cmd.type) {
      case 'play_action':
        if (cmd.action_id) {
          // Apply expression from master if provided (follower sync)
          if (cmd.expression) {
            setExpression(cmd.expression, cmd.expression_weight ?? 0.5)
          } else {
            resetExpressions()
          }
          await requestAction(cmd.action_id)
        }
        break
      case 'set_expression':
        if (cmd.name) setExpression(cmd.name, cmd.weight ?? 1.0)
        break
      case 'set_expressions':
        if (cmd.expressions) {
          resetExpressions()
          for (const e of cmd.expressions) {
            setExpression(e.name, e.weight)
          }
        }
        break
      case 'speak':
        // Fallback if server didn't handle TTS (no API key, etc.)
        await requestSpeak(cmd.text ?? '', cmd.action_id, cmd.expression, cmd.expression_weight)
        break
      case 'speak_audio': {
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
          await requestAction(actionId || '86_Talking')
          if (expression) {
            const { setExpression } = await import('./expressions')
            setExpression(expression, expressionWeight ?? 0.8)
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

      // Legacy protocol
      case 'loadModel':
        if (cmd.url) await loadVRM(cmd.url)
        break
      case 'loadAnimation':
        if (cmd.url) await loadAndPlay(cmd.url)
        break
      case 'setExpression':
        if (cmd.name) setExpression(cmd.name, cmd.intensity ?? 1.0)
        break
      case 'resetExpressions':
        resetExpressions()
        break
      case 'lookAt':
        setLookAtTarget(cmd.x ?? 0, cmd.y ?? 1.5, cmd.z ?? -1)
        break
      case 'set_camera_preset':
        import('./camera-presets').then(m => m.setCameraPreset(cmd.preset, cmd.duration))
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
    // Send ack for commands, but NOT for status messages (prevents broadcast loops)
    if (cmd.type !== 'speak_audio' && cmd.type !== 'tts_error' && !cmd.status) {
      sendWS({ status: 'ok', type: cmd.type })
    }
  } catch (e: any) {
    sendWS({ status: 'error', type: cmd.type, message: e.message })
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
    try {
      const cmd = JSON.parse(e.data)
      handleCommand(cmd)
    } catch { /* ignore parse errors */ }
  }

  ws.onclose = () => {
    updateStatus(false)
    addMessage('system', 'WebSocket disconnected — AI chat unavailable. Standalone features still work.')
    reconnectTimer = window.setTimeout(() => connectWS(port), 5000)
  }

  ws.onerror = () => ws?.close()
}
