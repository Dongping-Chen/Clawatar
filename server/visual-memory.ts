/**
 * Visual Memory System
 *
 * Three-layer architecture:
 * 1. Ring Buffer — last ~60s of raw frames (in-memory)
 * 2. Visual Memory — persistent scene records (text + compressed thumbnails)
 * 3. Tool Interface — AI calls get_visual_context on demand
 *
 * Features:
 * - Perceptual hash (pHash) for frame deduplication
 * - Scene change detection
 * - Compressed thumbnail storage
 * - Text descriptions from AI analysis
 * - Proactive scene change alerts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { basename, isAbsolute, join } from 'path'
import sharp from 'sharp'
import { MemoryGraph, type MemoryNode } from './memory/memory-graph.js'
import { getTextEmbedding, isEmbeddingServiceAvailable } from './memory/embedding-service.js'

// ============ Config ============

const RING_BUFFER_MAX_FRAMES = 30       // ~60s at 2s/frame
const PHASH_SIZE = 8                     // 8x8 perceptual hash
const SCENE_CHANGE_THRESHOLD = 12        // hamming distance threshold (out of 64 bits)
const THUMBNAIL_QUALITY = 50             // JPEG quality for stored thumbnails
const THUMBNAIL_MAX_DIM = 320            // Max dimension for thumbnails
const MAX_THUMBNAILS = 200               // Max stored thumbnails before cleanup
const MEMORY_DIR = join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual')
const THUMBNAILS_DIR = join(MEMORY_DIR, 'thumbnails')
const MEMORY_GRAPH_PATH = join(MEMORY_DIR, 'memory-graph.json')

// ============ Types ============

interface FrameEntry {
  timestamp: number
  base64: string            // raw base64 JPEG
  hash: string              // perceptual hash (hex)
  byteSize: number
}

export interface VisualMemoryRecord {
  ts: string                // ISO timestamp
  description: string       // AI-generated text description
  thumbnail: string         // filename in thumbnails/
  hash: string              // perceptual hash
  tags: string[]            // scene tags
  location?: string         // inferred location
}

export interface VisualContext {
  currentFrames: string[]         // base64 JPEGs (deduped recent frames)
  frameCount: number              // how many unique frames returned
  memorySummary: string           // text summary of recent visual memories
  sceneChanged: boolean           // did scene change since last memory?
  lastMemory: VisualMemoryRecord | null
}

export interface VisualSearchResult {
  id: string
  timestamp: string
  description: string
  thumbnailPath: string
  tags: string[]
  relevanceScore: number
}

function tokenizeSearchQuery(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const tokens = new Set<string>()

  // English words (case-insensitive)
  const englishWords = trimmed.toLowerCase().match(/[a-z0-9]+/g) || []
  for (const word of englishWords) {
    if (word.length > 0) tokens.add(word)
  }

  // Chinese characters + adjacent bigrams
  const chineseChars = trimmed.match(/[\u4e00-\u9fff]/g) || []
  for (const ch of chineseChars) tokens.add(ch)
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.add(chineseChars[i] + chineseChars[i + 1])
  }

  return Array.from(tokens)
}

// ============ Perceptual Hash (via sharp) ============

/**
 * Compute a perceptual hash using sharp.
 * Resize to 8x8 grayscale → compare each pixel to average → 64-bit hash.
 * This is the "average hash" (aHash) algorithm — fast and effective for scene dedup.
 * ~2-5ms per frame thanks to sharp's native pipeline.
 */
async function computePerceptualHash(jpegBuffer: Buffer): Promise<string> {
  try {
    // Resize to 8x8 grayscale in one native pipeline
    const pixels = await sharp(jpegBuffer)
      .resize(PHASH_SIZE, PHASH_SIZE, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer()

    // Compute average pixel value
    let sum = 0
    for (let i = 0; i < pixels.length; i++) sum += pixels[i]
    const avg = sum / pixels.length

    // Generate 64-bit hash: each bit = 1 if pixel > average
    let hash = ''
    for (let i = 0; i < pixels.length; i++) {
      hash += pixels[i] >= avg ? '1' : '0'
    }

    // Convert binary string to hex (64 bits = 16 hex chars)
    let hex = ''
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(hash.substring(i, i + 4), 2).toString(16)
    }
    return hex
  } catch (e) {
    console.error('[phash] Error computing hash:', e)
    return '0000000000000000'
  }
}

