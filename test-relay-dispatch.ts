#!/usr/bin/env npx tsx
/**
 * Relay dispatch regression + latency test.
 *
 * Verifies direct dispatch logic introduced in ws-server:
 * 1) user_speech -> /gateway_speak ... (speak)
 * 2) user_speech -> /gateway_speak speak_audio ... (speak_audio or speak fallback)
 * 3) meeting_speech -> /gateway_speak ... (speak)
 *
 * Also reports per-case chain latency (send -> routed command received).
 *
 * Usage:
 *   npx tsx test-relay-dispatch.ts
 *   WS_URL=ws://localhost:8765 npx tsx test-relay-dispatch.ts
 */

import WebSocket from 'ws'

const WS_URL = process.env.WS_URL || 'ws://localhost:8765'
const TIMEOUT_MS = 20_000

type RelayCommandType = 'speak' | 'speak_audio' | 'tts_audio'

interface EventRecord {
  at: number
  msg: Record<string, any>
}

interface CaseResult {
  name: string
  ok: boolean
  latencyMs?: number
  routeType?: string
  routedAudioDevice?: string
  ackLatencyMs?: number
  error?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOpen(ws: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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

function waitForEvent(
  events: EventRecord[],
  startIndex: number,
  predicate: (msg: Record<string, any>) => boolean,
  timeoutMs: number,
): Promise<EventRecord> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs

    const tick = () => {
      for (let i = startIndex; i < events.length; i += 1) {
        const event = events[i]
        if (predicate(event.msg)) {
          resolve(event)
          return
        }
      }

      if (Date.now() >= deadline) {
        reject(new Error(`timeout after ${timeoutMs}ms`))
        return
      }
      setTimeout(tick, 20)
    }

    tick()
  })
}

function isRoutedSpeak(msg: Record<string, any>): boolean {
  if (!msg || typeof msg !== 'object') return false
  return msg.type === 'speak' || msg.type === 'speak_audio' || msg.type === 'tts_audio'
}

async function runUserSpeechCase(
  ws: WebSocket,
  events: EventRecord[],
  sourceDeviceId: string,
  options: {
    name: string
    prompt: string
    expectedText: string
    expectedAudioDevice: string
    allowFallbackToSpeak?: boolean
  },
): Promise<CaseResult> {
  const baseIndex = events.length
  const sentAt = Date.now()
  ws.send(JSON.stringify({
    type: 'user_speech',
    text: options.prompt,
    source_device: sourceDeviceId,
  }))

  try {
    const routed = await waitForEvent(
      events,
      baseIndex,
      (msg) => {
        if (!isRoutedSpeak(msg)) return false
        if ((msg.text || '') !== options.expectedText) return false
        if ((msg.audio_device || '') !== options.expectedAudioDevice) return false

        if (options.allowFallbackToSpeak) {
          return msg.type === 'speak' || msg.type === 'speak_audio' || msg.type === 'tts_audio'
        }
        return msg.type === 'speak'
      },
      TIMEOUT_MS,
    )

    let ackLatencyMs: number | undefined
    try {
      const ack = await waitForEvent(
        events,
        baseIndex,
        (msg) =>
          isRoutedSpeak(msg)
          && typeof msg.text === 'string'
          && msg.text.includes('Done. Sent to')
          && msg.audio_device === sourceDeviceId,
        8_000,
      )
      ackLatencyMs = ack.at - sentAt
    } catch {
      // Ack is best-effort in case TTS is unavailable.
    }

    return {
      name: options.name,
      ok: true,
      latencyMs: routed.at - sentAt,
      routeType: String(routed.msg.type),
      routedAudioDevice: String(routed.msg.audio_device || ''),
      ackLatencyMs,
    }
  } catch (error: any) {
    return {
      name: options.name,
      ok: false,
      error: error?.message || String(error),
    }
  }
}

