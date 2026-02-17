import type { SceneDescription } from './scene-types'
import { loadScene, loadRoomGLB, unloadCurrentScene, isSceneLoaded } from './scene-loader'
import { listAssets } from './asset-registry'

let currentDescription: SceneDescription | null = null
let cleanupFn: (() => void) | null = null
let loadingPromise: Promise<void> | null = null
let availableScenes: string[] = []

function validateScene(data: unknown): data is SceneDescription {
  const d = data as Record<string, unknown>
  return !!(d?.id && d?.room && d?.objects && d?.lighting && d?.character
    && (d.room as any)?.width && (d.room as any)?.depth && (d.room as any)?.height
    && Array.isArray(d.objects) && (d.lighting as any)?.preset
    && (d.character as any)?.walkBounds)
}

export async function loadSceneFromJSON(path: string): Promise<void> {
  if (loadingPromise) await loadingPromise  // wait for any in-flight load
  loadingPromise = (async () => {
    const resp = await fetch(path)
    if (!resp.ok) throw new Error(`Failed to load scene: ${path} (${resp.status})`)
    const data: unknown = await resp.json()
    if (!validateScene(data)) throw new Error(`Invalid scene JSON: ${path}`)
    cleanupFn = await loadScene(data)
    currentDescription = data
  })()
  await loadingPromise
  loadingPromise = null
}

export function getCurrentScene(): SceneDescription | null {
  return currentDescription
}

export function unloadScene(): void {
  if (cleanupFn) cleanupFn()
  else unloadCurrentScene()
  currentDescription = null
  cleanupFn = null
}

export function isActive(): boolean {
  return isSceneLoaded()
}

export async function listAvailableScenes(): Promise<string[]> {
  if (availableScenes.length > 0) return availableScenes
  try {
    const resp = await fetch('/scenes/index.json')
    if (resp.ok) {
      availableScenes = await resp.json()
    }
  } catch {
    availableScenes = ['scenes/cozy-bedroom.json']
  }
  return availableScenes
}

type SceneCommand =
  | { type: 'load_scene'; path?: string; scene?: string }
  | { type: 'load_room'; path: string; exposure?: number; fov?: number }
  | { type: 'unload_scene' }
  | { type: 'list_scenes' }
  | { type: 'list_assets' }

export function handleSceneCommand(cmd: SceneCommand): void {
  switch (cmd.type) {
    case 'load_scene': {
      // Support both cmd.path ("scenes/cozy-bedroom.json") and cmd.scene ("cozy-bedroom")
      const scenePath = cmd.path ?? (cmd.scene ? `scenes/${cmd.scene}.json` : null)
      if (scenePath) {
        console.log('[scene-manager] Loading scene:', scenePath)
        loadSceneFromJSON(scenePath)
          .then(() => console.log(`[scene-manager] Scene loaded OK: ${scenePath}`))
          .catch(e => console.error('[scene-manager] Scene load FAILED:', e))
      } else {
        console.error('load_scene: missing path or scene parameter')
      }
      break
    }
    case 'load_room': {
      const roomPath = cmd.path
      if (roomPath) {
        console.log('[scene-manager] Loading room GLB:', roomPath)
        loadRoomGLB(roomPath, {
          exposure: cmd.exposure,
          fov: cmd.fov,
        })
          .then(() => console.log(`[scene-manager] Room loaded OK: ${roomPath}`))
          .catch(e => console.error('[scene-manager] Room load FAILED:', e))
      } else {
        console.error('load_room: missing path parameter')
      }
      break
    }
    case 'list_scenes':
      listAvailableScenes().then(scenes => {
        const ws = (window as any).__clawatar_ws as WebSocket | undefined
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'scene_list', scenes }))
        }
      })
      break
    case 'unload_scene':
      unloadScene()
      break
    case 'list_assets': {
      const assets = listAssets().map(a => ({ id: a.id, name: a.name, category: a.category }))
      const ws = (window as any).__clawatar_ws as WebSocket | undefined
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'asset_list', assets }))
      }
      break
    }
  }
}

export { loadScene, loadRoomGLB } from './scene-loader'
export { getAsset, searchAssets, listCategories, listAssets } from './asset-registry'
export type { SceneDescription, AssetEntry } from './scene-types'