/**
 * Compress a JPEG to a smaller thumbnail using sharp
 */
async function compressThumbnail(jpegBuffer: Buffer): Promise<Buffer> {
  return sharp(jpegBuffer)
    .resize(THUMBNAIL_MAX_DIM, THUMBNAIL_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_QUALITY })
    .toBuffer()
}

/**
 * Hamming distance between two hex hash strings
 */
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 64

  let distance = 0
  for (let i = 0; i < hash1.length; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16)
    // Count bits in xor
    let bits = xor
    while (bits) {
      distance += bits & 1
      bits >>= 1
    }
  }
  return distance
}

// ============ Ring Buffer ============

class FrameRingBuffer {
  private frames: FrameEntry[] = []
  private maxSize: number

  constructor(maxSize: number = RING_BUFFER_MAX_FRAMES) {
    this.maxSize = maxSize
  }

  async push(base64: string): Promise<{ hash: string; isDuplicate: boolean; sceneChanged: boolean }> {
    // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
    const raw = base64.includes(',') ? base64.split(',')[1] : base64
    const buffer = Buffer.from(raw, 'base64')
    const hash = await computePerceptualHash(buffer)

    // Check if duplicate of most recent frame
    const lastFrame = this.frames.length > 0 ? this.frames[this.frames.length - 1] : null
    const isDuplicate = lastFrame ? hammingDistance(hash, lastFrame.hash) < SCENE_CHANGE_THRESHOLD : false

    // Skip duplicate frames — don't waste ring buffer space
    if (isDuplicate) {
      return { hash, isDuplicate: true, sceneChanged: false }
    }

    // Check for scene change: compare to most recent frame (≥1 frame needed)
    let sceneChanged = false
    if (this.frames.length >= 1) {
      const lastHash = this.frames[this.frames.length - 1].hash
      sceneChanged = hammingDistance(hash, lastHash) >= SCENE_CHANGE_THRESHOLD
    }

    const entry: FrameEntry = {
      timestamp: Date.now(),
      base64: raw,  // Store pure base64 without data URI prefix
      hash,
      byteSize: buffer.length,
    }

    this.frames.push(entry)
    if (this.frames.length > this.maxSize) {
      this.frames.shift()
    }

    return { hash, isDuplicate, sceneChanged }
  }

  /**
   * Get recent frames, deduplicated by perceptual hash.
   * Returns at most `maxFrames` unique frames.
   */
  getDeduped(maxFrames: number = 3): { base64: string; timestamp: number; hash: string }[] {
    if (this.frames.length === 0) return []

    const result: { base64: string; timestamp: number; hash: string }[] = []
    const seenHashes: string[] = []

    // Walk backwards (newest first)
    for (let i = this.frames.length - 1; i >= 0 && result.length < maxFrames; i--) {
      const frame = this.frames[i]

      // Check if this frame is too similar to any already-selected frame
      const isSimilar = seenHashes.some(h => hammingDistance(h, frame.hash) < SCENE_CHANGE_THRESHOLD)
      if (!isSimilar) {
        result.push({ base64: frame.base64, timestamp: frame.timestamp, hash: frame.hash })
        seenHashes.push(frame.hash)
      }
    }

    return result.reverse() // chronological order
  }

  getLatest(): FrameEntry | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null
  }

  getLatestHash(): string | null {
    const latest = this.getLatest()
    return latest ? latest.hash : null
  }

  size(): number {
    return this.frames.length
  }

  clear(): void {
    this.frames = []
  }
}

// ============ Visual Memory Store ============

type NodeMetadataExtras = MemoryNode['metadata'] & {
  tags?: string[]
  location?: string
}

class VisualMemoryStore {
  private records: VisualMemoryRecord[] = []
  private recordByNodeId: Map<number, VisualMemoryRecord> = new Map()
  private loaded = false
  private graph: MemoryGraph

  constructor(graph: MemoryGraph) {
    this.graph = graph
    this.ensureDirs()
  }

  private ensureDirs() {
    try {
      mkdirSync(MEMORY_DIR, { recursive: true })
      mkdirSync(THUMBNAILS_DIR, { recursive: true })
    } catch {}
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    this.refreshFromGraph()
  }

