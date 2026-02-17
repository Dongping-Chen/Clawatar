/**
 * Meeting Bridge v3 — Streaming Pipeline for <3s latency.
 *
 * Pipeline: VAD recording → Whisper STT → OpenClaw (orchestrated model) → ElevenLabs TTS → WS broadcast
 *
 * All AI responses route through OpenClaw Gateway — no direct LLM API calls.
 * The Gateway handles model selection, session management, and context.
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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''  // Used for Whisper STT only
const ELEVENLABS_VOICE_ID = 'L5vK1xowu0LZIPxjLSl5'
const ELEVENLABS_MODEL = 'eleven_multilingual_v2'  // turbo_v2_5 doesn't support streaming+PCM reliably
const TMP_DIR = '/tmp/meeting-bridge-v3'
const AUDIO_CACHE_DIR = path.resolve(import.meta.dirname ?? '.', '..', 'server', '_audio_cache')
const AUDIO_HTTP_PORT = 8866
const MAX_RECORDING_MS = 15_000
const TRANSCRIPT_MAX_AGE_MS = 600_000
const RESPONSE_COOLDOWN_MS = 5_000
const PROACTIVE_SILENCE_MS = 10_000
const PROACTIVE_COOLDOWN_MS = 20_000
const SPEAKER_CHANGE_PAUSE_MS = 1_800
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
  // ─── English: correct pronunciations ───
  'reze', 'rezay', 'rezei', 'reza', 'rezé', 'rèze',
  // ─── English: common Whisper mishearings (R→L, R→W, vowel shifts) ───
  'leze', 'lezay', 'lesay', 'lezy', 'lezi', 'leza', 'lezey',
  'riz', 'ruiz', 'rees', 'reese', 'reis', 'race', 'raise',
  'razeh', 'razer', 'razor', 'raser', 'raiser',
  'rezy', 'rezi', 'rezzy', 'rese', 'resay', 'reezy', 'reezay',
  'leather', 'laser', 'leaser', 'leisure', 'lesser',
  'weze', 'wezay', 'wezy',  // W→R confusion
  'rezee', 'rezzay', 'rezei', 'rezae', 'rezah',
  'lets say', 'let say',  // Whisper sometimes hears "let's say" for "Reze"
  'rz', 'rez', 'rez-ay', 'reh-zay', 'reh zay', 're zay', 're-ze',
  // ─── English: phonetic fragments (partial matches) ───
  'risey', 'risay', 'rizay', 'rizei', 'rizzay',
  'rezzy', 'rezi', 'rezie', 'reseh', 'resey',
  'rachel',  // surprisingly common Whisper output for "Reze"
  'raizay', 'raizei', 'razay', 'razei',
  // ─── Chinese: all possible transcriptions ───
  '雷泽', '蕾泽', '雷姐', '蕾姐', '蕾泽',
  '瑞泽', '锐泽', '芮泽', '蕊泽', '睿泽',
  '雷则', '蕾则', '雷择', '蕾择',
  '雷哲', '蕾哲', '芮哲',
  '雷贼', '蕾贼',  // Whisper sometimes
  '来泽', '来则', '来哲',  // L sound in Chinese
  '累泽', '类泽',
  '礼泽', '力泽', '丽泽', '莉泽', '利泽',
  '磊泽', '蕾丝', // partial matches
  'reze', // pinyin
  // ─── Chinese: Dongping's name ───
  '东平', '冬平', '东萍', '东坪', '冬萍', '东屏',
  '洞平', '懂平', '动平',
  // ─── English: Dongping mishearings ───
  'dongping', 'dong ping', 'dong-ping', 'dongpin',
  'dumping', 'donping', 'tong ping', 'tongping',
  'dung ping', 'dopping', 'dong thing', 'dong king',
  // ─── Japanese: レゼ and variations ───
  'レゼ', 'れぜ', 'レゼー', 'れぜー',
  'レーゼ', 'れーぜ', 'レイゼ', 'れいぜ',
  'レセ', 'れせ', 'レジ', 'れじ', // close sounds
  'レズ', 'れず', // mishearing
  // ─── Japanese: phonetic ───
  'reze', 'reje', 'rese',  // romaji
  // ─── Korean (just in case) ───
  '레제', '레즈', '레세',
  // ─── Direct address patterns (not names but signal they're talking to the avatar) ───
  'hey avatar', 'hi avatar', 'hello avatar',
  'hey assistant', 'hi assistant', 'hello assistant',
  'hey ai', 'hi ai', 'hello ai',
  'hey bot', 'hi bot',
  '你好助手', '助手你好', 'AI同学', 'AI你好',
  'アシスタント', 'アバター',
]
const QUESTION_PATTERNS = [
  // ─── Chinese question patterns ───
  /你[觉认]得/, /[吗嘛呢么][\?？。]?$/, /怎么[看想办说样做]/, /什么意[见思]/,
  /是怎[么样]/, /怎样/, /如何/, /为什么/, /为啥/, /咋[回样办]/, /干[嘛啥吗]/,
  /对[吧不][\?？]?$/, /是不是/, /有没有/, /能不能/, /可以.{0,4}[吗嘛]/,
  /什么时候/, /哪[里个些]/, /多[少长久大]/, /谁[是来的]?/,
  /[说讲聊谈]一?[说讲聊谈下]/, /介绍[一下]*/, /解释[一下]*/,
  /好不好/, /行不行/, /要不要/, /想不想/, /对不对/,
  /知[不道]道/, /[了解明白清楚].*[吗嘛]/, /[觉认]为/,
  /意[见思]/, /看法/, /观点/, /[建意]议/, /[想看]法/,
  // ─── English question patterns ───
  /\?$/, /\?[\s"']*$/,
  /\bcan you\b/i, /\bdo you\b/i, /\bwhat do\b/i, /\bhow do\b/i, /\bcould you\b/i,
  /\bwhat'?s your\b/i, /\bdon'?t you\b/i, /\bwould you\b/i, /\bshould we\b/i,
  /\bwhat about\b/i, /\bhow about\b/i, /\bwhat if\b/i,
  /\bdo you think\b/i, /\bwhat do you think\b/i, /\bhow do you feel\b/i,
  /\bcan someone\b/i, /\bdoes anyone\b/i, /\banyone know\b/i,
  /\btell (me|us)\b/i, /\bexplain\b/i, /\bdescribe\b/i,
  /\bwhat is\b/i, /\bwhat are\b/i, /\bwho is\b/i, /\bwhere is\b/i,
  /\bwhen (is|do|did|will|should)\b/i, /\bwhy (is|do|did|would|should)\b/i,
  /\bhow (is|do|did|would|should|can|could|many|much|long|far)\b/i,
  /\bis (it|this|that|there)\b/i, /\bare (you|we|they|there)\b/i,
  /\bthoughts\b/i, /\bopinion\b/i, /\bfeedback\b/i, /\bsuggestion\b/i,
  /\bany idea\b/i, /\bany question\b/i, /\bany comment\b/i,
  // ─── Japanese question patterns ───
  /[ますかの][\?？]?$/, /でしょうか/, /ですか/, /ませんか/,
  /どう[思考]/, /なぜ/, /なんで/, /どうして/, /何が/, /誰が/, /いつ/,
  /どこ/, /どれ/, /どの/, /どんな/, /いかが/,
]

