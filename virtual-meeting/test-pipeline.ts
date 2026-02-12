/**
 * End-to-end meeting pipeline test — measures latency at each step.
 * 
 * Usage: OPENAI_API_KEY=xxx npx tsx virtual-meeting/test-pipeline.ts
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TMP_DIR = '/tmp/meeting-test'
const RECORD_SECONDS = 5

// Read ElevenLabs config
function getElevenLabsKey(): string {
  try {
    const config = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf-8'
    ))
    return config?.skills?.entries?.sag?.apiKey || ''
  } catch { return '' }
}

const ELEVENLABS_KEY = getElevenLabsKey()
const VOICE_ID = 'L5vK1xowu0LZIPxjLSl5'

interface TimingResult {
  step: string
  durationMs: number
  detail?: string
}

const timings: TimingResult[] = []

function time<T>(step: string, fn: () => T): T {
  const start = Date.now()
  const result = fn()
  const elapsed = Date.now() - start
  timings.push({ step, durationMs: elapsed })
  console.log(`  ✓ ${step}: ${elapsed}ms`)
  return result
}

async function timeAsync<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  const result = await fn()
  const elapsed = Date.now() - start
  timings.push({ step, durationMs: elapsed })
  console.log(`  ✓ ${step}: ${elapsed}ms`)
  return result
}

// Step 1: Record audio from BlackHole using sox
function recordAudio(): string {
  const rawPath = path.join(TMP_DIR, 'test_raw.wav')
  const outPath = path.join(TMP_DIR, 'test_16k.wav')
  
  console.log(`\n📡 Recording ${RECORD_SECONDS}s from BlackHole...`)
  
  time('1a. sox record (48kHz stereo)', () => {
    execSync(`rec -q -r 48000 -c 2 -b 16 "${rawPath}" trim 0 ${RECORD_SECONDS}`, { timeout: 15000 })
  })
  
  time('1b. sox downsample (→16kHz mono)', () => {
    execSync(`sox "${rawPath}" -r 16000 -c 1 "${outPath}"`, { timeout: 10000 })
  })

  // Volume check
  const volOut = execSync(
    `ffmpeg -i "${outPath}" -af "volumedetect" -f null /dev/null 2>&1`,
    { encoding: 'utf-8', timeout: 10000 }
  )
  const meanMatch = volOut.match(/mean_volume:\s*([-\d.]+)\s*dB/)
  const maxMatch = volOut.match(/max_volume:\s*([-\d.]+)\s*dB/)
  console.log(`  📊 Volume: mean=${meanMatch?.[1]}dB, max=${maxMatch?.[1]}dB`)
  
  const fSize = fs.statSync(outPath).size
  console.log(`  📁 File: ${outPath} (${(fSize / 1024).toFixed(1)}KB)`)
  
  // Clean up raw
  if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath)
  
  return outPath
}

// Step 2: Transcribe with Whisper
async function transcribe(wavPath: string): Promise<string> {
  console.log('\n🎙️ Transcribing with Whisper...')
  
  const text = await timeAsync('2. Whisper STT', async () => {
    const formData = new FormData()
    const buf = fs.readFileSync(wavPath)
    formData.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav')
    formData.append('model', 'whisper-1')

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })
    const data = await resp.json() as { text: string }
    return data.text?.trim() || ''
  })
  
  console.log(`  📝 Text: "${text}"`)
  return text
}

// Meeting agent system prompt — stored separately so ws-server can use it too
const MEETING_SYSTEM_PROMPT = `You are Reze, a warm and playful girl attending a meeting on behalf of Dongping. You are his AI assistant avatar in Google Meet / video calls.

Rules:
- Keep responses SHORT (1-3 sentences max) — this is a live meeting, not a chat
- Respond naturally in the language of the speaker (Chinese → Chinese, English → English)  
- If the speech is just background noise, music, or irrelevant chatter, reply with exactly: [SKIP]
- If someone asks a question directed at you/Dongping, answer helpfully
- Be warm and professional — you represent Dongping
- Don't mention you're an AI unless directly asked
- Match the tone of the meeting (formal/casual)

Context:
- You are displayed as a VRM 3D avatar in the meeting via virtual camera
- Your voice is generated via TTS and played through virtual microphone
- Dongping can hear everything but you handle the speaking`

// Step 3: AI response via openclaw agent CLI (uses gateway auth, Sonnet 4.5 via session override)
async function getAIResponse(meetingText: string): Promise<string> {
  console.log('\n🧠 Getting AI response (via openclaw agent)...')

  const fullPrompt = `[System Instructions]\n${MEETING_SYSTEM_PROMPT}\n\n[Meeting Audio] A participant said: "${meetingText}"`
  
  const response = await timeAsync('3. AI response (openclaw agent)', async () => {
    const { execSync } = await import('child_process')
    try {
      const result = execSync(
        `openclaw agent --message ${JSON.stringify(fullPrompt)} --json --session-id meeting-chat 2>/dev/null`,
        { encoding: 'utf-8', timeout: 30000 }
      )
      // Parse JSON from CLI output (strip UI decorations)
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
        return parsed?.result?.payloads?.[0]?.text || 'No response'
      }
      return 'Failed to parse response'
    } catch (e: any) {
      console.error('openclaw agent error:', e.message?.slice(0, 200))
      return 'Error getting response'
    }
  })
  
  console.log(`  💬 Response: "${response}"`)
  return response
}

// Step 4: TTS via ElevenLabs
async function generateTTS(text: string): Promise<string> {
  console.log('\n🔊 Generating TTS (ElevenLabs)...')
  
  const audioPath = path.join(TMP_DIR, 'response.mp3')
  
  await timeAsync('4. ElevenLabs TTS', async () => {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    )
    const buf = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(audioPath, buf)
  })
  
  const fSize = fs.statSync(audioPath).size
  console.log(`  📁 Audio: ${audioPath} (${(fSize / 1024).toFixed(1)}KB)`)
  return audioPath
}

// Main test
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  Meeting Pipeline End-to-End Latency Test')
  console.log('═══════════════════════════════════════════')
  
  // Preflight checks
  if (!OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY not set'); process.exit(1) }
  if (!ELEVENLABS_KEY) { console.error('❌ ElevenLabs key not found in openclaw.json'); process.exit(1) }
  
  // Verify openclaw agent is available
  try {
    execSync('which openclaw', { stdio: 'pipe' })
  } catch {
    console.error('❌ openclaw CLI not found')
    process.exit(1)
  }
  
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
  
  const totalStart = Date.now()
  
  // Step 1: Record
  const wavPath = recordAudio()
  
  // Step 2: Transcribe
  const text = await transcribe(wavPath)
  
  if (!text || text.length < 2) {
    console.log('\n⚠️ No speech detected in recording. Play audio and try again.')
    process.exit(0)
  }
  
  // Step 3: AI
  const aiResponse = await getAIResponse(text)
  
  if (aiResponse === '[SKIP]') {
    console.log('\n⏭️ AI decided to skip (irrelevant audio)')
    const totalMs = Date.now() - totalStart
    console.log(`\n⏱️ Total time to decision: ${totalMs}ms`)
    process.exit(0)
  }
  
  // Step 4: TTS
  const audioPath = await generateTTS(aiResponse)
  
  // Summary
  const totalMs = Date.now() - totalStart
  const postRecordMs = totalMs - (RECORD_SECONDS * 1000) // exclude recording wait time
  
  console.log('\n═══════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('═══════════════════════════════════════════')
  console.log('')
  timings.forEach(t => {
    const bar = '█'.repeat(Math.min(40, Math.round(t.durationMs / 100)))
    console.log(`  ${t.step.padEnd(35)} ${String(t.durationMs).padStart(6)}ms ${bar}`)
  })
  console.log('  ─────────────────────────────────────────')
  console.log(`  Total (incl ${RECORD_SECONDS}s recording)${' '.repeat(10)} ${String(totalMs).padStart(6)}ms`)
  console.log(`  Response latency (post-recording)${' '.repeat(4)} ${String(postRecordMs).padStart(6)}ms ← 说完话后等多久`)
  console.log('')
  console.log(`  📝 Heard: "${text}"`)
  console.log(`  💬 Reply: "${aiResponse}"`)
  console.log(`  🔊 Audio: ${audioPath}`)
  console.log('')
}

main().catch(console.error)
