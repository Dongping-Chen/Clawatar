/**
 * Meeting Bridge — Captures meeting audio, transcribes via Whisper, routes AI responses.
 * 
 * Usage: npx tsx virtual-meeting/meeting-bridge.ts
 * 
 * Prerequisites:
 * - BlackHole-2ch installed and system audio routed through Multi-Output Device
 * - WS server running on :8765
 * - OPENAI_API_KEY set (for Whisper transcription)
 */

import { execSync, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:8765'
const WHISPER_API_KEY = process.env.OPENAI_API_KEY || ''
const CAPTURE_DURATION = 5  // seconds per chunk
const SILENCE_THRESHOLD = 0.01
const TMP_DIR = '/tmp/meeting-audio'

// Ensure tmp dir exists
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

let ws: WebSocket | null = null
let isListening = true
let chunkIndex = 0

function connectWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL)
    socket.on('open', () => {
      console.log('[meeting-bridge] Connected to WS server')
      socket.send(JSON.stringify({
        type: 'register_device',
        device_type: 'meeting-bridge',
        device_name: 'Virtual Meeting Audio Capture',
      }))
      resolve(socket)
    })
    socket.on('error', reject)
    socket.on('close', () => {
      console.log('[meeting-bridge] WS disconnected, reconnecting in 3s...')
      setTimeout(() => connectWS().then(s => { ws = s }).catch(console.error), 3000)
    })
  })
}

/**
 * Record a chunk of audio from BlackHole using sox/rec (CoreAudio).
 * ffmpeg avfoundation drops ~72% of audio frames — sox is reliable.
 * Records at 48kHz stereo, then downsamples to 16kHz mono for Whisper.
 */
