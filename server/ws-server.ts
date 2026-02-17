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

// --- Bridge endpoint: POST /bridge/speak — push text to VRM for TTS + animation ---
// Used by OpenClaw main session to bridge replies to VRM
audioServer.on('request', (req: any, res: any) => {
  // Already handled by createServer callback above for /audio/ routes
})

const bridgeServer = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

  // POST /bridge/speak — push a reply to VRM with TTS
  if (req.method === 'POST' && req.url === '/bridge/speak') {
    let body = ''
    req.on('data', (chunk: string) => { body += chunk })
    req.on('end', async () => {
      try {
        const { text, audio_device } = JSON.parse(body)
        if (!text) { res.writeHead(400); res.end('Missing text'); return }

        console.log(`[bridge] Speaking: "${text.slice(0, 80)}..." (audio_device: ${audio_device || 'all'})`)
        const { action_id, expression, expression_weight } = pickAction(text)

        try {
          const audioUrl = await generateTTS(text)
          const msg: any = { type: 'speak_audio', audio_url: audioUrl, text, action_id, expression, expression_weight }
          if (audio_device) msg.audio_device = audio_device
          const msgStr = JSON.stringify(msg)
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) client.send(msgStr)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, action_id, audio_url: audioUrl }))
        } catch (e: any) {
          // TTS failed — still send text with animation
          const msg = JSON.stringify({ type: 'speak', text, action_id, expression, expression_weight })
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) client.send(msg)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, action_id, tts_error: e.message }))
        }
      } catch (e: any) {
        res.writeHead(400)
        res.end(e.message)
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const BRIDGE_PORT = config.server?.bridgePort || 8867

bridgeServer.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Bridge port ${BRIDGE_PORT} in use, trying ${BRIDGE_PORT + 1}...`)
    bridgeServer.listen(BRIDGE_PORT + 1)
  } else {
    console.error('Bridge server error:', err)
  }
})

bridgeServer.listen(BRIDGE_PORT, () => {
  console.log(`Bridge HTTP server on http://localhost:${BRIDGE_PORT}`)
})

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

// --- Streaming Gateway + TTS Pipeline ---

/**
 * Quick acknowledgment phrases — played immediately while Gateway processes tools.
 * Gives instant feedback so user doesn't wait 5-15s in silence.
 */
const ACK_PHRASES_ZH = [
  '让我看看～', '我查一下哦～', '稍等一下～', '嗯，让我想想…', '好的，等我一下～',
]
const ACK_PHRASES_EN = [
  "Let me check~", "One sec~", "Hmm, let me look...", "Sure, give me a moment~",
]

function pickAckPhrase(text: string): string {
  const isChinese = /[\u4e00-\u9fff]/.test(text)
  const phrases = isChinese ? ACK_PHRASES_ZH : ACK_PHRASES_EN
  return phrases[Math.floor(Math.random() * phrases.length)]
}

/**
 * Stream tokens from OpenClaw Gateway (SSE).
 * Yields individual content tokens as they arrive.
 */
async function* streamFromGateway(
  messages: Array<{ role: string; content: string }>,
  sessionKey: string = 'vrm-chat',
): AsyncGenerator<string> {
  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({ model: 'openclaw', stream: true, messages }),
  })
  if (!resp.ok) throw new Error(`Gateway ${resp.status}: ${await resp.text()}`)

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const json = JSON.parse(line.slice(6))
        const token = json.choices?.[0]?.delta?.content
        if (token) yield token
      } catch {}
    }
  }
}

/**
 * Split streaming tokens into complete sentences for TTS.
 */
async function* sentenceSplitter(tokens: AsyncGenerator<string>): AsyncGenerator<string> {
  let buffer = ''
  const enders = /[。！？.!?\n]/

  for await (const token of tokens) {
    buffer += token
    const match = buffer.match(enders)
    if (match && match.index !== undefined) {
      const idx = match.index + 1
      const sentence = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx)
      if (sentence) yield sentence + ' '
    }
  }
  if (buffer.trim()) yield buffer.trim()
}

