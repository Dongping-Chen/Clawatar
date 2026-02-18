/**
 * test-memory-graph.ts — Comprehensive tests for MemoryGraph + EmbeddingService
 *
 * Tests:
 *   1. Basic node CRUD (add, get, update, remove)
 *   2. Edge operations (add, weight, reinforce, weaken, bidirectional key)
 *   3. Same-type text edge rejection (M3-Agent rule)
 *   4. Cosine similarity search (searchTextNodes)
 *   5. Entity-based search (searchByEntity)
 *   6. Dedup & merge (findSimilarNode, mergeOrCreate)
 *   7. Persistence (save/load round-trip)
 *   8. Compact (node eviction by weight * recency)
 *   9. Edge cases (empty embedding, missing nodes, corrupt file)
 *  10. EmbeddingService (cache, batch, API key detection)
 *  11. getConnectedNodes type filtering
 *  12. Stats
 *  13. ClipId monotonic counter
 *  14. Merge content priority (auto vs manual, length)
 *
 * Run: npx tsx server/test-memory-graph.ts
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { MemoryGraph, type MemoryNode } from './memory/memory-graph.js'

// ─── Helpers ───

const TEST_DIR = join(process.env.HOME || '/tmp', '.openclaw-test-memory-graph')
let testCounter = 0

function freshGraphPath(): string {
  testCounter += 1
  return join(TEST_DIR, `graph-${testCounter}-${Date.now()}.json`)
}

function freshGraph(): MemoryGraph {
  return new MemoryGraph(freshGraphPath())
}

/** Generate a fake embedding vector of given dimension */
function fakeEmb(seed: number, dim: number = 8): number[] {
  const v: number[] = []
  for (let i = 0; i < dim; i++) {
    v.push(Math.sin(seed * (i + 1) * 0.7))
  }
  // Normalize
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map(x => x / (norm + 1e-8))
}

/** cosine similarity (for verification) */
function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

let passed = 0
let failed = 0
const failures: string[] = []

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(msg)
    console.error(`  ❌ FAIL: ${msg}`)
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
  } else {
    failed++
    failures.push(`${msg}: expected ${e}, got ${a}`)
    console.error(`  ❌ FAIL: ${msg}: expected ${e}, got ${a}`)
  }
}

function assertApprox(actual: number, expected: number, epsilon: number, msg: string): void {
  if (Math.abs(actual - expected) < epsilon) {
    passed++
  } else {
    failed++
    failures.push(`${msg}: expected ~${expected}, got ${actual}`)
    console.error(`  ❌ FAIL: ${msg}: expected ~${expected}, got ${actual}`)
  }
}

// ─── Test Suites ───

function testNodeCRUD() {
  console.log('\n📦 Test: Node CRUD')
  const g = freshGraph()

  // Add nodes
  const id0 = g.addNode('img', 'a cat sitting on a table', fakeEmb(1), { source: 'camera' })
  const id1 = g.addNode('episodic', 'user said hello', fakeEmb(2), { entityId: 'user1' })
  const id2 = g.addNode('semantic', 'user likes cats', fakeEmb(3))
  const id3 = g.addNode('voice', 'voice clip #1', fakeEmb(4), { clipId: 42 })

  assertEq(id0, 0, 'first node id = 0')
  assertEq(id1, 1, 'second node id = 1')
  assertEq(id2, 2, 'third node id = 2')
  assertEq(id3, 3, 'fourth node id = 3')

  // Get node
  const n0 = g.getNode(id0)
  assert(n0 !== null, 'getNode returns non-null')
  assertEq(n0!.type, 'img', 'node type is img')
  assertEq(n0!.content, 'a cat sitting on a table', 'node content correct')
  assertEq(n0!.metadata.source, 'camera', 'metadata.source correct')

  // Get missing node
  assertEq(g.getNode(999), null, 'getNode for missing id returns null')

  // Get by type
  const imgs = g.getNodesByType('img')
  assertEq(imgs.length, 1, 'getNodesByType img count = 1')
  assertEq(imgs[0].id, id0, 'getNodesByType img id correct')

  const episodics = g.getNodesByType('episodic')
  assertEq(episodics.length, 1, 'getNodesByType episodic count = 1')

  // Update content
  const updated = g.updateNodeContent(id0, 'updated content', fakeEmb(10))
  assert(updated, 'updateNodeContent returns true')
  const n0Updated = g.getNode(id0)
  assertEq(n0Updated!.content, 'updated content', 'content updated')
  assert(n0Updated!.embedding.length === 8, 'embedding updated')

  // Update missing node
  assert(!g.updateNodeContent(999, 'nope'), 'updateNodeContent for missing id returns false')

  // Remove
  assert(g.removeNode(id0), 'removeNode returns true')
  assertEq(g.getNode(id0), null, 'removed node is null')
  assertEq(g.getNodesByType('img').length, 0, 'img type empty after removal')
  assert(!g.removeNode(id0), 'removeNode again returns false')

  // Stats
  const stats = g.getStats()
  assertEq(stats.nodes, 3, 'stats.nodes = 3 after removal')
  assertEq(stats.byType.img, 0, 'stats.byType.img = 0')
  assertEq(stats.byType.episodic, 1, 'stats.byType.episodic = 1')
}

