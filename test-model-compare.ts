#!/usr/bin/env npx tsx
/**
 * Compare Opus vs Sonnet for the same queries via Gateway SSE.
 * Uses /model directive in the user message to override per-request.
 */

import * as fs from 'fs';
import * as path from 'path';

const GATEWAY_PORT = 18789;
const GATEWAY_TOKEN = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf-8'));
    return c.gateway?.auth?.token || '';
  } catch { return ''; }
})();

const VOICE_PROMPT = `You are in VOICE MODE. Say a brief phrase before using any tool. NO markdown, NO emoji. Keep it SHORT (2-3 sentences). Speak naturally.`;

async function measure(text: string, sessionKey: string): Promise<{
  firstTokenMs: number; fullMs: number; maxGapMs: number; text: string; tokenCount: number;
}> {
  const start = Date.now();
  const tokens: Array<{ t: string; ms: number }> = [];

  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      model: 'openclaw', stream: true,
      messages: [
        { role: 'system', content: VOICE_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`${resp.status}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const l of lines) {
      if (!l.startsWith('data: ') || l === 'data: [DONE]') continue;
      try {
        const tk = JSON.parse(l.slice(6)).choices?.[0]?.delta?.content;
        if (tk) tokens.push({ t: tk, ms: Date.now() - start });
      } catch {}
    }
  }

  let maxGap = 0;
  for (let i = 1; i < tokens.length; i++) {
    maxGap = Math.max(maxGap, tokens[i].ms - tokens[i - 1].ms);
  }

  return {
    firstTokenMs: tokens[0]?.ms || 0,
    fullMs: Date.now() - start,
    maxGapMs: maxGap,
    text: tokens.map(t => t.t).join(''),
    tokenCount: tokens.length,
  };
}

const QUERIES = [
  { label: '💬 简单聊天', text: '你好，今天过得怎么样？' },
  { label: '🌤️ 天气', text: '洛杉矶天气怎么样？' },
  { label: '🔍 搜索', text: '最新的AI新闻有什么？' },
  { label: '🧠 记忆', text: '我之前说过什么关于VRM的事？' },
];

async function main() {
  console.log('🧪 Opus 4.6 vs Sonnet 4.6 延迟对比\n');

  const results: Array<{ label: string; opus: any; sonnet: any }> = [];

  for (const q of QUERIES) {
    process.stdout.write(`${q.label}:\n`);

    // Sonnet 4.6
    process.stdout.write('  Sonnet 4.6... ');
    const sonnet = await measure(
      `/model anthropic/claude-sonnet-4-6\n${q.text}`,
      `compare-sonnet46-${Date.now()}`
    );
    console.log(`${sonnet.fullMs}ms (first: ${sonnet.firstTokenMs}ms, gap: ${sonnet.maxGapMs}ms)`);

    await new Promise(r => setTimeout(r, 500));

    // Opus 4.6
    process.stdout.write('  Opus 4.6...   ');
    const opus = await measure(
      q.text,  // default model is Opus
      `compare-opus46-${Date.now()}`
    );
    console.log(`${opus.fullMs}ms (first: ${opus.firstTokenMs}ms, gap: ${opus.maxGapMs}ms)`);

    results.push({ label: q.label, opus, sonnet });
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('📊 MODEL COMPARISON SUMMARY');
  console.log('═'.repeat(70));
  console.log(
    'Query'.padEnd(18) +
    '│ Opus Total'.padEnd(14) +
    '│ Sonnet Total'.padEnd(16) +
    '│ Speedup'.padEnd(11) +
    '│ Opus 1st'.padEnd(12) +
    '│ Sonnet 1st'
  );
  console.log('─'.repeat(70));

  for (const r of results) {
    const speedup = (r.opus.fullMs / r.sonnet.fullMs).toFixed(1) + 'x';
    console.log(
      r.label.padEnd(18) +
      `│ ${r.opus.fullMs}ms`.padEnd(14) +
      `│ ${r.sonnet.fullMs}ms`.padEnd(16) +
      `│ ${speedup}`.padEnd(11) +
      `│ ${r.opus.firstTokenMs}ms`.padEnd(12) +
      `│ ${r.sonnet.firstTokenMs}ms`
    );
  }
  console.log('─'.repeat(70));

  const avgOpus = results.reduce((s, r) => s + r.opus.fullMs, 0) / results.length;
  const avgSonnet = results.reduce((s, r) => s + r.sonnet.fullMs, 0) / results.length;
  console.log(`\nAverage: Opus ${(avgOpus / 1000).toFixed(1)}s vs Sonnet ${(avgSonnet / 1000).toFixed(1)}s (${(avgOpus / avgSonnet).toFixed(1)}x speedup)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
