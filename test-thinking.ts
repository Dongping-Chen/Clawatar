#!/usr/bin/env npx tsx
/**
 * Test impact of thinking/reasoning level on latency.
 * Uses /reasoning directive to toggle thinking per query.
 */

import * as fs from 'fs';
import * as path from 'path';

const PORT = 18789;
const TOKEN = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(process.env.HOME || '', '.openclaw/openclaw.json'), 'utf-8'));
    return c.gateway?.auth?.token || '';
  } catch { return ''; }
})();

const VOICE = `You are in VOICE MODE. Say a brief phrase before using any tool. NO markdown, NO emoji. Keep it SHORT. Speak naturally.`;

async function measure(userMsg: string, session: string) {
  const start = Date.now();
  const tokens: Array<{ t: string; ms: number }> = [];

  const resp = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': session,
    },
    body: JSON.stringify({
      model: 'openclaw', stream: true,
      messages: [
        { role: 'system', content: VOICE },
        { role: 'user', content: userMsg },
      ],
    }),
  });

  if (!resp.ok) return { firstMs: 0, fullMs: 0, maxGap: 0, text: `ERROR ${resp.status}`, tokens: 0 };
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
  for (let i = 1; i < tokens.length; i++) maxGap = Math.max(maxGap, tokens[i].ms - tokens[i-1].ms);
  return {
    firstMs: tokens[0]?.ms || 0,
    fullMs: Date.now() - start,
    maxGap,
    text: tokens.map(t => t.t).join(''),
    tokens: tokens.length,
  };
}

interface Config {
  label: string;
  model: string;
  reasoning: string; // directive
}

const CONFIGS: Config[] = [
  { label: 'Opus + think:high', model: '', reasoning: '' },                    // default
  { label: 'Opus + think:off', model: '', reasoning: '/reasoning off\n' },
  { label: 'Sonnet4.6 + think:high', model: '/model anthropic/claude-sonnet-4-6\n', reasoning: '' },
  { label: 'Sonnet4.6 + think:off', model: '/model anthropic/claude-sonnet-4-6\n', reasoning: '/reasoning off\n' },
];

const QUERIES = [
  { label: '💬 聊天', text: '你好，今天怎么样？' },
  { label: '🌤️ 天气', text: '纽约天气怎么样？' },
  { label: '🧠 记忆', text: '我叫什么名字？' },
];

async function main() {
  console.log('🧪 Thinking Level Impact Test\n');

  // header
  process.stdout.write(''.padEnd(25));
  for (const c of CONFIGS) process.stdout.write(c.label.padEnd(22));
  console.log('');
  console.log('─'.repeat(25 + CONFIGS.length * 22));

  for (const q of QUERIES) {
    process.stdout.write(q.label.padEnd(25));
    const row: string[] = [];
    for (const c of CONFIGS) {
      const prefix = c.model + c.reasoning;
      const r = await measure(prefix + q.text, `think-test-${Date.now()}`);
      const cell = `${(r.fullMs/1000).toFixed(1)}s (${(r.firstMs/1000).toFixed(1)}s)`;
      process.stdout.write(cell.padEnd(22));
      row.push(cell);
      await new Promise(r => setTimeout(r, 300));
    }
    console.log('');
  }

  console.log('─'.repeat(25 + CONFIGS.length * 22));
  console.log('\nFormat: total (first token)');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
