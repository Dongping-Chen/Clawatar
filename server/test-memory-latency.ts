/**
 * test-memory-latency.ts — Latency benchmarks for memory subsystems
 *
 * Measures:
 *   1. MemoryGraph local operations (add, search, merge, compact) at various scales
 *   2. EmbeddingService API latency (single, batch, cache hit)
 *   3. Entity Store quickRecall latency
 *   4. End-to-end retrieval: query text → embedding → graph search → results
 *   5. Visual memory search (legacy keyword-based) for comparison
 *
 * Run: npx tsx server/test-memory-latency.ts
 */

import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { MemoryGraph } from './memory/memory-graph.js'
import { isEmbeddingServiceAvailable, getTextEmbedding, getTextEmbeddings } from './memory/embedding-service.js'

// ─── Helpers ───

const TEST_DIR = join(process.env.HOME || '/tmp', '.openclaw-test-latency')

function freshGraph(path?: string): MemoryGraph {
  return new MemoryGraph(path || join(TEST_DIR, `graph-${Date.now()}-${Math.random().toString(36).slice(2)}.json`))
}

function fakeEmb(seed: number, dim: number = 1536): number[] {
  const v: number[] = []
  for (let i = 0; i < dim; i++) {
    v.push(Math.sin(seed * (i + 1) * 0.7 + i * 0.3))
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map(x => x / (norm + 1e-8))
}

async function timeMs(label: string, fn: () => void | Promise<void>, runs: number = 1): Promise<number> {
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)
  const p50 = times.sort((a, b) => a - b)[Math.floor(times.length / 2)]
  if (runs > 1) {
    console.log(`  ${label}: avg=${avg.toFixed(2)}ms  p50=${p50.toFixed(2)}ms  min=${min.toFixed(2)}ms  max=${max.toFixed(2)}ms  (n=${runs})`)
  } else {
    console.log(`  ${label}: ${avg.toFixed(2)}ms`)
  }
  return avg
}

// ─── Benchmarks ───

async function benchGraphLocalOps() {
  console.log('\n⏱️  Benchmark: MemoryGraph local operations (1536-dim embeddings)')

  // --- Add nodes at various scales ---
  for (const count of [100, 500, 1000]) {
    const g = freshGraph()
    await timeMs(`addNode × ${count}`, () => {
      for (let i = 0; i < count; i++) {
        g.addNode(
          i % 2 === 0 ? 'episodic' : 'semantic',
          `event number ${i} with some description text about what happened`,
          fakeEmb(i),
          { timestamp: new Date(Date.now() - i * 60000).toISOString() },
        )
      }
    })

    // --- Add edges ---
    await timeMs(`addEdge × ${count} (chain)`, () => {
      const imgId = g.addNode('img', 'anchor', fakeEmb(9999))
      for (let i = 0; i < count; i++) {
        g.addEdge(imgId, i, 1 + Math.random())
      }
    })

    // --- Search ---
    const queryEmb = fakeEmb(42.5)
    await timeMs(`searchTextNodes top-5 (${count} nodes)`, () => {
      g.searchTextNodes(queryEmb, undefined, 5)
    }, 50)

    await timeMs(`searchTextNodes top-20 (${count} nodes)`, () => {
      g.searchTextNodes(queryEmb, undefined, 20)
    }, 50)

    // --- Search by entity ---
    const entityNodes = g.getNodesByType('img').map(n => n.id)
    await timeMs(`searchByEntity (${count} nodes)`, () => {
      g.searchByEntity(entityNodes, 10)
    }, 50)

    // --- findSimilarNode (dedup check) ---
    await timeMs(`findSimilarNode (${count} nodes)`, () => {
      g.findSimilarNode(fakeEmb(7.7), 'episodic', 0.85)
    }, 50)

    // --- mergeOrCreate ---
    await timeMs(`mergeOrCreate (${count} nodes)`, () => {
      g.mergeOrCreate('episodic', 'test merge content', fakeEmb(0.01), {})
    }, 10)

    // --- Save ---
    await timeMs(`save (${g.getStats().nodes} nodes)`, () => {
      g.save()
    })

    // --- Load ---
    const savedPath = join(TEST_DIR, `bench-load-${count}.json`)
    {
      const gSave = freshGraph(savedPath)
      for (let i = 0; i < count; i++) {
        gSave.addNode('episodic', `node ${i}`, fakeEmb(i))
      }
      gSave.save()
    }
    await timeMs(`load (${count} nodes from disk)`, () => {
      new MemoryGraph(savedPath)
    }, 5)

    // --- Compact ---
    if (count >= 500) {
      const gCompact = freshGraph()
      for (let i = 0; i < count; i++) {
        gCompact.addNode('episodic', `event ${i}`, fakeEmb(i), {
          timestamp: new Date(Date.now() - i * 3600000).toISOString(),
        })
      }
      await timeMs(`compact ${count} → ${Math.floor(count * 0.5)}`, () => {
        gCompact.compact(Math.floor(count * 0.5))
      })
    }

    console.log()
  }
}

