import type { AppState } from './types'

export const state: AppState = {
  vrm: null,
  vrmMeta: null,
  mixer: null,
  baseFacingYaw: 0,
  autoBlinkEnabled: true,
  idleAnimationsEnabled: true,
  touchReactionsEnabled: true,
  mouseLookEnabled: true,
  characterState: 'idle',
}
