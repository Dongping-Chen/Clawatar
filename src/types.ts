import type { VRM } from '@pixiv/three-vrm'
import type { AnimationMixer } from 'three'

export type CharacterState = 'idle' | 'action' | 'speaking'
export type VRMMetaVersion = '0' | '1' | 'unknown'

export interface VRMModelMeta {
  metaVersion: VRMMetaVersion
  name?: string
  authors: string[]
  license?: string
  raw: unknown
}

export interface AppState {
  vrm: VRM | null
  vrmMeta: VRMModelMeta | null
  mixer: AnimationMixer | null
  baseFacingYaw: number
  autoBlinkEnabled: boolean
  idleAnimationsEnabled: boolean
  touchReactionsEnabled: boolean
  mouseLookEnabled: boolean
  characterState: CharacterState
}

export interface IdleConfig {
  idleActionInterval: number
  idleActionChance: number
  idleMinHoldSeconds: number
  idleMaxHoldSeconds: number
}

export interface WSCommand {
  type: string
  // Legacy
  url?: string
  name?: string
  intensity?: number
  text?: string
  x?: number
  y?: number
  z?: number
  // New protocol
  action_id?: string
  loop?: boolean
  category?: string
  weight?: number
  expression?: string
  expression_weight?: number
  expressions?: Array<{ name: string; weight: number }>
}