async function runMeetingSpeechCase(
  ws: WebSocket,
  events: EventRecord[],
  options: {
    name: string
    meetingText: string
    expectedText: string
    expectedAudioDevice: string
    allowFallbackToSpeak?: boolean
  },
): Promise<CaseResult> {
  const baseIndex = events.length
  const sentAt = Date.now()
  ws.send(JSON.stringify({
    type: 'meeting_speech',
    mode: 'triggered',
    reason: 'relay_dispatch_test',
    transcript: options.meetingText,
    text: options.meetingText,
  }))

  try {
    const routed = await waitForEvent(
      events,
      baseIndex,
      (msg) => {
        if (!isRoutedSpeak(msg)) return false
        if ((msg.text || '') !== options.expectedText) return false
        if ((msg.audio_device || '') !== options.expectedAudioDevice) return false

        if (options.allowFallbackToSpeak) {
          return msg.type === 'speak' || msg.type === 'speak_audio' || msg.type === 'tts_audio'
        }
        return msg.type === 'speak'
      },
      TIMEOUT_MS,
    )

    return {
      name: options.name,
      ok: true,
      latencyMs: routed.at - sentAt,
      routeType: String(routed.msg.type),
      routedAudioDevice: String(routed.msg.audio_device || ''),
    }
  } catch (error: any) {
    return {
      name: options.name,
      ok: false,
      error: error?.message || String(error),
    }
  }
}

async function main() {
  console.log('🧪 Relay Dispatch Regression + Latency Test')
  console.log(`🔌 WS: ${WS_URL}`)

  const ws = new WebSocket(WS_URL)
  await waitForOpen(ws)

  const events: EventRecord[] = []
  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, any>
      events.push({ at: Date.now(), msg })
    } catch {
      // ignore non-JSON payloads
    }
  })

  const sourceDeviceId = `relay-dispatch-test-${Date.now()}`
  ws.send(JSON.stringify({
    type: 'register_device',
    deviceId: sourceDeviceId,
    deviceType: 'ios',
    name: 'Relay Dispatch Test',
  }))

  await waitForEvent(
    events,
    0,
    (msg) => msg.type === 'registered' && msg.deviceId === sourceDeviceId,
    8_000,
  )
  await sleep(80)

  const seed = Date.now()
  const userSpeakText = `relay-user-speak-${seed}`
  const userSpeakAudioText = `relay-user-speak-audio-${seed}`
  const meetingSpeakText = `relay-meeting-speak-${seed}`

  const results: CaseResult[] = []

  results.push(await runUserSpeechCase(ws, events, sourceDeviceId, {
    name: 'user_speech -> speak -> iphone',
    prompt: `/gateway_speak targets=iphone text=${userSpeakText}`,
    expectedText: userSpeakText,
    expectedAudioDevice: 'iphone',
    allowFallbackToSpeak: false,
  }))

  results.push(await runUserSpeechCase(ws, events, sourceDeviceId, {
    name: 'user_speech -> speak_audio -> ipad',
    prompt: `/gateway_speak speak_audio targets=ipad text=${userSpeakAudioText}`,
    expectedText: userSpeakAudioText,
    expectedAudioDevice: 'ipad',
    allowFallbackToSpeak: true,
  }))

  results.push(await runMeetingSpeechCase(ws, events, {
    name: 'meeting_speech -> speak -> mac',
    meetingText: `/gateway_speak targets=mac text=${meetingSpeakText}`,
    expectedText: meetingSpeakText,
    expectedAudioDevice: 'mac',
    allowFallbackToSpeak: false,
  }))

  ws.close(1000)

  console.log('\n📊 Results')
  console.log('────────────────────────────────────────────────────────')
  for (const result of results) {
    if (!result.ok) {
      console.log(`❌ ${result.name} | ${result.error}`)
      continue
    }
    const ackPart = result.ackLatencyMs ? ` | ack=${result.ackLatencyMs}ms` : ''
    console.log(
      `✅ ${result.name} | route=${result.routeType} -> ${result.routedAudioDevice} | latency=${result.latencyMs}ms${ackPart}`,
    )
  }

  const failed = results.filter((r) => !r.ok)
  const passed = results.filter((r) => r.ok)
  const avgLatency = passed.length
    ? Math.round(passed.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / passed.length)
    : 0

  console.log('────────────────────────────────────────────────────────')
  console.log(`Passed: ${passed.length}/${results.length}`)
  console.log(`Avg routed-command latency: ${avgLatency}ms`)

  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('❌ Fatal:', error?.message || error)
  process.exit(1)
})
