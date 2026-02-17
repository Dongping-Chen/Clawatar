import WebSocket from 'ws'

const WS_URL = 'ws://localhost:8765'
const t0 = Date.now()
const ts = () => ((Date.now() - t0) / 1000).toFixed(2) + 's'

console.log(`[${ts()}] Connecting to WS...`)
const ws = new WebSocket(WS_URL)

ws.on('open', () => {
  console.log(`[${ts()}] Connected. Sending meeting_speech...`)
  
  // Simulate a triggered meeting speech
  ws.send(JSON.stringify({
    type: 'meeting_speech',
    text: '你好雷泽，请自我介绍一下你的背景，然后你能做什么东西？',
    transcript: 'Speaker 1: 你好雷泽，请自我介绍一下你的背景，然后你能做什么东西？',
    reason: 'name: "雷泽"',
    mode: 'triggered',
  }))
  console.log(`[${ts()}] Sent. Waiting for speak_audio response...`)
})

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'speak_audio') {
      console.log(`[${ts()}] 🔊 GOT RESPONSE!`)
      console.log(`  Text: "${(msg.text || '').slice(0, 200)}"`)
      console.log(`  Audio: ${msg.audio_url}`)
      console.log(`  Action: ${msg.action_id}`)
      console.log(`  Expression: ${msg.expression} (${msg.expression_weight})`)
      console.log(`\n  ⏱️  TOTAL LATENCY: ${ts()} (from send to speak_audio)`)
      ws.close()
      process.exit(0)
    } else if (msg.type === 'speak') {
      console.log(`[${ts()}] 💬 Text-only response: "${(msg.text || '').slice(0, 200)}"`)
      ws.close()
      process.exit(0)
    }
  } catch {}
})

ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1) })

// Timeout after 120s
setTimeout(() => { console.log(`[${ts()}] ⏰ TIMEOUT`); process.exit(1) }, 120_000)
