#!/usr/bin/env npx tsx
/**
 * Test the full speech pipeline:
 * 1. Connect to WS server as an iOS device
 * 2. Send a user_speech message
 * 3. Capture: AI response text + TTS audio + animations
 */

import WebSocket from 'ws';
import * as fs from 'fs';

const WS_URL = 'ws://localhost:8765';
const TEST_SPEECH = process.argv[2] || '你好Reze，给我讲个笑话吧';
const TIMEOUT_MS = 45000;

async function main() {
  console.log('🔌 Connecting to WS server...');
  const ws = new WebSocket(WS_URL);
  const startTime = Date.now();
  let gotResponse = false;

  ws.on('open', () => {
    console.log('✅ Connected!');
    ws.send(JSON.stringify({
      type: 'register_device',
      deviceId: 'test-pipeline-' + Date.now(),
      deviceType: 'ios',
      name: 'Pipeline Test',
    }));

    setTimeout(() => {
      console.log(`\n🗣️  Sending: "${TEST_SPEECH}"`);
      console.log('⏳ Waiting for response...\n');
      ws.send(JSON.stringify({
        type: 'user_speech',
        text: TEST_SPEECH,
        timestamp: Date.now(),
      }));
    }, 500);
  });

  ws.on('message', (data: WebSocket.Data) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Binary data
    if (Buffer.isBuffer(data)) {
      // Ignore small binary chunks from other sources
      if (data.length > 1000) {
        console.log(`[${elapsed}s] 🔊 Binary audio: ${data.length} bytes`);
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'registered':
        case 'device_list':
          break; // skip noise

        case 'speak_text':
          gotResponse = true;
          console.log(`[${elapsed}s] 💬 TEXT: "${msg.text}"`);
          break;

        case 'speak_audio':
          console.log(`[${elapsed}s] 🔊 AUDIO: ${msg.audio ? (Buffer.from(msg.audio, 'base64').length / 1024).toFixed(1) + 'KB' : 'empty'}`);
          if (msg.audio) {
            const buf = Buffer.from(msg.audio, 'base64');
            const outPath = '/tmp/test-pipeline-response.mp3';
            fs.writeFileSync(outPath, buf);
            console.log(`   💾 Saved: ${outPath} (${buf.length} bytes)`);
          }
          break;

        case 'speak_ack':
          console.log(`[${elapsed}s] ⚡ ACK audio (quick response)`);
          if (msg.audio) {
            const buf = Buffer.from(msg.audio, 'base64');
            fs.writeFileSync('/tmp/test-pipeline-ack.mp3', buf);
            console.log(`   💾 Saved ack: /tmp/test-pipeline-ack.mp3`);
          }
          break;

        case 'animation':
          console.log(`[${elapsed}s] 🎭 Animation: ${msg.name}`);
          break;

        case 'expression':
          console.log(`[${elapsed}s] 😊 Expression: ${JSON.stringify(msg.expressions || msg)}`);
          break;

        case 'chat_message':
          console.log(`[${elapsed}s] 📨 Chat: ${(msg.text || '').substring(0, 120)}`);
          break;

        case 'play_action':
          // Ignore action broadcasts
          break;

        default:
          const str = JSON.stringify(msg).substring(0, 150);
          if (str.length > 30) {
            console.log(`[${elapsed}s] 📩 ${msg.type}: ${str}`);
          }
      }
    } catch {
      console.log(`[${elapsed}s] 📦 Raw: ${data.toString().substring(0, 100)}`);
    }
  });

  ws.on('error', (err) => console.error('❌ Error:', err.message));
  ws.on('close', () => console.log('\n🔌 Disconnected'));

  // Wait for response, then exit
  const checkDone = setInterval(() => {
    if (gotResponse && Date.now() - startTime > 20000) {
      clearInterval(checkDone);
      console.log('\n✅ Test complete!');
      ws.close();
      setTimeout(() => process.exit(0), 1000);
    }
  }, 1000);

  setTimeout(() => {
    console.log(`\n⏰ Timeout (${TIMEOUT_MS / 1000}s)`);
    ws.close();
    process.exit(gotResponse ? 0 : 1);
  }, TIMEOUT_MS);
}

main().catch(console.error);
