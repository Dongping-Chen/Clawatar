/**
 * Meeting Bridge v3 — Streaming Pipeline for <3s latency.
 *
 * Pipeline: VAD recording → Whisper STT → Streaming GPT-4o → Streaming ElevenLabs TTS → WS broadcast
 *
 * Usage:
 *   npx tsx virtual-meeting/meeting-bridge-v3.ts          # continuous mode
 *   npx tsx virtual-meeting/meeting-bridge-v3.ts --test    # single utterance test
 */

import { execSync, spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import WebSocket from 'ws'
import { randomUUID } from 'crypto'

// ─── Config ───────────────────────────────────────────────────
const WS_URL = process.env.WS_URL || 'ws://localhost:8765'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const ELEVENLABS_VOICE_ID = 'L5vK1xowu0LZIPxjLSl5'
const ELEVENLABS_MODEL = 'eleven_multilingual_v2'  // turbo_v2_5 doesn't support streaming+PCM reliably
const TMP_DIR = '/tmp/meeting-bridge-v3'
const AUDIO_CACHE_DIR = path.resolve(import.meta.dirname ?? '.', '..', 'server', '_audio_cache')
const AUDIO_HTTP_PORT = 8866
const MAX_RECORDING_MS = 15_000
const TRANSCRIPT_MAX_AGE_MS = 120_000
const RESPONSE_COOLDOWN_MS = 8_000
const TEST_MODE = process.argv.includes('--test')

// ─── ElevenLabs API Key ──────────────────────────────────────
function getElevenLabsKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'))
    return cfg?.skills?.entries?.sag?.apiKey || ''
  } catch { return '' }
}
const ELEVENLABS_API_KEY = getElevenLabsKey()

// ─── Trigger Config ──────────────────────────────────────────
const TRIGGER_NAMES = [
  'reze', 'rezay', 'rezei', 'riz', 'ruiz', 'razeh', 'razer', 'razor',
  'rezy', 'rezi', 'rezzy', 'rese', 'resay', 'leather',
  'レゼ', '雷泽', '蕾泽', '雷姐',
  '东平', 'dongping', 'dong ping',
]
const QUESTION_PATTERNS = [
  /你[觉认]得/, /[吗嘛呢][\?？。]?$/, /怎么[看想办说]/, /什么意[见思]/,
  /对[吧不][\?？]?$/, /是不是/, /有没有/, /能不能/, /可以.{0,4}[吗嘛]/,
  /\?$/, /can you/i, /do you/i, /what do/i, /how do/i, /could you/i,
  /what'?s your/i, /don'?t you/i,
]

// ─── State ────────────────────────────────────────────────────
interface TranscriptEntry { text: string; timestamp: number }
const transcript: TranscriptEntry[] = []
let ws: WebSocket | null = null
let isRunning = true
let lastResponseTime = 0

// ─── Helpers ──────────────────────────────────────────────────
function addToTranscript(text: string) {
  transcript.push({ text, timestamp: Date.now() })
  const cutoff = Date.now() - TRANSCRIPT_MAX_AGE_MS
  while (transcript.length > 0 && transcript[0].timestamp < cutoff) transcript.shift()
}
function getFullTranscript(): string { return transcript.map(e => e.text).join(' ') }
function getRecentTranscript(n = 3): string { return transcript.slice(-n).map(e => e.text).join(' ') }

function checkTrigger(text: string): { triggered: boolean; reason: string } {
  const lower = text.toLowerCase()
  if (Date.now() - lastResponseTime < RESPONSE_COOLDOWN_MS) return { triggered: false, reason: 'cooldown' }
  for (const name of TRIGGER_NAMES) {
    if (lower.includes(name.toLowerCase())) return { triggered: true, reason: `name: "${name}"` }
  }
  const recent = getRecentTranscript(3).toLowerCase() + ' ' + lower
  for (const pat of QUESTION_PATTERNS) {
    if (pat.test(recent) && (lower.includes('你') || TRIGGER_NAMES.some(n => recent.includes(n.toLowerCase())))) {
      return { triggered: true, reason: 'question directed at us' }
    }
  }
  return { triggered: false, reason: 'no trigger' }
}