async function benchEmbeddingService() {
  console.log('\n⏱️  Benchmark: EmbeddingService API latency')

  if (!isEmbeddingServiceAvailable()) {
    console.log('  ⏭️  Skipped (no API key)')
    return
  }

  // Cold call — single embedding
  await timeMs('single embedding (cold)', async () => {
    await getTextEmbedding(`unique text ${Date.now()} ${Math.random()}`)
  }, 3)

  // Cache hit
  const cached = 'this is a cached test string for benchmarking'
  await getTextEmbedding(cached) // warm cache
  await timeMs('single embedding (cache hit)', async () => {
    await getTextEmbedding(cached)
  }, 20)

  // Batch sizes
  for (const batchSize of [1, 5, 10, 20]) {
    const texts = Array.from({ length: batchSize }, (_, i) =>
      `batch test ${Date.now()} item ${i} ${Math.random()}`
    )
    await timeMs(`batch embedding × ${batchSize} (cold)`, async () => {
      await getTextEmbeddings(texts)
    })
  }
}

async function benchEntityStoreRecall() {
  console.log('\n⏱️  Benchmark: Entity Store quickRecall')

  try {
    const { EntityStore } = await import('./memory/entity-store.js')
    const store = new EntityStore()

    // Ensure some test entities exist
    const entities = store.listEntities()
    if (entities.length === 0) {
      console.log('  ⏭️  No entities in store, creating test data...')
      store.createEntity({
        type: 'person',
        name: 'Alice Chen',
        aliases: ['Alice', 'AC'],
        faceDescriptions: ['round face, glasses, dark hair'],
        appearanceDescription: 'tall woman, usually wears a blue jacket',
        voiceDescription: 'soft spoken, slight accent',
      })
      store.createEntity({
        type: 'person',
        name: 'Bob Smith',
        aliases: ['Bob', 'Bobby'],
        faceDescriptions: ['square jaw, beard'],
        appearanceDescription: 'medium build, casual style',
        voiceDescription: 'deep baritone voice',
      })
    }

    const entityCount = store.listEntities().length

    // quickRecall with matching text
    await timeMs(`quickRecall (match, ${entityCount} entities)`, () => {
      store.quickRecall('I saw Alice at the café today')
    }, 100)

    // quickRecall with no match
    await timeMs(`quickRecall (no match, ${entityCount} entities)`, () => {
      store.quickRecall('the weather is nice today')
    }, 100)

    // quickRecall with long text
    const longText = 'Alice and Bob were discussing the project. ' +
      'They talked about machine learning, data pipelines, and deployment strategies. '.repeat(10)
    await timeMs(`quickRecall (long text, ${entityCount} entities)`, () => {
      store.quickRecall(longText)
    }, 50)

    // listEntities
    await timeMs(`listEntities (${entityCount})`, () => {
      store.listEntities()
    }, 100)

  } catch (e) {
    console.log(`  ❌ Entity store error: ${e}`)
  }
}

