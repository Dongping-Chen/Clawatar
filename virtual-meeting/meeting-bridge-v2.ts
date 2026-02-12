/**
 * Meeting Bridge v2 — Continuous listening with smart trigger detection.
 * 
 * Flow:
 *   1. Record 3s chunks continuously (pipelined — records while processing)
 *   2. Transcribe each chunk via Whisper
 *   3. Append to rolling transcript (last 2 min)
 *   4. Check triggers: name mentioned? question directed at us?
 *   5. If triggered → send full context to AI → TTS → broadcast to VRM
 * 
 * Usage: npx tsx virtual-meeting/meeting-bridge-v2.ts
 */

import { execSync, spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import WebSocket from 'ws'

// ─── Config ───────────────────────────────────────────────────
const WS_URL = process.env.WS_URL || 'ws://localhost:8765'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const CHUNK_SECONDS = 3
const TRANSCRIPT_MAX_AGE_MS = 120_000 // keep 2 min of transcript
const SILENCE_THRESHOLD_DB = -50
const TMP_DIR = '/tmp/meeting-bridge'

// Trigger keywords (case-insensitive, checked against transcription)
const TRIGGER_NAMES = [
  // Reze — Whisper transcribes this in MANY different ways
  'reze', 'rezay', 'reh-zay', 'rezei',
  'riz', 'ruiz', 'razeh', 'razer', 'razor',
  'rezy', 'rezi', 'rezzy', 'rese', 'resay',
  'leather',  // yes, Whisper actually hears "leather" sometimes 😂
  'レゼ', '雷泽', '蕾泽', '雷姐',
  // Dongping
  '东平', 'dongping', 'dong ping',
]
// Question patterns (Chinese + English)
const QUESTION_PATTERNS = [
  /你[觉认]得/,  // 你觉得/你认为
  /[吗嘛呢][\?？。]?$/,  // ends with 吗/嘛/呢
  /怎么[看想办说]/,  // 怎么看/怎么想
  /什么意[见思]/,  // 什么意见/意思
  /对[吧不][\?？]?$/,  // 对吧/对不对
  /是不是/,
  /有没有/,
  /能不能/,
  /可以.{0,4}[吗嘛]/,
  /\?$/,  // English question mark
  /can you/i, /do you/i, /what do/i, /how do/i, /could you/i,
  /what'?s your/i, /don'?t you/i,
]

// ─── State ────────────────────────────────────────────────────
interface TranscriptEntry {
  text: string
  timestamp: number
}

let ws: WebSocket | null = null
let isRunning = true
let chunkIndex = 0
const transcript: TranscriptEntry[] = []

// Track when we last responded to avoid rapid-fire
let lastResponseTime = 0
const RESPONSE_COOLDOWN_MS = 8000

// ─── WebSocket ────────────────────────────────────────────────
function connectWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL)
    socket.on('open', () => {
      console.log('[bridge] Connected to WS server')
      socket.send(JSON.stringify({
        type: 'register_device',
        device_type: 'meeting-bridge',
        device_name: 'Meeting Audio Bridge v2',
      }))
      resolve(socket)
    })
    socket.on('error', reject)
    socket.on('close', () => {
      console.log('[bridge] WS disconnected, reconnecting in 3s...')
      setTimeout(() => connectWS().then(s => { ws = s }).catch(console.error), 3000)
    })
  })
}

// ─── Audio Recording (sox/rec) ────────────────────────────────
function recordChunk(index: number): Promise<string> {
  const rawPath = path.join(TMP_DIR, `chunk_raw_${index}.wav`)
  const outPath = path.join(TMP_DIR, `chunk_${index}.wav`)

  return new Promise((resolve, reject) => {
    const proc = spawn('rec', [
      '-q', '-r', '48000', '-c', '2', '-b', '16',
      rawPath, 'trim', '0', String(CHUNK_SECONDS),
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(rawPath)) {
        reject(new Error(`rec failed (code ${code}): ${stderr.slice(-200)}`))
        return
      }
      try {
        execSync(`sox "${rawPath}" -r 16000 -c 1 "${outPath}"`, { timeout: 10000 })
        fs.unlinkSync(rawPath)
        resolve(outPath)
      } catch (err) {
        reject(new Error(`downsample failed: ${err}`))
      }
    })
    proc.on('error', reject)
  })
}