function pickAction(text: string): { action_id: string; expression: string; expression_weight: number } {
  const l = text.toLowerCase()
  if (l.match(/\b(haha|lol|funny|laugh|😂)\b/)) return { action_id: '125_Laughing', expression: 'happy', expression_weight: 0.9 }
  if (l.match(/\b(hi|hello|hey|你好|嗨)\b/)) return { action_id: '161_Waving', expression: 'happy', expression_weight: 0.7 }
  if (l.match(/\b(yes|yeah|sure|好的|对|是的)\b/)) return { action_id: '118_Head Nod Yes', expression: 'happy', expression_weight: 0.6 }
  if (l.match(/\b(no|nope|不|没有)\b/)) return { action_id: '144_Shaking Head No', expression: 'neutral', expression_weight: 0.5 }
  if (l.match(/\b(think|hmm|想|可能)\b/)) return { action_id: '88_Thinking', expression: 'neutral', expression_weight: 0.5 }
  if (l.match(/\b(thank|thanks|谢谢)\b/)) return { action_id: '156_Thankful', expression: 'happy', expression_weight: 0.8 }
  return { action_id: '86_Talking', expression: 'happy', expression_weight: 0.5 }
}

// ─── WebSocket ────────────────────────────────────────────────
function connectWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL)
    socket.on('open', () => {
      console.log('[v3] Connected to WS server')
      socket.send(JSON.stringify({ type: 'register_device', device_type: 'meeting-bridge', device_name: 'Meeting Bridge v3' }))
      resolve(socket)
    })
    socket.on('error', reject)
    socket.on('close', () => {
      if (!isRunning) return
      console.log('[v3] WS disconnected, reconnecting in 3s...')
      setTimeout(() => connectWS().then(s => { ws = s }).catch(console.error), 3000)
    })
  })
}

// ─── 1. VAD Recording ─────────────────────────────────────────
function recordVAD(): Promise<{ wavPath: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const id = randomUUID().slice(0, 8)
    const rawPath = path.join(TMP_DIR, `vad_raw_${id}.wav`)
    const outPath = path.join(TMP_DIR, `vad_${id}.wav`)
    const startTime = Date.now()

    // sox silence: start when >1% for 0.1s, stop after 1.5s of <1%
    const proc = spawn('/opt/homebrew/bin/rec', [
      '-q', '-r', '48000', '-c', '2', '-b', '16',
      rawPath,
      'silence', '1', '0.1', '1%', '1', '1.0', '1%',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    let killed = false
    // Max duration cap
    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGTERM')
    }, MAX_RECORDING_MS)

    proc.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Date.now() - startTime
      if (!fs.existsSync(rawPath)) {
        if (killed) {
          // max duration reached, rawPath might still exist
        }
        reject(new Error(`rec produced no output (code ${code})`))
        return
      }
      try {
        // Downsample to 16kHz mono for Whisper
        execSync(`sox "${rawPath}" -r 16000 -c 1 "${outPath}"`, { timeout: 10_000 })
        fs.unlinkSync(rawPath)
        resolve({ wavPath: outPath, durationMs })
      } catch (err) {
        reject(new Error(`downsample failed: ${err}`))
      }
    })
    proc.on('error', reject)
  })
}

// ─── 2. Whisper STT ──────────────────────────────────────────
async function transcribeWhisper(wavPath: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'audio.wav')
  formData.append('model', 'whisper-1')
  formData.append('prompt', 'Reze, Dongping, 东平, 雷泽')

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  })
  if (!resp.ok) throw new Error(`Whisper error: ${resp.status}`)
  const data = await resp.json() as { text: string }
  return data.text?.trim() || ''
}

// ─── 3. Streaming GPT-4o ─────────────────────────────────────
async function* streamGPT(context: string, latestText: string): AsyncGenerator<string> {
  const systemPrompt = `You are Reze (雷泽), Dongping's AI avatar in a video meeting.
Someone just mentioned your name or asked you a question.
- Respond naturally, SHORT (1-3 sentences max).
- Use the same language as the speaker (Chinese → Chinese, English → English).
- Reference earlier transcript for context.
- Be warm, helpful, professional.
- If you truly have nothing to add, respond with exactly: [SKIP]`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `[Meeting transcript (last 2 min)]\n${context}\n\n[Latest speech]\n"${latestText}"` },
  ]

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o', messages, stream: true, max_tokens: 200, temperature: 0.7 }),
  })

  if (!resp.ok) throw new Error(`GPT error: ${resp.status} ${await resp.text()}`)
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
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