function testEdgeOperations() {
  console.log('\n🔗 Test: Edge Operations')
  const g = freshGraph()

  const imgId = g.addNode('img', 'image of a dog', fakeEmb(1))
  const epiId = g.addNode('episodic', 'saw a dog in the park', fakeEmb(2))
  const semId = g.addNode('semantic', 'user owns a dog', fakeEmb(3))

  // Basic edge
  assert(g.addEdge(imgId, epiId, 2), 'addEdge img→episodic succeeds')
  assertEq(g.getEdgeWeight(imgId, epiId), 2, 'edge weight is 2')

  // Bidirectional key: weight should be same regardless of direction
  assertEq(g.getEdgeWeight(epiId, imgId), 2, 'edge weight bidirectional')

  // Accumulate weight
  assert(g.addEdge(imgId, epiId, 3), 'addEdge again accumulates')
  assertEq(g.getEdgeWeight(imgId, epiId), 5, 'accumulated weight = 5')

  // img → semantic edge
  assert(g.addEdge(imgId, semId, 1), 'addEdge img→semantic succeeds')

  // Self-edge rejected
  assert(!g.addEdge(imgId, imgId), 'self-edge rejected')

  // Edge to missing node
  assert(!g.addEdge(imgId, 999), 'edge to missing node rejected')
  assert(!g.addEdge(999, imgId), 'edge from missing node rejected')

  // Reinforce
  const reinforced = g.reinforceNode(imgId, 2)
  assertEq(reinforced, 2, 'reinforceNode affected 2 edges')
  assertEq(g.getEdgeWeight(imgId, epiId), 7, 'reinforced edge weight = 7')
  assertEq(g.getEdgeWeight(imgId, semId), 3, 'reinforced other edge weight = 3')

  // Weaken
  const weakened = g.weakenNode(imgId, 2)
  assertEq(weakened, 2, 'weakenNode affected 2 edges')
  assertEq(g.getEdgeWeight(imgId, epiId), 5, 'weakened edge weight = 5')
  assertEq(g.getEdgeWeight(imgId, semId), 1, 'weakened other edge weight = 1')

  // Weaken to zero → edge removed
  const weakened2 = g.weakenNode(imgId, 10)
  assertEq(weakened2, 2, 'weakenNode affected 2 edges')
  assertEq(g.getEdgeWeight(imgId, epiId), 0, 'over-weakened edge deleted')
  assertEq(g.getEdgeWeight(imgId, semId), 0, 'over-weakened other edge deleted')

  // Reinforce missing node
  assertEq(g.reinforceNode(999), 0, 'reinforceNode missing node returns 0')
  assertEq(g.weakenNode(999), 0, 'weakenNode missing node returns 0')
}

function testSameTypeEdgeRejection() {
  console.log('\n🚫 Test: Same-Type Text Edge Rejection (M3-Agent Rule)')
  const g = freshGraph()

  const epi1 = g.addNode('episodic', 'event A', fakeEmb(1))
  const epi2 = g.addNode('episodic', 'event B', fakeEmb(2))
  const sem1 = g.addNode('semantic', 'fact A', fakeEmb(3))
  const sem2 = g.addNode('semantic', 'fact B', fakeEmb(4))
  const img1 = g.addNode('img', 'image A', fakeEmb(5))
  const img2 = g.addNode('img', 'image B', fakeEmb(6))
  const voi1 = g.addNode('voice', 'voice A', fakeEmb(7))

  // Same-type text edges should be REJECTED
  assert(!g.addEdge(epi1, epi2), 'episodic→episodic rejected')
  assert(!g.addEdge(sem1, sem2), 'semantic→semantic rejected')

  // Different text types should be ALLOWED
  assert(g.addEdge(epi1, sem1), 'episodic→semantic allowed')

  // img→img and voice→voice: allowed (not text type)
  assert(g.addEdge(img1, img2), 'img→img allowed')

  // Cross-type edges always allowed
  assert(g.addEdge(img1, epi1), 'img→episodic allowed')
  assert(g.addEdge(voi1, sem1), 'voice→semantic allowed')
  assert(g.addEdge(img1, voi1), 'img→voice allowed')
}

