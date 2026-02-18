import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface MemoryNode {
  id: number
  type: 'img' | 'voice' | 'episodic' | 'semantic'
  content: string
  embedding: number[]
  weight: number
  metadata: {
    timestamp: string
    source?: string
    thumbnailPath?: string
    hash?: string
    entityId?: string
    clipId?: number
  }
}

export interface SerializedGraph {
  version: number
  nextNodeId: number
  nextClipId: number
  nodes: MemoryNode[]
  edges: Array<{ from: number; to: number; weight: number }>
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

function edgeKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`
}

function cloneNode(node: MemoryNode): MemoryNode {
  return {
    ...node,
    embedding: [...node.embedding],
    metadata: { ...node.metadata },
  }
}

function isTextNodeType(type: MemoryNode['type']): boolean {
  return type === 'episodic' || type === 'semantic'
}

const GRAPH_VERSION = 1
const DEFAULT_MAX_NODES = 1000

export class MemoryGraph {
  private nodes: Map<number, MemoryNode> = new Map()
  private edges: Map<string, number> = new Map()
  private nextNodeId: number = 0
  private nextClipId: number = 0
  private dirty: boolean = false
  private savePath: string

  constructor(savePath?: string) {
    this.savePath = savePath || join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual', 'memory-graph.json')
    mkdirSync(dirname(this.savePath), { recursive: true })
    this.load()
  }

  // === Node Operations ===

  addNode(
    type: MemoryNode['type'],
    content: string,
    embedding: number[],
    metadata: Partial<MemoryNode['metadata']> = {},
    weight: number = 1,
  ): number {
    const id = this.nextNodeId
    this.nextNodeId += 1

    const isText = isTextNodeType(type)
    const normalizedMetadata: MemoryNode['metadata'] = {
      ...(metadata as MemoryNode['metadata']),
      timestamp: metadata.timestamp || new Date().toISOString(),
      source: metadata.source,
      thumbnailPath: metadata.thumbnailPath,
      hash: metadata.hash,
      entityId: metadata.entityId,
      clipId: metadata.clipId ?? (isText ? this.nextClipId++ : undefined),
    }

    const node: MemoryNode = {
      id,
      type,
      content,
      embedding: Array.isArray(embedding) ? [...embedding] : [],
      weight: Number.isFinite(weight) ? Math.max(0.1, weight) : 1,
      metadata: normalizedMetadata,
    }

    this.nodes.set(id, node)
    this.dirty = true
    return id
  }

  getNode(id: number): MemoryNode | null {
    const node = this.nodes.get(id)
    return node ? cloneNode(node) : null
  }

  getNodesByType(type: MemoryNode['type']): MemoryNode[] {
    const out: MemoryNode[] = []
    for (const node of this.nodes.values()) {
      if (node.type === type) out.push(cloneNode(node))
    }
    return out
  }

  updateNodeContent(id: number, content: string, embedding?: number[]): boolean {
    const node = this.nodes.get(id)
    if (!node) return false

    node.content = content
    if (Array.isArray(embedding) && embedding.length > 0) {
      node.embedding = [...embedding]
    }
    this.dirty = true
    return true
  }

  removeNode(id: number): boolean {
    if (!this.nodes.has(id)) return false

    this.nodes.delete(id)
    for (const key of Array.from(this.edges.keys())) {
      const [from, to] = key.split('-').map(Number)
      if (from === id || to === id) {
        this.edges.delete(key)
      }
    }

    this.dirty = true
    return true
  }

  // === Edge Operations ===

  addEdge(from: number, to: number, weight: number = 1): boolean {
    if (from === to) return false

    const fromNode = this.nodes.get(from)
    const toNode = this.nodes.get(to)
    if (!fromNode || !toNode) return false

    // M3-Agent rule: do not connect same-type text nodes.
    if (isTextNodeType(fromNode.type) && isTextNodeType(toNode.type) && fromNode.type === toNode.type) {
      return false
    }

    const key = edgeKey(from, to)
    const nextWeight = (this.edges.get(key) || 0) + Math.max(0, weight)
    if (nextWeight <= 0) return false

    this.edges.set(key, nextWeight)
    this.dirty = true
    return true
  }

  getEdgeWeight(from: number, to: number): number {
    return this.edges.get(edgeKey(from, to)) || 0
  }

  reinforceNode(nodeId: number, delta: number = 1): number {
    if (!this.nodes.has(nodeId) || delta <= 0) return 0

    let affected = 0
    for (const [key, value] of this.edges.entries()) {
      const [from, to] = key.split('-').map(Number)
      if (from === nodeId || to === nodeId) {
        this.edges.set(key, value + delta)
        affected += 1
      }
    }

    if (affected > 0) this.dirty = true
    return affected
  }

  weakenNode(nodeId: number, delta: number = 1): number {
    if (!this.nodes.has(nodeId) || delta <= 0) return 0

    let affected = 0
    for (const [key, value] of Array.from(this.edges.entries())) {
      const [from, to] = key.split('-').map(Number)
      if (from === nodeId || to === nodeId) {
        const next = value - delta
        if (next <= 0) this.edges.delete(key)
        else this.edges.set(key, next)
        affected += 1
      }
    }

    if (affected > 0) this.dirty = true
    return affected
  }

  getConnectedNodes(nodeId: number, types?: MemoryNode['type'][]): number[] {
    if (!this.nodes.has(nodeId)) return []

    const allowed = types && types.length > 0 ? new Set(types) : null
    const out = new Set<number>()

    for (const key of this.edges.keys()) {
      const [from, to] = key.split('-').map(Number)
      if (from !== nodeId && to !== nodeId) continue

      const otherId = from === nodeId ? to : from
      const otherNode = this.nodes.get(otherId)
      if (!otherNode) continue
      if (allowed && !allowed.has(otherNode.type)) continue
      out.add(otherId)
    }

    return Array.from(out)
  }

  // === Search ===

  searchTextNodes(
    queryEmbedding: number[],
    rangeNodeIds?: number[],
    topk: number = 5,
  ): Array<{ nodeId: number; score: number }> {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return []

    const searchIds = new Set<number>()

    if (Array.isArray(rangeNodeIds) && rangeNodeIds.length > 0) {
      for (const anchorId of rangeNodeIds) {
        const anchorNode = this.nodes.get(anchorId)
        if (anchorNode && isTextNodeType(anchorNode.type)) {
          searchIds.add(anchorId)
        }
        for (const connectedId of this.getConnectedNodes(anchorId, ['episodic', 'semantic'])) {
          searchIds.add(connectedId)
        }
      }
    } else {
      for (const node of this.nodes.values()) {
        if (isTextNodeType(node.type)) searchIds.add(node.id)
      }
    }

    const scored: Array<{ nodeId: number; score: number }> = []

    for (const id of searchIds) {
      const node = this.nodes.get(id)
      if (!node || !isTextNodeType(node.type) || node.embedding.length === 0) continue
      const score = cosineSimilarity(queryEmbedding, node.embedding)
      if (Number.isFinite(score)) {
        scored.push({ nodeId: id, score })
      }
    }

    const safeTopK = Math.max(1, topk)
    return scored
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const nodeA = this.nodes.get(a.nodeId)
        const nodeB = this.nodes.get(b.nodeId)
        return (nodeB?.weight || 0) - (nodeA?.weight || 0)
      })
      .slice(0, safeTopK)
  }

  searchByEntity(entityNodeIds: number[], topk: number = 10): Array<{ nodeId: number; score: number; content: string }> {
    if (!Array.isArray(entityNodeIds) || entityNodeIds.length === 0) return []

    const scores = new Map<number, number>()

    for (const entityNodeId of entityNodeIds) {
      if (!this.nodes.has(entityNodeId)) continue
      for (const nodeId of this.getConnectedNodes(entityNodeId, ['episodic', 'semantic'])) {
        const edgeWeight = this.getEdgeWeight(entityNodeId, nodeId)
        scores.set(nodeId, (scores.get(nodeId) || 0) + edgeWeight)
      }
    }

    const safeTopK = Math.max(1, topk)
    return Array.from(scores.entries())
      .map(([nodeId, score]) => {
        const node = this.nodes.get(nodeId)
        return node ? { nodeId, score, content: node.content } : null
      })
      .filter((item): item is { nodeId: number; score: number; content: string } => Boolean(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, safeTopK)
  }

  // === Dedup & Merge ===

  findSimilarNode(
    embedding: number[],
    type: MemoryNode['type'],
    threshold: number = 0.9,
  ): number | null {
    if (!isTextNodeType(type)) return null
    if (!Array.isArray(embedding) || embedding.length === 0) return null

    let bestNodeId: number | null = null
    let bestScore = threshold

    for (const node of this.nodes.values()) {
      if (node.type !== type || node.embedding.length === 0) continue
      const score = cosineSimilarity(embedding, node.embedding)
      if (score > bestScore) {
        bestScore = score
        bestNodeId = node.id
      }
    }

    return bestNodeId
  }

  mergeOrCreate(
    type: 'episodic' | 'semantic',
    content: string,
    embedding: number[],
    metadata: Partial<MemoryNode['metadata']> = {},
    linkedEntityIds: number[] = [],
  ): { nodeId: number; merged: boolean } {
    const threshold = type === 'episodic' ? 0.85 : 0.9
    const similarNodeId = this.findSimilarNode(embedding, type, threshold)

    if (similarNodeId !== null) {
      const node = this.nodes.get(similarNodeId)
      if (!node) {
        return { nodeId: this.addNode(type, content, embedding, metadata), merged: false }
      }

      const existingIsAuto = /^\[auto\]/i.test(node.content)
      const incomingIsAuto = /^\[auto\]/i.test(content)
      const shouldUpdateContent =
        (existingIsAuto && !incomingIsAuto) || content.trim().length > node.content.trim().length

      if (shouldUpdateContent) {
        node.content = content
        if (Array.isArray(embedding) && embedding.length > 0) {
          node.embedding = [...embedding]
        }
      }

      node.weight += 1
      node.metadata = {
        ...node.metadata,
        ...metadata,
        timestamp: metadata.timestamp || new Date().toISOString(),
      }
      if (node.metadata.clipId === undefined) {
        node.metadata.clipId = this.nextClipId++
      }

      this.reinforceNode(similarNodeId, 1)

      for (const entityId of linkedEntityIds) {
        this.addEdge(similarNodeId, entityId, 1)
      }

      this.dirty = true
      return { nodeId: similarNodeId, merged: true }
    }

    const nodeId = this.addNode(type, content, embedding, metadata)
    for (const entityId of linkedEntityIds) {
      this.addEdge(nodeId, entityId, 1)
    }

    this.dirty = true
    return { nodeId, merged: false }
  }

  // === Persistence ===

  save(): void {
    if (!this.dirty) return

    try {
      mkdirSync(dirname(this.savePath), { recursive: true })

      const serialized: SerializedGraph = {
        version: GRAPH_VERSION,
        nextNodeId: this.nextNodeId,
        nextClipId: this.nextClipId,
        nodes: Array.from(this.nodes.values())
          .map(cloneNode)
          .sort((a, b) => a.id - b.id),
        edges: Array.from(this.edges.entries())
          .map(([key, weight]) => {
            const [from, to] = key.split('-').map(Number)
            return { from, to, weight }
          })
          .sort((a, b) => (a.from - b.from) || (a.to - b.to)),
      }

      writeFileSync(this.savePath, JSON.stringify(serialized, null, 2), 'utf-8')
      this.dirty = false
    } catch (e) {
      console.error('[MemoryGraph] Failed to save graph:', e)
    }
  }

  load(): void {
    this.nodes.clear()
    this.edges.clear()
    this.nextNodeId = 0
    this.nextClipId = 0

    if (!existsSync(this.savePath)) {
      this.dirty = false
      return
    }

    try {
      const raw = readFileSync(this.savePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<SerializedGraph>

      this.nextNodeId = typeof parsed.nextNodeId === 'number' ? parsed.nextNodeId : 0
      this.nextClipId = typeof parsed.nextClipId === 'number' ? parsed.nextClipId : 0

      if (Array.isArray(parsed.nodes)) {
        for (const node of parsed.nodes) {
          if (!node || typeof node.id !== 'number') continue
          const normalized: MemoryNode = {
            id: node.id,
            type: node.type as MemoryNode['type'],
            content: typeof node.content === 'string' ? node.content : '',
            embedding: Array.isArray(node.embedding) ? node.embedding : [],
            weight: typeof node.weight === 'number' ? node.weight : 1,
            metadata: {
              ...(node.metadata || {}),
              timestamp: node.metadata?.timestamp || new Date().toISOString(),
              source: node.metadata?.source,
              thumbnailPath: node.metadata?.thumbnailPath,
              hash: node.metadata?.hash,
              entityId: node.metadata?.entityId,
              clipId: node.metadata?.clipId,
            } as MemoryNode['metadata'],
          }
          this.nodes.set(normalized.id, normalized)
        }
      }

      if (Array.isArray(parsed.edges)) {
        for (const edge of parsed.edges) {
          if (!edge || typeof edge.from !== 'number' || typeof edge.to !== 'number') continue
          if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) continue
          const key = edgeKey(edge.from, edge.to)
          const weight = typeof edge.weight === 'number' ? edge.weight : 0
          if (weight > 0) {
            this.edges.set(key, weight)
          }
        }
      }

      // Keep counters monotonic if the file is older/corrupt.
      if (this.nodes.size > 0) {
        const maxNodeId = Math.max(...Array.from(this.nodes.keys()))
        this.nextNodeId = Math.max(this.nextNodeId, maxNodeId + 1)

        const maxClipId = Array.from(this.nodes.values())
          .map(node => node.metadata.clipId)
          .filter((id): id is number => typeof id === 'number')
          .reduce((max, id) => Math.max(max, id), -1)
        this.nextClipId = Math.max(this.nextClipId, maxClipId + 1)
      }

      this.pruneEdges()
      this.dirty = false
    } catch (e) {
      console.error('[MemoryGraph] Failed to load graph:', e)
      this.nodes.clear()
      this.edges.clear()
      this.nextNodeId = 0
      this.nextClipId = 0
      this.dirty = false
    }
  }

  // === Maintenance ===

  compact(maxNodes: number = DEFAULT_MAX_NODES): { removed: number } {
    if (this.nodes.size <= maxNodes) return { removed: 0 }

    const targetSize = Math.floor(maxNodes * 0.8)
    const neededRemovals = Math.max(0, this.nodes.size - targetSize)
    if (neededRemovals === 0) return { removed: 0 }

    const now = Date.now()
    const candidates = Array.from(this.nodes.values())
      .filter(node => node.type === 'episodic' || node.type === 'semantic')
      .map(node => {
        const ts = Date.parse(node.metadata.timestamp)
        const ageHours = Number.isFinite(ts) ? Math.max(0, (now - ts) / (1000 * 60 * 60)) : 0
        const recencyFactor = Math.exp(-0.02 * ageHours)
        return {
          node,
          score: node.weight * recencyFactor,
        }
      })
      .sort((a, b) => a.score - b.score)

    let removed = 0
    for (const candidate of candidates) {
      if (removed >= neededRemovals) break

      const node = this.nodes.get(candidate.node.id)
      if (!node) continue

      const thumbPath = node.metadata.thumbnailPath
      if (thumbPath && existsSync(thumbPath)) {
        try { unlinkSync(thumbPath) } catch {}
      }

      if (this.removeNode(node.id)) {
        removed += 1
      }
    }

    this.pruneEdges()
    return { removed }
  }

  getStats(): { nodes: number; edges: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {
      img: 0,
      voice: 0,
      episodic: 0,
      semantic: 0,
    }

    for (const node of this.nodes.values()) {
      byType[node.type] = (byType[node.type] || 0) + 1
    }

    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      byType,
    }
  }

  private pruneEdges(): void {
    let removed = 0
    for (const [key, weight] of Array.from(this.edges.entries())) {
      const [from, to] = key.split('-').map(Number)
      if (!this.nodes.has(from) || !this.nodes.has(to) || weight <= 0) {
        this.edges.delete(key)
        removed += 1
      }
    }

    if (removed > 0) {
      this.dirty = true
    }
  }
}
