export {
  loadSceneFromJSON,
  getCurrentScene,
  unloadScene,
  isActive,
  listAvailableScenes,
  handleSceneCommand,
  loadScene,
  loadRoomGLB,
  getAsset,
  searchAssets,
  listCategories,
  listAssets,
} from './scene-manager'

export type { SceneDescription, AssetEntry, SceneObject, LightOverride } from './scene-types'
export { isSceneLoaded, getSceneWalkBounds, SCENE_LAYER, SCENE_EXPOSURE, CHAR_EXPOSURE } from './scene-loader'