function testConnectedNodes() {
  console.log('\n🕸️ Test: getConnectedNodes')
  const g = freshGraph()

  const img = g.addNode('img', 'face of Alice', fakeEmb(1))
  const epi1 = g.addNode('episodic', 'Alice arrived at the café', fakeEmb(2))
  const epi2 = g.addNode('episodic', 'Alice ordered coffee', fakeEmb(3))
  const sem1 = g.addNode('semantic', 'Alice likes coffee', fakeEmb(4))
  const voice = g.addNode('voice', 'Alice voice clip', fakeEmb(5))

  g.addEdge(img, epi1, 1)
  g.addEdge(img, epi2, 1)
  g.addEdge(img, sem1, 1)
  g.addEdge(img, voice, 1)

  // All connected
  const allConnected = g.getConnectedNodes(img)
  assertEq(allConnected.length, 4, 'img connected to 4 nodes')

  // Filter by type
  const episodics = g.getConnectedNodes(img, ['episodic'])
  assertEq(episodics.length, 2, 'img connected to 2 episodic nodes')

  const semantics = g.getConnectedNodes(img, ['semantic'])
  assertEq(semantics.length, 1, 'img connected to 1 semantic node')

  // Multiple type filter
  const textNodes = g.getConnectedNodes(img, ['episodic', 'semantic'])
  assertEq(textNodes.length, 3, 'img connected to 3 text nodes')

  // Missing node
  assertEq(g.getConnectedNodes(999).length, 0, 'missing node has 0 connections')
}

function testCosineSimilaritySearch() {
  console.log('\n🔍 Test: searchTextNodes (Cosine Similarity)')
  const g = freshGraph()

  // Create some text nodes with known embeddings
  const emb1 = fakeEmb(1)
  const emb2 = fakeEmb(2)
  const emb3 = fakeEmb(100) // very different
  const queryEmb = fakeEmb(1.1) // close to emb1

  const epi1 = g.addNode('episodic', 'user greeted me', emb1)
  const epi2 = g.addNode('episodic', 'user asked about weather', emb2)
  const sem1 = g.addNode('semantic', 'user is friendly', emb3)

  // Also add img node — should NOT appear in text search
  g.addNode('img', 'face photo', fakeEmb(1.05))

  // Search all text nodes
  const results = g.searchTextNodes(queryEmb, undefined, 10)
  assert(results.length === 3, `search returns 3 text nodes, got ${results.length}`)

  // First result should be closest to query (emb1, seed=1 vs query seed=1.1)
  const sim1 = cosine(queryEmb, emb1)
  const sim2 = cosine(queryEmb, emb2)
  const sim3 = cosine(queryEmb, emb3)
  assert(sim1 > sim2, 'emb1 should be more similar to query than emb2')
  assertEq(results[0].nodeId, epi1, 'top result is epi1 (closest embedding)')
  assertApprox(results[0].score, sim1, 0.001, 'score matches cosine similarity')

  // Search with range (only connected to a specific anchor)
  const imgAnchor = g.addNode('img', 'anchor image', fakeEmb(50))
  g.addEdge(imgAnchor, epi1, 1)
  // Now search restricted to imgAnchor's connections
  const rangedResults = g.searchTextNodes(queryEmb, [imgAnchor.valueOf()])
  assertEq(rangedResults.length, 1, 'ranged search returns only connected text node')
  assertEq(rangedResults[0].nodeId, epi1, 'ranged search finds epi1')

  // Search with empty embedding
  const emptyResults = g.searchTextNodes([], undefined, 5)
  assertEq(emptyResults.length, 0, 'empty embedding returns no results')

  // topk = 1
  const top1 = g.searchTextNodes(queryEmb, undefined, 1)
  assertEq(top1.length, 1, 'topk=1 returns 1 result')
}

