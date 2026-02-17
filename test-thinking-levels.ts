#!/usr/bin/env npx tsx
/**
 * Compare Opus vs Sonnet at thinking: high vs thinking: low
 * Tests 4 combinations × 4 queries = 16 measurements
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

interface Result {
  firstTokenMs: number;
  fullMs: number;
  maxGapMs: number;
  text: string;
  tokenCount: number;
}

async function measure(text: string, model: string, thinking: string): Promise<Result> {
  const sessionKey = `think-test-${model.split('/').pop()}-${thinking}-${Date.now()}`;
  const start = Date.now();
  const tokens: Array<{ t: string; ms: number }> = [];

  // Use /model directive + /reasoning directive in message
  let userMsg = text;
  if (model !== 'default') {
    userMsg = `/model ${model}\n${userMsg}`;
  }

  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': sessionKey,
    },
    body: JSON.stringify({
      model: 'openclaw',
      stream: true,
      messages: [
        { role: 'system', content: VOICE_PROMPT },
        { role: 'user', content: userMsg },
      ],
      // Pass thinking level via extra body param
      ...(thinking !== 'default' ? { thinking } : {}),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

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
  { label: '💬 聊天', text: '你好，今天过得怎么样？' },
  { label: '🌤️ 天气', text: '华盛顿DC天气怎么样？' },
  { label: '🔍 搜索', text: '最新的AI新闻有什么？' },
  { label: '🧠 记忆', text: '我之前说过什么关于VRM的事？' },
];

interface Config {
  label: string;
  model: string;
  thinking: string;
}

const CONFIGS: Config[] = [
  { label: 'Opus high',   model: 'default',                          thinking: 'high' },
  { label: 'Opus low',    model: 'default',                          thinking: 'low' },
  { label: 'Sonnet high', model: 'anthropic/claude-sonnet-4-5-20250514', thinking: 'high' },
  { label: 'Sonnet low',  model: 'anthropic/claude-sonnet-4-5-20250514', thinking: 'low' },
];

async function main() {
  console.log('🧪 Thinking Level Comparison: Opus vs Sonnet × High vs Low\n');
  console.log(`Gateway: http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`Token: ${GATEWAY_TOKEN ? '✅' : '❌ missing'}\n`);

  // results[configLabel][queryLabel] = Result
  const results: Record<string, Record<string, Result>> = {};

  for (const cfg of CONFIGS) {
    results[cfg.label] = {};
    console.log(`\n${'━'.repeat(50)}`);
    console.log(`🔧 ${cfg.label} (model=${cfg.model === 'default' ? 'opus' : 'sonnet'}, thinking=${cfg.thinking})`);
    console.log('━'.repeat(50));

    for (const q of QUERIES) {
      process.stdout.write(`  ${q.label}... `);
      try {
        const r = await measure(q.text, cfg.model, cfg.thinking);
        results[cfg.label][q.label] = r;
        console.log(`${r.fullMs}ms (first: ${r.firstTokenMs}ms, gap: ${r.maxGapMs}ms) [${r.tokenCount} tokens]`);
      } catch (e: any) {
        console.log(`❌ ${e.message}`);
        results[cfg.label][q.label] = { firstTokenMs: 0, fullMs: 99999, maxGapMs: 0, text: '', tokenCount: 0 };
      }
      // Brief pause between queries
      await new Promise(r => setTimeout(r, 800));
    }
  }

  // Summary table
  console.log('\n\n' + '═'.repeat(95));
  console.log('📊 THINKING LEVEL COMPARISON');
  console.log('═'.repeat(95));

  // Header
  const cfgLabels = CONFIGS.map(c => c.label);
  let header = 'Query'.padEnd(12);
  for (const cl of cfgLabels) {
    header += `│ ${cl}`.padEnd(22);
  }
  console.log(header);
  console.log('─'.repeat(95));

  // Rows — total time
  console.log('\n📏 Total Time (ms):');
  console.log('─'.repeat(95));
  for (const q of QUERIES) {
    let row = q.label.padEnd(12);
    for (const cl of cfgLabels) {
      const r = results[cl]?.[q.label];
      row += `│ ${r ? r.fullMs + 'ms' : 'N/A'}`.padEnd(22);
    }
    console.log(row);
  }

  // Rows — first token
  console.log('\n⚡ First Token (ms):');
  console.log('─'.repeat(95));
  for (const q of QUERIES) {
    let row = q.label.padEnd(12);
    for (const cl of cfgLabels) {
      const r = results[cl]?.[q.label];
      row += `│ ${r ? r.firstTokenMs + 'ms' : 'N/A'}`.padEnd(22);
    }
    console.log(row);
  }

  // Rows — max gap
  console.log('\n🕳️ Max Gap (ms):');
  console.log('─'.repeat(95));
  for (const q of QUERIES) {
    let row = q.label.padEnd(12);
    for (const cl of cfgLabels) {
      const r = results[cl]?.[q.label];
      row += `│ ${r ? r.maxGapMs + 'ms' : 'N/A'}`.padEnd(22);
    }
    console.log(row);
  }

  // Averages
  console.log('\n' + '═'.repeat(95));
  console.log('📈 Averages:');
  for (const cl of cfgLabels) {
    const vals = QUERIES.map(q => results[cl]?.[q.label]?.fullMs || 0).filter(v => v < 99999);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const firstAvg = QUERIES.map(q => results[cl]?.[q.label]?.firstTokenMs || 0).filter(v => v > 0);
    const avgFirst = firstAvg.length ? firstAvg.reduce((a, b) => a + b, 0) / firstAvg.length : 0;
    console.log(`  ${cl.padEnd(14)} │ avg total: ${(avg / 1000).toFixed(1)}s │ avg first token: ${(avgFirst / 1000).toFixed(1)}s`);
  }

  // Direct comparisons
  console.log('\n' + '═'.repeat(95));
  console.log('🔀 Speedup from high → low thinking:');
  for (const model of ['Opus', 'Sonnet']) {
    const highKey = `${model} high`;
    const lowKey = `${model} low`;
    for (const q of QUERIES) {
      const high = results[highKey]?.[q.label]?.fullMs || 0;
      const low = results[lowKey]?.[q.label]?.fullMs || 0;
      if (high && low && high < 99999 && low < 99999) {
        const speedup = (high / low).toFixed(1);
        const diff = high - low;
        console.log(`  ${model} ${q.label}: high ${high}ms → low ${low}ms (${speedup}x, ${diff > 0 ? '-' : '+'}${Math.abs(diff)}ms)`);
      }
    }
  }

  console.log('\n✅ Done!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
