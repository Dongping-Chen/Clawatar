import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'

// Load config
const CONFIG_PATH = resolve(import.meta.dirname ?? '.', '..', 'clawatar.config.json')
let config: any = {}
try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch {}

const WS_PORT = config.server?.wsPort || 8765
const AUDIO_PORT = config.server?.audioPort || 8866
const AUDIO_CACHE_DIR = resolve(import.meta.dirname ?? '.', '_audio_cache')
const MAX_CACHE_FILES = 64

// ElevenLabs config
const VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || config.voice?.elevenlabsVoiceId || 'L5vK1xowu0LZIPxjLSl5'
const MODEL_ID = process.env.ELEVEN_LABS_MODEL || config.voice?.elevenlabsModel || 'eleven_turbo_v2_5'

function getApiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  try {
    const configPath = join(process.env.HOME || '', '.openclaw', 'openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config?.skills?.entries?.sag?.apiKey || ''
  } catch { return '' }
}

const API_KEY = getApiKey()

// Ensure cache dir
mkdirSync(AUDIO_CACHE_DIR, { recursive: true })

// --- Audio HTTP server ---
const audioServer = createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

  const match = req.url?.match(/^\/audio\/([a-f0-9-]+\.mp3)$/)
  if (!match) { res.writeHead(404); res.end('Not found'); return }

  const filePath = join(AUDIO_CACHE_DIR, match[1])
  if (!existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return }

  const data = readFileSync(filePath)
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'Content-Length': data.length })
  res.end(data)
})

let actualAudioPort = AUDIO_PORT

audioServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${actualAudioPort} in use, trying ${actualAudioPort + 1}...`)
    actualAudioPort++
    audioServer.listen(actualAudioPort)
  } else {
    console.error('Audio server error:', err)
  }
})

audioServer.listen(AUDIO_PORT, () => {
  console.log(`Audio HTTP server on http://localhost:${actualAudioPort}`)
})

// --- TTS generation ---
async function generateTTS(text: string): Promise<string> {
  if (!API_KEY) throw new Error('No ElevenLabs API key configured')
  
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'accept': 'audio/mpeg',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: text.trim(),
      model_id: MODEL_ID,
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`ElevenLabs error (${resp.status}): ${body.slice(0, 300)}`)
  }

  const buffer = Buffer.from(await resp.arrayBuffer())
  const fileName = `${randomUUID()}.mp3`
  writeFileSync(join(AUDIO_CACHE_DIR, fileName), buffer)
  pruneCache()
  return `http://localhost:${actualAudioPort}/audio/${fileName}`
}