function testSearchByEntity() {
  console.log('\n👤 Test: searchByEntity')
  const g = freshGraph()

  // Create entity node (img = face)
  const faceId = g.addNode('img', 'face: Alice', fakeEmb(1))
  const voiceId = g.addNode('voice', 'voice: Alice', fakeEmb(2))

  // Create episodic/semantic nodes linked to entity
  const epi1 = g.addNode('episodic', 'Alice arrived at office', fakeEmb(10))
  const epi2 = g.addNode('episodic', 'Alice had lunch', fakeEmb(11))
  const sem1 = g.addNode('semantic', 'Alice works at Google', fakeEmb(12))
  const unrelated = g.addNode('episodic', 'weather was sunny', fakeEmb(20))

  g.addEdge(faceId, epi1, 5)
  g.addEdge(faceId, epi2, 3)
  g.addEdge(faceId, sem1, 2)
  g.addEdge(voiceId, epi1, 2)

  // Search by face entity
  const results = g.searchByEntity([faceId])
  assertEq(results.length, 3, 'searchByEntity returns 3 linked nodes')
  assertEq(results[0].nodeId, epi1, 'highest edge weight = epi1 (5)')
  assertEq(results[0].score, 5, 'score = edge weight 5')
  assertEq(results[1].nodeId, epi2, 'second = epi2 (3)')
  assertEq(results[2].nodeId, sem1, 'third = sem1 (2)')

  // Search by both entity nodes (scores accumulate)
  const multiResults = g.searchByEntity([faceId, voiceId])
  // epi1 is linked to both: face(5) + voice(2) = 7
  const epi1Result = multiResults.find(r => r.nodeId === epi1)
  assert(epi1Result !== undefined, 'epi1 found in multi-entity search')
  assertEq(epi1Result!.score, 7, 'epi1 accumulated score = 7 (5+2)')

  // Unrelated node should NOT appear
  const unrelatedResult = multiResults.find(r => r.nodeId === unrelated)
  assertEq(unrelatedResult, undefined, 'unrelated node not in results')

  // Empty input
  assertEq(g.searchByEntity([]).length, 0, 'empty entity ids returns 0')
  assertEq(g.searchByEntity([999]).length, 0, 'missing entity id returns 0')
}

function testDedupAndMerge() {
  console.log('\n🔀 Test: Dedup & Merge')
  const g = freshGraph()

  const emb1 = fakeEmb(1, 8)

  // findSimilarNode — no nodes yet
  assertEq(g.findSimilarNode(emb1, 'episodic', 0.85), null, 'no similar node in empty graph')

  // Add an episodic node
  g.addNode('episodic', 'original content', emb1, { source: 'camera' })

  // Find similar with same embedding → should find it
  const found = g.findSimilarNode(emb1, 'episodic', 0.85)
  assertEq(found, 0, 'findSimilarNode returns id 0')

  // Find similar with slightly different embedding
  const emb1Shifted = fakeEmb(1.02, 8) // very close
  const sim = cosine(emb1, emb1Shifted)
  assert(sim > 0.85, `shifted embedding similarity ${sim.toFixed(3)} > 0.85`)
  const foundShifted = g.findSimilarNode(emb1Shifted, 'episodic', 0.85)
  assert(foundShifted !== null, 'findSimilarNode finds slightly shifted embedding')

  // Find similar with very different embedding
  const embFar = fakeEmb(100, 8)
  const farSim = cosine(emb1, embFar)
  assert(farSim < 0.85, `far embedding similarity ${farSim.toFixed(3)} < 0.85`)
  assertEq(g.findSimilarNode(embFar, 'episodic', 0.85), null, 'far embedding not found')

  // findSimilarNode for img type → always null (non-text)
  g.addNode('img', 'some image', emb1)
  assertEq(g.findSimilarNode(emb1, 'img', 0.5), null, 'findSimilarNode for img always null')

  // mergeOrCreate — new node
  const mc1 = g.mergeOrCreate('episodic', 'new event', fakeEmb(50, 8))
  assert(!mc1.merged, 'mergeOrCreate creates new node')
  assert(mc1.nodeId >= 0, 'mergeOrCreate returns valid nodeId')

  // mergeOrCreate — merge into existing (same embedding)
  const mc2 = g.mergeOrCreate('episodic', 'new event updated', fakeEmb(50, 8))
  assert(mc2.merged, 'mergeOrCreate merges into existing')
  assertEq(mc2.nodeId, mc1.nodeId, 'merged into same node')

  // Check merged node: content should be updated (longer)
  const mergedNode = g.getNode(mc2.nodeId)
  assertEq(mergedNode!.content, 'new event updated', 'merged content is longer version')
  assertEq(mergedNode!.weight, 2, 'merged weight incremented to 2')

  // mergeOrCreate with entity links
  const entityId = g.addNode('img', 'entity face', fakeEmb(60, 8))
  const mc3 = g.mergeOrCreate('semantic', 'user fact', fakeEmb(70, 8), {}, [entityId])
  assert(!mc3.merged, 'new semantic node created')
  const connected = g.getConnectedNodes(entityId)
  assert(connected.includes(mc3.nodeId), 'entity linked to new semantic node')
}

