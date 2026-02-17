#!/usr/bin/env npx tsx
/**
 * Test the streaming-audio pipeline.
 *
 * 1. Connects to WS server
 * 2. Registers a device
 * 3. Enables streaming mode
 * 4. Sends a user_speech message
 * 5. Measures timing of audio_start / audio_chunk / audio_end
 * 6. Compares first-chunk latency with old batch pipeline
 */

import WebSocket from 'ws'

const WS_PORT = 8765
const wsUrl = `ws://localhost:${WS_PORT}`

async function run() {
  console.log('🧪 Streaming Audio Pipeline Test\n')
  console.log(`Connecting to ${wsUrl}...`)

  const ws = new WebSocket(wsUrl)
  const start = Date.now()

  interface Chunk { index: number; ms: number; bytes: number }
  let audioStartMs = 0
  let firstChunkMs = 0
  const chunks: Chunk[] = []
  let audioEndMs = 0
  let fullText = ''
  let sessionId = ''

  const done = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error('❌ Timeout — no audio_end received in 60s')
      reject(new Error('timeout'))
    }, 60000)

    ws.on('message', (raw: Buffer) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }

      switch (msg.type) {
        case 'registered':
          console.log(`✅ Registered: ${msg.deviceId}`)
          break

        case 'streaming_mode':
          console.log(`✅ Streaming mode: ${msg.enabled}`)
          break

        case 'audio_start':
          audioStartMs = Date.now() - start
          sessionId = msg.session_id
          console.log(`🔊 audio_start at ${audioStartMs}ms — action: ${msg.action_id}, text: "${(msg.text || '').slice(0, 60)}"`)
          break

        case 'audio_chunk': {
          const bytes = msg.audio ? Buffer.from(msg.audio, 'base64').length : 0
          const ms = Date.now() - start
          if (chunks.length === 0) {
            firstChunkMs = ms
            console.log(`⚡ FIRST audio_chunk at ${firstChunkMs}ms (${bytes} bytes)`)
          }
          chunks.push({ index: msg.index, ms, bytes })
          if (chunks.length % 10 === 0) {
            process.stdout.write(`  ... ${chunks.length} chunks received (${ms}ms)\r`)
          }
          break
        }

        case 'audio_end':
          audioEndMs = Date.now() - start
          fullText = msg.text || ''
          console.log(`\n✅ audio_end at ${audioEndMs}ms — ${chunks.length} total chunks`)
          console.log(`📝 Full text: "${fullText.slice(0, 120)}${fullText.length > 120 ? '...' : ''}"`)
          clearTimeout(timeout)
          resolve()
          break
      }
    })

    ws.on('error', (e) => { clearTimeout(timeout); reject(e) })
  })

  await new Promise<void>((resolve) => ws.on('open', resolve))
  const connectMs = Date.now() - start
  console.log(`Connected in ${connectMs}ms\n`)

  // 1. Register device
  ws.send(JSON.stringify({
    type: 'register_device',
    deviceId: 'test-streaming',
    deviceType: 'test',
    name: 'Streaming Test Client',
  }))

  await new Promise(r => setTimeout(r, 200))

  // 2. Enable streaming mode
  ws.send(JSON.stringify({ type: 'set_streaming_mode', enabled: true }))

  await new Promise(r => setTimeout(r, 200))

  // 3. Send speech
  const query = process.argv[2] || '你好，今天过得怎么样？'
  console.log(`📤 Sending: "${query}"\n`)
  ws.send(JSON.stringify({
    type: 'user_speech',
    text: query,
    source_device: 'test-streaming',
    force_new_session: true,
  }))

  try {
    await done

    // Summary
    const totalAudioBytes = chunks.reduce((s, c) => s + c.bytes, 0)
    console.log('\n' + '═'.repeat(60))
    console.log('📊 STREAMING PIPELINE RESULTS')
    console.log('═'.repeat(60))
    console.log(`  Connect:           ${connectMs}ms`)
    console.log(`  audio_start:       ${audioStartMs}ms`)
    console.log(`  First audio chunk: ${firstChunkMs}ms  ← THIS IS THE KEY METRIC`)
    console.log(`  audio_end:         ${audioEndMs}ms`)
    console.log(`  Total chunks:      ${chunks.length}`)
    console.log(`  Total audio:       ${(totalAudioBytes / 1024).toFixed(1)} KB`)
    console.log(`  Full text:         ${fullText.length} chars`)
    console.log('─'.repeat(60))
    console.log(`  🎯 First sound at: ${firstChunkMs}ms`)
    console.log(`     (batch pipeline was ~3900ms for simple chat)`)
    console.log(`     (batch pipeline was ~4200ms for tool calls)`)
    if (firstChunkMs < 3000) {
      console.log(`  ✅ ${((3900 - firstChunkMs) / 3900 * 100).toFixed(0)}% faster than batch!`)
    }
    console.log('═'.repeat(60))
  } catch {
    // timeout handled above
  }

  ws.close()
  process.exit(0)
}

run().catch(e => { console.error('Fatal:', e); process.exit(1) })