function pruneCache() {
  try {
    const files = readdirSync(AUDIO_CACHE_DIR)
      .filter(f => f.endsWith('.mp3'))
      .map(f => ({ name: f, mtime: statSync(join(AUDIO_CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const f of files.slice(MAX_CACHE_FILES)) {
      try { unlinkSync(join(AUDIO_CACHE_DIR, f.name)) } catch {}
    }
  } catch {}
}

// --- OpenClaw Agent Integration ---
const GATEWAY_PORT = config.openclaw?.gatewayPort || 18789
const GATEWAY_TOKEN = (() => {
  try {
    const configPath = join(process.env.HOME || '', '.openclaw', 'openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config?.gateway?.auth?.token || ''
  } catch { return '' }
})()

// Simple action picker based on text sentiment
function pickAction(text: string): { action_id: string, expression: string, expression_weight: number } {
  const lower = text.toLowerCase()
  if (lower.match(/\b(haha|lol|funny|laugh|😂|😄)\b/)) return { action_id: '125_Laughing', expression: 'happy', expression_weight: 0.9 }
  if (lower.match(/\b(hi|hello|hey|greet|welcome)\b/)) return { action_id: '161_Waving', expression: 'happy', expression_weight: 0.7 }
  if (lower.match(/\b(yes|yeah|sure|agree|ok|okay|right)\b/)) return { action_id: '118_Head Nod Yes', expression: 'happy', expression_weight: 0.6 }
  if (lower.match(/\b(no|nope|disagree|don't)\b/)) return { action_id: '144_Shaking Head No', expression: 'neutral', expression_weight: 0.5 }
  if (lower.match(/\b(sad|sorry|bad|unfortunately)\b/)) return { action_id: '142_Sad Idle', expression: 'sad', expression_weight: 0.7 }
  if (lower.match(/\b(think|hmm|consider|maybe|probably)\b/)) return { action_id: '88_Thinking', expression: 'neutral', expression_weight: 0.5 }
  if (lower.match(/\b(thank|thanks|appreciate|grateful)\b/)) return { action_id: '156_Thankful', expression: 'happy', expression_weight: 0.8 }
  if (lower.match(/\b(wow|amazing|awesome|incredible|cool)\b/)) return { action_id: '116_Happy Hand Gesture', expression: 'surprised', expression_weight: 0.8 }
  if (lower.match(/\b(dance|party|celebrate)\b/)) return { action_id: '54_Macarena Dance', expression: 'happy', expression_weight: 0.9 }
  if (lower.match(/\b(shrug|dunno|idk|whatever)\b/)) return { action_id: '145_Shrugging', expression: 'neutral', expression_weight: 0.5 }
  // Default: talking gesture
  return { action_id: '86_Talking', expression: 'happy', expression_weight: 0.5 }
}

async function askOpenClaw(userText: string): Promise<string> {
  // Use CLI with --json and strip any non-JSON output
  const { execSync } = await import('child_process')
  try {
    const result = execSync(
      `openclaw agent --message ${JSON.stringify(userText)} --json --session-id ${config.openclaw?.sessionId || 'vrm-chat'} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 120000 }
    )
    // Strip CLI UI decorations, find the main JSON object
    // The output has "│ ◇ Config warnings ..." before the JSON
    const lines = result.split('\n')
    let jsonStr = ''
    let braceDepth = 0
    let inJson = false
    for (const line of lines) {
      if (!inJson && line.trim().startsWith('{')) {
        inJson = true
      }
      if (inJson) {
        jsonStr += line + '\n'
        for (const ch of line) {
          if (ch === '{') braceDepth++
          if (ch === '}') braceDepth--
        }
        if (braceDepth <= 0 && inJson) break
      }
    }
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr)
      // OpenClaw agent output: result.payloads[0].text
      const payloadText = parsed?.result?.payloads?.[0]?.text
      if (payloadText) return payloadText
      return parsed?.reply || parsed?.text || parsed?.message || 'Hmm?'
    }
    return 'I couldn\'t process that.'
  } catch (e: any) {
    console.error('CLI error:', e.message)
    // Last resort: try gateway HTTP API
    try {
      const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        },
        body: JSON.stringify({
          message: userText,
          session: 'vrm-chat',
          channel: 'webchat',
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        return data?.reply || data?.text || data?.message || 'I couldn\'t process that.'
      }
    } catch {}
    throw e
  }
}

async function handleUserSpeech(text: string, senderWs: WebSocket) {
  console.log(`User said: "${text}"`)

  // Get response from OpenClaw
  let response: string
  try {
    response = await askOpenClaw(text)
  } catch (e: any) {
    console.error('OpenClaw error:', e.message)
    response = "Sorry, I'm having trouble connecting to my brain right now."
  }

  console.log(`Avatar responds: "${response}"`)

  // Pick action based on response content
  const { action_id, expression, expression_weight } = pickAction(response)

  // Generate TTS
  try {
    const audioUrl = await generateTTS(response)
    const audioMsg = JSON.stringify({
      type: 'speak_audio',
      audio_url: audioUrl,
      text: response,
      action_id,
      expression,
      expression_weight,
    })
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(audioMsg)
      }
    }
    console.log(`TTS + action sent: ${action_id}, ${expression}`)
  } catch (e: any) {
    console.error('TTS error, sending text-only:', e.message)
    // Fallback: send speak without audio
    const fallbackMsg = JSON.stringify({
      type: 'speak',
      text: response,
      action_id,
      expression,
      expression_weight,
    })
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(fallbackMsg)
      }
    }
  }
}

// --- Multi-device registry ---
interface DeviceInfo {
  ws: WebSocket
  deviceId: string
  deviceType: string
  name: string
}
const devices = new Map<string, DeviceInfo>()

function getDeviceList(): Array<{deviceId: string, deviceType: string, name: string}> {
  return Array.from(devices.values()).map(d => ({
    deviceId: d.deviceId, deviceType: d.deviceType, name: d.name
  }))
}

function broadcastDeviceList() {
  const list = getDeviceList()
  const msg = JSON.stringify({ type: 'device_list', devices: list })
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  }
}

// --- Camera frame analysis ---
let lastFrameTime = 0
const FRAME_COOLDOWN_MS = 3000 // Min 3s between vision analyses

async function handleCameraFrame(base64Image: string, senderWs: WebSocket) {
  const now = Date.now()
  if (now - lastFrameTime < FRAME_COOLDOWN_MS) {
    return // Rate limit
  }
  lastFrameTime = now

  console.log(`Camera frame received (${(base64Image.length / 1024).toFixed(1)}KB), analyzing...`)

  try {
    // Save frame as temp file for vision analysis
    const frameBuffer = Buffer.from(base64Image, 'base64')
    const framePath = join(AUDIO_CACHE_DIR, `frame_${Date.now()}.jpg`)
    writeFileSync(framePath, frameBuffer)

    // Ask OpenClaw to analyze what it sees (brief description for conversational context)
    const visionPrompt = `You are Reze (Bomb Devil from Chainsaw Man). You just saw this image from the user's camera. Briefly describe what you see in 1-2 sentences, naturally and casually. Don't say "I see an image of..." — just react naturally like you're looking at someone through a video call.`

    const { execSync } = await import('child_process')
    const result = execSync(
      `openclaw agent --message ${JSON.stringify(visionPrompt)} --attachment ${JSON.stringify(framePath)} --json --session-id ${config.openclaw?.sessionId || 'vrm-chat'} 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    )

    // Parse response
    const lines = result.split('\n')
    let jsonStr = ''
    let braceDepth = 0
    let inJson = false
    for (const line of lines) {
      if (!inJson && line.trim().startsWith('{')) inJson = true
      if (inJson) {
        jsonStr += line + '\n'
        for (const ch of line) {
          if (ch === '{') braceDepth++
          if (ch === '}') braceDepth--
        }
        if (braceDepth <= 0 && inJson) break
      }
    }

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr)
      const text = parsed?.result?.payloads?.[0]?.text || 'I can see you~'
      console.log(`Vision response: "${text.substring(0, 100)}"`)

      // Broadcast vision context as a subtle system note (not full response)
      const msg = JSON.stringify({
        type: 'vision_context',
        text,
        timestamp: Date.now()
      })
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      }
    }

    // Clean up frame
    try { unlinkSync(framePath) } catch {}
  } catch (e: any) {
    console.error('Vision analysis error:', e.message)
  }
}

// --- Slash command handler (Telegram-style with inline buttons) ---
function handleSlashCommand(text: string): any | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const arg = parts.slice(1).join(' ')

  switch (cmd) {
    case '/help':
    case '/commands':
      return {
        type: 'speak',
        text: 'Available commands:',
        buttons: [
          [{ text: 'Status', callback_data: '/status' }, { text: 'Model', callback_data: '/model' }],
          [{ text: 'Think', callback_data: '/think' }, { text: 'TTS', callback_data: '/tts' }],
          [{ text: 'Usage', callback_data: '/usage' }, { text: 'Sessions', callback_data: '/sessions' }],
          [{ text: 'New Session', callback_data: '/new' }, { text: 'Reset', callback_data: '/reset' }],
        ],
      }

    case '/model':
      if (!arg) {
        return {
          type: 'speak',
          text: 'Choose a model provider:',
          buttons: [
            [{ text: 'OpenAI', callback_data: '/model openai' }],
            [{ text: 'Anthropic', callback_data: '/model anthropic' }],
          ],
        }
      }
      if (arg === 'openai') {
        return {
          type: 'speak',
          text: 'Choose an OpenAI model:',
          buttons: [
            [{ text: 'GPT-4o', callback_data: '/model set openai/gpt-4o' }],
            [{ text: 'GPT-5.2', callback_data: '/model set openai/gpt-5.2' }],
            [{ text: 'GPT-5.2 Codex', callback_data: '/model set openai/gpt-5.2-codex' }],
            [{ text: 'Back', callback_data: '/model' }],
          ],
        }
      }
      if (arg === 'anthropic') {
        return {
          type: 'speak',
          text: 'Choose an Anthropic model:',
          buttons: [
            [{ text: 'Claude Sonnet 4', callback_data: '/model set anthropic/claude-sonnet-4' }],
            [{ text: 'Claude Opus 4.6', callback_data: '/model set anthropic/claude-opus-4-6' }],
            [{ text: 'Back', callback_data: '/model' }],
          ],
        }
      }
      // "set" subcommand — forward to OpenClaw agent
      if (arg.startsWith('set ')) {
        return null  // Let agent handle the actual model switch
      }
      return null

    case '/think':
      return {
        type: 'speak',
        text: 'Set thinking level:',
        buttons: [
          [{ text: 'Off', callback_data: '/think off' }, { text: 'Low', callback_data: '/think low' }],
          [{ text: 'Medium', callback_data: '/think medium' }, { text: 'High', callback_data: '/think high' }],
        ],
      }

    case '/status':
      return null  // Forward to OpenClaw agent for real status

    case '/tts':
      return {
        type: 'speak',
        text: 'Text-to-Speech settings:',
        buttons: [
          [{ text: 'Enable TTS', callback_data: '/tts on' }, { text: 'Disable TTS', callback_data: '/tts off' }],
        ],
      }

    default:
      return null  // Unknown slash command → forward to agent
  }
}

// --- WebSocket server ---
const wss = new WebSocketServer({ port: WS_PORT })
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log(`Client connected (${clients.size} total)`)

  ws.on('message', async (data) => {
    // Handle binary audio data from Chrome extension
    if (data instanceof Buffer && (ws as any).__pendingAudioChunk) {
      const meta = (ws as any).__pendingAudioChunk
      delete (ws as any).__pendingAudioChunk
      console.log(`[chrome-audio] Received ${data.length} bytes`)
      // Save to temp file, convert with ffmpeg, transcribe with Whisper
      try {
        const tmpWebm = join(AUDIO_CACHE_DIR, `chunk_${Date.now()}.webm`)
        const tmpWav = tmpWebm.replace('.webm', '.wav')
        writeFileSync(tmpWebm, data)
        // Convert webm to wav for Whisper
        const { execSync } = await import('child_process')
        execSync(`ffmpeg -y -i "${tmpWebm}" -ar 16000 -ac 1 -acodec pcm_s16le "${tmpWav}" 2>/dev/null`, { timeout: 10000 })
        // Transcribe via Whisper API
        const apiKey = process.env.OPENAI_API_KEY ||
          (() => { try { return JSON.parse(readFileSync(resolve(import.meta.dirname ?? '.', '..', '..', '..', '.openclaw/openclaw.json'), 'utf-8')).skills?.entries?.['openai-whisper-api']?.apiKey } catch { return '' } })()
        if (apiKey) {
          const formData = new FormData()
          formData.append('file', new Blob([readFileSync(tmpWav)], { type: 'audio/wav' }), 'audio.wav')
          formData.append('model', 'whisper-1')
          const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData,
          })
          if (resp.ok) {
            const result = await resp.json() as { text: string }
            const text = (result.text || '').trim()
            if (text && text.length > 1) {
              console.log(`[chrome-audio] Transcribed: "${text}"`)
              const meetingPrompt = `[Meeting Audio] Someone said: "${text}"\n\nRespond naturally if relevant.`
              handleUserSpeech(meetingPrompt, ws).catch(e => console.error('Meeting speech error:', e.message))
            }
          }
        }
        // Cleanup
        try { unlinkSync(tmpWebm) } catch {}
        try { unlinkSync(tmpWav) } catch {}
      } catch (e: any) {
        console.error('[chrome-audio] Processing error:', e.message)
      }
      return
    }

    const msg = data.toString()
    // Skip logging binary-looking messages
    if (msg.length < 500) console.log('Received:', msg)

    let parsed: any
    try { parsed = JSON.parse(msg) } catch { parsed = null }

    // Handle speak command - generate TTS then broadcast audio URL
    if (parsed?.type === 'speak' && parsed.text) {
      try {
        const audioUrl = await generateTTS(parsed.text)
        const audioMsg = JSON.stringify({
          type: 'speak_audio',
          audio_url: audioUrl,
          text: parsed.text,
          action_id: parsed.action_id,
          expression: parsed.expression,
          expression_weight: parsed.expression_weight,
        })
        // Send to ALL clients (including sender, so the frontend gets it)
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(audioMsg)
          }
        }
        console.log(`TTS generated: ${audioUrl}`)
      } catch (e: any) {
        console.error('TTS error:', e.message)
        ws.send(JSON.stringify({ type: 'tts_error', message: e.message }))
        // Still broadcast original speak command for fallback lip sync
        for (const client of clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(msg)
          }
        }
      }
      return
    }

    // Handle camera_frame — vision analysis via OpenClaw
    if (parsed?.type === 'camera_frame' && parsed.image) {
      handleCameraFrame(parsed.image, ws).catch(e => {
        console.error('Camera frame handling error:', e.message)
      })
      return
    }

    // Handle device registration for multi-device sync
    if (parsed?.type === 'register_device') {
      const info = {
        ws,
        deviceId: parsed.deviceId || randomUUID(),
        deviceType: parsed.deviceType || 'unknown', // 'ios', 'macos', 'watchos', 'web'
        name: parsed.name || 'Unknown Device'
      }
      devices.set(info.deviceId, info)
      ws.send(JSON.stringify({ type: 'registered', deviceId: info.deviceId, connectedDevices: getDeviceList() }))
      // Notify all devices of the updated device list
      broadcastDeviceList()
      console.log(`Device registered: ${info.name} (${info.deviceType}) — ${devices.size} devices total`)
      return
    }

    // Handle audio_chunk from Chrome extension — binary audio follows this JSON message
    if (parsed?.type === 'audio_chunk' && parsed.size > 0) {
      // Next binary message will contain the audio data
      (ws as any).__pendingAudioChunk = parsed
      return
    }

    // Handle meeting_response — bridge already has AI response, just do TTS + broadcast
    if (parsed?.type === 'meeting_response' && parsed.text) {
      console.log(`[meeting] Speaking: "${parsed.text}"`)
      const { action_id, expression, expression_weight } = pickAction(parsed.text)
      try {
        const audioUrl = await generateTTS(parsed.text)
        const msg = JSON.stringify({
          type: 'speak_audio',
          audio_url: audioUrl,
          text: parsed.text,
          action_id,
          expression,
          expression_weight,
        })
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg)
          }
        }
        console.log(`[meeting] TTS sent: ${action_id}, ${expression}`)
      } catch (e: any) {
        console.error('[meeting] TTS error:', e.message)
        // Fallback: send text without audio
        const fallback = JSON.stringify({ type: 'speak', text: parsed.text, action_id, expression, expression_weight })
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(fallback)
        }
      }
      return
    }

    // Handle meeting_speech — transcribed audio from virtual meeting bridge
    if (parsed?.type === 'meeting_speech' && parsed.text) {
      console.log(`[meeting] Heard: "${parsed.text}"`)
      // Prefix with meeting context so AI knows this is from a meeting
      const meetingPrompt = `[Meeting Audio] A participant said: "${parsed.text}"\n\nIf this seems directed at you or relevant, respond naturally. If it's just background conversation, you can acknowledge briefly or stay quiet.`
      handleUserSpeech(meetingPrompt, ws).catch(e => {
        console.error('Meeting speech handling error:', e.message)
      })
      return
    }

    // Handle user_speech — check for slash commands first, then send to OpenClaw agent
    if (parsed?.type === 'user_speech' && parsed.text) {
      const slashResponse = handleSlashCommand(parsed.text)
      if (slashResponse) {
        // Slash command handled locally — broadcast response with buttons
        const msg = JSON.stringify(slashResponse)
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg)
          }
        }
        return
      }

      handleUserSpeech(parsed.text, ws).catch(e => {
        console.error('User speech handling error:', e.message)
        ws.send(JSON.stringify({ type: 'tts_error', message: e.message }))
      })
      return
    }

    // Don't re-broadcast ack/status messages — they're responses, not commands
    if (parsed?.status) {
      // Status messages are replies to the sender only; don't flood other clients
      return
    }

    // Default: broadcast to all other clients
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg)
      }
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    // Remove from device registry
    for (const [id, info] of devices) {
      if (info.ws === ws) {
        devices.delete(id)
        console.log(`Device unregistered: ${info.name} (${info.deviceType})`)
        broadcastDeviceList()
        break
      }
    }
    console.log(`Client disconnected (${clients.size} total)`)
  })
})

console.log(`WebSocket server running on ws://localhost:${WS_PORT}`)

// stdin relay
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (input: string) => {
  const trimmed = input.trim()
  if (!trimmed) return
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(trimmed)
    }
  }
  console.log(`Sent to ${clients.size} clients: ${trimmed}`)
})