function testMergeContentPriority() {
  console.log('\n📝 Test: Merge Content Priority (auto vs manual)')
  const g = freshGraph()

  const emb = fakeEmb(42, 8)

  // Create node with [auto] prefix
  g.mergeOrCreate('episodic', '[auto] brief description', emb)

  // Merge with non-auto content → should replace
  const mc = g.mergeOrCreate('episodic', 'detailed human description', emb)
  assert(mc.merged, 'merged into existing')
  const node = g.getNode(mc.nodeId)
  assertEq(node!.content, 'detailed human description', 'auto content replaced by manual')

  // Now merge with shorter non-auto → should NOT replace (shorter)
  const mc2 = g.mergeOrCreate('episodic', 'short', emb)
  assert(mc2.merged, 'merged again')
  const node2 = g.getNode(mc2.nodeId)
  assertEq(node2!.content, 'detailed human description', 'longer content preserved')
}

function testPersistence() {
  console.log('\n💾 Test: Persistence (save/load)')
  const path = freshGraphPath()
  
  // Create and populate graph
  {
    const g = new MemoryGraph(path)
    const img = g.addNode('img', 'saved image', fakeEmb(1), { thumbnailPath: '/tmp/x.jpg', hash: 'abc123' })
    const epi = g.addNode('episodic', 'saved event', fakeEmb(2), { entityId: 'e1' })
    const sem = g.addNode('semantic', 'saved fact', fakeEmb(3))
    g.addEdge(img, epi, 5)
    g.addEdge(img, sem, 3)
    g.save()
  }

  // Verify file exists
  assert(existsSync(path), 'graph file exists after save')

  // Load into new instance
  {
    const g2 = new MemoryGraph(path)
    const stats = g2.getStats()
    assertEq(stats.nodes, 3, 'loaded 3 nodes')
    assertEq(stats.edges, 2, 'loaded 2 edges')

    // Verify node contents
    const img = g2.getNode(0)
    assertEq(img!.content, 'saved image', 'loaded img content correct')
    assertEq(img!.type, 'img', 'loaded img type correct')
    assertEq(img!.metadata.thumbnailPath, '/tmp/x.jpg', 'loaded thumbnailPath correct')
    assertEq(img!.metadata.hash, 'abc123', 'loaded hash correct')
    assert(img!.embedding.length === 8, 'loaded embedding has correct dimension')

    // Verify edge weights
    assertEq(g2.getEdgeWeight(0, 1), 5, 'loaded edge 0→1 weight = 5')
    assertEq(g2.getEdgeWeight(0, 2), 3, 'loaded edge 0→2 weight = 3')

    // Add new node — should get correct next ID
    const newId = g2.addNode('voice', 'new after load', fakeEmb(4))
    assertEq(newId, 3, 'new node after load gets id 3')
  }
}

function testPersistenceCorruptFile() {
  console.log('\n💥 Test: Persistence with corrupt file')
  const path = freshGraphPath()

  // Write garbage
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(path, 'this is not json!!!', 'utf-8')

  // Should not throw, just start empty
  const g = new MemoryGraph(path)
  const stats = g.getStats()
  assertEq(stats.nodes, 0, 'corrupt file → 0 nodes')
  assertEq(stats.edges, 0, 'corrupt file → 0 edges')
}

function testPersistenceEdgeOrphans() {
  console.log('\n🧹 Test: Persistence prunes orphaned edges')
  const path = freshGraphPath()

  // Manually write a graph with an edge pointing to a non-existent node
  mkdirSync(TEST_DIR, { recursive: true })
  const data = {
    version: 1,
    nextNodeId: 2,
    nextClipId: 1,
    nodes: [
      { id: 0, type: 'img', content: 'image', embedding: [1, 0], weight: 1, metadata: { timestamp: new Date().toISOString() } },
      { id: 1, type: 'episodic', content: 'event', embedding: [0, 1], weight: 1, metadata: { timestamp: new Date().toISOString() } },
    ],
    edges: [
      { from: 0, to: 1, weight: 5 },
      { from: 0, to: 999, weight: 3 }, // orphan edge
      { from: 888, to: 1, weight: 2 }, // orphan edge
    ],
  }
  writeFileSync(path, JSON.stringify(data), 'utf-8')

  const g = new MemoryGraph(path)
  assertEq(g.getStats().edges, 1, 'orphaned edges pruned on load')
  assertEq(g.getEdgeWeight(0, 1), 5, 'valid edge preserved')
  assertEq(g.getEdgeWeight(0, 999), 0, 'orphan edge 0→999 gone')
}