// ─── Speech Detection ─────────────────────────────────────────
function hasSpeech(wavPath: string): boolean {
  try {
    const result = execSync(
      `ffmpeg -i "${wavPath}" -af "volumedetect" -f null /dev/null 2>&1`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    const meanMatch = result.match(/mean_volume:\s*([-\d.]+)\s*dB/)
    if (meanMatch) {
      return parseFloat(meanMatch[1]) > SILENCE_THRESHOLD_DB
    }
  } catch {}
  return true
}

// ─── Whisper Transcription ────────────────────────────────────
async function transcribe(wavPath: string): Promise<string> {
  const formData = new FormData()
  const buf = fs.readFileSync(wavPath)
  formData.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav')
  formData.append('model', 'whisper-1')
  // Prompt helps Whisper recognize proper nouns correctly
  formData.append('prompt', 'Reze, Dongping, 东平, 雷泽')

  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })
    if (!resp.ok) return ''
    const data = await resp.json() as { text: string }
    return data.text?.trim() || ''
  } catch {
    return ''
  }
}

// ─── Transcript Management ────────────────────────────────────
function addToTranscript(text: string) {
  transcript.push({ text, timestamp: Date.now() })
  // Prune old entries
  const cutoff = Date.now() - TRANSCRIPT_MAX_AGE_MS
  while (transcript.length > 0 && transcript[0].timestamp < cutoff) {
    transcript.shift()
  }
}

function getFullTranscript(): string {
  return transcript.map(e => e.text).join(' ')
}

function getRecentTranscript(lastN: number = 5): string {
  return transcript.slice(-lastN).map(e => e.text).join(' ')
}

// ─── Trigger Detection ────────────────────────────────────────
interface TriggerResult {
  triggered: boolean
  reason: string
}

function checkTrigger(latestText: string): TriggerResult {
  const lower = latestText.toLowerCase()

  // Check cooldown
  if (Date.now() - lastResponseTime < RESPONSE_COOLDOWN_MS) {
    return { triggered: false, reason: 'cooldown' }
  }

  // Check name mentions
  for (const name of TRIGGER_NAMES) {
    if (lower.includes(name.toLowerCase())) {
      return { triggered: true, reason: `name: "${name}"` }
    }
  }

  // Check question patterns (on recent transcript, not just latest chunk)
  const recent = getRecentTranscript(3).toLowerCase() + ' ' + lower
  for (const pattern of QUESTION_PATTERNS) {
    if (pattern.test(recent)) {
      // Only trigger on questions if they seem directed (contain a name or "你")
      if (lower.includes('你') || TRIGGER_NAMES.some(n => recent.includes(n.toLowerCase()))) {
        return { triggered: true, reason: `question directed at us` }
      }
    }
  }

  return { triggered: false, reason: 'no trigger' }
}

// ─── AI Response ──────────────────────────────────────────────
async function getAIResponse(context: string, latestText: string): Promise<string> {
  const prompt = `[Meeting Context — Rolling Transcript (last 2 min)]
${context}

[Latest Speech]
"${latestText}"

[Instructions]
You are Reze (雷泽), Dongping's AI avatar in this video meeting.
- Someone just mentioned your name or asked you a question.
- Respond naturally, SHORT (1-3 sentences max).
- Use the same language as the speaker (Chinese → Chinese, English → English).
- You can reference earlier parts of the transcript for context.
- Be warm, helpful, and professional.
- If despite the trigger you truly have nothing to add, say [SKIP].`

  try {
    const raw = execSync(
      `openclaw agent --message ${JSON.stringify(prompt)} --json --session-id meeting-live --thinking off 2>/dev/null`,
      { encoding: 'utf-8', timeout: 30000 }
    )
    let jsonStr = '', braceDepth = 0, inJson = false
    for (const line of raw.split('\n')) {
      if (!inJson && line.trim().startsWith('{')) inJson = true
      if (inJson) {
        jsonStr += line + '\n'
        for (const ch of line) {
          if (ch === '{') braceDepth++
          if (ch === '}') braceDepth--
        }
        if (braceDepth <= 0) break
      }
    }
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr)
      return parsed?.result?.payloads?.[0]?.text || ''
    }
  } catch (e: any) {
    console.error('[bridge] AI error:', e.message?.slice(0, 100))
  }
  return ''
}