/**
 * Streaming TTS: feeds sentence chunks to ElevenLabs WebSocket API,
 * collects MP3 audio, saves to cache, returns URL.
 * Starts generating audio as soon as the first sentence arrives.
 */
async function streamingTTS(sentences: AsyncIterable<string>): Promise<{ audioUrl: string; firstChunkMs: number }> {
  if (!API_KEY) throw new Error('No ElevenLabs API key')

  return new Promise(async (resolve, reject) => {
    const audioBuffers: Buffer[] = []
    let firstChunkTime: number | null = null
    const startTime = Date.now()
    let resolved = false

    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=${MODEL_ID}&output_format=mp3_44100_128`
    const elWs = new WebSocket(wsUrl)

    elWs.on('open', async () => {
      // Initial handshake
      elWs.send(JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        xi_api_key: API_KEY,
      }))

      // Feed sentences as they arrive from AI
      for await (const sentence of sentences) {
        if (elWs.readyState === WebSocket.OPEN) {
          elWs.send(JSON.stringify({ text: sentence }))
        }
      }

      // Signal end of text
      if (elWs.readyState === WebSocket.OPEN) {
        elWs.send(JSON.stringify({ text: '' }))
      }
    })

    elWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.audio) {
          const buf = Buffer.from(msg.audio, 'base64')
          audioBuffers.push(buf)
          if (!firstChunkTime) {
            firstChunkTime = Date.now()
            console.log(`[streaming-tts] First audio chunk: ${firstChunkTime - startTime}ms`)
          }
        }
        if (msg.isFinal) elWs.close()
      } catch {}
    })

    elWs.on('close', () => {
      if (resolved) return
      resolved = true
      if (audioBuffers.length === 0) { reject(new Error('No audio from ElevenLabs')); return }
      const combined = Buffer.concat(audioBuffers)
      const fileName = `${randomUUID()}.mp3`
      writeFileSync(join(AUDIO_CACHE_DIR, fileName), combined)
      pruneCache()
      const audioUrl = `http://localhost:${actualAudioPort}/audio/${fileName}`
      resolve({ audioUrl, firstChunkMs: (firstChunkTime || Date.now()) - startTime })
    })

    elWs.on('error', (err) => { if (!resolved) { resolved = true; reject(err) } })
  })
}

/**
 * Voice-mode system prompt: instructs the model to always speak a brief
 * acknowledgment BEFORE calling any tool. This ensures the SSE stream
 * emits tokens immediately, eliminating silent gaps during tool execution.
 */
const VOICE_SYSTEM_PROMPT = `You are in VOICE MODE — your response will be spoken aloud via TTS.
Critical rules:
1. ALWAYS say a brief phrase BEFORE using any tool (e.g. "让我看看～", "我查一下哦"). This gives immediate audio feedback.
2. NO markdown (**bold**, # headers, | tables, \`code\`, - bullets). TTS reads these literally and it sounds terrible.
3. Keep it SHORT — 2-4 sentences max unless asked for detail. This is a conversation, not an essay.
4. Speak naturally, like talking to a friend. No emoji, no URLs.`

/**
 * Full streaming pipeline with voice-mode system prompt.
 * 
 * The voice system prompt ensures the model always says something before
 * tool calls, so the SSE stream produces tokens immediately instead of
 * going silent for 5-15s during tool execution.
 * 
 * Fallback: if first token still takes >ACK_THRESHOLD_MS, send a hardcoded ack.
 */
const ACK_THRESHOLD_MS = 3000  // Raised since model should now ack naturally