function testCompact() {
  console.log('\n🗜️ Test: Compact (eviction)')
  const g = freshGraph()

  // Add 20 episodic nodes
  for (let i = 0; i < 20; i++) {
    g.addNode('episodic', `event ${i}`, fakeEmb(i), {
      timestamp: new Date(Date.now() - i * 3600 * 1000).toISOString(), // older = higher i
    })
  }

  // Also add img node (should NOT be compacted — only episodic/semantic are candidates)
  g.addNode('img', 'important image', fakeEmb(100))

  assertEq(g.getStats().nodes, 21, '21 nodes before compact')

  // Compact to max 10 → target 8 (80%) → remove 13
  const result = g.compact(10)
  assert(result.removed > 0, 'compact removed nodes')
  assert(g.getStats().nodes <= 10, `after compact: ${g.getStats().nodes} ≤ 10`)

  // Img node should survive (not a compact candidate)
  const imgs = g.getNodesByType('img')
  assertEq(imgs.length, 1, 'img node survives compact')
}

function testCompactPreservesHighWeight() {
  console.log('\n⚖️ Test: Compact preserves high-weight nodes')
  const g = freshGraph()

  // Low weight, old
  for (let i = 0; i < 10; i++) {
    g.addNode('episodic', `low weight event ${i}`, fakeEmb(i), {
      timestamp: new Date(Date.now() - 1000 * 3600 * 1000).toISOString(), // very old
    })
  }

  // High weight, also old
  const highWeightId = g.addNode('semantic', 'important fact', fakeEmb(50), {
    timestamp: new Date(Date.now() - 1000 * 3600 * 1000).toISOString(),
  }, 100) // weight=100

  assertEq(g.getStats().nodes, 11, '11 nodes before compact')

  g.compact(5) // target 4

  // High weight node should survive
  const highNode = g.getNode(highWeightId)
  assert(highNode !== null, 'high weight node survives compact')
}

function testClipIdMonotonic() {
  console.log('\n🔢 Test: ClipId monotonic counter')
  const path = freshGraphPath()

  {
    const g = new MemoryGraph(path)
    const id1 = g.addNode('episodic', 'event 1', fakeEmb(1))
    const id2 = g.addNode('episodic', 'event 2', fakeEmb(2))
    const id3 = g.addNode('semantic', 'fact 1', fakeEmb(3))

    const n1 = g.getNode(id1)
    const n2 = g.getNode(id2)
    const n3 = g.getNode(id3)

    assert(typeof n1!.metadata.clipId === 'number', 'episodic node gets clipId')
    assert(typeof n2!.metadata.clipId === 'number', 'second episodic gets clipId')
    assert(typeof n3!.metadata.clipId === 'number', 'semantic gets clipId')
    assert(n1!.metadata.clipId! < n2!.metadata.clipId!, 'clipId is monotonically increasing')
    assert(n2!.metadata.clipId! < n3!.metadata.clipId!, 'clipId continues increasing')

    // img node should NOT get auto clipId
    const imgId = g.addNode('img', 'photo', fakeEmb(4))
    const imgNode = g.getNode(imgId)
    assertEq(imgNode!.metadata.clipId, undefined, 'img node has no clipId')

    g.save()
  }

  // After reload, clipId should continue from where it left off
  {
    const g2 = new MemoryGraph(path)
    const newId = g2.addNode('episodic', 'event after reload', fakeEmb(5))
    const newNode = g2.getNode(newId)
    assert(newNode!.metadata.clipId! >= 3, 'clipId after reload continues from saved state')
  }
}

function testNodeImmutability() {
  console.log('\n🛡️ Test: Node immutability (getNode returns clone)')
  const g = freshGraph()
  g.addNode('episodic', 'original', fakeEmb(1))

  const node = g.getNode(0)!
  node.content = 'MUTATED'
  node.embedding[0] = 999
  node.metadata.source = 'HACKED'

  const nodeAgain = g.getNode(0)!
  assertEq(nodeAgain.content, 'original', 'mutation on returned node does not affect graph')
  assert(nodeAgain.embedding[0] !== 999, 'embedding not mutated')
  assert(nodeAgain.metadata.source !== 'HACKED', 'metadata not mutated')
}

