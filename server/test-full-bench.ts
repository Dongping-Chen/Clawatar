/**
 * Full pipeline latency benchmark — measures every retrieval step independently
 * Also stress-tests with synthetic data to predict scaling behavior
 */
import WebSocket from 'ws'
import { EntityStore } from './memory/entity-store.js'
import { FacePersistenceTracker } from './memory/face-tracker.js'
import { NewSpeakerDetector } from './memory/speaker-tracker.js'
import { performance } from 'perf_hooks'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const WS_URL = 'ws://localhost:8765'

// ── Helpers ──

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register_device', deviceId: 'bench-full', deviceType: 'web', name: 'Full Bench' }))
      setTimeout(() => resolve(ws), 500)
    })
    ws.on('error', reject)
  })
}

function waitForType(ws: WebSocket, types: string[], timeoutMs = 30000): Promise<{ msg: any; elapsed: number }> {
  const start = performance.now()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener('message', h); reject(new Error(`timeout ${timeoutMs}ms`)) }, timeoutMs)
    function h(data: any) {
      try {
        const p = JSON.parse(data.toString())
        if (types.includes(p.type)) {
          clearTimeout(timer); ws.removeListener('message', h)
          resolve({ msg: p, elapsed: performance.now() - start })
        }
      } catch {}
    }
    ws.on('message', h)
  })
}

function header(s: string) { console.log(`\n${'='.repeat(50)}\n ${s}\n${'='.repeat(50)}`) }
function sub(s: string) { console.log(`\n--- ${s} ---`) }

// ── 1. Isolated component benchmarks ──

async function benchComponents() {
  header('1. ISOLATED COMPONENT BENCHMARKS')

  // 1a. quickRecall with varying entity counts
  sub('1a. quickRecall scaling (entity count)')
  const tmpDir = `/tmp/bench-entities-${Date.now()}`
  mkdirSync(tmpDir, { recursive: true })
  mkdirSync(join(tmpDir, 'episodes'), { recursive: true })
  mkdirSync(join(tmpDir, 'semantic'), { recursive: true })

  for (const count of [1, 10, 50, 100, 500]) {
    const store = new EntityStore(tmpDir)
    // Seed entities
    for (let i = 0; i < count; i++) {
      store.createEntity({
        type: 'person',
        name: `Person_${i}`,
        aliases: [`alias_${i}`, `别名_${i}`],
        appearanceDescription: `Test entity ${i}`,
      })
    }

    // Benchmark: no match
    const t1: number[] = []
    for (let i = 0; i < 200; i++) {
      const s = performance.now()
      store.quickRecall('Hello how are you today?')
      t1.push(performance.now() - s)
    }

    // Benchmark: match last entity
    const t2: number[] = []
    const target = `Person_${count - 1}`
    for (let i = 0; i < 200; i++) {
      const s = performance.now()
      store.quickRecall(`Tell ${target} I said hello`)
      t2.push(performance.now() - s)
    }

    const avg1 = (t1.reduce((a, b) => a + b) / t1.length).toFixed(3)
    const avg2 = (t2.reduce((a, b) => a + b) / t2.length).toFixed(3)
    const max2 = Math.max(...t2).toFixed(3)
    console.log(`  ${String(count).padStart(3)} entities: no-match=${avg1}ms  match=${avg2}ms  max=${max2}ms`)

    // Cleanup
    try {
      const { execSync } = await import('child_process')
      execSync(`rm -rf "${tmpDir}"`)
      mkdirSync(tmpDir, { recursive: true })
      mkdirSync(join(tmpDir, 'episodes'), { recursive: true })
      mkdirSync(join(tmpDir, 'semantic'), { recursive: true })
    } catch {}
  }

  // 1b. Face tracker with varying tracked faces
  sub('1b. FacePersistenceTracker scaling')
  for (const faceCount of [0, 10, 50, 100]) {
    const tracker = new FacePersistenceTracker()

    // Pre-populate with tracked faces
    const fakeHashes: string[] = []
    for (let i = 0; i < faceCount; i++) {
      const hash = i.toString(16).padStart(16, '0')
      fakeHashes.push(hash)
    }
    if (fakeHashes.length > 0) {
      tracker.ingestFaces(fakeHashes)
    }

    // Benchmark: ingest a new face
    const times: number[] = []
    for (let i = 0; i < 200; i++) {
      const newHash = (faceCount + i + 1000).toString(16).padStart(16, '0')
      const s = performance.now()
      tracker.ingestFaces([newHash])
      times.push(performance.now() - s)
    }

    // Benchmark: getPendingPrompts
    const promptTimes: number[] = []
    for (let i = 0; i < 200; i++) {
      const s = performance.now()
      tracker.getPendingPrompts()
      promptTimes.push(performance.now() - s)
    }

    const avgIngest = (times.reduce((a, b) => a + b) / times.length).toFixed(3)
    const avgPrompt = (promptTimes.reduce((a, b) => a + b) / promptTimes.length).toFixed(3)
    console.log(`  ${String(faceCount).padStart(3)} tracked: ingest=${avgIngest}ms  getPending=${avgPrompt}ms`)
  }

  // 1c. Speaker tracker
  sub('1c. NewSpeakerDetector')
  const speakerTracker = new NewSpeakerDetector()
  const known = new Set<string>(['SPEAKER_00'])

  const stimes: number[] = []
  for (let i = 0; i < 200; i++) {
    const s = performance.now()
    speakerTracker.ingestSpeech(`SPEAKER_${i + 1}`, 1, known)
    stimes.push(performance.now() - s)
  }
  const avgSpeaker = (stimes.reduce((a, b) => a + b) / stimes.length).toFixed(3)

  const ptimes: number[] = []
  for (let i = 0; i < 200; i++) {
    const s = performance.now()
    speakerTracker.getPendingPrompts()
    ptimes.push(performance.now() - s)
  }
  const avgSPending = (ptimes.reduce((a, b) => a + b) / ptimes.length).toFixed(3)
  console.log(`  ingest=${avgSpeaker}ms  getPending=${avgSPending}ms`)

  // 1d. Intro pattern matching
  sub('1d. Introduction pattern detection')
  const introPatterns = [
    /(?:this is|meet|let me introduce)\s+(?:my\s+)?(\w[\w\s]{0,30})/i,
    /(?:这是|介绍一下|认识一下)\s*(?:我的|我们的)?\s*(.{1,20})/,
  ]
  const testTexts = [
    'This is my friend Zhang Wei',
    '这是我同事小李',
    'Hey how are you doing today?',
    'Let me introduce my colleague Sarah',
    'What time is it?',
  ]
  for (const txt of testTexts) {
    const times: number[] = []
    let matched = false
    for (let i = 0; i < 1000; i++) {
      const s = performance.now()
      for (const p of introPatterns) {
        if (p.test(txt)) { matched = true; break }
      }
      times.push(performance.now() - s)
    }
    const avg = (times.reduce((a, b) => a + b) / times.length).toFixed(4)
    console.log(`  "${txt.slice(0, 40).padEnd(40)}" avg=${avg}ms [${matched ? 'INTRO' : 'no'}]`)
  }
}