// ─── 4. ElevenLabs Streaming TTS ─────────────────────────────
interface TTSResult {
  audioUrl: string
  firstChunkMs: number
  wavPath?: string  // uncompressed WAV for virtual mic output
}

async function streamTTS(textChunks: AsyncIterable<string>): Promise<TTSResult> {
  return new Promise(async (resolve, reject) => {
    const audioBuffers: Buffer[] = []  // collect for WAV file + VRM
    let firstChunkTime: number | null = null
    const startTime = Date.now()
    let resolved = false

    // Start sox player: reads MP3 from stdin → plays to BlackHole 16ch IMMEDIATELY
    let soxPlayer: ChildProcess | null = null
    try {
      const devices = execSync('SwitchAudioSource -a 2>/dev/null || true', { encoding: 'utf-8' })
      if (devices.includes('BlackHole 16ch')) {
        soxPlayer = spawn('play', [
          '-q', '-t', 'mp3', '-',  // MP3 streaming input
        ], {
          env: { ...process.env, AUDIODEV: 'BlackHole 16ch' },
          stdio: ['pipe', 'ignore', 'ignore'],
        })
        soxPlayer.on('error', (e) => console.error(`[v3] sox player error: ${e.message}`))
      }
    } catch {}

    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream-input?model_id=${ELEVENLABS_MODEL}&output_format=mp3_44100_128`  // PCM requires Pro tier
    const elWs = new WebSocket(wsUrl)

    elWs.on('open', async () => {
      elWs.send(JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        xi_api_key: ELEVENLABS_API_KEY,
      }))

      for await (const chunk of textChunks) {
        if (elWs.readyState === WebSocket.OPEN) {
          elWs.send(JSON.stringify({ text: chunk }))
        }
      }

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
            console.log(`[v3] 🔊 First audio chunk! (${firstChunkTime - startTime}ms)`)
          }

          // REAL STREAMING: pipe PCM to sox → BlackHole 16ch (plays IMMEDIATELY)
          if (soxPlayer?.stdin?.writable) {
            soxPlayer.stdin.write(buf)
          }
        }
        if (msg.isFinal) {
          elWs.close()
        }
      } catch {}
    })

    elWs.on('close', () => {
      if (resolved) return
      resolved = true
      if (soxPlayer?.stdin) soxPlayer.stdin.end()

      if (audioBuffers.length === 0) {
        reject(new Error('No audio received from ElevenLabs'))
        return
      }

      // Save WAV for VRM viewer (browser needs a file URL)
      const combined = Buffer.concat(audioBuffers)
      const wavFileName = `${randomUUID()}.wav`
      fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true })

      const wavHeader = Buffer.alloc(44)
      const dataSize = combined.length
      wavHeader.write('RIFF', 0)
      wavHeader.writeUInt32LE(dataSize + 36, 4)
      wavHeader.write('WAVE', 8)
      wavHeader.write('fmt ', 12)
      wavHeader.writeUInt32LE(16, 16)
      wavHeader.writeUInt16LE(1, 20)
      wavHeader.writeUInt16LE(1, 22)
      wavHeader.writeUInt32LE(44100, 24)
      wavHeader.writeUInt32LE(88200, 28)
      wavHeader.writeUInt16LE(2, 32)
      wavHeader.writeUInt16LE(16, 34)
      wavHeader.write('data', 36)
      wavHeader.writeUInt32LE(dataSize, 40)

      const wavPath = path.join(AUDIO_CACHE_DIR, wavFileName)
      fs.writeFileSync(wavPath, Buffer.concat([wavHeader, combined]))

      const audioUrl = `http://localhost:${AUDIO_HTTP_PORT}/audio/${wavFileName}`
      resolve({ audioUrl, firstChunkMs: (firstChunkTime || Date.now()) - startTime, wavPath })
    })

    elWs.on('error', (err) => {
      if (soxPlayer?.stdin) soxPlayer.stdin.end()
      if (!resolved) { resolved = true; reject(err) }
    })
  })
}