function testEdgeCases() {
  console.log('\n🧪 Test: Edge Cases')
  const g = freshGraph()

  // addNode with empty embedding
  const id = g.addNode('episodic', 'no embedding', [])
  const node = g.getNode(id)
  assertEq(node!.embedding.length, 0, 'empty embedding stored')

  // searchTextNodes with a node that has empty embedding — should be skipped
  const results = g.searchTextNodes(fakeEmb(1))
  assertEq(results.length, 0, 'node with empty embedding skipped in search')

  // addEdge with 0 weight (accumulate → 0 is still positive start)
  // First add: weight = 0, but 0 + 0 = 0, which is ≤ 0 → should fail
  const id2 = g.addNode('img', 'image', fakeEmb(2))
  assert(!g.addEdge(id, id2, 0), 'addEdge with 0 weight rejected (0+0 ≤ 0)')

  // Negative weight
  assert(!g.addEdge(id, id2, -5), 'addEdge with negative weight rejected')

  // addNode with negative weight → clamped to 0.1
  const negWeightId = g.addNode('semantic', 'neg weight', fakeEmb(3), {}, -5)
  const negNode = g.getNode(negWeightId)
  assertEq(negNode!.weight, 0.1, 'negative weight clamped to 0.1')
}

function testRemoveNodeCleansEdges() {
  console.log('\n🧹 Test: removeNode cleans up edges')
  const g = freshGraph()

  const a = g.addNode('img', 'A', fakeEmb(1))
  const b = g.addNode('episodic', 'B', fakeEmb(2))
  const c = g.addNode('semantic', 'C', fakeEmb(3))

  g.addEdge(a, b, 1)
  g.addEdge(a, c, 1)
  g.addEdge(b, c, 1) // episodic→semantic is allowed

  assertEq(g.getStats().edges, 3, '3 edges before removal')

  g.removeNode(a)

  assertEq(g.getStats().edges, 1, 'only b→c edge remains after removing a')
  assertEq(g.getEdgeWeight(b, c), 1, 'b→c edge intact')
  assertEq(g.getEdgeWeight(a, b), 0, 'a→b edge gone')
}

// ─── EmbeddingService Tests (unit tests without API calls) ───

async function testEmbeddingServiceImport() {
  console.log('\n🔌 Test: EmbeddingService import & availability check')
  try {
    const { isEmbeddingServiceAvailable, getTextEmbedding, getTextEmbeddings } = await import('./memory/embedding-service.js')
    assert(typeof isEmbeddingServiceAvailable === 'function', 'isEmbeddingServiceAvailable is a function')
    assert(typeof getTextEmbedding === 'function', 'getTextEmbedding is a function')
    assert(typeof getTextEmbeddings === 'function', 'getTextEmbeddings is a function')

    // Check availability (depends on env)
    const available = isEmbeddingServiceAvailable()
    assert(typeof available === 'boolean', 'availability returns boolean')
    console.log(`  ℹ️  Embedding service available: ${available}`)

    // getTextEmbeddings with empty array → should return empty
    const empty = await getTextEmbeddings([])
    assertEq(empty.length, 0, 'getTextEmbeddings([]) returns []')
  } catch (e) {
    failed++
    failures.push(`EmbeddingService import failed: ${e}`)
    console.error(`  ❌ EmbeddingService import failed: ${e}`)
  }
}

async function testEmbeddingServiceLive() {
  console.log('\n🌐 Test: EmbeddingService LIVE API call (if key available)')
  try {
    const { isEmbeddingServiceAvailable, getTextEmbedding, getTextEmbeddings } = await import('./memory/embedding-service.js')

    if (!isEmbeddingServiceAvailable()) {
      console.log('  ⏭️  Skipped (no API key)')
      return
    }

    // Single embedding
    const emb = await getTextEmbedding('hello world')
    assert(emb.length > 0, `single embedding has dimensions: ${emb.length}`)
    assertEq(emb.length, 1536, 'text-embedding-3-small returns 1536 dimensions')

    // Batch embeddings
    const batch = await getTextEmbeddings(['hello', 'world', 'test'])
    assertEq(batch.length, 3, 'batch returns 3 embeddings')
    assert(batch[0].length === 1536, 'batch[0] has 1536 dims')
    assert(batch[1].length === 1536, 'batch[1] has 1536 dims')

    // Similarity check: "hello" should be more similar to "hi" than to "quantum physics"
    const [embHello, embHi, embPhysics] = await getTextEmbeddings(['hello', 'hi there', 'quantum physics equations'])
    const simHelloHi = cosine(embHello, embHi)
    const simHelloPhysics = cosine(embHello, embPhysics)
    console.log(`  ℹ️  cos(hello, hi) = ${simHelloHi.toFixed(4)}, cos(hello, physics) = ${simHelloPhysics.toFixed(4)}`)
    assert(simHelloHi > simHelloPhysics, '"hello" more similar to "hi" than "quantum physics"')

    // Cache test: second call should be instant
    const t0 = Date.now()
    const embCached = await getTextEmbedding('hello world')
    const cacheMs = Date.now() - t0
    assertEq(embCached.length, 1536, 'cached result has correct dimensions')
    assert(cacheMs < 50, `cache hit took ${cacheMs}ms (should be <50ms)`)
    console.log(`  ℹ️  Cache hit latency: ${cacheMs}ms`)

    // Empty string
    const embEmpty = await getTextEmbedding('')
    assertEq(embEmpty.length, 0, 'empty string returns empty embedding')

  } catch (e) {
    failed++
    failures.push(`EmbeddingService live test failed: ${e}`)
    console.error(`  ❌ EmbeddingService live test failed: ${e}`)
  }
}

