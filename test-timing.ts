#!/usr/bin/env npx tsx
/**
 * Complete latency breakdown for the voice pipeline.
 * Measures each step independently:
 * 
 * 1. Gateway SSE: first token, full response, tool call overhead
 * 2. Sentence splitter: first sentence emission
 * 3. ElevenLabs TTS: first audio chunk, full audio
 * 4. End-to-end: request → broadcast-ready audio
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';

// === Config ===
const GATEWAY_PORT = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/workspace/vrm-viewer/clawatar.config.json'), 'utf-8'));
    return c.openclaw?.gatewayPort || 18789;
  } catch { return 18789; }
})();

const GATEWAY_TOKEN = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf-8'));
    return c.gateway?.auth?.token || '';
  } catch { return ''; }
})();

const VOICE_ID = 'L5vK1xowu0LZIPxjLSl5';
const TTS_MODEL = 'eleven_turbo_v2_5';
const API_KEY = (() => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf-8'));
    return c.skills?.entries?.sag?.apiKey || '';
  } catch { return ''; }
})();

const VOICE_SYSTEM_PROMPT = `You are in VOICE MODE — your response will be spoken aloud via TTS.
Critical rules:
1. ALWAYS say a brief phrase BEFORE using any tool (e.g. "让我看看～", "我查一下哦"). This gives immediate audio feedback.
2. NO markdown (**bold**, # headers, | tables, \`code\`, - bullets). TTS reads these literally.
3. Keep it SHORT — 2-4 sentences max. This is a conversation, not an essay.
4. Speak naturally, like talking to a friend. No emoji, no URLs.`;

const TEST_QUERIES = [
  { label: '简单聊天', text: '你好，今天心情怎么样？' },
  { label: '天气查询 (tool call)', text: '华盛顿现在天气怎么样？' },
];

const query = process.argv[2];
const queries = query 
  ? [{ label: 'Custom', text: query }] 
  : TEST_QUERIES;

// === Step 1: Gateway SSE Timing ===
interface GatewayResult {
  firstTokenMs: number;
  fullResponseMs: number;
  tokenCount: number;
  text: string;
  tokens: Array<{ token: string; timeMs: number }>;
}

async function measureGatewaySSE(userText: string): Promise<GatewayResult> {
  const start = Date.now();
  const tokens: Array<{ token: string; timeMs: number }> = [];

  const messages = [
    { role: 'system', content: VOICE_SYSTEM_PROMPT },
    { role: 'user', content: userText },
  ];

  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': 'timing-test',
    },
    body: JSON.stringify({ model: 'openclaw', stream: true, messages }),
  });

  if (!resp.ok) throw new Error(`Gateway ${resp.status}: ${await resp.text()}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let firstTokenMs = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const json = JSON.parse(line.slice(6));
        const token = json.choices?.[0]?.delta?.content;
        if (token) {
          const timeMs = Date.now() - start;
          if (!firstTokenMs) firstTokenMs = timeMs;
          tokens.push({ token, timeMs });
        }
      } catch {}
    }
  }

  const fullText = tokens.map(t => t.token).join('');
  return {
    firstTokenMs,
    fullResponseMs: Date.now() - start,
    tokenCount: tokens.length,
    text: fullText,
    tokens,
  };
}

// === Step 2: Sentence Splitting Timing ===
interface SentenceResult {
  sentences: Array<{ text: string; readyMs: number }>;
  firstSentenceMs: number;
}

function measureSentenceSplitting(tokens: Array<{ token: string; timeMs: number }>): SentenceResult {
  const sentences: Array<{ text: string; readyMs: number }> = [];
  let buffer = '';
  const enders = /[。！？.!?\n～〜；;：…—]/;

  for (const { token, timeMs } of tokens) {
    buffer += token;
    const match = buffer.match(enders);
    if (match && match.index !== undefined) {
      const idx = match.index + 1;
      const sentence = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx);
      if (sentence.length >= 2) sentences.push({ text: sentence, readyMs: timeMs });
    }
  }
  if (buffer.trim()) {
    sentences.push({ text: buffer.trim(), readyMs: tokens[tokens.length - 1]?.timeMs || 0 });
  }

  return {
    sentences,
    firstSentenceMs: sentences[0]?.readyMs || 0,
  };
}

// === Step 3: ElevenLabs TTS Timing ===
interface TTSResult {
  firstChunkMs: number;
  fullAudioMs: number;
  audioSize: number;
  audioPath: string;
}

async function measureTTS(text: string): Promise<TTSResult> {
  const start = Date.now();
  let firstChunkMs = 0;

  return new Promise((resolve, reject) => {
    const audioBuffers: Buffer[] = [];
    const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=${TTS_MODEL}&output_format=mp3_44100_128`;
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        xi_api_key: API_KEY,
      }));
      ws.send(JSON.stringify({ text: text + ' ' }));
      ws.send(JSON.stringify({ text: '' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.audio) {
          const buf = Buffer.from(msg.audio, 'base64');
          audioBuffers.push(buf);
          if (!firstChunkMs) firstChunkMs = Date.now() - start;
        }
        if (msg.isFinal) ws.close();
      } catch {}
    });

    ws.on('close', () => {
      const combined = Buffer.concat(audioBuffers);
      const audioPath = '/tmp/timing-test-audio.mp3';
      fs.writeFileSync(audioPath, combined);
      resolve({
        firstChunkMs,
        fullAudioMs: Date.now() - start,
        audioSize: combined.length,
        audioPath,
      });
    });

    ws.on('error', reject);
  });
}

// === Main ===
async function runTest(label: string, text: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🧪 ${label}: "${text}"`);
  console.log(`${'═'.repeat(60)}`);
  const totalStart = Date.now();

  // Step 1: Gateway SSE
  console.log('\n📡 Step 1: Gateway SSE...');
  const gw = await measureGatewaySSE(text);
  console.log(`   First token:    ${gw.firstTokenMs}ms`);
  console.log(`   Full response:  ${gw.fullResponseMs}ms`);
  console.log(`   Token count:    ${gw.tokenCount}`);
  console.log(`   Text:           "${gw.text.slice(0, 100)}${gw.text.length > 100 ? '...' : ''}"`);

  // Token timeline (first 10 + last 3)
  console.log('\n   Token timeline:');
  const show = [...gw.tokens.slice(0, 10), ...(gw.tokens.length > 13 ? [{ token: '...', timeMs: 0 }] : []), ...gw.tokens.slice(-3)];
  for (const t of show) {
    if (t.token === '...') { console.log('   ...'); continue; }
    const repr = t.token.replace(/\n/g, '\\n');
    console.log(`   ${String(t.timeMs).padStart(6)}ms  "${repr}"`);
  }

  // Step 2: Sentence splitting
  console.log('\n✂️  Step 2: Sentence splitting...');
  const ss = measureSentenceSplitting(gw.tokens);
  console.log(`   First sentence: ${ss.firstSentenceMs}ms`);
  console.log(`   Total sentences: ${ss.sentences.length}`);
  for (const s of ss.sentences) {
    console.log(`   ${String(s.readyMs).padStart(6)}ms  "${s.text.slice(0, 60)}"`);
  }

  // Step 3: TTS (using full text for fair comparison)
  console.log('\n🔊 Step 3: ElevenLabs TTS...');
  const tts = await measureTTS(gw.text);
  console.log(`   First audio chunk: ${tts.firstChunkMs}ms`);
  console.log(`   Full audio:        ${tts.fullAudioMs}ms`);
  console.log(`   Audio size:        ${(tts.audioSize / 1024).toFixed(1)}KB`);

  // Step 4: Combined pipeline estimate
  const totalMs = Date.now() - totalStart;
  const pipelineEstimate = ss.firstSentenceMs + tts.firstChunkMs; // streaming overlap
  const sequentialEstimate = gw.fullResponseMs + tts.fullAudioMs;  // no streaming

  console.log(`\n${'─'.repeat(60)}`);
  console.log('📊 LATENCY BREAKDOWN');
  console.log(`${'─'.repeat(60)}`);
  console.log(`Gateway first token:     ${gw.firstTokenMs}ms`);
  console.log(`Gateway full response:   ${gw.fullResponseMs}ms`);
  console.log(`  └─ Tool call overhead: ${gw.firstTokenMs > 3000 ? `~${gw.firstTokenMs}ms (model silent during tools)` : 'N/A (no tools)'}`);
  console.log(`First sentence ready:    ${ss.firstSentenceMs}ms`);
  console.log(`TTS first audio chunk:   ${tts.firstChunkMs}ms (standalone, not streaming)`);
  console.log(`TTS full audio:          ${tts.fullAudioMs}ms`);
  console.log(`─────────────────────────────────`);
  console.log(`Streaming estimate:      ${pipelineEstimate}ms (first sentence + TTS overlap)`);
  console.log(`Sequential estimate:     ${sequentialEstimate}ms (no streaming)`);
  console.log(`Actual wall time:        ${totalMs}ms`);

  // Bottleneck analysis
  console.log('\n🔍 BOTTLENECK ANALYSIS:');
  if (gw.firstTokenMs > 3000) {
    console.log(`   ⚠️  Gateway first token slow (${gw.firstTokenMs}ms) — model NOT speaking before tool calls`);
    console.log(`   → VOICE_SYSTEM_PROMPT being ignored, no "让我查一下" before tool_use`);
    console.log(`   → User hears nothing for ${gw.firstTokenMs}ms`);
  }
  if (gw.firstTokenMs > ACK_THRESHOLD_MS) {
    console.log(`   → Would trigger hardcoded ACK at ${ACK_THRESHOLD_MS}ms`);
  }
  const gwPct = ((gw.fullResponseMs / (gw.fullResponseMs + tts.fullAudioMs)) * 100).toFixed(0);
  const ttsPct = ((tts.fullAudioMs / (gw.fullResponseMs + tts.fullAudioMs)) * 100).toFixed(0);
  console.log(`   Gateway: ${gwPct}% of time, TTS: ${ttsPct}% of time`);
}

const ACK_THRESHOLD_MS = 3000;

async function main() {
  console.log('🔧 Config:');
  console.log(`   Gateway: 127.0.0.1:${GATEWAY_PORT}`);
  console.log(`   Token: ${GATEWAY_TOKEN.slice(0, 8)}...`);
  console.log(`   Voice: ${VOICE_ID}`);
  console.log(`   TTS Model: ${TTS_MODEL}`);
  console.log(`   ElevenLabs key: ${API_KEY.slice(0, 6)}...`);

  for (const q of queries) {
    await runTest(q.label, q.text);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
