import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

export interface VisionRecord {
  timestamp: string
  description: string
  entitiesPresent: string[]
  tags: string[]
  thumbnailPath: string
  sceneHash: string
  source: 'camera' | 'meeting' | 'manual'
}

export class VisionLog {
  private logPath: string

  constructor(baseDir?: string) {
    const dir = baseDir || join(process.env.HOME || '', '.openclaw', 'workspace', 'memory', 'visual')
    mkdirSync(dir, { recursive: true })
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
    const q = query.trim().toLowerCase()
    if (!q) return []
    return this.readAll().filter(r =>
      r.description.toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q)),
    )
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