// ─── Integration: MemoryGraph + EmbeddingService ───

async function testIntegrationSearch() {
  console.log('\n🔗 Test: Integration — MemoryGraph + real embeddings')
  try {
    const { isEmbeddingServiceAvailable, getTextEmbedding, getTextEmbeddings } = await import('./memory/embedding-service.js')

    if (!isEmbeddingServiceAvailable()) {
      console.log('  ⏭️  Skipped (no API key)')
      return
    }

    const g = freshGraph()

    // Create nodes with real embeddings
    const texts = [
      'Alice walked into the café and ordered a latte',
      'Bob was talking about machine learning algorithms',
      'The weather was sunny and warm today',
      'Alice mentioned she likes cats and dogs',
      'Bob showed his latest deep learning paper',
    ]

    const embeddings = await getTextEmbeddings(texts)

    const ids: number[] = []
    for (let i = 0; i < texts.length; i++) {
      const id = g.addNode('episodic', texts[i], embeddings[i])
      ids.push(id)
    }

    // Search: "What do we know about Alice?"
    const queryEmb = await getTextEmbedding('What do we know about Alice?')
    const results = g.searchTextNodes(queryEmb, undefined, 3)

    assert(results.length === 3, 'top-3 results returned')
    // Results about Alice should rank higher
    const topContent = g.getNode(results[0].nodeId)!.content
    console.log(`  ℹ️  Top result: "${topContent}" (score: ${results[0].score.toFixed(4)})`)
    assert(
      topContent.includes('Alice'),
      `top result mentions Alice: "${topContent}"`,
    )

    // Search: "machine learning"
    const mlQuery = await getTextEmbedding('machine learning research')
    const mlResults = g.searchTextNodes(mlQuery, undefined, 2)
    const mlTop = g.getNode(mlResults[0].nodeId)!.content
    console.log(`  ℹ️  ML top: "${mlTop}" (score: ${mlResults[0].score.toFixed(4)})`)
    assert(mlTop.includes('machine learning') || mlTop.includes('deep learning'), 'ML query finds ML content')

    // mergeOrCreate with real embeddings
    const newEmb = await getTextEmbedding('Alice walked into the café and got coffee')
    const sim = cosine(embeddings[0], newEmb)
    console.log(`  ℹ️  Similarity between original and variant: ${sim.toFixed(4)}`)

    const mc = g.mergeOrCreate('episodic', 'Alice walked into the café and got coffee', newEmb)
    if (sim > 0.85) {
      assert(mc.merged, `similar content merged (sim=${sim.toFixed(3)})`)
    } else {
      assert(!mc.merged, `content not similar enough to merge (sim=${sim.toFixed(3)})`)
    }

    console.log(`  ℹ️  Merged: ${mc.merged}, nodeId: ${mc.nodeId}`)

  } catch (e) {
    failed++
    failures.push(`Integration test failed: ${e}`)
    console.error(`  ❌ Integration test failed: ${e}`)
  }
}

// ─── Run All Tests ───

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  Memory Graph + Embedding Service Tests')
  console.log('═══════════════════════════════════════════════')

  // Ensure clean test dir
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
  mkdirSync(TEST_DIR, { recursive: true })

  // Pure unit tests (no API calls)
  testNodeCRUD()
  testEdgeOperations()
  testSameTypeEdgeRejection()
  testConnectedNodes()
  testCosineSimilaritySearch()
  testSearchByEntity()
  testDedupAndMerge()
  testMergeContentPriority()
  testPersistence()
  testPersistenceCorruptFile()
  testPersistenceEdgeOrphans()
  testCompact()
  testCompactPreservesHighWeight()
  testClipIdMonotonic()
  testNodeImmutability()
  testEdgeCases()
  testRemoveNodeCleansEdges()

  // Async tests (may hit API)
  await testEmbeddingServiceImport()
  await testEmbeddingServiceLive()
  await testIntegrationSearch()

  // Cleanup
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }

  // Report
  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════════')

  if (failures.length > 0) {
    console.log('\nFailed tests:')
    for (const f of failures) {
      console.log(`  ❌ ${f}`)
    }
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})
