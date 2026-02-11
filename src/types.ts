import type { VRM } from '@pixiv/three-vrm'
import type { AnimationMixer } from 'three'

export type CharacterState = 'idle' | 'action' | 'speaking'

export interface AppState {
  vrm: VRM | null
  mixer: AnimationMixer | null
  autoBlinkEnabled: boolean
  mouseLookEnabled: boolean
  characterState: CharacterState
}

export interface IdleConfig {
  idleActionInterval: number
  idleActionChance: number
  idleMinHoldSeconds: number
  idleMaxHoldSeconds: number
}

export interface CrossfadeConfig {
  minCrossfadeDuration: number
  maxCrossfadeDuration: number
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
  weight?: number
  expression?: string
  expression_weight?: number
  expressions?: Array<{ name: string; weight: number }>
}