// ─── TTS + Broadcast ──────────────────────────────────────────
async function speakResponse(text: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('[bridge] Cannot speak — WS not connected')
    return
  }

  // Send as meeting_response — WS server does TTS + broadcast directly (no AI)
  ws.send(JSON.stringify({
    type: 'meeting_response',
    text,
  }))
  console.log(`  🔊 Sent to TTS`)
}

// ─── Cleanup old chunks ──────────────────────────────────────
function cleanupOldChunks(keepLast: number = 10) {
  const files = fs.readdirSync(TMP_DIR)
    .filter(f => f.startsWith('chunk_') && f.endsWith('.wav'))
    .sort()
  if (files.length > keepLast) {
    for (const f of files.slice(0, files.length - keepLast)) {
      try { fs.unlinkSync(path.join(TMP_DIR, f)) } catch {}
    }
  }
}

// ─── Main Loop ────────────────────────────────────────────────
async function mainLoop() {
  console.log('[bridge] Starting continuous listening...')
  console.log(`[bridge] Chunk: ${CHUNK_SECONDS}s | Transcript window: ${TRANSCRIPT_MAX_AGE_MS / 1000}s`)
  console.log(`[bridge] Triggers: ${TRIGGER_NAMES.join(', ')}`)
  console.log('')

  while (isRunning) {
    const loopStart = Date.now()
    try {
      // 1. Record
      const wavPath = await recordChunk(chunkIndex++)

      // 2. Check for speech
      if (!hasSpeech(wavPath)) {
        process.stdout.write('·')  // silence indicator
        continue
      }

      // 3. Transcribe
      const text = await transcribe(wavPath)
      if (!text || text.length < 2) {
        process.stdout.write('·')
        continue
      }

      // 4. Add to rolling transcript
      addToTranscript(text)
      const elapsed = Date.now() - loopStart
      console.log(`\n[${new Date().toLocaleTimeString()}] (${elapsed}ms) "${text}"`)

      // 5. Check trigger
      const trigger = checkTrigger(text)
      if (trigger.triggered) {
        console.log(`  🎯 TRIGGERED: ${trigger.reason}`)

        // 6. Get AI response with full context
        const t = Date.now()
        const context = getFullTranscript()
        const response = await getAIResponse(context, text)
        const aiMs = Date.now() - t

        if (response && response !== '[SKIP]') {
          console.log(`  💬 (${aiMs}ms) "${response}"`)
          lastResponseTime = Date.now()
          await speakResponse(response)
        } else {
          console.log(`  ⏭️ (${aiMs}ms) AI skipped`)
        }
      }

      // Cleanup
      if (chunkIndex % 20 === 0) cleanupOldChunks()

    } catch (err: any) {
      console.error(`\n[bridge] Error: ${err.message?.slice(0, 100)}`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

// ─── Entry Point ──────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[bridge] Shutting down...')
  isRunning = false
  ws?.close()
  process.exit(0)
})

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║  Clawatar Meeting Bridge v2          ║')
  console.log('║  Continuous Listen + Smart Trigger   ║')
  console.log('╚══════════════════════════════════════╝')
  console.log('')

  // Preflight
  if (!OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY not set'); process.exit(1) }
  try { execSync('which rec', { stdio: 'pipe' }) } catch {
    console.error('❌ sox not found (brew install sox)'); process.exit(1)
  }

  const input = execSync('SwitchAudioSource -c -t input 2>/dev/null || echo unknown', { encoding: 'utf-8' }).trim()
  console.log(`Audio input: ${input}`)
  if (!input.includes('BlackHole')) {
    console.warn('⚠️  Input is not BlackHole — set with: SwitchAudioSource -s "BlackHole 2ch" -t input')
  }

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

  // Connect WS
  ws = await connectWS()

  // Start
  await mainLoop()
}

main().catch(console.error)