// ── 2. Full E2E pipeline via WS ──

async function benchE2E() {
  header('2. FULL E2E PIPELINE (via WebSocket)')

  const ws = await connect()
  console.log('  Connected\n')

  const tests = [
    { name: 'A: Normal chat (no retrieval)', text: 'What is the weather like?', camera: false },
    { name: 'B: Entity recall (mentions Dongping)', text: 'What does Dongping usually work on?', camera: false },
    { name: 'C: Visual keyword, camera OFF', text: 'What do you see around you?', camera: false },
    { name: 'D: Visual keyword, camera ON', text: 'What can you see right now?', camera: true },
    { name: 'E: Introduction pattern', text: 'This is my friend Alex, say hi!', camera: false },
  ]

  for (const test of tests) {
    sub(test.name)

    if (test.camera) {
      // Activate camera + send a test frame
      ws.send(JSON.stringify({ type: 'camera_active', active: true }))
      await new Promise(r => setTimeout(r, 500))
      const sharp = (await import('sharp')).default
      const px = Buffer.alloc(320 * 240 * 3, 180)
      const frame = await sharp(px, { raw: { width: 320, height: 240, channels: 3 } }).jpeg({ quality: 60 }).toBuffer()
      ws.send(JSON.stringify({ type: 'camera_frame', image: `data:image/jpeg;base64,${frame.toString('base64')}` }))
      await new Promise(r => setTimeout(r, 1000))
    }

    const overallStart = performance.now()
    const wait = waitForType(ws, ['speak_audio', 'speak'], 45000)
    ws.send(JSON.stringify({ type: 'user_speech', text: test.text }))

    try {
      const { msg, elapsed } = await wait
      const text = (msg.text || '').slice(0, 100)
      console.log(`  First response: ${elapsed.toFixed(0)}ms`)
      console.log(`  Text: "${text}"`)
    } catch (e: any) {
      console.log(`  ⚠️ ${e.message}`)
    }

    if (test.camera) {
      ws.send(JSON.stringify({ type: 'camera_active', active: false }))
    }

    // Cooldown between tests
    await new Promise(r => setTimeout(r, 4000))
  }

  ws.close()
}

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║   Full Pipeline Latency Benchmark        ║')
  console.log('╚══════════════════════════════════════════╝')

  await benchComponents()
  await benchE2E()

  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   Benchmark Complete                     ║')
  console.log('╚══════════════════════════════════════════╝\n')
  process.exit(0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
