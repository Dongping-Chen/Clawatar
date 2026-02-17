/**
 * Test streaming pipeline latency with instant ack.
 * 
 * When Gateway takes >2s (tool calls), plays a quick ack immediately,
 * then streams the real response.
 * 
 * Usage: npx tsx virtual-meeting/test-streaming.ts [prompt]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import WebSocket from 'ws'

// Config
const CONFIG_PATH = resolve(import.meta.dirname ?? '.', '..', 'clawatar.config.json')
let config: any = {}
try { config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) } catch {}

const GATEWAY_PORT = config.openclaw?.gatewayPort || 18789
const GATEWAY_TOKEN = (() => {
  try {
    const c = JSON.parse(readFileSync(join(process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'))
    return c?.gateway?.auth?.token || ''
  } catch { return '' }
})()

const VOICE_ID = config.voice?.elevenlabsVoiceId || 'L5vK1xowu0LZIPxjLSl5'
const MODEL_ID = config.voice?.elevenlabsModel || 'eleven_turbo_v2_5'
const API_KEY = (() => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  try {
    const c = JSON.parse(readFileSync(join(process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'))
    return c?.skills?.entries?.sag?.apiKey || ''
  } catch { return '' }
})()

const OUT_DIR = '/tmp/streaming-test'
mkdirSync(OUT_DIR, { recursive: true })

const ACK_THRESHOLD_MS = 2000
const ACK_PHRASES_ZH = ['让我看看～', '我查一下哦～', '稍等一下～', '嗯，让我想想…']
const ACK_PHRASES_EN = ["Let me check~", "One sec~", "Hmm, let me look..."]

function pickAck(text: string): string {
  const zh = /[\u4e00-\u9fff]/.test(text)
  const p = zh ? ACK_PHRASES_ZH : ACK_PHRASES_EN
  return p[Math.floor(Math.random() * p.length)]
}

// --- Stream from Gateway ---
async function* streamFromGateway(prompt: string): AsyncGenerator<string> {
  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': 'streaming-test',
    },
    body: JSON.stringify({
      model: 'openclaw', stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
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

// --- Sentence Splitter ---
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

// --- Non-streaming TTS (for ack) ---
async function quickTTS(text: string): Promise<string> {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'accept': 'audio/mpeg', 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { stability: 0.45, similarity_boost: 0.75 } }),
  })
  if (!resp.ok) throw new Error(`TTS error ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const p = join(OUT_DIR, `ack-${randomUUID()}.mp3`)
  writeFileSync(p, buf)
  return p
}

// --- Streaming TTS ---
async function streamingTTS(sentences: AsyncIterable<string>): Promise<{ mp3Path: string; firstChunkMs: number }> {
  return new Promise(async (resolve, reject) => {
    const audioBuffers: Buffer[] = []
    let firstChunkTime: number | null = null
    const startTime = Date.now()
    let resolved = false
    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=${MODEL_ID}&output_format=mp3_44100_128`
    const elWs = new WebSocket(wsUrl)
    elWs.on('open', async () => {
      elWs.send(JSON.stringify({ text: ' ', voice_settings: { stability: 0.45, similarity_boost: 0.75 }, xi_api_key: API_KEY }))
      for await (const sentence of sentences) {
        if (elWs.readyState === WebSocket.OPEN) elWs.send(JSON.stringify({ text: sentence }))
      }
      if (elWs.readyState === WebSocket.OPEN) elWs.send(JSON.stringify({ text: '' }))
    })
    elWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.audio) { audioBuffers.push(Buffer.from(msg.audio, 'base64')); if (!firstChunkTime) firstChunkTime = Date.now() }
        if (msg.isFinal) elWs.close()
      } catch {}
    })
    elWs.on('close', () => {
      if (resolved) return; resolved = true
      if (audioBuffers.length === 0) { reject(new Error('No audio')); return }
      const mp3Path = join(OUT_DIR, `resp-${randomUUID()}.mp3`)
      writeFileSync(mp3Path, Buffer.concat(audioBuffers))
      resolve({ mp3Path, firstChunkMs: (firstChunkTime || Date.now()) - startTime })
    })
    elWs.on('error', (err) => { if (!resolved) { resolved = true; reject(err) } })
  })
}

// --- Main ---
async function main() {
  const prompt = process.argv[2] || '你好！简单介绍一下你自己，两句话就好。'
  
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║  Streaming Pipeline + Instant Ack Latency Test  ║')
  console.log('╚══════════════════════════════════════════════════╝\n')
  console.log(`Prompt: "${prompt}"\n`)

  const t0 = Date.now()
  let fullText = ''
  let firstTokenTime: number | null = null
  let ackSent = false
  let ackMp3 = ''
  let ackMs = 0

  // Start streaming from Gateway
  const tokenIterator = streamFromGateway(prompt)

  // Race: first token vs ack threshold
  const firstResult = await Promise.race([
    tokenIterator.next(),
    new Promise<'timeout'>(r => setTimeout(() => r('timeout'), ACK_THRESHOLD_MS)),
  ])

  if (firstResult === 'timeout') {
    // Slow response (tool call likely) — send ack TTS immediately
    const ackText = pickAck(prompt)
    console.log(`⚡ ACK (${Date.now() - t0}ms): "${ackText}" — Gateway slow, sending instant ack`)
    const ackStart = Date.now()
    ackMp3 = await quickTTS(ackText)
    ackMs = Date.now() - ackStart
    ackSent = true
    console.log(`🔊 Ack TTS done in ${ackMs}ms: ${ackMp3}`)
  }

  // Collect all tokens
  async function* allTokens() {
    if (firstResult !== 'timeout') {
      const r = firstResult as IteratorResult<string>
      if (!r.done && r.value) {
        if (!firstTokenTime) { firstTokenTime = Date.now(); process.stdout.write('\n   AI: ') }
        process.stdout.write(r.value)
        fullText += r.value
        yield r.value
      }
      if (r.done) return
    }
    for await (const token of tokenIterator) {
      if (!firstTokenTime) { firstTokenTime = Date.now(); console.log(`\n⚡ First token: ${firstTokenTime - t0}ms`); process.stdout.write('   AI: ') }
      process.stdout.write(token)
      fullText += token
      yield token
    }
    console.log('\n')
  }

  const sentences = sentenceSplitter(allTokens())
  const { mp3Path, firstChunkMs } = await streamingTTS(sentences)
  const totalMs = Date.now() - t0

  console.log('═══════════════════════════════════════')
  console.log(`⏱️  TIMINGS:`)
  if (ackSent) console.log(`  🗣️  Ack sent:     ${ACK_THRESHOLD_MS}ms (user hears feedback!)`)
  if (ackSent) console.log(`  🗣️  Ack TTS:      ${ackMs}ms`)
  console.log(`  ⚡ First token:   ${firstTokenTime ? firstTokenTime - t0 : '?'}ms`)
  console.log(`  🔊 TTS 1st chunk: ${firstChunkMs}ms`)
  console.log(`  📊 TOTAL:         ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`)
  console.log(`\n📝 Text: "${fullText.trim().slice(0, 120)}..."`)
  if (ackSent) console.log(`🔊 Ack MP3: ${ackMp3}`)
  console.log(`🔊 Response MP3: ${mp3Path}`)
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
