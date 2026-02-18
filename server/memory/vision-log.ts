import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { isAbsolute, join } from 'path'

export interface VisionRecord {
  timestamp: string
  description: string
  entitiesPresent: string[]
  tags: string[]
  thumbnailPath: string
  sceneHash: string
  source: 'camera' | 'meeting' | 'manual'
}

export interface VisionSearchResult {
  id: string
  record: VisionRecord
  thumbnailPath: string
  score: number
}

function tokenizeSearchQuery(query: string): string[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const tokens = new Set<string>()

  // English words
  const englishWords = trimmed.toLowerCase().match(/[a-z0-9]+/g) || []
  for (const word of englishWords) {
    if (word.length > 0) tokens.add(word)
  }

  // Chinese chars + adjacent bigrams
  const chineseChars = trimmed.match(/[\u4e00-\u9fff]/g) || []
  for (const ch of chineseChars) tokens.add(ch)
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.add(chineseChars[i] + chineseChars[i + 1])
  }

  return Array.from(tokens)
}

export class VisionLog {
  private logPath: string
  private baseDir: string

  constructor(baseDir?: string) {
    const dir = baseDir || join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual')
    mkdirSync(dir, { recursive: true })
    this.baseDir = dir
    this.logPath = join(dir, 'vision-records.jsonl')
  }

  addRecord(record: Omit<VisionRecord, 'timestamp'>): VisionRecord {
    const entry: VisionRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    }
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n')
    return entry
  }

  getRecent(n: number = 10): VisionRecord[] {
    const records = this.readAll()
    return records.slice(-n)
  }

  search(query: string): VisionRecord[] {
    return this.searchWithScoring(query).map(result => result.record)
  }

  searchWithScoring(query: string, limit: number = 5): VisionSearchResult[] {
    const tokens = tokenizeSearchQuery(query)
    if (tokens.length === 0) return []

    const records = this.readAll()
    if (records.length === 0) return []

    const safeLimit = Math.max(1, limit)
    const scored: VisionSearchResult[] = []

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      const tags = Array.isArray(record.tags) ? record.tags : []
      const searchableText = `${record.description || ''} ${tags.join(' ')}`.toLowerCase()

      let score = 0
      for (const token of tokens) {
        if (searchableText.includes(token.toLowerCase())) {
          score += 1
        }
      }

      if (score > 0) {
        scored.push({
          id: `v${String(i + 1).padStart(3, '0')}`,
          record,
          thumbnailPath: this.resolveThumbnailPath(record.thumbnailPath),
          score,
        })
      }
    }

    return scored
      .sort((a, b) => b.score - a.score || b.record.timestamp.localeCompare(a.record.timestamp))
      .slice(0, safeLimit)
  }

  getByEntity(entityId: string): VisionRecord[] {
    return this.readAll().filter(r => r.entitiesPresent.includes(entityId))
  }

  getSummaryText(): string {
    const recent = this.getRecent(5)
    if (recent.length === 0) return 'Recent visual observations:\n- No visual observations yet.'

    const lines = recent
      .slice()
      .reverse()
      .map((record) => {
        const ts = new Date(record.timestamp).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
        const entities = record.entitiesPresent.length > 0
          ? ` (entities: ${record.entitiesPresent.join(', ')})`
          : ''
        return `- [${ts}] ${record.description}${entities}`
      })

    return `Recent visual observations:\n${lines.join('\n')}`
  }

  private resolveThumbnailPath(pathValue: string): string {
    if (!pathValue) return join(this.baseDir, 'thumbnails')
    return isAbsolute(pathValue) ? pathValue : join(this.baseDir, pathValue)
  }

  private readAll(): VisionRecord[] {
    if (!existsSync(this.logPath)) return []
    try {
      return readFileSync(this.logPath, 'utf-8')
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line) as VisionRecord
          } catch {
            return null
          }
        })
        .filter((record): record is VisionRecord => Boolean(record))
    } catch {
      return []
    }
  }
}
