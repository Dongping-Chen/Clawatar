/**
 * Multimodal Memory System (inspired by M3-Agent)
 *
 * Two memory types:
 *   - Episodic: concrete events ("user picked up coffee at 9am")
 *   - Semantic: abstracted knowledge ("user prefers coffee in the morning")
 *
 * Three modalities:
 *   - Visual: scene descriptions + compressed thumbnails (from visual-memory.ts)
 *   - Audio: voice mood/emotion, what was said, speaker characteristics
 *   - Text: conversation summaries, preferences, facts
 *
 * Entity-centric: memories linked to entities (primarily the user)
 *
 * Architecture:
 *   visual-memory.ts → ring buffer + phash dedup (unchanged)
 *   multimodal-memory.ts → this file, episodic + semantic + audio memory
 *   Both integrated via ws-server.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { visualMemory, type VisualContext, type VisualMemoryRecord } from './visual-memory.js'

// ============ Config ============

const MEMORY_BASE = join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual')
const EPISODIC_LOG = join(MEMORY_BASE, 'episodic.jsonl')
const SEMANTIC_LOG = join(MEMORY_BASE, 'semantic.jsonl')
const AUDIO_LOG = join(MEMORY_BASE, 'audio-memory.jsonl')
const ENTITY_FILE = join(MEMORY_BASE, 'entities.json')

// Auto-captioning: minimum interval between AI analysis calls
const AUTO_CAPTION_COOLDOWN_MS = 60_000  // 1 minute
// Semantic extraction: how often to distill semantic from episodic
const SEMANTIC_EXTRACTION_INTERVAL = 10  // every N episodic entries

// ============ Types ============

export interface EpisodicMemory {
  ts: string
  modality: 'visual' | 'audio' | 'text'
  event: string              // what happened
  entityIds: string[]        // related entities
  thumbnail?: string         // visual thumbnail filename
  hash?: string              // visual phash
  mood?: string              // detected mood/emotion
  confidence: number         // 0-1
}

export interface SemanticMemory {
  ts: string
  knowledge: string          // abstracted fact
  entityIds: string[]
  source: 'visual' | 'audio' | 'conversation' | 'inferred'
  weight: number             // increases with repeated observation
  lastUpdated: string
}

export interface AudioMemory {
  ts: string
  transcript: string         // what was said
  mood?: string              // happy, tired, excited, neutral, sad, angry
  entityId: string           // who said it
  duration?: number          // seconds
}

export interface Entity {
  id: string
  name: string
  type: 'person' | 'object' | 'place'
  attributes: Record<string, string>  // key-value pairs (appearance, voice, etc.)
  lastSeen: string
  totalInteractions: number
}

// ============ Storage Helpers ============

function ensureDirs() {
  mkdirSync(MEMORY_BASE, { recursive: true })
}

function appendJsonl(path: string, record: any) {
  appendFileSync(path, JSON.stringify(record) + '\n')
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean) as T[]
  } catch { return [] }
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return fallback }
}

function writeJson(path: string, data: any) {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

// ============ Multimodal Memory Manager ============

export class MultimodalMemoryManager {
  private episodic: EpisodicMemory[] = []
  private semantic: SemanticMemory[] = []
  private audio: AudioMemory[] = []
  private entities: Map<string, Entity> = new Map()
  private loaded = false
  private lastAutoCaptionTime = 0
  private episodicSinceLastExtraction = 0

  // Callback for when we need AI to analyze something
  private analyzeCallback?: (params: {
    type: 'caption_scene'      // describe what's in the image
        | 'extract_semantic'   // distill knowledge from recent episodes
        | 'detect_mood'        // analyze voice/text for mood
    context: string
    images?: string[]          // base64 JPEGs
  }) => Promise<string>

  constructor() {
    ensureDirs()
  }

  /**
   * Set the AI analysis callback (called by ws-server with OpenClaw integration)
   */
  setAnalyzeCallback(cb: typeof this.analyzeCallback) {
    this.analyzeCallback = cb
  }

  private load() {
    if (this.loaded) return
    this.loaded = true
    this.episodic = readJsonl<EpisodicMemory>(EPISODIC_LOG)
    this.semantic = readJsonl<SemanticMemory>(SEMANTIC_LOG)
    this.audio = readJsonl<AudioMemory>(AUDIO_LOG)
    const entityList = readJson<Entity[]>(ENTITY_FILE, [])
    for (const e of entityList) this.entities.set(e.id, e)

    // Ensure primary user entity exists
    if (!this.entities.has('user')) {
      this.entities.set('user', {
        id: 'user',
        name: 'Dongping',
        type: 'person',
        attributes: {},
        lastSeen: new Date().toISOString(),
        totalInteractions: 0,
      })
      this.saveEntities()
    }

    console.log(`[MultimodalMemory] Loaded: ${this.episodic.length} episodic, ${this.semantic.length} semantic, ${this.audio.length} audio, ${this.entities.size} entities`)
  }

  private saveEntities() {
    writeJson(ENTITY_FILE, Array.from(this.entities.values()))
  }

  // ── Episodic Memory ──

  /**
   * Record an episodic memory (a specific event that happened)
   */
  addEpisodic(entry: Omit<EpisodicMemory, 'ts' | 'confidence'> & { confidence?: number }): EpisodicMemory {
    this.load()
    const record: EpisodicMemory = {
      ...entry,
      ts: new Date().toISOString(),
      confidence: entry.confidence ?? 0.8,
    }
    appendJsonl(EPISODIC_LOG, record)
    this.episodic.push(record)

    // Update entity lastSeen
    for (const eid of record.entityIds) {
      const entity = this.entities.get(eid)
      if (entity) {
        entity.lastSeen = record.ts
        entity.totalInteractions++
      }
    }
    this.saveEntities()

    // Check if we should trigger semantic extraction
    this.episodicSinceLastExtraction++
    if (this.episodicSinceLastExtraction >= SEMANTIC_EXTRACTION_INTERVAL) {
      this.triggerSemanticExtraction().catch(e =>
        console.error('[MultimodalMemory] Semantic extraction error:', e))
    }

    return record
  }

  /**
   * Get recent episodic memories
   */
  getRecentEpisodic(count: number = 10): EpisodicMemory[] {
    this.load()
    return this.episodic.slice(-count)
  }

  // ── Semantic Memory ──

  /**
   * Add or update a semantic memory (abstracted knowledge)
   * If similar knowledge exists, increase its weight instead of duplicating
   */
  addSemantic(entry: Omit<SemanticMemory, 'ts' | 'weight' | 'lastUpdated'> & { weight?: number }): SemanticMemory {
    this.load()

    // Check for similar existing semantic memory (simple substring match)
    const existing = this.semantic.find(s =>
      s.knowledge.toLowerCase().includes(entry.knowledge.toLowerCase().substring(0, 30)) ||
      entry.knowledge.toLowerCase().includes(s.knowledge.toLowerCase().substring(0, 30))
    )

    if (existing) {
      existing.weight += 1
      existing.lastUpdated = new Date().toISOString()
      // Rewrite the full file (not ideal for large files, but fine for our scale)
      this.rewriteSemanticLog()
      console.log(`[MultimodalMemory] Semantic reinforced (weight ${existing.weight}): "${existing.knowledge.slice(0, 60)}"`)
      return existing
    }

    const record: SemanticMemory = {
      ...entry,
      ts: new Date().toISOString(),
      weight: entry.weight ?? 1,
      lastUpdated: new Date().toISOString(),
    }
    appendJsonl(SEMANTIC_LOG, record)
    this.semantic.push(record)
    console.log(`[MultimodalMemory] Semantic added: "${record.knowledge.slice(0, 60)}"`)
    return record
  }

  /**
   * Get semantic memories, sorted by weight (most confident first)
   */
  getSemanticMemories(count: number = 10): SemanticMemory[] {
    this.load()
    return [...this.semantic]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, count)
  }

  /**
   * Search semantic memories by keyword
   */
  searchSemantic(query: string): SemanticMemory[] {
    this.load()
    const q = query.toLowerCase()
    return this.semantic
      .filter(s => s.knowledge.toLowerCase().includes(q))
      .sort((a, b) => b.weight - a.weight)
  }

  private rewriteSemanticLog() {
    const content = this.semantic.map(s => JSON.stringify(s)).join('\n') + '\n'
    writeFileSync(SEMANTIC_LOG, content)
  }

  // ── Audio Memory ──

  /**
   * Record what the user said + mood
   */
  addAudioMemory(transcript: string, mood?: string, entityId: string = 'user', duration?: number): AudioMemory {
    this.load()
    const record: AudioMemory = {
      ts: new Date().toISOString(),
      transcript,
      mood,
      entityId,
      duration,
    }
    appendJsonl(AUDIO_LOG, record)
    this.audio.push(record)

    // Also create an episodic memory for the speech event
    this.addEpisodic({
      modality: 'audio',
      event: `${this.getEntityName(entityId)} said: "${transcript.slice(0, 100)}"${mood ? ` (mood: ${mood})` : ''}`,
      entityIds: [entityId],
      mood,
    })

    return record
  }

  /**
   * Get recent audio memories
   */
  getRecentAudio(count: number = 10): AudioMemory[] {
    this.load()
    return this.audio.slice(-count)
  }

  /**
   * Detect mood patterns from recent audio
   */
  getRecentMoodPattern(count: number = 5): { dominantMood: string; moods: string[] } {
    const recent = this.getRecentAudio(count).filter(a => a.mood)
    if (recent.length === 0) return { dominantMood: 'neutral', moods: [] }

    const moodCounts: Record<string, number> = {}
    const moods: string[] = []
    for (const a of recent) {
      if (a.mood) {
        moodCounts[a.mood] = (moodCounts[a.mood] || 0) + 1
        moods.push(a.mood)
      }
    }
    const dominantMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral'
    return { dominantMood, moods }
  }

  // ── Entity Management ──

  getEntity(id: string): Entity | undefined {
    this.load()
    return this.entities.get(id)
  }

  updateEntityAttribute(entityId: string, key: string, value: string) {
    this.load()
    const entity = this.entities.get(entityId)
    if (!entity) return
    entity.attributes[key] = value
    this.saveEntities()
  }

  getEntityName(id: string): string {
    return this.entities.get(id)?.name || id
  }

  // ── Auto-Captioning (Scene Change → AI Description) ──

  /**
   * Called when visual memory detects a scene change.
   * Triggers AI to describe the scene and store episodic + possibly semantic memories.
   */
  async onSceneChange(visualContext: VisualContext) {
    const now = Date.now()
    if (now - this.lastAutoCaptionTime < AUTO_CAPTION_COOLDOWN_MS) return
    if (!this.analyzeCallback) return
    if (visualContext.currentFrames.length === 0) return

    this.lastAutoCaptionTime = now

    try {
      // 1. Get AI to describe the scene
      const recentEpisodes = this.getRecentEpisodic(3)
        .map(e => `- ${e.event}`).join('\n')

      const caption = await this.analyzeCallback({
        type: 'caption_scene',
        context: `Recent events:\n${recentEpisodes || '(none)'}\n\nDescribe what you see in 1-2 sentences. Focus on: who is there, what they're doing, where they are, any notable details (clothing, objects, mood).`,
        images: visualContext.currentFrames.slice(-1),
      })

      if (!caption || caption.length < 10) return

      // 2. Store as episodic memory
      this.addEpisodic({
        modality: 'visual',
        event: caption,
        entityIds: ['user'],
        hash: undefined,
      })

      // 3. Store visual memory (thumbnail + description)
      const latestFrame = visualContext.currentFrames[visualContext.currentFrames.length - 1]
      await visualMemory.storeMemory(caption, latestFrame, undefined, [], undefined)

      console.log(`[MultimodalMemory] Auto-captioned scene: "${caption.slice(0, 80)}"`)
    } catch (e: any) {
      console.error('[MultimodalMemory] Auto-caption error:', e.message)
    }
  }

  // ── Semantic Extraction (Episodic → Semantic) ──

  /**
   * Periodically distill semantic knowledge from recent episodic memories.
   * e.g., "user has been at desk for 3 hours" → "user often works late"
   */
  private async triggerSemanticExtraction() {
    if (!this.analyzeCallback) return
    this.episodicSinceLastExtraction = 0

    try {
      const recentEpisodes = this.getRecentEpisodic(SEMANTIC_EXTRACTION_INTERVAL)
      const existingSemantic = this.getSemanticMemories(5)

      const episodeText = recentEpisodes.map(e =>
        `[${new Date(e.ts).toLocaleTimeString()}] ${e.event}`
      ).join('\n')

      const existingText = existingSemantic.map(s =>
        `- ${s.knowledge} (confidence: ${s.weight})`
      ).join('\n')

      const result = await this.analyzeCallback({
        type: 'extract_semantic',
        context: `Recent observations:\n${episodeText}\n\nExisting knowledge:\n${existingText || '(none)'}\n\nExtract 1-3 new facts/preferences/patterns from these observations. Format as JSON array of strings. Only include genuinely new insights not already in existing knowledge. Return [] if nothing new.`,
      })

      // Parse JSON array of strings
      try {
        const facts = JSON.parse(result)
        if (Array.isArray(facts)) {
          for (const fact of facts) {
            if (typeof fact === 'string' && fact.length > 5) {
              this.addSemantic({
                knowledge: fact,
                entityIds: ['user'],
                source: 'inferred',
              })
            }
          }
        }
      } catch {
        // AI didn't return valid JSON, try line-by-line
        const lines = result.split('\n').filter(l => l.trim().length > 10)
        for (const line of lines.slice(0, 3)) {
          this.addSemantic({
            knowledge: line.replace(/^[-*•]\s*/, '').trim(),
            entityIds: ['user'],
            source: 'inferred',
          })
        }
      }
    } catch (e: any) {
      console.error('[MultimodalMemory] Semantic extraction error:', e.message)
    }
  }

  // ── Context Building (for AI prompts) ──

  /**
   * Build a multimodal memory context string for inclusion in AI system prompt.
   * Combines visual memory, semantic knowledge, recent moods, and recent events.
   */
  buildContextForAI(options: { maxTokens?: number } = {}): string {
    this.load()
    const parts: string[] = []

    // Semantic knowledge (highest priority — abstracted facts)
    const semantics = this.getSemanticMemories(8)
    if (semantics.length > 0) {
      parts.push('## What I Know')
      for (const s of semantics) {
        parts.push(`- ${s.knowledge}${s.weight > 2 ? ` (observed ${s.weight}x)` : ''}`)
      }
    }

    // Recent mood
    const { dominantMood, moods } = this.getRecentMoodPattern(5)
    if (moods.length > 0 && dominantMood !== 'neutral') {
      parts.push(`\n## Current Mood: ${dominantMood}`)
    }

    // Recent episodic events (lower priority, more recent)
    const episodes = this.getRecentEpisodic(5)
    if (episodes.length > 0) {
      parts.push('\n## Recent Observations')
      for (const e of episodes) {
        const time = new Date(e.ts).toLocaleTimeString('zh-CN', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
        parts.push(`- [${time}] ${e.event}`)
      }
    }

    // Visual memory summary
    const visualSummary = visualMemory.getMemorySummary(3)
    if (visualSummary && visualSummary !== '(no visual memories yet)') {
      parts.push('\n## Visual Memories')
      parts.push(visualSummary)
    }

    // Entity info
    const user = this.entities.get('user')
    if (user && Object.keys(user.attributes).length > 0) {
      parts.push('\n## About ' + user.name)
      for (const [k, v] of Object.entries(user.attributes)) {
        parts.push(`- ${k}: ${v}`)
      }
    }

    return parts.join('\n')
  }

  // ── Stats ──

  getStats() {
    this.load()
    return {
      episodicCount: this.episodic.length,
      semanticCount: this.semantic.length,
      audioCount: this.audio.length,
      entityCount: this.entities.size,
      topSemantic: this.getSemanticMemories(3).map(s => `${s.knowledge} (w:${s.weight})`),
      visualStats: visualMemory.getStats(),
    }
  }
}

// Singleton
export const multimodalMemory = new MultimodalMemoryManager()