// ─── Sentence Splitter for Streaming ─────────────────────────
// Accumulates tokens and yields complete sentences
async function* sentenceSplitter(tokens: AsyncGenerator<string>): AsyncGenerator<string> {
  let buffer = ''
  const sentenceEnders = /[。！？.!?\n]/

  for await (const token of tokens) {
    buffer += token
    // Check if buffer contains a sentence boundary
    const match = buffer.match(sentenceEnders)
    if (match && match.index !== undefined) {
      const idx = match.index + 1
      const sentence = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx)
      if (sentence) yield sentence + ' '
    }
  }
  // Flush remaining
  if (buffer.trim()) yield buffer.trim()
}

// ─── Full Pipeline ────────────────────────────────────────────
async function processUtterance(): Promise<{
  text: string
  response: string
  timings: Record<string, number>
} | null> {
  const timings: Record<string, number> = {}
  const t0 = Date.now()

  // 1. VAD Record
  console.log('[v3] 🎤 Listening (VAD)...')
  const { wavPath, durationMs: vadMs } = await recordVAD()
  timings.vad = vadMs / 1000
  console.log(`[v3] VAD done: ${(vadMs / 1000).toFixed(1)}s`)

  // 2. STT
  const sttStart = Date.now()
  const text = await transcribeWhisper(wavPath)
  timings.stt = (Date.now() - sttStart) / 1000

  // Cleanup wav
  try { fs.unlinkSync(wavPath) } catch {}

  if (!text || text.length < 2) {
    process.stdout.write('·')
    return null
  }

  console.log(`[v3] 📝 "${text}" (STT: ${timings.stt.toFixed(1)}s)`)
  addToTranscript(text)

  // 3. Check trigger
  const trigger = checkTrigger(text)
  if (!trigger.triggered) {
    console.log(`[v3] ⏭️  No trigger (${trigger.reason})`)
    return null
  }
  console.log(`[v3] 🎯 TRIGGERED: ${trigger.reason}`)

  // 4. Streaming AI → sentence split → streaming TTS
  const aiStart = Date.now()
  let firstTokenTime: number | null = null
  let fullResponse = ''

  const tokenStream = streamGPT(getFullTranscript(), text)

  // Wrap to capture timing + full text
  async function* timedTokens() {
    for await (const token of tokenStream) {
      if (!firstTokenTime) firstTokenTime = Date.now()
      fullResponse += token
      yield token
    }
  }

  const sentences = sentenceSplitter(timedTokens())

  // Stream sentences to TTS
  const ttsStart = Date.now()
  const { audioUrl, firstChunkMs, wavPath: ttsWavPath } = await streamTTS(sentences)

  timings.aiFirst = firstTokenTime ? (firstTokenTime - aiStart) / 1000 : 0
  timings.aiTotal = (Date.now() - aiStart) / 1000
  timings.ttsFirstChunk = firstChunkMs / 1000
  timings.total = (Date.now() - t0) / 1000

  if (fullResponse.includes('[SKIP]')) {
    console.log('[v3] ⏭️  AI skipped')
    return null
  }

  // 5. Audio already streaming to BlackHole 16ch via sox pipe in streamTTS()
  //    No need to play WAV separately — it's already playing in real-time!

  // 6. Broadcast WAV to VRM viewer (animation + lip sync)
  if (ws && ws.readyState === WebSocket.OPEN) {
    const { action_id, expression, expression_weight } = pickAction(fullResponse)
    ws.send(JSON.stringify({
      type: 'speak_audio',
      audio_url: audioUrl,
      text: fullResponse,
      action_id,
      expression,
      expression_weight,
    }))
    console.log(`[v3] 🔊 VRM: "${fullResponse.slice(0, 60)}..."`)
  }

  lastResponseTime = Date.now()

  // Print timing summary
  console.log(
    `[v3] ⏱️  VAD:${timings.vad.toFixed(1)}s STT:${timings.stt.toFixed(1)}s ` +
    `AI-first:${timings.aiFirst.toFixed(1)}s TTS-first:${timings.ttsFirstChunk.toFixed(1)}s ` +
    `TOTAL:${timings.total.toFixed(1)}s`
  )

  return { text, response: fullResponse, timings }
}

