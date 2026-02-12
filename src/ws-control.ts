import type { WSCommand } from './types'
import { loadVRM } from './vrm-loader'
import { loadAndPlay } from './animation'
import { setExpression, resetExpressions } from './expressions'
import { triggerSpeak } from './lip-sync'
import { setLookAtTarget } from './look-at'
import { requestAction, requestSpeak, requestSpeakAudio, requestReset, getState } from './action-state-machine'
import { addMessage } from './chat-ui'
import { initVoiceInput, toggleListening, setMicButton } from './voice-input'
import { initChatUI } from './chat-ui'

let ws: WebSocket | null = null
let reconnectTimer: number | null = null

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
      case 'speak_audio':
        // Audio-driven speech from TTS server
        if (cmd.text) addMessage('avatar', cmd.text)
        await requestSpeakAudio(
          cmd.audio_url,
          cmd.action_id,
          cmd.expression,
          cmd.expression_weight
        )
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
  // Init chat UI - sends user text through WS
  initChatUI((text: string) => {
    sendWS({ type: 'user_speech', text })
  })

  // Init voice input - sends transcribed speech through WS
  initVoiceInput((text: string) => {
    addMessage('user', text)
    sendWS({ type: 'user_speech', text })
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