async function streamingPipeline(
  messages: Array<{ role: string; content: string }>,
  sessionKey: string = 'vrm-chat',
  opts?: { broadcastAck?: (audioUrl: string, text: string) => void; inputText?: string },
): Promise<{ text: string; audioUrl: string; firstChunkMs: number; ackSent: boolean }> {
  // Prepend voice-mode system prompt
  messages = [{ role: 'system', content: VOICE_SYSTEM_PROMPT }, ...messages]
  let fullText = ''
  let ackSent = false

  // Race: first token vs ack timeout
  const tokenIterator = streamFromGateway(messages, sessionKey)
  const firstResult = await Promise.race([
    tokenIterator.next(),
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), ACK_THRESHOLD_MS)),
  ])

  if (firstResult === 'timeout' && opts?.broadcastAck) {
    // Gateway is slow (likely tool call) — send ack immediately
    const ackText = pickAckPhrase(opts.inputText || '')
    try {
      const ackAudioUrl = await generateTTS(ackText)
      opts.broadcastAck(ackAudioUrl, ackText)
      ackSent = true
      console.log(`[streaming] Ack sent: "${ackText}"`)
    } catch (e: any) {
      console.error(`[streaming] Ack TTS failed: ${e.message}`)
    }
  }

  // Now collect all tokens (including the first if we got it from the race)
  async function* allTokens() {
    if (firstResult !== 'timeout') {
      const r = firstResult as IteratorResult<string>
      if (!r.done && r.value) {
        fullText += r.value
        yield r.value
      }
      if (r.done) return
    }
    for await (const token of tokenIterator) {
      fullText += token
      yield token
    }
  }

  const sentences = sentenceSplitter(allTokens())
  const { audioUrl, firstChunkMs } = await streamingTTS(sentences)

  return { text: fullText.trim(), audioUrl, firstChunkMs, ackSent }
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

