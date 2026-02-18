/**
 * Retrieval latency benchmark
 * Tests quickRecall, visual pipeline, and full message flow
 */
import WebSocket from 'ws'
import { EntityStore } from './memory/entity-store.js'
import { performance } from 'perf_hooks'

const WS_URL = 'ws://localhost:8765'

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register_device', deviceId: 'bench', deviceType: 'web', name: 'Bench' }))
      setTimeout(() => resolve(ws), 300)
    })
    ws.on('error', reject)
  })
}

function collectUntilType(ws: WebSocket, targetType: string, timeoutMs = 30000): Promise<{ msg: any; elapsed: number }> {
  const start = performance.now()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener('message', h); reject(new Error(`timeout ${timeoutMs}ms`)) }, timeoutMs)
    function h(data: any) {
      try {
        const parsed = JSON.parse(data.toString())
        if (parsed.type === targetType) {
          clearTimeout(timer)
          ws.removeListener('message', h)
          resolve({ msg: parsed, elapsed: performance.now() - start })
        }
      } catch {}
    }
    ws.on('message', h)
  })
}

async function benchQuickRecall() {
  console.log('\n=== 1. quickRecall Benchmark ===')
  const store = new EntityStore()
  
  const tests = [
    'Hey how are you?',                          // no match
    'Tell Dongping I said hi',                    // match: Dongping
    '东平你好啊',                                  // match: 东平 (Chinese alias)
    'What did Dongping Chen think about it?',     // match: Dongping Chen
    'Random message with no names at all',        // no match
    'Ask Dongping and Zhang Wei about the plan',  // match: Dongping (Zhang Wei may not exist yet)
  ]

  for (const text of tests) {
    const runs = 100
    const times: number[] = []
    let result = ''
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      result = store.quickRecall(text)
      times.push(performance.now() - start)
    }
    const avg = times.reduce((a, b) => a + b) / times.length
    const max = Math.max(...times)
    const matched = result ? 'MATCH' : 'no match'
    console.log(`  "${text.slice(0, 45).padEnd(45)}" avg=${avg.toFixed(2)}ms max=${max.toFixed(2)}ms [${matched}]`)
  }
}

async function benchFullPipeline() {
  console.log('\n=== 2. Full Pipeline Benchmark (via WS) ===')
  const ws = await connect()

  // Test A: Normal message (no visual, no entity match)
  console.log('\n  --- A: Normal chat (no retrieval) ---')
  const startA = performance.now()
  const waitA = collectUntilType(ws, 'speak_audio', 30000)
  ws.send(JSON.stringify({ type: 'user_speech', text: 'Hey, how are you doing today?' }))
  try {
    const { msg, elapsed } = await waitA
    console.log(`  First speak_audio: ${elapsed.toFixed(0)}ms`)
    console.log(`  Text: "${(msg.text || '').slice(0, 80)}"`)
  } catch (e: any) { console.log(`  ⚠️ ${e.message}`) }

  await new Promise(r => setTimeout(r, 3000)) // cooldown

  // Test B: Message mentioning known entity
  console.log('\n  --- B: Chat mentioning "Dongping" (entity recall) ---')
  const waitB = collectUntilType(ws, 'speak_audio', 30000)
  ws.send(JSON.stringify({ type: 'user_speech', text: 'What do you know about Dongping?' }))
  try {
    const { msg, elapsed } = await waitB
    console.log(`  First speak_audio: ${elapsed.toFixed(0)}ms`)
    console.log(`  Text: "${(msg.text || '').slice(0, 80)}"`)
  } catch (e: any) { console.log(`  ⚠️ ${e.message}`) }

  await new Promise(r => setTimeout(r, 3000))

  // Test C: Visual keyword with camera OFF (should NOT trigger vision)
  console.log('\n  --- C: Visual keyword but camera OFF ---')
  const waitC = collectUntilType(ws, 'speak_audio', 30000)
  ws.send(JSON.stringify({ type: 'user_speech', text: 'What do you see around you?' }))
  try {
    const { msg, elapsed } = await waitC
    console.log(`  First speak_audio: ${elapsed.toFixed(0)}ms`)
    console.log(`  Text: "${(msg.text || '').slice(0, 80)}"`)
  } catch (e: any) { console.log(`  ⚠️ ${e.message}`) }

  await new Promise(r => setTimeout(r, 3000))

  // Test D: Visual keyword with camera ON
  console.log('\n  --- D: Visual keyword + camera ON (full vision pipeline) ---')
  // Create a test frame in the ring buffer
  const sharp = (await import('sharp')).default
  const w = 320, h = 240, ch = 3
  const px = Buffer.alloc(w * h * ch)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch
    px[i] = 180; px[i+1] = 160; px[i+2] = 140  // beige room
  }
  const frameJpeg = await sharp(px, { raw: { width: w, height: h, channels: ch } }).jpeg({ quality: 70 }).toBuffer()
  const frameB64 = `data:image/jpeg;base64,${frameJpeg.toString('base64')}`

  // Activate camera and send frame
  ws.send(JSON.stringify({ type: 'camera_active', active: true }))
  await new Promise(r => setTimeout(r, 500))
  ws.send(JSON.stringify({ type: 'camera_frame', image: frameB64 }))
  await new Promise(r => setTimeout(r, 1000))

  const waitD = collectUntilType(ws, 'speak_audio', 45000)
  ws.send(JSON.stringify({ type: 'user_speech', text: 'What can you see right now?' }))
  try {
    const { msg, elapsed } = await waitD
    console.log(`  First speak_audio: ${elapsed.toFixed(0)}ms`)
    console.log(`  Text: "${(msg.text || '').slice(0, 120)}"`)
  } catch (e: any) { console.log(`  ⚠️ ${e.message}`) }

  // Deactivate camera
  ws.send(JSON.stringify({ type: 'camera_active', active: false }))

  ws.close()
}

async function main() {
  console.log('====================================')
  console.log(' Retrieval Latency Benchmark')
  console.log('====================================')
  
  await benchQuickRecall()
  await benchFullPipeline()
  
  console.log('\n====================================')
  console.log(' Benchmark Complete')
  console.log('====================================\n')
  process.exit(0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
