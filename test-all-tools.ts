#!/usr/bin/env npx tsx
/**
 * Measure Gateway latency for ALL common tool-call scenarios.
 * For each query, records: first token, tool gap, full response, total.
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

interface TokenEvent { token: string; timeMs: number; }

async function measureQuery(label: string, text: string): Promise<{
  label: string;
  query: string;
  firstTokenMs: number;
  gapMs: number;    // longest silence between tokens
  gapAfterToken: string;
  fullResponseMs: number;
  tokenCount: number;
  responseText: string;
  toolDetected: boolean;
}> {
  const start = Date.now();
  const tokens: TokenEvent[] = [];

  const resp = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GATEWAY_TOKEN}`,
      'x-openclaw-agent-id': 'main',
      'x-openclaw-session-key': 'tool-timing-' + Date.now(),
    },
    body: JSON.stringify({
      model: 'openclaw',
      stream: true,
      messages: [
        { role: 'system', content: VOICE_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!resp.ok) throw new Error(`Gateway ${resp.status}: ${await resp.text()}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

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
        if (token) tokens.push({ token, timeMs: Date.now() - start });
      } catch {}
    }
  }

  // Find the longest gap between consecutive tokens
  let maxGap = 0, gapAfterToken = '';
  for (let i = 1; i < tokens.length; i++) {
    const gap = tokens[i].timeMs - tokens[i - 1].timeMs;
    if (gap > maxGap) {
      maxGap = gap;
      gapAfterToken = tokens.slice(0, i).map(t => t.token).join('').slice(-20);
    }
  }

  const fullText = tokens.map(t => t.token).join('');
  return {
    label,
    query: text,
    firstTokenMs: tokens[0]?.timeMs || 0,
    gapMs: maxGap,
    gapAfterToken,
    fullResponseMs: Date.now() - start,
    tokenCount: tokens.length,
    responseText: fullText,
    toolDetected: maxGap > 3000,
  };
}

const TESTS = [
  // No tools
  { label: '💬 简单聊天', text: '你好' },

  // Weather (exec curl)
  { label: '🌤️ 天气查询', text: '东京现在天气怎么样' },

  // Web search (web_search tool)
  { label: '🔍 网页搜索', text: '最近有什么科技新闻' },

  // Web fetch (web_fetch tool)
  { label: '🌐 网页抓取', text: '帮我看看 https://news.ycombinator.com 上有什么' },

  // Memory search (memory_search tool)
  { label: '🧠 记忆搜索', text: '我之前跟你说过什么关于Clawatar的事？' },

  // Calendar (gog skill - exec)
  { label: '📅 日历查询', text: '我今天有什么日程安排？' },

  // Email (gog skill - exec)
  { label: '📧 邮件查询', text: '我最近有什么重要邮件？' },

  // File read (read tool)
  { label: '📄 文件读取', text: '读一下 MEMORY.md 的内容' },

  // Exec command
  { label: '⚙️ 命令执行', text: '看看当前目录下有哪些文件' },

  // Apple Reminders
  { label: '📋 提醒事项', text: '我有什么待办提醒？' },
];

async function main() {
  console.log('🧪 Testing ALL common tool call latencies\n');
  console.log(`Gateway: 127.0.0.1:${GATEWAY_PORT}`);
  console.log(`Token: ${GATEWAY_TOKEN.slice(0, 8)}...`);
  console.log('');

  const results: Awaited<ReturnType<typeof measureQuery>>[] = [];

  for (const test of TESTS) {
    process.stdout.write(`Testing: ${test.label}...`);
    try {
      const r = await measureQuery(test.label, test.text);
      results.push(r);
      console.log(` ✅ ${r.fullResponseMs}ms (gap: ${r.gapMs}ms)`);
    } catch (e: any) {
      console.log(` ❌ ${e.message}`);
    }
    // Small delay between tests to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  // Print summary table
  console.log('\n' + '═'.repeat(90));
  console.log('📊 FULL TOOL LATENCY COMPARISON');
  console.log('═'.repeat(90));
  console.log(
    'Tool'.padEnd(20) +
    'FirstTok'.padStart(10) +
    'MaxGap'.padStart(10) +
    'Total'.padStart(10) +
    'Tokens'.padStart(8) +
    '  Tool?  ' +
    'Response'
  );
  console.log('─'.repeat(90));

  for (const r of results) {
    console.log(
      r.label.padEnd(20) +
      `${r.firstTokenMs}ms`.padStart(10) +
      `${r.gapMs}ms`.padStart(10) +
      `${r.fullResponseMs}ms`.padStart(10) +
      `${r.tokenCount}`.padStart(8) +
      `  ${r.toolDetected ? '⚠️ YES' : '  no '}  ` +
      `"${r.responseText.replace(/\n/g, ' ').slice(0, 40)}..."`
    );
  }

  console.log('─'.repeat(90));

  // Sort by total latency
  const sorted = [...results].sort((a, b) => a.fullResponseMs - b.fullResponseMs);
  console.log('\n🏆 Ranked by total latency:');
  for (const r of sorted) {
    const bar = '█'.repeat(Math.ceil(r.fullResponseMs / 1000));
    console.log(`  ${r.label.padEnd(20)} ${String(r.fullResponseMs).padStart(6)}ms ${bar}`);
  }

  // Tool call analysis
  const toolCalls = results.filter(r => r.toolDetected);
  if (toolCalls.length > 0) {
    console.log('\n⚠️ Tool call gap analysis (gap > 3s):');
    for (const r of toolCalls) {
      console.log(`  ${r.label}: ${r.gapMs}ms gap after "${r.gapAfterToken}"`);
    }
  }

  // Save raw data
  fs.writeFileSync('/tmp/tool-latency-results.json', JSON.stringify(results, null, 2));
  console.log('\n📋 Raw data: /tmp/tool-latency-results.json');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