async function benchEndToEndRetrieval() {
  console.log('\n⏱️  Benchmark: End-to-end retrieval (text → embedding → graph search)')

  if (!isEmbeddingServiceAvailable()) {
    console.log('  ⏭️  Skipped (no API key)')
    return
  }

  // Build a graph with real embeddings
  const g = freshGraph()
  const sampleTexts = [
    'Alice arrived at the office at 9am',
    'Bob presented his machine learning research',
    'The team had lunch at the Italian restaurant',
    'Alice debugged the memory allocation issue',
    'Weather report: sunny with clouds in afternoon',
    'Bob committed the new API endpoint code',
    'Alice and Bob reviewed the pull request together',
    'The server crashed due to out-of-memory error',
    'Team standup meeting discussed sprint priorities',
    'Alice deployed the new version to production',
    'Bob configured the CI/CD pipeline',
    'The database migration completed successfully',
    'Alice wrote unit tests for the auth module',
    'Network latency spike detected at 3pm',
    'Bob refactored the event processing system',
    'Alice presented the quarterly metrics report',
    'The load balancer was reconfigured for better distribution',
    'Bob investigated the WebSocket connection drops',
    'Team retrospective identified process improvements',
    'Alice optimized the search indexing algorithm',
  ]

  console.log('  Building graph with 20 real embeddings...')
  const embeddings = await getTextEmbeddings(sampleTexts)
  for (let i = 0; i < sampleTexts.length; i++) {
    g.addNode('episodic', sampleTexts[i], embeddings[i])
  }

  // E2E: query → embed → search → format results
  const queries = [
    'What did Alice do today?',
    'Any issues with the servers?',
    'Tell me about Bob\'s work',
    'What happened at the meeting?',
  ]

  for (const query of queries) {
    let results: Array<{ nodeId: number; score: number }> = []
    await timeMs(`E2E "${query.slice(0, 40)}..."`, async () => {
      const queryEmb = await getTextEmbedding(query)
      results = g.searchTextNodes(queryEmb, undefined, 3)
    })

    // Show top result
    if (results.length > 0) {
      const top = g.getNode(results[0].nodeId)
      console.log(`    → Top: "${top?.content}" (score: ${results[0].score.toFixed(4)})`)
    }
  }

  // E2E with cache (second run should be faster — embedding cached)
  console.log('\n  Repeated queries (embedding cache warm):')
  for (const query of queries) {
    await timeMs(`E2E cached "${query.slice(0, 40)}..."`, async () => {
      const queryEmb = await getTextEmbedding(query)
      g.searchTextNodes(queryEmb, undefined, 3)
    })
  }
}

async function benchVisualMemoryLegacy() {
  console.log('\n⏱️  Benchmark: Visual Memory legacy keyword search (for comparison)')

  try {
    const { VisualMemory } = await import('./visual-memory.js')
    const vm = new VisualMemory()

    // Check if there's any data
    const testResults = vm.search('test', 1)
    const hasData = testResults.length > 0

    if (!hasData) {
      console.log('  ℹ️  No visual memory data, testing with empty store')
    }

    await timeMs('visual memory search (keyword)', () => {
      vm.search('person sitting at desk', 5)
    }, 50)

    await timeMs('visual memory search (Chinese)', () => {
      vm.search('有人坐在桌前', 5)
    }, 50)

  } catch (e) {
    console.log(`  ⏭️  Visual memory not available: ${(e as Error).message?.slice(0, 80)}`)
  }
}

async function benchMemoryGraphScaling() {
  console.log('\n⏱️  Benchmark: Search scaling (cosine similarity over N nodes, 1536-dim)')

  const sizes = [50, 200, 500, 1000, 2000, 5000]
  const queryEmb = fakeEmb(999, 1536)

  for (const n of sizes) {
    const g = freshGraph()
    for (let i = 0; i < n; i++) {
      g.addNode(i % 2 === 0 ? 'episodic' : 'semantic', `node ${i}`, fakeEmb(i, 1536))
    }

    await timeMs(`cosine search top-5 over ${n.toString().padStart(5)} nodes`, () => {
      g.searchTextNodes(queryEmb, undefined, 5)
    }, 20)
  }
}

// ─── Main ───

async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Memory System Latency Benchmarks')
  console.log('═══════════════════════════════════════════════════')
  console.log(`  Time: ${new Date().toISOString()}`)
  console.log(`  Platform: ${process.platform} ${process.arch}`)

  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })

  await benchGraphLocalOps()
  await benchMemoryGraphScaling()
  await benchEmbeddingService()
  await benchEntityStoreRecall()
  await benchEndToEndRetrieval()
  await benchVisualMemoryLegacy()

  // Cleanup
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })

  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Benchmarks complete')
  console.log('═══════════════════════════════════════════════════')
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