  private refreshFromGraph() {
    const episodicNodes = this.graph.getNodesByType('episodic')
    const mapped = episodicNodes
      .map(node => this.nodeToRecord(node))
      .filter((item): item is { nodeId: number; record: VisualMemoryRecord } => Boolean(item))
      .sort((a, b) => a.record.ts.localeCompare(b.record.ts))

    this.recordByNodeId = new Map(mapped.map(item => [item.nodeId, item.record]))
    this.records = mapped.map(item => item.record)
  }

  private nodeToRecord(node: MemoryNode): { nodeId: number; record: VisualMemoryRecord } | null {
    if (node.type !== 'episodic' && node.type !== 'semantic') return null

    const meta = (node.metadata || {}) as NodeMetadataExtras
    const thumbnailPath = meta.thumbnailPath || ''

    const record: VisualMemoryRecord = {
      ts: meta.timestamp || new Date().toISOString(),
      description: node.content,
      thumbnail: thumbnailPath ? basename(thumbnailPath) : '',
      hash: meta.hash || '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      location: typeof meta.location === 'string' ? meta.location : undefined,
    }

    return { nodeId: node.id, record }
  }

  private nodeToSearchResult(node: MemoryNode, score: number): VisualSearchResult {
    const meta = (node.metadata || {}) as NodeMetadataExtras
    const thumbnailPath = meta.thumbnailPath || ''

    return {
      id: `g${String(node.id).padStart(4, '0')}`,
      timestamp: meta.timestamp || new Date().toISOString(),
      description: node.content,
      thumbnailPath,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      relevanceScore: score,
    }
  }