// ─── State ────────────────────────────────────────────────────
interface TranscriptEntry {
  text: string
  timestamp: number
  speaker: string
}
type ResponseMode = 'triggered' | 'proactive'

const transcript: TranscriptEntry[] = []
let ws: WebSocket | null = null
let isRunning = true
let lastResponseTime = 0
let responseCooldownUntil = 0
let lastSpeechTime = 0
let isSpeaking = false  // Echo suppression: true while TTS is playing
let lastProactiveTime = 0
let inferredSpeakerIndex = 1
let currentSpeaker = `Speaker ${inferredSpeakerIndex}`

// ─── Helpers ──────────────────────────────────────────────────
function addToTranscript(text: string) {
  const now = Date.now()
  if (lastSpeechTime > 0 && now - lastSpeechTime >= SPEAKER_CHANGE_PAUSE_MS) {
    inferredSpeakerIndex += 1
    currentSpeaker = `Speaker ${inferredSpeakerIndex}`
  }
  transcript.push({ text, timestamp: now, speaker: currentSpeaker })
  lastSpeechTime = now
  const cutoff = Date.now() - TRANSCRIPT_MAX_AGE_MS
  while (transcript.length > 0 && transcript[0].timestamp < cutoff) transcript.shift()
}
function getFullTranscript(): string { return transcript.map(e => e.text).join(' ') }
function getRecentTranscript(n = 3): string { return transcript.slice(-n).map(e => e.text).join(' ') }
function getStructuredTranscript(): string {
  return transcript.map((e) => {
    const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false })
    return `[${time}] ${e.speaker}: ${e.text}`
  }).join('\n')
}
function hasSpokenRecently(windowMs = PROACTIVE_COOLDOWN_MS): boolean {
  return Date.now() - lastResponseTime < windowMs
}
function detectArithmeticError(text: string): string | null {
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*xX])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  const left = Number(match[1])
  const op = match[2]
  const right = Number(match[3])
  const claimed = Number(match[4])
  const expected = op === '+' ? left + right : op === '-' ? left - right : left * right
  if (Number.isFinite(expected) && Number.isFinite(claimed) && Math.abs(expected - claimed) > 1e-9) {
    return `${left} ${op} ${right} = ${claimed} (expected ${expected})`
  }
  return null
}

