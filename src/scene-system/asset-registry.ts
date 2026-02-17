import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { AssetEntry } from './scene-types'

const KENNEY_ASSETS: Array<[string, string, string[]]> = [
  ['bathroomCabinet', 'bathroom', ['bathroom', 'cabinet', 'storage']],
  ['bathroomCabinetDrawer', 'bathroom', ['bathroom', 'cabinet', 'drawer']],
  ['bathroomMirror', 'bathroom', ['bathroom', 'mirror']],
  ['bathroomSink', 'bathroom', ['bathroom', 'sink']],
  ['bathroomSinkSquare', 'bathroom', ['bathroom', 'sink']],
  ['bathtub', 'bathroom', ['bathroom', 'bathtub']],
  ['bear', 'decoration', ['toy', 'stuffed', 'bedroom']],
  ['bedBunk', 'furniture', ['bed', 'bedroom', 'sleep', 'bunk']],
  ['bedDouble', 'furniture', ['bed', 'bedroom', 'sleep']],
  ['bedSingle', 'furniture', ['bed', 'bedroom', 'sleep']],
  ['bench', 'furniture', ['bench', 'seating']],
  ['benchCushion', 'furniture', ['bench', 'seating', 'cushion']],
  ['benchCushionLow', 'furniture', ['bench', 'seating', 'cushion']],
  ['bookcaseClosed', 'furniture', ['bookcase', 'storage', 'books']],
  ['bookcaseClosedDoors', 'furniture', ['bookcase', 'storage', 'books']],
  ['bookcaseClosedWide', 'furniture', ['bookcase', 'storage', 'books']],
  ['bookcaseOpen', 'furniture', ['bookcase', 'storage', 'books']],
  ['bookcaseOpenLow', 'furniture', ['bookcase', 'storage', 'books']],
  ['books', 'decoration', ['books', 'study', 'reading']],
  ['cabinetBed', 'furniture', ['cabinet', 'bedroom', 'storage']],
  ['cabinetBedDrawer', 'furniture', ['cabinet', 'bedroom', 'drawer']],
  ['cabinetBedDrawerTable', 'furniture', ['cabinet', 'bedroom', 'drawer', 'table']],
  ['cabinetTelevision', 'furniture', ['cabinet', 'tv', 'living']],
  ['cabinetTelevisionDoors', 'furniture', ['cabinet', 'tv', 'living']],
  ['cardboardBoxClosed', 'decoration', ['box', 'storage']],
  ['cardboardBoxOpen', 'decoration', ['box', 'storage']],
  ['ceilingFan', 'appliance', ['ceiling', 'fan']],
  ['chair', 'furniture', ['chair', 'seating']],
  ['chairCushion', 'furniture', ['chair', 'seating', 'cushion']],
  ['chairDesk', 'furniture', ['chair', 'desk', 'office']],
  ['chairModernCushion', 'furniture', ['chair', 'modern', 'seating']],
  ['chairModernFrameCushion', 'furniture', ['chair', 'modern', 'seating']],
  ['chairRounded', 'furniture', ['chair', 'seating']],
  ['coatRack', 'furniture', ['coat', 'rack', 'hallway']],
  ['coatRackStanding', 'furniture', ['coat', 'rack', 'hallway']],
  ['computerKeyboard', 'appliance', ['computer', 'keyboard', 'desk']],
  ['computerMouse', 'appliance', ['computer', 'mouse', 'desk']],
  ['computerScreen', 'appliance', ['computer', 'screen', 'desk']],
  ['desk', 'furniture', ['desk', 'office', 'study']],
  ['deskCorner', 'furniture', ['desk', 'office', 'corner']],
  ['doorway', 'structure', ['door', 'wall']],
  ['doorwayFront', 'structure', ['door', 'wall']],
  ['doorwayOpen', 'structure', ['door', 'wall']],
  ['dryer', 'appliance', ['laundry', 'dryer']],
  ['floorCorner', 'structure', ['floor', 'tile']],
  ['floorCornerRound', 'structure', ['floor', 'tile']],
  ['floorFull', 'structure', ['floor', 'tile']],
  ['floorHalf', 'structure', ['floor', 'tile']],
  ['hoodLarge', 'appliance', ['kitchen', 'hood', 'ventilation']],
  ['hoodModern', 'appliance', ['kitchen', 'hood', 'ventilation']],
  ['kitchenBar', 'furniture', ['kitchen', 'bar', 'counter']],
  ['kitchenBarEnd', 'furniture', ['kitchen', 'bar', 'counter']],
  ['kitchenBlender', 'appliance', ['kitchen', 'blender']],
  ['kitchenCabinet', 'furniture', ['kitchen', 'cabinet', 'storage']],
  ['kitchenCabinetCornerInner', 'furniture', ['kitchen', 'cabinet', 'corner']],
  ['kitchenCabinetCornerRound', 'furniture', ['kitchen', 'cabinet', 'corner']],
  ['kitchenCabinetDrawer', 'furniture', ['kitchen', 'cabinet', 'drawer']],
  ['kitchenCabinetUpper', 'furniture', ['kitchen', 'cabinet', 'upper']],
  ['kitchenCabinetUpperCorner', 'furniture', ['kitchen', 'cabinet', 'upper', 'corner']],
  ['kitchenCabinetUpperDouble', 'furniture', ['kitchen', 'cabinet', 'upper']],
  ['kitchenCabinetUpperLow', 'furniture', ['kitchen', 'cabinet', 'upper']],
  ['kitchenCoffeeMachine', 'appliance', ['kitchen', 'coffee']],
  ['kitchenFridge', 'appliance', ['kitchen', 'fridge']],
  ['kitchenFridgeBuiltIn', 'appliance', ['kitchen', 'fridge']],
  ['kitchenFridgeLarge', 'appliance', ['kitchen', 'fridge']],
  ['kitchenFridgeSmall', 'appliance', ['kitchen', 'fridge']],
  ['kitchenMicrowave', 'appliance', ['kitchen', 'microwave']],
  ['kitchenSink', 'appliance', ['kitchen', 'sink']],
  ['kitchenStove', 'appliance', ['kitchen', 'stove']],
  ['kitchenStoveElectric', 'appliance', ['kitchen', 'stove', 'electric']],
  ['lampRoundFloor', 'decoration', ['lamp', 'floor', 'lighting']],
  ['lampRoundTable', 'decoration', ['lamp', 'table', 'lighting']],
  ['lampSquareCeiling', 'decoration', ['lamp', 'ceiling', 'lighting']],
  ['lampSquareFloor', 'decoration', ['lamp', 'floor', 'lighting']],
  ['lampSquareTable', 'decoration', ['lamp', 'table', 'lighting']],
  ['lampWall', 'decoration', ['lamp', 'wall', 'lighting']],
  ['laptop', 'appliance', ['laptop', 'computer', 'desk']],
  ['loungeChair', 'furniture', ['chair', 'lounge', 'living']],
  ['loungeChairRelax', 'furniture', ['chair', 'lounge', 'relax']],
  ['loungeDesignChair', 'furniture', ['chair', 'design', 'modern']],
  ['loungeDesignSofa', 'furniture', ['sofa', 'design', 'living']],
  ['loungeDesignSofaCorner', 'furniture', ['sofa', 'design', 'corner']],
  ['loungeSofa', 'furniture', ['sofa', 'living']],
  ['loungeSofaCorner', 'furniture', ['sofa', 'corner', 'living']],
  ['loungeSofaLong', 'furniture', ['sofa', 'living']],
  ['loungeSofaOttoman', 'furniture', ['sofa', 'ottoman', 'living']],
  ['paneling', 'structure', ['wall', 'panel']],
  ['pillow', 'decoration', ['pillow', 'bedroom', 'comfort']],
  ['pillowBlue', 'decoration', ['pillow', 'bedroom', 'comfort']],
  ['pillowBlueLong', 'decoration', ['pillow', 'bedroom', 'comfort']],
  ['pillowLong', 'decoration', ['pillow', 'bedroom', 'comfort']],
  ['plantSmall1', 'decoration', ['plant', 'greenery']],
  ['plantSmall2', 'decoration', ['plant', 'greenery']],
  ['plantSmall3', 'decoration', ['plant', 'greenery']],
  ['pottedPlant', 'decoration', ['plant', 'pot', 'greenery']],
  ['radio', 'appliance', ['radio', 'music']],
  ['rugDoormat', 'decoration', ['rug', 'floor', 'doormat']],
  ['rugRectangle', 'decoration', ['rug', 'floor']],
  ['rugRound', 'decoration', ['rug', 'floor']],
  ['rugRounded', 'decoration', ['rug', 'floor']],
  ['rugSquare', 'decoration', ['rug', 'floor']],
  ['shower', 'bathroom', ['shower', 'bathroom']],
  ['showerRound', 'bathroom', ['shower', 'bathroom']],
  ['sideTable', 'furniture', ['table', 'side', 'bedroom']],
  ['sideTableDrawers', 'furniture', ['table', 'side', 'drawer', 'bedroom']],
  ['speaker', 'appliance', ['speaker', 'music', 'audio']],
  ['speakerSmall', 'appliance', ['speaker', 'music', 'audio']],
  ['stairs', 'structure', ['stairs']],
  ['stairsCorner', 'structure', ['stairs', 'corner']],
  ['stairsOpen', 'structure', ['stairs']],
  ['stairsOpenSingle', 'structure', ['stairs']],
  ['stoolBar', 'furniture', ['stool', 'bar', 'seating']],
  ['stoolBarSquare', 'furniture', ['stool', 'bar', 'seating']],
  ['table', 'furniture', ['table', 'dining']],
  ['tableCloth', 'furniture', ['table', 'dining', 'cloth']],
  ['tableCoffee', 'furniture', ['table', 'coffee', 'living']],
  ['tableCoffeeGlass', 'furniture', ['table', 'coffee', 'glass']],
  ['tableCoffeeGlassSquare', 'furniture', ['table', 'coffee', 'glass']],
  ['tableCoffeeSquare', 'furniture', ['table', 'coffee', 'living']],
  ['tableCross', 'furniture', ['table', 'dining']],
  ['tableCrossCloth', 'furniture', ['table', 'dining', 'cloth']],
  ['tableGlass', 'furniture', ['table', 'glass']],
  ['tableRound', 'furniture', ['table', 'round', 'dining']],
  ['televisionAntenna', 'appliance', ['tv', 'television', 'vintage']],
  ['televisionModern', 'appliance', ['tv', 'television', 'modern']],
  ['televisionVintage', 'appliance', ['tv', 'television', 'vintage']],
  ['toaster', 'appliance', ['kitchen', 'toaster']],
  ['toilet', 'bathroom', ['toilet', 'bathroom']],
  ['toiletSquare', 'bathroom', ['toilet', 'bathroom']],
  ['trashcan', 'decoration', ['trash', 'bin']],
  ['wall', 'structure', ['wall']],
  ['wallCorner', 'structure', ['wall', 'corner']],
  ['wallCornerRond', 'structure', ['wall', 'corner', 'round']],
  ['wallDoorway', 'structure', ['wall', 'door']],
  ['wallDoorwayWide', 'structure', ['wall', 'door', 'wide']],
  ['wallHalf', 'structure', ['wall', 'half']],
  ['wallWindow', 'structure', ['wall', 'window']],
  ['wallWindowSlide', 'structure', ['wall', 'window', 'slide']],
  ['washer', 'appliance', ['laundry', 'washer']],
  ['washerDryerStacked', 'appliance', ['laundry', 'washer', 'dryer']],
]

