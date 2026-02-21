#!/usr/bin/env npx tsx
/**
 * End-to-end chain latency test (send-based timing).
 *
 * Measures:
 *   send user_speech -> audio_start
 *   send user_speech -> first audio_chunk
 *   send user_speech -> audio_end
 *
 * Usage:
 *   npx tsx test-chain-latency.ts
 *   npx tsx test-chain-latency.ts "你好，简单问候一句" "帮我查一下今天纽约天气"
 *   WS_URL=ws://localhost:8765 npx tsx test-chain-latency.ts
 */

import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:8765'
const DEFAULT_PROMPTS = [
  '你好，简单问候一句',
  '帮我查一下今天纽约天气',
]

interface CaseMetrics {
  prompt: string
  audioStartMs: number
  firstChunkMs: number
  audioEndMs: number
  chunkCount: number
  textLength: number
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      ws.off('open', onOpen)
      reject(error)
    }
    const onOpen = () => {
      ws.off('error', onError)
      resolve()
    }
    ws.once('error', onError)
    ws.once('open', onOpen)
  })
}

async function runCase(prompt: string, index: number): Promise<CaseMetrics> {
  const ws = new WebSocket(WS_URL)
  await waitForOpen(ws)

  const deviceId = `latency-test-${Date.now()}-${index}`
  let registered = false
  let streamingConfirmed = false

  let sendAt = 0
  let audioStartMs = -1
  let firstChunkMs = -1
  let audioEndMs = -1
  let chunkCount = 0
  let finalTextLength = 0

  const done = new Promise<CaseMetrics>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timeout waiting for audio_end'))
    }, 70_000)

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: Record<string, any>
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (msg.type === 'registered' && msg.deviceId === deviceId) {
        registered = true
        ws.send(JSON.stringify({ type: 'set_streaming_mode', enabled: true }))
        return
      }

      if (msg.type === 'streaming_mode' && msg.enabled === true && registered) {
        streamingConfirmed = true
        sendAt = Date.now()
        ws.send(JSON.stringify({
          type: 'user_speech',
          text: prompt,
          source_device: deviceId,
          force_new_session: true,
        }))
        return
      }

      if (!streamingConfirmed || sendAt <= 0) {
        return
      }

      if (msg.type === 'audio_start' && audioStartMs < 0) {
        audioStartMs = Date.now() - sendAt
        return
      }

      if (msg.type === 'audio_chunk') {
        chunkCount += 1
        if (firstChunkMs < 0) {
          firstChunkMs = Date.now() - sendAt
        }
        return
      }

      if (msg.type === 'audio_end') {
        audioEndMs = Date.now() - sendAt
        finalTextLength = typeof msg.text === 'string' ? msg.text.length : 0
        clearTimeout(timeout)
        resolve({
          prompt,
          audioStartMs: audioStartMs < 0 ? firstChunkMs : audioStartMs,
          firstChunkMs,
          audioEndMs,
          chunkCount,
          textLength: finalTextLength,
        })
      }
    })
  })

  ws.send(JSON.stringify({
    type: 'register_device',
    deviceId,
    deviceType: 'test',
    name: 'Latency Test Client',
  }))

  try {
    const result = await done
    ws.close(1000)
    return result
  } catch (error) {
    ws.close(1000)
    throw error
  }
}

async function main() {
  const prompts = process.argv.slice(2)
  const tests = prompts.length > 0 ? prompts : DEFAULT_PROMPTS

  console.log('🧪 Chain Latency Test (send-based timing)')
  console.log(`🔌 WS: ${WS_URL}`)

  const results: CaseMetrics[] = []
  for (let i = 0; i < tests.length; i += 1) {
    const prompt = tests[i]
    console.log(`\n[Case ${i + 1}] ${prompt}`)
    const metrics = await runCase(prompt, i)
    results.push(metrics)
    console.log(
      `  ✅ audio_start=${metrics.audioStartMs}ms | first_chunk=${metrics.firstChunkMs}ms | audio_end=${metrics.audioEndMs}ms | chunks=${metrics.chunkCount}`,
    )
  }

  const avg = (items: number[]) => Math.round(items.reduce((s, x) => s + x, 0) / items.length)
  const avgStart = avg(results.map((r) => r.audioStartMs))
  const avgFirst = avg(results.map((r) => r.firstChunkMs))
  const avgEnd = avg(results.map((r) => r.audioEndMs))

  console.log('\n📊 Summary')
  console.log('────────────────────────────────────────────────────────')
  for (const result of results) {
    console.log(
      `• ${result.prompt} | start=${result.audioStartMs}ms | first=${result.firstChunkMs}ms | end=${result.audioEndMs}ms | chunks=${result.chunkCount}`,
    )
  }
  console.log('────────────────────────────────────────────────────────')
  console.log(`AVG | start=${avgStart}ms | first=${avgFirst}ms | end=${avgEnd}ms`)
}

main().catch((error: any) => {
  console.error(`❌ ${error?.message || error}`)
  process.exit(1)
})