function checkTrigger(text: string): { triggered: boolean; reason: string } {
  const now = Date.now()
  const lower = text.toLowerCase()
  if (now < responseCooldownUntil) return { triggered: false, reason: 'cooldown' }

  // 1. Name match — highest priority
  for (const name of TRIGGER_NAMES) {
    if (lower.includes(name.toLowerCase())) return { triggered: true, reason: `name: "${name}"` }
  }

  // 2. Direct commands / requests to the avatar (even without name)
  const directCommandPatterns = [
    /自我介绍/, /介绍[一下]*你/, /你.{0,4}介绍/, /你.{0,4}说[一下说]/, 
    /你能做什么/, /你会什么/, /你[是做]什么/, /你的背景/, /你的功能/, /你的能力/,
    /tell (me|us) about (yourself|you)/i, /introduce yourself/i, /what can you do/i,
    /what are you/i, /who are you/i, /describe yourself/i,
    /自己紹介/, /あなたは誰/, /何ができる/,
    /需要你/, /请你/, /帮我/, /给我/,  // requests directed at "you"
    /\byour (background|ability|feature|function|capability)\b/i,
  ]
  for (const pat of directCommandPatterns) {
    if (pat.test(text)) return { triggered: true, reason: 'direct command/request' }
  }

  // 3. Question + "你" (directed at us) in recent context
  const recent = getRecentTranscript(3).toLowerCase() + ' ' + lower
  for (const pat of QUESTION_PATTERNS) {
    if (pat.test(recent) && (lower.includes('你') || TRIGGER_NAMES.some(n => recent.includes(n.toLowerCase())))) {
      return { triggered: true, reason: 'question directed at us' }
    }
  }

  // 4. Group questions (anyone / everyone / team)
  const groupQuestionPatterns = [
    /\b(anyone|someone|team|folks|everyone|any thoughts|what do you all think)\b/i,
    /大家[觉得怎么看想法]/, /有人知道/, /我们[觉得怎么看想法]/,
    /谁[能会可]/, /哪位/,
  ]
  const directedElsewherePatterns = [
    /@\w+/,
    /\b(can you|could you|what do you think),?\s+(john|mike|sarah|professor|老师|同学)\b/i,
  ]
  const looksLikeQuestion = QUESTION_PATTERNS.some((p) => p.test(lower))
  const directedElsewhere = directedElsewherePatterns.some((p) => p.test(text))
  const asksGroup = groupQuestionPatterns.some((p) => p.test(text))
  // Only trigger on explicit group questions (大家/anyone/everyone), NOT general questions
  if (asksGroup && !hasSpokenRecently()) {
    return { triggered: true, reason: 'group question' }
  }

  // 5. Factual correction
  const arithmeticError = detectArithmeticError(text)
  if (arithmeticError && !hasSpokenRecently(10_000)) {
    return { triggered: true, reason: `polite factual correction (${arithmeticError})` }
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

// ─── Play audio to BlackHole 16ch (meeting participants hear avatar) ───
async function playToBlackHole(audioUrl: string) {
  try {
    const devices = execSync('SwitchAudioSource -a 2>/dev/null || true', { encoding: 'utf-8' })
    if (!devices.includes('BlackHole 16ch')) {
      console.log('[v3] ⚠️ BlackHole 16ch not available')
      return
    }
    // Download audio file and play through BlackHole 16ch
    const tmpFile = path.join(TMP_DIR, `bh_${Date.now()}.wav`)
    const resp = await fetch(audioUrl)
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(tmpFile, buf)
    
    // Echo suppression: mark as speaking so VAD ignores our own voice
    isSpeaking = true
    console.log('[v3] 🔇 Echo suppression ON')
    
    const player = spawn('play', ['-q', tmpFile], {
      env: { ...process.env, AUDIODEV: 'BlackHole 16ch' },
      stdio: 'ignore',
    })
    player.on('close', () => {
      // Add extra 1.5s buffer after playback ends to catch tail echo
      setTimeout(() => {
        isSpeaking = false
        console.log('[v3] 🔊 Echo suppression OFF')
      }, 1500)
      try { fs.unlinkSync(tmpFile) } catch {}
    })
    player.on('error', (e) => {
      isSpeaking = false
      console.error(`[v3] BlackHole play error: ${e.message}`)
    })
  } catch (e: any) {
    isSpeaking = false
    console.error(`[v3] playToBlackHole error: ${e.message}`)
  }
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
  // Check for empty audio (BlackHole with no input)
  const stat = fs.statSync(wavPath)
  if (stat.size <= 44) {  // WAV header only = no audio data
    console.log('[v3] ⚠️ Empty audio file, skipping Whisper')
    return ''
  }
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

// AI responses are handled entirely by OpenClaw Gateway (via WS → meeting_speech → Gateway API).
// No direct LLM API calls — the Gateway handles model selection, context, and persona.

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

/**
 * Send triggered/proactive speech to WS server → OpenClaw main session (full context).
 * WS server handles TTS + broadcast. Bridge listens for speak_audio back → plays to BlackHole.
 */
async function runResponse(mode: ResponseMode, latestText: string, triggerReason: string, timings: Record<string, number>, t0: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[v3] ⚠️ WS not connected, cannot send to OpenClaw')
    return null
  }

  const sendTime = Date.now()
  const transcriptContext = getStructuredTranscript()

  // Send to WS server as meeting_speech — WS server routes to OpenClaw main session
  ws.send(JSON.stringify({
    type: 'meeting_speech',
    text: latestText,
    transcript: transcriptContext,
    reason: triggerReason,
    mode,
  }))

  console.log(`[v3] 📤 Sent to OpenClaw (${mode}): "${latestText.slice(0, 60)}..."`)

  // Wait for speak_audio response from WS server (OpenClaw → TTS → broadcast → back to us)
  const responsePromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      ws?.removeListener('message', handler)
      console.log('[v3] ⏰ Response timeout (60s)')
      resolve(null)
    }, 60_000)

    function handler(data: any) {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'speak_audio' && msg.audio_url) {
          clearTimeout(timeout)
          ws?.removeListener('message', handler)
          console.log(`[v3] 🔊 Got response: "${(msg.text || '').slice(0, 60)}..."`)
          
          // Play audio to BlackHole 16ch so meeting participants hear it
          playToBlackHole(msg.audio_url).catch(e => console.error(`[v3] BlackHole play error: ${e.message}`))
          
          resolve(msg.text || '')
        }
      } catch {}
    }
    ws?.on('message', handler)
  })

  const responseText = await responsePromise
  
  timings.total = (Date.now() - t0) / 1000
  timings.roundTrip = (Date.now() - sendTime) / 1000

  if (!responseText) {
    console.log(`[v3] ⏭️  No response (${mode})`)
    if (mode === 'proactive') lastProactiveTime = Date.now()
    return null
  }

  const now = Date.now()
  lastResponseTime = now
  responseCooldownUntil = now + (mode === 'proactive' ? PROACTIVE_COOLDOWN_MS : RESPONSE_COOLDOWN_MS)
  if (mode === 'proactive') lastProactiveTime = now

  console.log(
    `[v3] ⏱️  VAD:${timings.vad.toFixed(1)}s STT:${timings.stt.toFixed(1)}s ` +
    `RT:${timings.roundTrip.toFixed(1)}s TOTAL:${timings.total.toFixed(1)}s`
  )

  return responseText
}

