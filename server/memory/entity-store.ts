/**
 * Entity Memory Store — file-based memory for people, objects, places.
 * 
 * Storage layout (~/.openclaw/workspace/memory/entities/):
 *   {entity-id}.json        — Entity records
 *   index.json               — name/alias → entity ID lookup
 *   episodes/{date}/{id}.json — Episodic memories
 *   semantic/{entity-id}.json — Semantic memories per entity
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

// ── Interfaces ──

export interface FaceSnapshot {
  timestamp: string
  imagePath: string
  description: string
  context: string
  confidence: number
}

export interface Entity {
  id: string
  type: 'person' | 'object' | 'place'
  name: string | null
  aliases: string[]
  faceDescriptions: FaceSnapshot[]
  appearanceDescription: string
  voiceDescription: string | null
  speakerEmbedding: number[] | null
  relationship: string
  firstSeen: string
  lastSeen: string
  seenCount: number
  facts: string[]
}

export interface EpisodicMemory {
  id: string
  timestamp: string
  type: 'conversation' | 'sighting' | 'mention' | 'interaction'
  summary: string
  entityIds: string[]
  modalities: ('visual' | 'audio' | 'text')[]
  source: 'camera' | 'meeting' | 'chat'
}

export interface SemanticMemory {
  id: string
  entityId: string
  category: string
  content: string
  confidence: number
  sources: string[]
  createdAt: string
  updatedAt: string
}

// ── Name index: maps lowercase name/alias → entity ID ──

interface NameIndex {
  [lowerName: string]: string  // entity ID
}

// ── EntityStore ──

export class EntityStore {
  private baseDir: string
  private nameIndex: NameIndex = {}
  // Sorted by length descending for greedy matching
  private sortedNames: string[] = []

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'entities')
    mkdirSync(this.baseDir, { recursive: true })
    mkdirSync(join(this.baseDir, 'episodes'), { recursive: true })
    mkdirSync(join(this.baseDir, 'semantic'), { recursive: true })
    this.loadIndex()
  }

  // ── Index management ──

  private indexPath(): string { return join(this.baseDir, 'index.json') }

  private loadIndex(): void {
    try {
      this.nameIndex = JSON.parse(readFileSync(this.indexPath(), 'utf-8'))
    } catch {
      this.nameIndex = {}
    }
    this.rebuildSortedNames()
  }

  private saveIndex(): void {
    writeFileSync(this.indexPath(), JSON.stringify(this.nameIndex, null, 2))
    this.rebuildSortedNames()
  }

  private rebuildSortedNames(): void {
    this.sortedNames = Object.keys(this.nameIndex).sort((a, b) => b.length - a.length)
  }

  private indexEntity(entity: Entity): void {
    const names = [entity.name, ...entity.aliases].filter(Boolean) as string[]
    for (const name of names) {
      this.nameIndex[name.toLowerCase()] = entity.id
    }
    this.saveIndex()
  }

  private unindexEntity(entity: Entity): void {
    const names = [entity.name, ...entity.aliases].filter(Boolean) as string[]
    for (const name of names) {
      const key = name.toLowerCase()
      if (this.nameIndex[key] === entity.id) {
        delete this.nameIndex[key]
      }
    }
    this.saveIndex()
  }

  // ── Entity CRUD ──

  private entityPath(id: string): string { return join(this.baseDir, `${id}.json`) }

  getEntity(id: string): Entity | null {
    try {
      return JSON.parse(readFileSync(this.entityPath(id), 'utf-8'))
    } catch { return null }
  }

  findByName(name: string): Entity | null {
    const id = this.nameIndex[name.toLowerCase()]
    return id ? this.getEntity(id) : null
  }

  createEntity(data: Partial<Entity> & { type: Entity['type'] }): Entity {
    const now = new Date().toISOString()
    const entity: Entity = {
      id: randomUUID(),
      type: data.type,
      name: data.name ?? null,
      aliases: data.aliases ?? [],
      faceDescriptions: data.faceDescriptions ?? [],
      appearanceDescription: data.appearanceDescription ?? '',
      voiceDescription: data.voiceDescription ?? null,
      speakerEmbedding: data.speakerEmbedding ?? null,
      relationship: data.relationship ?? '',
      firstSeen: data.firstSeen ?? now,
      lastSeen: data.lastSeen ?? now,
      seenCount: data.seenCount ?? 1,
      facts: data.facts ?? [],
    }
    writeFileSync(this.entityPath(entity.id), JSON.stringify(entity, null, 2))
    this.indexEntity(entity)
    return entity
  }

  updateEntity(id: string, updates: Partial<Entity>): Entity | null {
    const entity = this.getEntity(id)
    if (!entity) return null
    // Unindex old names before updating
    this.unindexEntity(entity)
    Object.assign(entity, updates, { id }) // id is immutable
    writeFileSync(this.entityPath(id), JSON.stringify(entity, null, 2))
    this.indexEntity(entity)
    return entity
  }

  deleteEntity(id: string): boolean {
    const entity = this.getEntity(id)
    if (!entity) return false
    this.unindexEntity(entity)
    try {
      const { unlinkSync } = require('fs')
      unlinkSync(this.entityPath(id))
    } catch {}
    return true
  }

  listEntities(): Entity[] {
    const entities: Entity[] = []
    try {
      for (const file of readdirSync(this.baseDir)) {
        if (file.endsWith('.json') && file !== 'index.json') {
          try {
            entities.push(JSON.parse(readFileSync(join(this.baseDir, file), 'utf-8')))
          } catch {}
        }
      }
    } catch {}
    return entities
  }

  // ── Quick Recall — fast string matching, no LLM ──

  quickRecall(text: string): string {
    const lower = text.toLowerCase()
    const matched = new Map<string, Entity>()

    for (const name of this.sortedNames) {
      if (lower.includes(name)) {
        const id = this.nameIndex[name]
        if (!matched.has(id)) {
          const entity = this.getEntity(id)
          if (entity) matched.set(id, entity)
        }
      }
    }

    if (matched.size === 0) return ''

    const lines: string[] = ['[Entity Memory]']
    for (const entity of matched.values()) {
      const nameLine = entity.name || 'Unknown'
      const aliasStr = entity.aliases.length > 0 ? ` (aka ${entity.aliases.join(', ')})` : ''
      lines.push(`• ${nameLine}${aliasStr}: ${entity.relationship}`)
      if (entity.facts.length > 0) {
        lines.push(`  Facts: ${entity.facts.join('; ')}`)
      }
      if (entity.appearanceDescription) {
        lines.push(`  Appearance: ${entity.appearanceDescription}`)
      }
      lines.push(`  Seen ${entity.seenCount}x, last: ${entity.lastSeen.split('T')[0]}`)
    }
    lines.push('[/Entity Memory]')
    return lines.join('\n')
  }

  // ── Episodic Memory ──

  addEpisode(event: Omit<EpisodicMemory, 'id'>): EpisodicMemory {
    const episode: EpisodicMemory = { id: randomUUID(), ...event }
    const date = episode.timestamp.split('T')[0]
    const dir = join(this.baseDir, 'episodes', date)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${episode.id}.json`), JSON.stringify(episode, null, 2))

    // Update lastSeen/seenCount on referenced entities
    for (const eid of episode.entityIds) {
      const entity = this.getEntity(eid)
      if (entity) {
        entity.lastSeen = episode.timestamp
        entity.seenCount++
        writeFileSync(this.entityPath(eid), JSON.stringify(entity, null, 2))
      }
    }

    return episode
  }

  getEpisodes(date?: string): EpisodicMemory[] {
    const episodes: EpisodicMemory[] = []
    const episodesDir = join(this.baseDir, 'episodes')
    try {
      const dates = date ? [date] : readdirSync(episodesDir)
      for (const d of dates) {
        const dir = join(episodesDir, d)
        try {
          for (const file of readdirSync(dir)) {
            if (file.endsWith('.json')) {
              try { episodes.push(JSON.parse(readFileSync(join(dir, file), 'utf-8'))) } catch {}
            }
          }
        } catch {}
      }
    } catch {}
    return episodes
  }

  // ── Semantic Memory ──

  private semanticPath(entityId: string): string {
    return join(this.baseDir, 'semantic', `${entityId}.json`)
  }

  getSemanticMemories(entityId: string): SemanticMemory[] {
    try {
      return JSON.parse(readFileSync(this.semanticPath(entityId), 'utf-8'))
    } catch { return [] }
  }

  addSemanticFact(entityId: string, category: string, content: string, sourceEpisodeId?: string): SemanticMemory {
    const memories = this.getSemanticMemories(entityId)
    const now = new Date().toISOString()

    // Check if similar fact exists (case-insensitive content match)
    const existing = memories.find(m =>
      m.category === category && m.content.toLowerCase() === content.toLowerCase()
    )

    if (existing) {
      existing.confidence = Math.min(1.0, existing.confidence + 0.1)
      existing.updatedAt = now
      if (sourceEpisodeId && !existing.sources.includes(sourceEpisodeId)) {
        existing.sources.push(sourceEpisodeId)
      }
      writeFileSync(this.semanticPath(entityId), JSON.stringify(memories, null, 2))
      return existing
    }

    const mem: SemanticMemory = {
      id: randomUUID(),
      entityId,
      category,
      content,
      confidence: 0.5,
      sources: sourceEpisodeId ? [sourceEpisodeId] : [],
      createdAt: now,
      updatedAt: now,
    }
    memories.push(mem)
    writeFileSync(this.semanticPath(entityId), JSON.stringify(memories, null, 2))
    return mem
  }

  // ── Seed initial entities ──

  seed(): void {
    // Only seed if no entities exist
    if (this.listEntities().length > 0) return

    this.createEntity({
      type: 'person',
      name: 'Dongping',
      aliases: ['东平', 'Dongping Chen'],
      relationship: 'Creator and primary user',
      facts: [
        'Developer/researcher',
        'Likes Chainsaw Man',
        'Prefers Chinese for casual conversation',
      ],
    })
    console.log('[EntityStore] Seeded initial entity: Dongping')
  }
}
