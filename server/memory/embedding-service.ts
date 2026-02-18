import { readFileSync } from 'fs'
import { join } from 'path'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings'
const BATCH_LIMIT = 2048

const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_CACHE_SIZE = 500

let warnedMissingApiKey = false

function getApiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY

  try {
    const config = JSON.parse(
      readFileSync(join(process.env.HOME || '', '.openclaw', 'openclaw.json'), 'utf-8'),
    )
    return config.skills?.entries?.['openai-whisper-api']?.apiKey || ''
  } catch {
    return ''
  }
}

export function isEmbeddingServiceAvailable(): boolean {
  return !!getApiKey()
}

function normalizeInput(text: string): string {
  return (text || '').trim()
}

function getCachedEmbedding(text: string): number[] | null {
  const key = normalizeInput(text)
  if (!key) return []

  const entry = embeddingCache.get(key)
  if (!entry) return null

  const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS
  if (isExpired) {
    embeddingCache.delete(key)
    return null
  }

  return entry.embedding
}

function setCachedEmbedding(text: string, embedding: number[]): void {
  const key = normalizeInput(text)
  if (!key || embedding.length === 0) return

  embeddingCache.set(key, {
    embedding,
    timestamp: Date.now(),
  })

  // Lightweight LRU-ish trim by oldest timestamp.
  if (embeddingCache.size > MAX_CACHE_SIZE) {
    const oldest = Array.from(embeddingCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, embeddingCache.size - MAX_CACHE_SIZE)
    for (const [oldKey] of oldest) {
      embeddingCache.delete(oldKey)
    }
  }
}

async function fetchEmbeddings(inputs: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetch(EMBEDDING_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`OpenAI embeddings error (${resp.status}): ${body.slice(0, 300)}`)
  }

  const json = await resp.json() as {
    data?: Array<{ index: number; embedding: number[] }>
  }

  const output: number[][] = Array.from({ length: inputs.length }, () => [])

  for (const item of json.data || []) {
    if (!item || typeof item.index !== 'number' || !Array.isArray(item.embedding)) continue
    if (item.index < 0 || item.index >= output.length) continue
    output[item.index] = item.embedding
  }

  return output
}

export async function getTextEmbeddings(texts: string[]): Promise<number[][]> {
  if (!Array.isArray(texts) || texts.length === 0) return []

  const normalizedTexts = texts.map(normalizeInput)
  const results: number[][] = Array.from({ length: normalizedTexts.length }, () => [])
  const missingIndices: number[] = []

  for (let i = 0; i < normalizedTexts.length; i++) {
    const text = normalizedTexts[i]
    if (!text) continue

    const cached = getCachedEmbedding(text)
    if (cached !== null) {
      results[i] = cached
    } else {
      missingIndices.push(i)
    }
  }

  if (missingIndices.length === 0) return results

  const apiKey = getApiKey()
  if (!apiKey) {
    if (!warnedMissingApiKey) {
      warnedMissingApiKey = true
      console.warn('[embedding-service] OPENAI_API_KEY missing. Embedding search will fall back to keyword matching.')
    }
    return results
  }

  try {
    for (let start = 0; start < missingIndices.length; start += BATCH_LIMIT) {
      const chunkIndices = missingIndices.slice(start, start + BATCH_LIMIT)
      const chunkTexts = chunkIndices.map(index => normalizedTexts[index])

      const chunkEmbeddings = await fetchEmbeddings(chunkTexts, apiKey)

      for (let i = 0; i < chunkIndices.length; i++) {
        const targetIndex = chunkIndices[i]
        const embedding = Array.isArray(chunkEmbeddings[i]) ? chunkEmbeddings[i] : []
        results[targetIndex] = embedding
        if (embedding.length > 0) {
          setCachedEmbedding(normalizedTexts[targetIndex], embedding)
        }
      }
    }
  } catch (e) {
    console.error('[embedding-service] Failed to fetch embeddings:', e)
  }

  return results
}

export async function getTextEmbedding(text: string): Promise<number[]> {
  const [embedding] = await getTextEmbeddings([text])
  return Array.isArray(embedding) ? embedding : []
}