// ─── Full Pipeline ────────────────────────────────────────────
async function processUtterance(): Promise<{
  text: string
  response: string
  mode: ResponseMode
  timings: Record<string, number>
} | null> {
  const timings: Record<string, number> = {}
  const t0 = Date.now()

  // 0. Echo suppression — skip if we're currently playing TTS
  if (isSpeaking) {
    console.log('[v3] 🔇 Skipping (echo suppression — TTS playing)')
    await new Promise(r => setTimeout(r, 1000))
    return null
  }

  // 1. VAD Record
  console.log('[v3] 🎤 Listening (VAD)...')
  const { wavPath, durationMs: vadMs } = await recordVAD()
  timings.vad = vadMs / 1000
  console.log(`[v3] VAD done: ${(vadMs / 1000).toFixed(1)}s`)

  // Echo suppression — if we started speaking during VAD recording, discard
  if (isSpeaking) {
    console.log('[v3] 🔇 Discarding (TTS started during recording)')
    try { fs.unlinkSync(wavPath) } catch {}
    return null
  }

  // 2. STT
  const sttStart = Date.now()
  const text = await transcribeWhisper(wavPath)
  timings.stt = (Date.now() - sttStart) / 1000

  // Cleanup wav
  try { fs.unlinkSync(wavPath) } catch {}

  if (!text || text.length < 2) {
    const now = Date.now()
    const silenceMs = lastSpeechTime > 0 ? now - lastSpeechTime : 0
    const transcriptChars = getFullTranscript().length
    const proactiveEligible =
      transcriptChars > 200 &&
      silenceMs >= PROACTIVE_SILENCE_MS &&
      now >= responseCooldownUntil &&
      (lastProactiveTime === 0 || now - lastProactiveTime >= PROACTIVE_COOLDOWN_MS)

    if (proactiveEligible) {
      console.log(`[v3] 🤫 Silence ${silenceMs}ms, proactive contribution...`)
      const response = await runResponse('proactive', '', `silence>${PROACTIVE_SILENCE_MS}ms`, timings, t0)
      if (response) return { text: '', response, mode: 'proactive', timings }
      return null
    }
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

  const response = await runResponse('triggered', text, trigger.reason, timings, t0)
  if (!response) return null
  return { text, response, mode: 'triggered', timings }
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
  console.log('[v3] TEST MODE — recording one utterance, routing through OpenClaw...\n')

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('❌ WS not connected — OpenClaw routing requires WS server')
    process.exit(1)
  }

  // Force trigger by temporarily disabling cooldown
  lastResponseTime = 0
  responseCooldownUntil = 0

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

  // Route through OpenClaw via WS server (same path as production)
  const timings: Record<string, number> = { vad: durationMs / 1000, stt: sttMs / 1000 }
  const response = await runResponse('triggered', text, 'test mode', timings, t0)

  const totalMs = Date.now() - t0
  console.log(`\n[v3] ⏱️  TIMINGS:`)
  console.log(`  VAD:        ${(durationMs / 1000).toFixed(2)}s`)
  console.log(`  STT:        ${(sttMs / 1000).toFixed(2)}s`)
  console.log(`  Round-trip: ${(timings.roundTrip || 0).toFixed(2)}s`)
  console.log(`  TOTAL:      ${(totalMs / 1000).toFixed(2)}s`)

  if (response) {
    console.log(`[v3] ✅ Response: "${response.slice(0, 100)}..."`)
  } else {
    console.log('[v3] ⏭️ No response')
  }
}

// ─── Entry ────────────────────────────────────────────────────
process.on('SIGINT', () => { console.log('\n[v3] Shutting down...'); isRunning = false; ws?.close(); process.exit(0) })

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║  Clawatar Meeting Bridge v3          ║')
  console.log('║  Streaming Pipeline (<3s target)     ║')
  console.log('╚══════════════════════════════════════╝\n')

  if (!OPENAI_API_KEY) { console.warn('⚠️  OPENAI_API_KEY not set — Whisper STT will fail. Set it for speech transcription.') }
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
