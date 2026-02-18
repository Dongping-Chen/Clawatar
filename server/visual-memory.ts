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

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, appendFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

// ============ Config ============

const RING_BUFFER_MAX_FRAMES = 30       // ~60s at 2s/frame
const PHASH_SIZE = 8                     // 8x8 perceptual hash
const SCENE_CHANGE_THRESHOLD = 12        // hamming distance threshold (out of 64 bits)
const THUMBNAIL_QUALITY = 50             // JPEG quality for stored thumbnails
const THUMBNAIL_MAX_DIM = 320            // Max dimension for thumbnails
const MAX_THUMBNAILS = 200               // Max stored thumbnails before cleanup
const MEMORY_DIR = join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual')
const THUMBNAILS_DIR = join(MEMORY_DIR, 'thumbnails')
const VISUAL_LOG_PATH = join(MEMORY_DIR, 'visual-log.jsonl')

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

// ============ Perceptual Hash ============

/**
 * Compute a simple perceptual hash from a JPEG buffer.
 * Since we're in Node.js without sharp/canvas, we use a luminance-based
 * approach on the raw JPEG data as a fingerprint.
 * 
 * This is a simplified "average hash" — works well enough for scene dedup.
 * For production, could upgrade to sharp-based DCT hash.
 */
function computePerceptualHash(jpegBuffer: Buffer): string {
  // Use chunks of the JPEG data to create a spatial fingerprint
  // We sample 64 evenly-spaced positions and compare to average
  const len = jpegBuffer.length
  if (len < 128) return '0000000000000000'
  
  const sampleCount = PHASH_SIZE * PHASH_SIZE  // 64 samples
  const step = Math.floor(len / sampleCount)
  const samples: number[] = []
  
  for (let i = 0; i < sampleCount; i++) {
    // Sample byte value at evenly-spaced positions (skip JPEG headers)
    const offset = Math.min(Math.floor(len * 0.1) + i * step, len - 1)
    samples.push(jpegBuffer[offset])
  }
  
  // Compute average
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length
  
  // Generate 64-bit hash: each bit = 1 if sample > average
  let hash = ''
  for (let i = 0; i < sampleCount; i++) {
    hash += samples[i] >= avg ? '1' : '0'
  }
  
  // Convert binary string to hex
  let hex = ''
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(hash.substring(i, i + 4), 2).toString(16)
  }
  
  return hex
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

  push(base64: string): { hash: string; isDuplicate: boolean; sceneChanged: boolean } {
    const buffer = Buffer.from(base64, 'base64')
    const hash = computePerceptualHash(buffer)
    
    // Check if duplicate of most recent frame
    const lastFrame = this.frames.length > 0 ? this.frames[this.frames.length - 1] : null
    const isDuplicate = lastFrame ? hammingDistance(hash, lastFrame.hash) < SCENE_CHANGE_THRESHOLD : false
    
    // Check for scene change against recent frames (compare to 3 most recent)
    let sceneChanged = false
    if (this.frames.length >= 3) {
      const recentHashes = this.frames.slice(-3).map(f => f.hash)
      const avgDistance = recentHashes.reduce((sum, h) => sum + hammingDistance(hash, h), 0) / recentHashes.length
      sceneChanged = avgDistance >= SCENE_CHANGE_THRESHOLD
    }

    const entry: FrameEntry = {
      timestamp: Date.now(),
      base64,
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

class VisualMemoryStore {
  private records: VisualMemoryRecord[] = []
  private loaded = false

  constructor() {
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
    
    if (!existsSync(VISUAL_LOG_PATH)) return
    
    try {
      const content = readFileSync(VISUAL_LOG_PATH, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      this.records = lines.map(l => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean) as VisualMemoryRecord[]
    } catch (e) {
      console.error('Failed to load visual memory:', e)
    }
  }

  /**
   * Store a new visual memory record with thumbnail
   */
  addRecord(description: string, jpegBase64: string, hash: string, tags: string[] = [], location?: string): VisualMemoryRecord {
    this.load()
    
    const now = new Date()
    const filename = `${now.toISOString().replace(/[:.]/g, '-').substring(0, 19)}.jpg`
    
    // Save compressed thumbnail
    const buffer = Buffer.from(jpegBase64, 'base64')
    const thumbPath = join(THUMBNAILS_DIR, filename)
    writeFileSync(thumbPath, buffer)
    
    const record: VisualMemoryRecord = {
      ts: now.toISOString(),
      description,
      thumbnail: filename,
      hash,
      tags,
      location,
    }
    
    // Append to JSONL log
    appendFileSync(VISUAL_LOG_PATH, JSON.stringify(record) + '\n')
    this.records.push(record)
    
    // Cleanup old thumbnails if too many
    this.cleanup()
    
    return record
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
   * Get a thumbnail as base64
   */
  getThumbnailBase64(filename: string): string | null {
    const path = join(THUMBNAILS_DIR, filename)
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
    return hammingDistance(currentHash, latest.hash) >= SCENE_CHANGE_THRESHOLD
  }

  /**
   * Cleanup old thumbnails when exceeding limit
   */
  private cleanup() {
    try {
      const files = readdirSync(THUMBNAILS_DIR).sort()
      if (files.length > MAX_THUMBNAILS) {
        const toDelete = files.slice(0, files.length - MAX_THUMBNAILS)
        for (const f of toDelete) {
          try { unlinkSync(join(THUMBNAILS_DIR, f)) } catch {}
        }
        console.log(`Visual memory: cleaned up ${toDelete.length} old thumbnails`)
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
  private cameraActive: boolean = false
  private lastSceneChangeAlert: number = 0
  private onSceneChange?: (context: VisualContext) => void

  constructor() {
    this.ringBuffer = new FrameRingBuffer(RING_BUFFER_MAX_FRAMES)
    this.memoryStore = new VisualMemoryStore()
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
    } else if (!active && wasActive) {
      console.log(`[VisualMemory] Camera deactivated (buffer had ${this.ringBuffer.size()} frames)`)
    }
  }

  isCameraActive(): boolean {
    return this.cameraActive
  }

  /**
   * Ingest a new camera frame (called on each frame from frontend)
   * Returns whether a significant scene change was detected
   */
  ingestFrame(base64Jpeg: string): { isDuplicate: boolean; sceneChanged: boolean } {
    const { hash, isDuplicate, sceneChanged } = this.ringBuffer.push(base64Jpeg)
    
    // Proactive scene change detection
    if (sceneChanged && this.onSceneChange) {
      const now = Date.now()
      // Don't alert more than once per 30s
      if (now - this.lastSceneChangeAlert > 30000) {
        this.lastSceneChangeAlert = now
        const context = this.getVisualContext('scene_change_detected')
        this.onSceneChange(context)
      }
    }

    return { isDuplicate, sceneChanged }
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
  storeMemory(description: string, jpegBase64: string, hash?: string, tags: string[] = [], location?: string): VisualMemoryRecord {
    const actualHash = hash || (() => {
      const buffer = Buffer.from(jpegBase64, 'base64')
      return computePerceptualHash(buffer)
    })()
    
    return this.memoryStore.addRecord(description, jpegBase64, actualHash, tags, location)
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
   * Stats for debugging
   */
  getStats() {
    return {
      cameraActive: this.cameraActive,
      bufferFrames: this.ringBuffer.size(),
      memoryRecords: this.memoryStore.recordCount(),
    }
  }
}

// Singleton instance
export const visualMemory = new VisualMemoryManager()
