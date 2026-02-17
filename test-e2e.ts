#!/usr/bin/env npx tsx
/**
 * E2E speech pipeline test — isolated, realistic simulation.
 * 
 * 1. Kills existing ws-server
 * 2. Starts fresh ws-server
 * 3. Connects as sole client (iOS device)
 * 4. Sends user_speech
 * 5. Receives speak_audio (audio_url)
 * 6. Downloads audio from HTTP server
 * 7. Reports full latency breakdown
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as http from 'http';
import { execSync, spawn } from 'child_process';

const WS_PORT = 8765;
const AUDIO_PORT = 8866;
const WS_URL = `ws://localhost:${WS_PORT}`;
const TEST_SPEECH = process.argv[2] || '你好Reze，今天感觉怎么样？';
const TIMEOUT_MS = 60_000;
const OUTPUT_DIR = '/tmp/e2e-test';

// ——— Helpers ———

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    http.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

function killPort(port: number) {
  try {
    // pkill any ws-server related processes first
    execSync('pkill -9 -f ws-server 2>/dev/null; true');
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`).toString().trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      try { execSync(`kill -9 ${pid} 2>/dev/null`); } catch {}
    }
  } catch {}
}

function waitForPort(port: number, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const req = http.request({ host: 'localhost', port, method: 'HEAD', timeout: 500 }, () => resolve());
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`Port ${port} not ready`));
        setTimeout(check, 300);
      });
      req.end();
    };
    check();
  });
}

// ——— Main ———

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${msg}`);
  };

  // Step 1: Kill existing servers
  log('🧹 Cleaning up old processes...');
  killPort(WS_PORT);
  killPort(AUDIO_PORT);
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: Start fresh ws-server
  log('🚀 Starting ws-server...');
  const serverProc = spawn('npx', ['tsx', 'server/ws-server.ts'], {
    cwd: '/Users/dongpingchen/.openclaw/workspace/vrm-viewer',
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env },
  });

  const serverLog: string[] = [];
  serverProc.stdout?.on('data', (d) => {
    const line = d.toString().trim();
    serverLog.push(line);
    if (line.includes('WebSocket server running')) log('   ✅ WS server ready');
    if (line.includes('Audio HTTP server')) log('   ✅ Audio server ready');
    if (line.includes('[streaming]') || line.includes('User said')) log(`   📋 ${line}`);
  });
  serverProc.stderr?.on('data', (d) => {
    const line = d.toString().trim();
    if (line) serverLog.push(`ERR: ${line}`);
  });

  // Wait for server to be fully ready
  log('   ⏳ Waiting for WS server to bind...');
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 15000;
    const check = () => {
      const testWs = new WebSocket(`ws://localhost:${WS_PORT}`);
      testWs.on('open', () => { testWs.close(); resolve(); });
      testWs.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('Server failed to start'));
        setTimeout(check, 500);
      });
    };
    setTimeout(check, 2000); // Give server 2s head start
  });
  log('   ✅ Server accepting connections');

  // Step 3: Connect as iOS client
  log(`🔌 Connecting to ${WS_URL}...`);
  
  const results: {
    connected: boolean;
    registered: boolean;
    ackReceived: boolean;
    ackTime?: number;
    responseReceived: boolean;
    responseTime?: number;
    responseText?: string;
    audioUrl?: string;
    audioDownloaded: boolean;
    audioSize?: number;
    animation?: string;
    expression?: string;
    error?: string;
  } = {
    connected: false,
    registered: false,
    ackReceived: false,
    responseReceived: false,
    audioDownloaded: false,
  };

  const startTime = Date.now();

  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    socket.on('open', () => {
      results.connected = true;
      log('✅ Connected');
      resolve(socket);
    });
    socket.on('error', (err) => reject(err));
    setTimeout(() => reject(new Error('Connection timeout')), 5000);
  });

  // Register
  ws.send(JSON.stringify({
    type: 'register_device',
    deviceId: 'e2e-test-' + Date.now(),
    deviceType: 'ios',
    name: 'E2E Test Device',
  }));

  // Listen for messages
  let speechSentTime = 0;

  const messagePromise = new Promise<void>((resolve) => {
    ws.on('message', async (data: WebSocket.Data) => {
      // ws delivers ALL messages as Buffers in Node.js — try JSON first
      const str = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);

      // Try to parse as JSON
      let msg: any;
      try {
        msg = JSON.parse(str);
      } catch {
        // Genuinely binary data (audio chunks etc)
        log(`📦 Binary: ${(Buffer.isBuffer(data) ? data : Buffer.from(str)).length} bytes`);
        return;
      }

      try {
        const elapsed = speechSentTime ? ((Date.now() - speechSentTime) / 1000).toFixed(1) : '?';

        switch (msg.type) {
          case 'registered':
            results.registered = true;
            log('✅ Registered');
            break;

          case 'device_list':
            break; // skip

          case 'speak_audio': {
            const isAck = msg.action_id === '88_Thinking' || (msg.text?.length < 30);
            if (isAck && !results.responseReceived) {
              results.ackReceived = true;
              results.ackTime = Date.now() - speechSentTime;
              log(`⚡ ACK in ${elapsed}s: "${msg.text?.slice(0, 50)}"`);
              if (msg.audio_url) {
                const ackPath = `${OUTPUT_DIR}/ack.mp3`;
                try {
                  await downloadFile(msg.audio_url, ackPath);
                  log(`   💾 ACK audio: ${ackPath} (${fs.statSync(ackPath).size} bytes)`);
                } catch (e: any) {
                  log(`   ⚠️ ACK download failed: ${e.message}`);
                }
              }
            } else {
              results.responseReceived = true;
              results.responseTime = Date.now() - speechSentTime;
              results.responseText = msg.text;
              results.audioUrl = msg.audio_url;
              results.animation = msg.action_id;
              results.expression = msg.expression;
              log(`💬 RESPONSE in ${elapsed}s: "${msg.text?.slice(0, 100)}"`);
              log(`🎭 Animation: ${msg.action_id}, Expression: ${msg.expression}`);

              if (msg.audio_url) {
                const audioPath = `${OUTPUT_DIR}/response.mp3`;
                try {
                  await downloadFile(msg.audio_url, audioPath);
                  results.audioDownloaded = true;
                  results.audioSize = fs.statSync(audioPath).size;
                  log(`🔊 Audio: ${audioPath} (${(results.audioSize / 1024).toFixed(1)}KB)`);
                } catch (e: any) {
                  log(`⚠️ Audio download failed: ${e.message}`);
                }
              }
              resolve();
            }
            break;
          }

          default:
            if (!['play_action'].includes(msg.type)) {
              log(`📩 ${msg.type}: ${JSON.stringify(msg).slice(0, 120)}`);
            }
        }
      } catch {
        log(`📦 Raw: ${data.toString().slice(0, 100)}`);
      }
    });
  });

  // Wait for registration, then send speech
  await new Promise(r => setTimeout(r, 500));
  speechSentTime = Date.now();
  log(`\n🗣️  Sending: "${TEST_SPEECH}"`);
  ws.send(JSON.stringify({
    type: 'user_speech',
    text: TEST_SPEECH,
    timestamp: Date.now(),
  }));

  // Wait for response or timeout
  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Response timeout')), TIMEOUT_MS);
  });

  try {
    await Promise.race([messagePromise, timeoutPromise]);
    // Give a moment for audio download
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: any) {
    results.error = e.message;
    log(`❌ ${e.message}`);
  }

  // ——— Report ———
  log('\n' + '='.repeat(60));
  log('📊 E2E TEST RESULTS');
  log('='.repeat(60));
  log(`Input:      "${TEST_SPEECH}"`);
  log(`Connected:  ${results.connected ? '✅' : '❌'}`);
  log(`Registered: ${results.registered ? '✅' : '❌'}`);
  log(`ACK:        ${results.ackReceived ? `✅ (${results.ackTime}ms)` : '❌ none'}`);
  log(`Response:   ${results.responseReceived ? `✅ (${results.responseTime}ms)` : '❌ none'}`);
  if (results.responseText) log(`Text:       "${results.responseText.slice(0, 150)}"`);
  log(`Audio:      ${results.audioDownloaded ? `✅ (${(results.audioSize! / 1024).toFixed(1)}KB)` : '❌'}`);
  log(`Animation:  ${results.animation || 'none'}`);
  log(`Expression: ${results.expression || 'none'}`);
  if (results.error) log(`Error:      ${results.error}`);
  log('='.repeat(60));

  // Play audio if downloaded
  if (results.audioDownloaded) {
    log('\n🔊 Playing response audio...');
    try {
      execSync(`afplay ${OUTPUT_DIR}/response.mp3`, { timeout: 30000 });
      log('✅ Audio playback complete');
    } catch {
      log('⚠️ Audio playback failed');
    }
  }

  // Save server log
  fs.writeFileSync(`${OUTPUT_DIR}/server.log`, serverLog.join('\n'));
  log(`📋 Server log: ${OUTPUT_DIR}/server.log`);

  // Cleanup
  ws.close();
  serverProc.kill();
  log('🧹 Cleaned up');
  process.exit(results.responseReceived ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