  private keywordFallbackSearch(query: string, limit: number = 5): VisualSearchResult[] {
    const tokens = tokenizeSearchQuery(query)
    if (tokens.length === 0 || this.records.length === 0) return []

    const safeLimit = Math.max(1, limit)
    const scored: VisualSearchResult[] = []

    const entries = Array.from(this.recordByNodeId.entries())
    for (const [nodeId, record] of entries) {
      const tags = Array.isArray(record.tags) ? record.tags : []
      const searchableText = `${record.description || ''} ${tags.join(' ')}`.toLowerCase()

      let relevanceScore = 0
      for (const token of tokens) {
        if (searchableText.includes(token.toLowerCase())) {
          relevanceScore += 1
        }
      }

      if (relevanceScore > 0) {
        const thumbnailPath = record.thumbnail
          ? join(THUMBNAILS_DIR, record.thumbnail)
          : ''

        scored.push({
          id: `g${String(nodeId).padStart(4, '0')}`,
          timestamp: record.ts,
          description: record.description,
          thumbnailPath,
          tags,
          relevanceScore,
        })
      }
    }

    return scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore || b.timestamp.localeCompare(a.timestamp))
      .slice(0, safeLimit)
  }

  /**
   * Store a new visual memory record + memory-graph node.
   */
  async addRecord(
    description: string,
    jpegBase64: string,
    hash: string,
    tags: string[] = [],
    location?: string,
    source: string = 'model_request',
    linkedEntityNodeIds: number[] = [],
    entityIds: string[] = [],
  ): Promise<{ nodeId: number; merged: boolean }> {
    this.load()

    const now = new Date()
    const filename = `${now.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.jpg`
    const raw = jpegBase64.includes(',') ? jpegBase64.split(',')[1] : jpegBase64

    // 1) Compress and save thumbnail
    const rawBuffer = Buffer.from(raw, 'base64')
    const thumbBuffer = await compressThumbnail(rawBuffer)
    const thumbPath = join(THUMBNAILS_DIR, filename)
    writeFileSync(thumbPath, thumbBuffer)
    console.log(`[VisualMemory] Thumbnail saved: ${filename} (${(rawBuffer.length / 1024).toFixed(0)}KB → ${(thumbBuffer.length / 1024).toFixed(0)}KB)`)

    // 2) Get text embedding
    const embedding = await getTextEmbedding(description)

    // 3) Merge/create episodic node
    const metadata: NodeMetadataExtras = {
      timestamp: now.toISOString(),
      source,
      thumbnailPath: thumbPath,
      hash,
      entityId: entityIds[0],
      tags,
      location,
    }

    let nodeId = -1
    let merged = false

    if (embedding.length > 0) {
      const result = this.graph.mergeOrCreate(
        'episodic',
        description,
        embedding,
        metadata as Partial<MemoryNode['metadata']>,
        linkedEntityNodeIds,
      )
      nodeId = result.nodeId
      merged = result.merged
    } else {
      nodeId = this.graph.addNode(
        'episodic',
        description,
        [],
        metadata as Partial<MemoryNode['metadata']>,
      )
      for (const entityNodeId of linkedEntityNodeIds) {
        this.graph.addEdge(nodeId, entityNodeId, 1)
      }
      merged = false
    }

    // 4) Compact and persist
    const compactResult = this.graph.compact(1000)
    if (compactResult.removed > 0) {
      console.log(`[VisualMemory] Graph compacted, removed ${compactResult.removed} low-value nodes`)
    }
    this.graph.save()

    this.refreshFromGraph()
    this.cleanup()

    return { nodeId, merged }
  }

  /**
   * Get recent memory records (text only, for context)
   */
  getRecentRecords(count: number = 5): VisualMemoryRecord[] {
    this.load()
    return this.records.slice(-count)
  }

  /**
   * Get latest record
   */
  getLatest(): VisualMemoryRecord | null {
    this.load()
    return this.records.length > 0 ? this.records[this.records.length - 1] : null
  }

  /**
   * Resolve a record from graph node ID.
   */
  getRecordByNodeId(nodeId: number): VisualMemoryRecord | null {
    this.load()
    return this.recordByNodeId.get(nodeId) || null
  }

  /**
   * Search visual memory using embedding similarity first; fallback to keyword matching.
   */
  async search(query: string, limit: number = 5): Promise<VisualSearchResult[]> {
    this.load()

    const safeLimit = Math.max(1, limit)
    const trimmed = query.trim()
    if (!trimmed) return []

    if (isEmbeddingServiceAvailable()) {
      const queryEmbedding = await getTextEmbedding(trimmed)
      if (queryEmbedding.length > 0) {
        const ranked = this.graph.searchTextNodes(queryEmbedding, undefined, safeLimit * 3)
        const semanticResults: VisualSearchResult[] = []

        for (const item of ranked) {
          if (item.score <= 0) continue
          const node = this.graph.getNode(item.nodeId)
          if (!node) continue
          if (node.type !== 'episodic' && node.type !== 'semantic') continue
          const searchResult = this.nodeToSearchResult(node, item.score)
          if (!searchResult.thumbnailPath) continue
          semanticResults.push(searchResult)
        }

        if (semanticResults.length > 0) {
          return semanticResults
            .sort((a, b) => b.relevanceScore - a.relevanceScore || b.timestamp.localeCompare(a.timestamp))
            .slice(0, safeLimit)
        }
      }
    }

    return this.keywordFallbackSearch(trimmed, safeLimit)
  }

  /**
   * Get a thumbnail as base64
   */
  getThumbnailBase64(filename: string): string | null {
    if (!filename) return null
    const path = isAbsolute(filename) ? filename : join(THUMBNAILS_DIR, filename)
    if (!existsSync(path)) return null
    return readFileSync(path).toString('base64')
  }

  /**
   * Build a text summary of recent visual memories
   */
  getMemorySummary(count: number = 5): string {
    const records = this.getRecentRecords(count)
    if (records.length === 0) return '(no visual memories yet)'

    return records.map(r => {
      const time = new Date(r.ts).toLocaleString('zh-CN', { timeZone: 'America/New_York' })
      const tags = r.tags.length > 0 ? ` [${r.tags.join(', ')}]` : ''
      return `- ${time}: ${r.description}${tags}`
    }).join('\n')
  }

  /**
   * Check if scene changed compared to last stored memory
   */
  hasSceneChanged(currentHash: string): boolean {
    const latest = this.getLatest()
    if (!latest) return true // No memory = new scene
    if (!latest.hash) return true
    return hammingDistance(currentHash, latest.hash) >= SCENE_CHANGE_THRESHOLD
  }

  /**
   * Cleanup orphaned old thumbnails when exceeding limit.
   */
  private cleanup() {
    try {
      const files = readdirSync(THUMBNAILS_DIR).sort()
      if (files.length <= MAX_THUMBNAILS) return

      const referenced = new Set(
        this.records
          .map(record => record.thumbnail)
          .filter(name => !!name),
      )

      const orphaned = files.filter(file => !referenced.has(file))
      const overflow = files.length - MAX_THUMBNAILS
      const toDelete = orphaned.slice(0, overflow)

      for (const file of toDelete) {
        try { unlinkSync(join(THUMBNAILS_DIR, file)) } catch {}
      }

      if (toDelete.length > 0) {
        console.log(`[VisualMemory] Cleaned up ${toDelete.length} orphaned thumbnails`)
      }
    } catch {}
  }

  recordCount(): number {
    this.load()
    return this.records.length
  }
}