function humanizeName(id: string): string {
  return id.replace(/([A-Z])/g, ' $1').replace(/(\d+)/, ' $1').trim()
}

const registry: Map<string, AssetEntry> = new Map()

for (const [fileName, category, tags] of KENNEY_ASSETS) {
  const id = `kenney:${fileName}`
  registry.set(id, {
    id,
    name: humanizeName(fileName),
    category,
    path: `assets/furniture/kenney/${fileName}.glb`,
    defaultScale: 2.0,
    tags,
  })
}

export function getAsset(id: string): AssetEntry | undefined {
  return registry.get(id)
}

export function searchAssets(tags: string[]): AssetEntry[] {
  const lower = tags.map(t => t.toLowerCase())
  return [...registry.values()].filter(entry =>
    lower.some(t => entry.tags.includes(t))
  )
}

export function listCategories(): string[] {
  return [...new Set([...registry.values()].map(e => e.category))]
}

export function listAssets(): AssetEntry[] {
  return [...registry.values()]
}

const loader = new GLTFLoader()
const glbCache = new Map<string, THREE.Group>()

export async function loadGLB(path: string): Promise<THREE.Group> {
  const cached = glbCache.get(path)
  if (cached) return cached.clone()

  const gltf = await loader.loadAsync(path)
  glbCache.set(path, gltf.scene)
  return gltf.scene.clone()
}

export function clearCache(): void {
  for (const group of glbCache.values()) {
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        const mat = child.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat?.dispose()
      }
    })
  }
  glbCache.clear()
}