function recordChunk(index: number): Promise<string> {
  const rawPath = path.join(TMP_DIR, `chunk_raw_${index}.wav`)
  const outPath = path.join(TMP_DIR, `chunk_${index}.wav`)
  
  return new Promise((resolve, reject) => {
    // Step 1: Record with sox/rec at native 48kHz stereo from BlackHole
    const proc = spawn('rec', [
      '-q',                    // quiet mode
      '-r', '48000',           // native sample rate
      '-c', '2',               // stereo (BlackHole is stereo)
      '-b', '16',              // 16-bit
      rawPath,
      'trim', '0', String(CAPTURE_DURATION),
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    
    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(rawPath)) {
        reject(new Error(`rec failed (code ${code}): ${stderr.slice(-200)}`))
        return
      }
      
      try {
        // Step 2: Downsample to 16kHz mono for Whisper
        execSync(`sox "${rawPath}" -r 16000 -c 1 "${outPath}"`, { timeout: 10000 })
        // Clean up raw file
        fs.unlinkSync(rawPath)
        resolve(outPath)
      } catch (err) {
        reject(new Error(`sox downsample failed: ${err}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Check if audio chunk contains actual speech (not silence).
 */
function hasSpeech(wavPath: string): boolean {
  try {
    // Use ffmpeg to get audio volume stats
    const result = execSync(
      `ffmpeg -i "${wavPath}" -af "volumedetect" -f null /dev/null 2>&1`,
      { encoding: 'utf-8', timeout: 10000 }
    )
    const meanMatch = result.match(/mean_volume:\s*([-\d.]+)\s*dB/)
    if (meanMatch) {
      const meanVolume = parseFloat(meanMatch[1])
      // -50 dB is rough threshold for "has speech" vs "silence"
      return meanVolume > -50
    }
  } catch {
    // If volume detection fails, assume there's speech
  }
  return true
}

/**
 * Transcribe audio chunk via OpenAI Whisper API.
 */
async function transcribe(wavPath: string): Promise<string> {
  if (!WHISPER_API_KEY) {
    console.warn('[meeting-bridge] No OPENAI_API_KEY — skipping transcription')
    return ''
  }

  const formData = new FormData()
  const audioBuffer = fs.readFileSync(wavPath)
  formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav')
  formData.append('model', 'whisper-1')
  formData.append('language', 'zh')  // Force Chinese — meeting is in Chinese

  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHISPER_API_KEY}` },
      body: formData,
    })
    
    if (!resp.ok) {
      console.error('[meeting-bridge] Whisper API error:', resp.status, await resp.text())
      return ''
    }
    
    const data = await resp.json() as { text: string }
    return data.text?.trim() || ''
  } catch (err) {
    console.error('[meeting-bridge] Transcription failed:', err)
    return ''
  }
}

/**
 * Send transcribed meeting speech to AI via WebSocket.
 */
function sendToAI(text: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[meeting-bridge] WS not connected')
    return
  }
  
  console.log(`[meeting-bridge] Meeting speech: "${text}"`)
  
  ws.send(JSON.stringify({
    type: 'meeting_speech',
    text,
    source: 'meeting-audio',
    timestamp: Date.now(),
  }))
}

/**
 * Main capture loop — record → check speech → transcribe → send to AI.
 */
async function captureLoop() {
  console.log('[meeting-bridge] Starting capture loop...')
  console.log(`[meeting-bridge] Recording ${CAPTURE_DURATION}s chunks from BlackHole`)
  
  while (isListening) {
    try {
      const wavPath = await recordChunk(chunkIndex++)
      
      // Check if chunk has actual speech
      if (!hasSpeech(wavPath)) {
        // Silence — clean up and continue
        fs.unlinkSync(wavPath)
        continue
      }
      
      // Transcribe
      const text = await transcribe(wavPath)
      
      // Keep audio files for debugging (delete old ones to save space)
      const oldChunk = path.join(TMP_DIR, `chunk_${chunkIndex - 10}.wav`)
      if (fs.existsSync(oldChunk)) fs.unlinkSync(oldChunk)
      
      if (text && text.length > 2) {
        sendToAI(text)
      }
    } catch (err) {
      console.error('[meeting-bridge] Capture error:', err)
      // Wait a bit before retrying
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[meeting-bridge] Shutting down...')
  isListening = false
  ws?.close()
  process.exit(0)
})

// Main
async function main() {
  console.log('=== Clawatar Virtual Meeting Bridge ===')
  console.log(`WS Server: ${WS_URL}`)
  console.log(`Whisper API: ${WHISPER_API_KEY ? 'configured' : 'NOT SET (set OPENAI_API_KEY)'}`)
  console.log('')
  
  // Check sox/rec (required — ffmpeg avfoundation drops audio frames)
  try {
    execSync('which rec', { stdio: 'pipe' })
    console.log('sox/rec: found')
  } catch {
    console.error('ERROR: sox not found. Install with: brew install sox')
    process.exit(1)
  }
  
  // Check BlackHole
  try {
    const devices = execSync('SwitchAudioSource -a 2>/dev/null || true', { encoding: 'utf-8' })
    if (devices.includes('BlackHole')) {
      console.log('BlackHole audio device: detected')
    } else {
      console.warn('WARNING: BlackHole audio device not found.')
      console.warn('Install: brew install --cask blackhole-2ch && reboot')
    }
  } catch {
    console.warn('Could not list audio devices')
  }
  
  // Check sox can record from BlackHole
  try {
    const input = execSync('SwitchAudioSource -c -t input 2>/dev/null || true', { encoding: 'utf-8' }).trim()
    console.log(`Current audio input: ${input}`)
    if (!input.includes('BlackHole')) {
      console.warn('WARNING: System audio input is not BlackHole.')
      console.warn('Set it with: SwitchAudioSource -s "BlackHole 2ch" -t input')
    }
  } catch {
    // ignore
  }
  
  // Connect to WS server
  ws = await connectWS()
  
  // Start capture loop
  await captureLoop()
}

main().catch(console.error)