// ============ Visual Memory Manager (Singleton) ============

export class VisualMemoryManager {
  private ringBuffer: FrameRingBuffer
  private memoryStore: VisualMemoryStore
  private graph: MemoryGraph
  private cameraActive: boolean = false
  private cameraJustOpened: boolean = false
  private lastStoredHash: string | null = null
  private lastSceneChangeAlert: number = 0
  private onSceneChange?: (context: VisualContext) => void

  constructor() {
    this.ringBuffer = new FrameRingBuffer(RING_BUFFER_MAX_FRAMES)
    this.graph = new MemoryGraph(MEMORY_GRAPH_PATH)
    this.memoryStore = new VisualMemoryStore(this.graph)
  }

  /**
   * Register callback for proactive scene change alerts
   */
  setSceneChangeCallback(cb: (context: VisualContext) => void) {
    this.onSceneChange = cb
  }

  /**
   * Called when camera is turned on/off
   */
  setCameraActive(active: boolean) {
    const wasActive = this.cameraActive
    this.cameraActive = active

    if (active && !wasActive) {
      console.log('[VisualMemory] Camera activated')
      this.ringBuffer.clear()
      this.cameraJustOpened = true
      this.lastStoredHash = null
    } else if (!active && wasActive) {
      console.log(`[VisualMemory] Camera deactivated (buffer had ${this.ringBuffer.size()} frames)`)
      this.cameraJustOpened = false
    }
  }

  isCameraActive(): boolean {
    return this.cameraActive
  }

  private ensureEntityNodeIds(entityIds?: string[]): number[] {
    if (!Array.isArray(entityIds) || entityIds.length === 0) return []

    const uniqueEntityIds = Array.from(new Set(entityIds.map(id => id?.trim()).filter(Boolean) as string[]))
    if (uniqueEntityIds.length === 0) return []

    const existingNodes = [
      ...this.graph.getNodesByType('img'),
      ...this.graph.getNodesByType('voice'),
    ]

    const result: number[] = []

    for (const entityId of uniqueEntityIds) {
      const matched = existingNodes.find(node => node.metadata?.entityId === entityId)
      if (matched) {
        result.push(matched.id)
        continue
      }

      const nodeId = this.graph.addNode(
        'img',
        `entity:${entityId}`,
        [],
        {
          timestamp: new Date().toISOString(),
          source: 'person_detected',
          entityId,
        },
      )

      result.push(nodeId)
      const newNode = this.graph.getNode(nodeId)
      if (newNode) existingNodes.push(newNode)
    }

    return result
  }

  private async storeToGraph(
    description: string,
    jpegBase64: string,
    hash: string,
    source: string,
    entityIds: string[] = [],
    tags: string[] = [],
    location?: string,
  ): Promise<number> {
    const linkedEntityNodeIds = this.ensureEntityNodeIds(entityIds)

    const { nodeId } = await this.memoryStore.addRecord(
      description,
      jpegBase64,
      hash,
      tags,
      location,
      source,
      linkedEntityNodeIds,
      entityIds,
    )

    return nodeId
  }

