export type AvatarSyncCommand = Record<string, unknown> & {
  type: string
}

type SyncCategory = 'theme' | 'camera' | 'action' | 'expression' | 'scene' | 'state'

type SyncEnvelope = {
  type: 'sync'
  category: SyncCategory | string
  payload: Record<string, unknown>
  origin: string
  ts: number
}

let suppressDepth = 0
const FALLBACK_ORIGIN = `web-${crypto.randomUUID().slice(0, 8)}`

function isSuppressed(): boolean {
  return suppressDepth > 0
}

export async function withSyncSuppressed<T>(fn: () => Promise<T> | T): Promise<T> {
  suppressDepth += 1
  try {
    return await fn()
  } finally {
    suppressDepth = Math.max(0, suppressDepth - 1)
  }
}

function resolveOrigin(): string {
  const fromWindow = (window as any).__clawatar_device_id
  return typeof fromWindow === 'string' && fromWindow.length > 0
    ? fromWindow
    : FALLBACK_ORIGIN
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      normalized[key] = value
    }
  }
  return normalized
}

function ensureEnvelope(raw: Record<string, unknown>): SyncEnvelope | null {
  const category = typeof raw.category === 'string' ? raw.category : null
  if (!category) return null

  const payload = (raw.payload && typeof raw.payload === 'object')
    ? sanitizePayload(raw.payload as Record<string, unknown>)
    : {}

  return {
    type: 'sync',
    category,
    payload,
    origin: typeof raw.origin === 'string' && raw.origin.length > 0 ? raw.origin : resolveOrigin(),
    ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
  }
}

function commandToEnvelope(command: AvatarSyncCommand): SyncEnvelope | null {
  if (command.type === 'sync') {
    return ensureEnvelope(command)
  }

  switch (command.type) {
    case 'play_action': {
      const actionId = typeof command.action_id === 'string' ? command.action_id : undefined
      if (!actionId) return null

      return {
        type: 'sync',
        category: 'action',
        payload: sanitizePayload({
          actionId,
          loop: command.loop,
          category: command.category,
          expression: command.expression,
          expressionWeight: command.expression_weight,
        }),
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    case 'set_expression': {
      const name = typeof command.name === 'string' ? command.name : undefined
      if (!name) return null

      return {
        type: 'sync',
        category: 'expression',
        payload: sanitizePayload({
          name,
          weight: command.weight,
        }),
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    case 'set_camera_preset': {
      const preset = typeof command.preset === 'string' ? command.preset : undefined
      if (!preset) return null

      return {
        type: 'sync',
        category: 'camera',
        payload: sanitizePayload({
          preset,
          duration: command.duration,
        }),
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    case 'adjust_camera_preset': {
      const preset = typeof command.preset === 'string' ? command.preset : undefined
      if (!preset) return null

      return {
        type: 'sync',
        category: 'camera',
        payload: sanitizePayload({
          preset,
          distance: command.distance,
          height: command.height,
        }),
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    case 'set_scene': {
      const room = typeof command.room === 'string' ? command.room : undefined
      if (room === undefined) return null

      return {
        type: 'sync',
        category: 'scene',
        payload: sanitizePayload({ room }),
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    case 'set_theme':
    case 'set_background_theme': {
      const theme = typeof command.theme === 'string' ? command.theme : undefined
      if (!theme) return null

      return {
        type: 'sync',
        category: 'theme',
        payload: { theme },
        origin: resolveOrigin(),
        ts: Date.now(),
      }
    }

    default:
      return null
  }
}

function sendToNative(envelope: SyncEnvelope): void {
  try {
    ;(window as any).webkit?.messageHandlers?.clawatar?.postMessage(envelope)
  } catch {
    // Ignore bridge errors when not in WKWebView.
  }
}

function sendToViewerWebSocket(envelope: SyncEnvelope): void {
  try {
    const ws = (window as any).__clawatar_ws as WebSocket | undefined
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(envelope))
    }
  } catch {
    // Ignore transient socket issues.
  }
}

export function broadcastSyncCommand(command: AvatarSyncCommand): void {
  if (isSuppressed()) {
    return
  }

  const envelope = commandToEnvelope(command)
  if (!envelope) {
    return
  }

  // Native relay path is the critical cross-device route in WKWebView embed mode.
  // Send it first to shave a tiny bit of bridge latency.
  sendToNative(envelope)
  sendToViewerWebSocket(envelope)
}
