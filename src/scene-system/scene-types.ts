export interface AssetEntry {
  id: string
  name: string
  category: string
  path: string
  defaultScale: number
  tags: string[]
}

export interface SceneObject {
  assetId: string
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  tint?: string
}

export interface LightOverride {
  type: string
  position: [number, number, number]
  intensity: number
  color?: string
}

export interface SceneDescription {
  id: string
  name: string
  room: { width: number; depth: number; height: number }
  floor: { color: string; material?: string }
  walls: { color: string; material?: string }
  objects: SceneObject[]
  lighting: {
    preset: 'cozy' | 'bright' | 'night' | 'studio'
    overrides?: LightOverride[]
  }
  character: {
    spawnPosition: [number, number, number]
    walkBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  }
}