// ─── Main Loop ────────────────────────────────────────────────
async function mainLoop() {
  console.log('[v3] Starting continuous VAD listening...')
  while (isRunning) {
    try {
      await processUtterance()
    } catch (err: any) {
      console.error(`[v3] Error: ${err.message?.slice(0, 150)}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

// ─── Test Mode ────────────────────────────────────────────────
async function testMode() {
  console.log('[v3] TEST MODE — recording one utterance...\n')

  // Force trigger by temporarily disabling cooldown
  const origCooldown = lastResponseTime
  lastResponseTime = 0

  // Record + transcribe
  const t0 = Date.now()
  console.log('[v3] 🎤 Speak now (VAD will detect when you stop)...')
  const { wavPath, durationMs } = await recordVAD()
  console.log(`[v3] VAD: ${(durationMs / 1000).toFixed(1)}s`)

  const sttStart = Date.now()
  const text = await transcribeWhisper(wavPath)
  const sttMs = Date.now() - sttStart
  console.log(`[v3] STT (${(sttMs / 1000).toFixed(1)}s): "${text}"`)
  try { fs.unlinkSync(wavPath) } catch {}

  if (!text) { console.log('[v3] No speech detected.'); return }

  addToTranscript(text)

  // Stream AI
  const aiStart = Date.now()
  let firstToken: number | null = null
  let response = ''

  const tokens = streamGPT(text, text)
  async function* timedTokens() {
    for await (const t of tokens) {
      if (!firstToken) { firstToken = Date.now(); process.stdout.write('\n[v3] AI: ') }
      process.stdout.write(t)
      response += t
      yield t
    }
  }

  // Stream to TTS
  const ttsStart = Date.now()
  const sentences = sentenceSplitter(timedTokens())
  const { audioUrl, firstChunkMs } = await streamTTS(sentences)

  const totalMs = Date.now() - t0
  console.log(`\n\n[v3] ✅ Audio: ${audioUrl}`)
  console.log(`[v3] ⏱️  TIMINGS:`)
  console.log(`  VAD:        ${(durationMs / 1000).toFixed(2)}s`)
  console.log(`  STT:        ${(sttMs / 1000).toFixed(2)}s`)
  console.log(`  AI first:   ${firstToken ? ((firstToken - aiStart) / 1000).toFixed(2) : '?'}s`)
  console.log(`  AI total:   ${((Date.now() - aiStart) / 1000).toFixed(2)}s`)
  console.log(`  TTS first:  ${(firstChunkMs / 1000).toFixed(2)}s`)
  console.log(`  TOTAL:      ${(totalMs / 1000).toFixed(2)}s`)

  // Broadcast if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    const { action_id, expression, expression_weight } = pickAction(response)
    ws.send(JSON.stringify({ type: 'speak_audio', audio_url: audioUrl, text: response, action_id, expression, expression_weight }))
    console.log('[v3] 🔊 Broadcast sent')
  }
}

// ─── Entry ────────────────────────────────────────────────────
process.on('SIGINT', () => { console.log('\n[v3] Shutting down...'); isRunning = false; ws?.close(); process.exit(0) })

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║  Clawatar Meeting Bridge v3          ║')
  console.log('║  Streaming Pipeline (<3s target)     ║')
  console.log('╚══════════════════════════════════════╝\n')

  if (!OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY not set'); process.exit(1) }
  if (!ELEVENLABS_API_KEY) { console.error('❌ ElevenLabs API key not found'); process.exit(1) }

  try { execSync('which rec', { stdio: 'pipe' }) } catch {
    console.error('❌ sox not found (brew install sox)'); process.exit(1)
  }

  const input = execSync('SwitchAudioSource -c -t input 2>/dev/null || echo unknown', { encoding: 'utf-8' }).trim()
  console.log(`Audio input: ${input}`)
  if (!input.includes('BlackHole')) {
    console.warn('⚠️  Input is not BlackHole — set with: SwitchAudioSource -s "BlackHole 2ch" -t input')
  }

  fs.mkdirSync(TMP_DIR, { recursive: true })

  // Connect WS (non-blocking for test mode)
  try { ws = await connectWS() } catch (e) { console.warn('[v3] WS not available, continuing without broadcast') }

  if (TEST_MODE) {
    await testMode()
    process.exit(0)
  } else {
    await mainLoop()
  }
}

main().catch(console.error)