  /**
   * Ingest a new camera frame (called on each frame from frontend)
   * Returns dedup + scene-change information and whether it was auto-stored.
   */
  async ingestFrame(base64Jpeg: string): Promise<{ isDuplicate: boolean; sceneChanged: boolean; stored: boolean; reason?: string }> {
    const { hash, isDuplicate, sceneChanged } = await this.ringBuffer.push(base64Jpeg)

    let stored = false
    let reason: string | undefined

    if (this.cameraActive && !isDuplicate) {
      if (this.cameraJustOpened) {
        await this.storeToGraph('[auto] Camera opened', base64Jpeg, hash, 'camera_opened')
        this.cameraJustOpened = false
        this.lastStoredHash = hash
        stored = true
        reason = 'camera_opened'
      } else {
        const changedSinceLastStored = this.lastStoredHash
          ? hammingDistance(hash, this.lastStoredHash) >= SCENE_CHANGE_THRESHOLD
          : true

        if (changedSinceLastStored) {
          await this.storeToGraph('[auto] Scene change detected', base64Jpeg, hash, 'scene_change')
          this.lastStoredHash = hash
          stored = true
          reason = 'scene_change'
        }
      }
    }

    // Proactive scene change detection (for auto-captioning callback)
    if (sceneChanged && this.onSceneChange) {
      const now = Date.now()
      // Don't alert more than once per 30s
      if (now - this.lastSceneChangeAlert > 30000) {
        this.lastSceneChangeAlert = now
        const context = this.getVisualContext('scene_change_detected')
        this.onSceneChange(context)
      }
    }

    return { isDuplicate, sceneChanged, stored, reason }
  }

  /**
   * Main tool interface: get visual context for the AI
   * Called when AI needs to "see" (user asked visual question, camera just opened, etc.)
   */
  getVisualContext(reason: string = 'user_request'): VisualContext {
    const dedupedFrames = this.ringBuffer.getDeduped(3)
    const memorySummary = this.memoryStore.getMemorySummary(5)
    const latestHash = this.ringBuffer.getLatestHash()
    const sceneChanged = latestHash ? this.memoryStore.hasSceneChanged(latestHash) : false
    const lastMemory = this.memoryStore.getLatest()

    console.log(`[VisualMemory] get_visual_context: reason=${reason}, frames=${dedupedFrames.length}, sceneChanged=${sceneChanged}`)

    return {
      currentFrames: dedupedFrames.map(f => f.base64),
      frameCount: dedupedFrames.length,
      memorySummary,
      sceneChanged,
      lastMemory,
    }
  }

  /**
   * Store a visual memory record (called after AI analyzes a scene)
   */
  async storeMemory(
    description: string,
    jpegBase64: string,
    hash?: string,
    tags: string[] = [],
    location?: string,
    entityIds: string[] = [],
    source: string = 'model_request',
  ): Promise<VisualMemoryRecord> {
    const raw = jpegBase64.includes(',') ? jpegBase64.split(',')[1] : jpegBase64
    const actualHash = hash || await computePerceptualHash(Buffer.from(raw, 'base64'))

    const nodeId = await this.storeToGraph(
      description,
      raw,
      actualHash,
      source,
      entityIds,
      tags,
      location,
    )

    this.lastStoredHash = actualHash

    const record = this.memoryStore.getRecordByNodeId(nodeId) || this.memoryStore.getLatest()
    if (record) return record

    // Defensive fallback (should rarely happen)
    return {
      ts: new Date().toISOString(),
      description,
      thumbnail: '',
      hash: actualHash,
      tags,
      location,
    }
  }

  /**
   * Get memory summary text (for including in system prompt context)
   */
  getMemorySummary(count: number = 5): string {
    return this.memoryStore.getMemorySummary(count)
  }

  /**
   * Get latest stored memory
   */
  getLatestMemory(): VisualMemoryRecord | null {
    return this.memoryStore.getLatest()
  }

  /**
   * Get a stored thumbnail by filename as base64
   */
  getThumbnail(filename: string): string | null {
    return this.memoryStore.getThumbnailBase64(filename)
  }

  /**
   * Search stored visual memories.
   */
  async search(query: string, limit: number = 5): Promise<VisualSearchResult[]> {
    return this.memoryStore.search(query, limit)
  }

  getGraph(): MemoryGraph {
    return this.graph
  }

  /**
   * Stats for debugging
   */
  getStats() {
    const graphStats = this.graph.getStats()
    return {
      cameraActive: this.cameraActive,
      bufferFrames: this.ringBuffer.size(),
      memoryRecords: this.memoryStore.recordCount(),
      graphNodes: graphStats.nodes,
      graphEdges: graphStats.edges,
      graphByType: graphStats.byType,
    }
  }
}

// Singleton instance
export const visualMemory = new VisualMemoryManager()