async function handleUserSpeech(text: string, senderWs: WebSocket, sourceDevice?: string) {
  console.log(`User said: "${text}" (from device: ${sourceDevice || 'unknown'})`)
  const startTime = Date.now()
  const audioDevice = sourceDevice || undefined

  try {
    // Ack callback: broadcasts a quick acknowledgment if Gateway is slow (tool calls)
    const broadcastAck = (ackAudioUrl: string, ackText: string) => {
      const ackMsg: any = {
        type: 'speak_audio', audio_url: ackAudioUrl, text: ackText,
        action_id: '88_Thinking', expression: 'neutral', expression_weight: 0.5,
      }
      if (audioDevice) ackMsg.audio_device = audioDevice
      const ackMsgStr = JSON.stringify(ackMsg)
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(ackMsgStr)
      }
    }

    // Full streaming pipeline with instant ack
    const { text: response, audioUrl, firstChunkMs, ackSent } = await streamingPipeline(
      [{ role: 'user', content: text }],
      'vrm-chat',
      { broadcastAck, inputText: text },
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[streaming] Response in ${elapsed}s (TTS first chunk: ${firstChunkMs}ms, ack: ${ackSent}): "${response.slice(0, 80)}..."`)

    if (!response || response.includes('NO_REPLY') || response.includes('HEARTBEAT_OK')) {
      console.log('[streaming] No actionable response')
      return
    }

    const { action_id, expression, expression_weight } = pickAction(response)
    const audioMsg: any = { type: 'speak_audio', audio_url: audioUrl, text: response, action_id, expression, expression_weight }
    if (audioDevice) audioMsg.audio_device = audioDevice
    const audioMsgStr = JSON.stringify(audioMsg)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(audioMsgStr)
    }
    console.log(`[streaming] Broadcast: ${action_id}, ${expression}, device: ${audioDevice || 'all'}`)
  } catch (e: any) {
    console.error('[streaming] Pipeline error:', e.message)
    // Fallback: non-streaming
    try {
      const response = await askOpenClaw(text)
      const { action_id, expression, expression_weight } = pickAction(response)
      const audioUrl = await generateTTS(response)
      const audioMsg: any = { type: 'speak_audio', audio_url: audioUrl, text: response, action_id, expression, expression_weight }
      if (audioDevice) audioMsg.audio_device = audioDevice
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(audioMsg))
      }
    } catch (fallbackErr: any) {
      console.error('[streaming] Fallback also failed:', fallbackErr.message)
      const fallbackMsg = JSON.stringify({ type: 'speak', text: "Sorry, I'm having trouble right now.", action_id: '88_Thinking', expression: 'neutral', expression_weight: 0.5 })
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(fallbackMsg)
      }
    }
  }
}

/**
 * Handle meeting speech — routes through OpenClaw Gateway HTTP API (streaming).
 * Uses x-openclaw-session-key to maintain a persistent meeting session with full context.
 */
async function handleMeetingSpeech(prompt: string, senderWs: WebSocket) {
  console.log(`[meeting] Streaming pipeline...`)
  const startTime = Date.now()

  try {
    const broadcastAck = (ackAudioUrl: string, ackText: string) => {
      const ackMsg = JSON.stringify({
        type: 'speak_audio', audio_url: ackAudioUrl, text: ackText,
        action_id: '88_Thinking', expression: 'neutral', expression_weight: 0.5,
        audio_device: 'meeting',
      })
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(ackMsg)
      }
    }

    const { text: response, audioUrl, firstChunkMs, ackSent } = await streamingPipeline(
      [{ role: 'user', content: prompt }],
      'meeting-avatar',
      { broadcastAck, inputText: prompt },
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[meeting] Done in ${elapsed}s (TTS first chunk: ${firstChunkMs}ms, ack: ${ackSent}): "${response.slice(0, 100)}..."`)

    if (!response || response.length < 2 || response.includes('NO_REPLY') || response.includes('HEARTBEAT_OK')) {
      console.log('[meeting] No actionable response')
      return
    }

    const { action_id, expression, expression_weight } = pickAction(response)
    const audioMsg = JSON.stringify({
      type: 'speak_audio', audio_url: audioUrl, text: response,
      action_id, expression, expression_weight, audio_device: 'meeting',
    })
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(audioMsg)
    }
    console.log(`[meeting] Broadcast: ${action_id}, ${expression}`)
  } catch (e: any) {
    console.error('[meeting] Streaming pipeline error:', e.message)
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

function findDeviceIdByWs(targetWs: WebSocket): string | undefined {
  for (const [id, info] of devices) {
    if (info.ws === targetWs) return id
  }
  return undefined
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

    // Relay speak_audio from meeting bridge (or any client) to all OTHER clients
    if (parsed?.type === 'speak_audio' && parsed.audio_url) {
      console.log(`[relay] speak_audio: "${(parsed.text || '').slice(0, 60)}..."`)
      const raw = typeof data === 'string' ? data : data.toString()
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(raw)
        }
      }
      return
    }

    // Handle meeting_speech — transcribed audio from virtual meeting bridge
    // Routes through OpenClaw MAIN session (full context: MEMORY.md, SOUL.md, project knowledge)
    if (parsed?.type === 'meeting_speech' && parsed.text) {
      const transcript = parsed.transcript || ''
      const reason = parsed.reason || 'triggered'
      const mode = parsed.mode || 'triggered'
      console.log(`[meeting] ${mode}: "${parsed.text.slice(0, 80)}..." (${reason})`)
      
      const meetingPrompt = mode === 'proactive'
        ? `[MEETING MODE — Proactive] You are currently in a live Google Meet meeting as a virtual avatar. There's been a pause. Based on the transcript, share a brief insight or ask a question. Be concise (1-2 sentences). If nothing to add, just say one short sentence acknowledging the pause.\n\n[Meeting Transcript]\n${transcript}\n\n[Respond in the same language as the meeting.]`
        : `[MEETING MODE — Triggered] You are currently in a live Google Meet meeting as a virtual avatar. Someone just spoke and it's directed at you or relevant. Respond naturally using your full knowledge.\n\n[Meeting Transcript]\n${transcript}\n\n[Latest speech] "${parsed.text}"\n[Trigger reason] ${reason}\n\n[IMPORTANT: Keep response concise (2-4 sentences). Use the same language as the speaker. Reference your knowledge of the Clawatar project, your capabilities, development timeline, etc. when relevant.]`
      
      handleMeetingSpeech(meetingPrompt, ws).catch(e => {
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

      // Pass source_device for focus-based audio routing
      const sourceDevice = parsed.source_device || findDeviceIdByWs(ws)
      handleUserSpeech(parsed.text, ws, sourceDevice).catch(e => {
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
