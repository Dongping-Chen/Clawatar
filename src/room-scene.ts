import * as THREE from 'three'
import { scene, renderer, lightingRig, camera, controls, setupRoomBloom, teardownRoomBloom, roomBloomPass, setThemeBackgroundSuppressed } from './scene'

let roomGroup: THREE.Group
let roomLights: THREE.Light[] = []
let savedOutdoorState: { visible: boolean; intensity: number; name: string }[] = []
let _isRoomMode = false
let currentTheme: 'cozy' | 'study' | 'night' = 'cozy'

// Room dimensions
const ROOM_W = 4
const ROOM_D = 3.5
const ROOM_H = 3
const HALF_W = ROOM_W / 2
const HALF_D = ROOM_D / 2

// === Animation references (populated during init) ===
interface RoomAnimRefs {
  cat: THREE.Group | null
  clockHourHand: THREE.Mesh | null
  clockMinuteHand: THREE.Mesh | null
  fairyBulbs: THREE.Mesh[]
  fairySprites: THREE.Sprite[]
  curtainFolds: THREE.Mesh[]
  laptopScreen: THREE.Mesh | null
  steamParticles: THREE.Mesh[]
  mugPosition: THREE.Vector3
  plantLeaves: THREE.Mesh[]
  catEars: THREE.Mesh[]
  lightShaft: THREE.Group | null
  dustMotes: THREE.Points | null
  dustVelocities: Float32Array | null
}

const animRefs: RoomAnimRefs = {
  cat: null, clockHourHand: null, clockMinuteHand: null,
  fairyBulbs: [], fairySprites: [], curtainFolds: [], laptopScreen: null,
  steamParticles: [], mugPosition: new THREE.Vector3(),
  plantLeaves: [], catEars: [],
  lightShaft: null, dustMotes: null, dustVelocities: null,
}

// === Seeded random for deterministic books ===
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// === Toon material for anime-style furniture ===
const toonGradient = new THREE.DataTexture(
  new Uint8Array([80, 160, 255]), 3, 1, THREE.RedFormat
)
toonGradient.minFilter = THREE.NearestFilter
toonGradient.magFilter = THREE.NearestFilter
toonGradient.needsUpdate = true

function toonMat(color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...opts })
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...opts })
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function cyl(rT: number, rB: number, h: number, material: THREE.Material, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg), material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Add dark edge outlines to a mesh for visual definition */
function addEdgeOutline(mesh: THREE.Mesh, color = 0x000000, opacity = 0.08): void {
  const edges = new THREE.EdgesGeometry(mesh.geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))
  mesh.add(line)
}

function createWindowLightShaft(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'light-shaft'

  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xfff5d4,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  for (let i = 0; i < 4; i++) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.5),
      shaftMat.clone()
    )
    plane.position.set(0, 1.5, -HALF_D + 1.0)
    plane.rotation.x = -0.3
    plane.rotation.y = (i - 1.5) * 0.15
    plane.renderOrder = 999
    group.add(plane)
  }

  animRefs.lightShaft = group
  return group
}

function createDustMotes(): THREE.Points {
  const count = 60
  const positions = new Float32Array(count * 3)
  const velocities = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 2.0
    positions[i * 3 + 1] = Math.random() * 2.5 + 0.3
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0
    velocities[i * 3] = (Math.random() - 0.5) * 0.002
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.001
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.002
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const material = new THREE.PointsMaterial({
    color: 0xfff8e0,
    size: 0.015,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const points = new THREE.Points(geometry, material)
  points.name = 'dust-motes'
  animRefs.dustMotes = points
  animRefs.dustVelocities = velocities
  return points
}

function createFloor(): THREE.Group {
  const group = new THREE.Group()
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(0xc49a6c, { roughness: 0.75, transparent: true, side: THREE.DoubleSide })
  )
  floor.name = 'wall-floor'
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 0)
  floor.receiveShadow = true
  group.add(floor)

  // Wood plank gaps
  const gapMat = mat(0x8a6a4a, { roughness: 0.9 })
  const plankWidth = 0.4
  for (let i = -Math.floor(ROOM_W / plankWidth / 2); i <= Math.floor(ROOM_W / plankWidth / 2); i++) {
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(0.008, ROOM_D), gapMat)
    gap.rotation.x = -Math.PI / 2
    gap.position.set(i * plankWidth, 0.001, 0)
    group.add(gap)
  }
  // Cross gaps every ~0.8m
  for (let z = -HALF_D + 0.4; z < HALF_D; z += 0.8) {
    const gap = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, 0.005), gapMat)
    gap.rotation.x = -Math.PI / 2
    gap.position.set(0, 0.001, z)
    group.add(gap)
  }
  return group
}

function createCeiling(): THREE.Group {
  const group = new THREE.Group()
  // Main ceiling
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(0xf0e8de, { roughness: 0.9, transparent: true, side: THREE.DoubleSide })
  )
  ceiling.name = 'wall-ceiling'
  ceiling.rotation.x = Math.PI / 2
  ceiling.position.set(0, ROOM_H, 0)
  group.add(ceiling)

  // Recessed trim (slightly inset rectangle)
  const trimW = ROOM_W - 0.4, trimD = ROOM_D - 0.4
  const trim = new THREE.Mesh(
    new THREE.PlaneGeometry(trimW, trimD),
    mat(0xe8dfd4, { roughness: 0.95 })
  )
  trim.rotation.x = Math.PI / 2
  trim.position.set(0, ROOM_H - 0.01, 0)
  group.add(trim)
  return group
}

function createBaseboards(): THREE.Group {
  const group = new THREE.Group()
  const bbMat = mat(0xa88060, { roughness: 0.7 })
  const bbH = 0.08, bbT = 0.02

  // Back wall baseboard
  const back = box(ROOM_W, bbH, bbT, bbMat)
  back.position.set(0, bbH / 2, -HALF_D + bbT / 2)
  back.castShadow = false
  group.add(back)

  // Left wall
  const left = box(bbT, bbH, ROOM_D, bbMat)
  left.position.set(-HALF_W + bbT / 2, bbH / 2, 0)
  left.castShadow = false
  group.add(left)

  // Right wall
  const right = box(bbT, bbH, ROOM_D, bbMat)
  right.position.set(HALF_W - bbT / 2, bbH / 2, 0)
  right.castShadow = false
  group.add(right)

  return group
}

function createWalls(): THREE.Group {
  const walls = new THREE.Group()
  const wallMat = mat(0xf5ede3, { roughness: 0.9, transparent: true, side: THREE.DoubleSide })

  // Back wall with window hole
  const winW = 1.4, winH = 1.2, winBottom = 1.2
  const winTop = winBottom + winH
  const blW = (ROOM_W - winW) / 2
  const bl = box(blW, ROOM_H, 0.1, wallMat)
  bl.position.set(-HALF_W + blW / 2, ROOM_H / 2, -HALF_D)
  bl.name = 'wall-back'
  bl.castShadow = false; bl.receiveShadow = true
  walls.add(bl)
  const br = box(blW, ROOM_H, 0.1, wallMat)
  br.position.set(HALF_W - blW / 2, ROOM_H / 2, -HALF_D)
  br.castShadow = false; br.receiveShadow = true
  walls.add(br)
  const ba = box(winW, ROOM_H - winTop, 0.1, wallMat)
  ba.position.set(0, winTop + (ROOM_H - winTop) / 2, -HALF_D)
  ba.castShadow = false
  walls.add(ba)
  const bb = box(winW, winBottom, 0.1, wallMat)
  bb.position.set(0, winBottom / 2, -HALF_D)
  bb.castShadow = false
  walls.add(bb)

  // Window glow
  const windowGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshBasicMaterial({ color: 0xffe4b0, transparent: true, opacity: 0.6 })
  )
  windowGlow.name = 'window-glow'
  windowGlow.position.set(0, winBottom + winH / 2, -HALF_D + 0.01)
  walls.add(windowGlow)

  // Window frame
  const frameMat = mat(0xd4b08c, { roughness: 0.7 })
  const frameT = 0.04
  for (const y of [winBottom, winTop]) {
    const bar = box(winW + 0.08, frameT, 0.06, frameMat)
    bar.position.set(0, y, -HALF_D + 0.03)
    bar.castShadow = false
    walls.add(bar)
  }
  for (const x of [-winW / 2, 0, winW / 2]) {
    const bar = box(frameT, winH, 0.06, frameMat)
    bar.position.set(x, winBottom + winH / 2, -HALF_D + 0.03)
    bar.castShadow = false
    walls.add(bar)
  }

  // Curtains
  const curtainMat = mat(0xf0e0e8, { roughness: 0.95 })
  for (const side of [-1, 1]) {
    const curtain = box(0.25, winH + 0.3, 0.05, curtainMat)
    curtain.position.set(side * (winW / 2 + 0.18), winBottom + winH / 2 + 0.05, -HALF_D + 0.06)
    curtain.castShadow = true
    walls.add(curtain)
  }

  // Window sill
  const sill = box(winW + 0.16, 0.03, 0.12, frameMat)
  sill.position.set(0, winBottom - 0.015, -HALF_D + 0.06)
  sill.castShadow = false
  walls.add(sill)

  // Left wall
  const leftWallMat = mat(0xf5ede3, { roughness: 0.9, transparent: true, side: THREE.DoubleSide })
  const leftWall = box(0.1, ROOM_H, ROOM_D, leftWallMat)
  leftWall.name = 'wall-left'
  leftWall.position.set(-HALF_W, ROOM_H / 2, 0)
  leftWall.castShadow = false; leftWall.receiveShadow = true
  walls.add(leftWall)

  // Right wall
  const rightWallMat = mat(0xf5ede3, { roughness: 0.9, transparent: true, side: THREE.DoubleSide })
  const rightWall = box(0.1, ROOM_H, ROOM_D, rightWallMat)
  rightWall.name = 'wall-right'
  rightWall.position.set(HALF_W, ROOM_H / 2, 0)
  rightWall.castShadow = false; rightWall.receiveShadow = true
  walls.add(rightWall)

  // Door frame on right wall
  const doorFrameMat = mat(0xc49a6c, { roughness: 0.7 })
  const doorW = 0.8, doorH = 2.1
  const doorFrame = box(0.06, doorH, doorW, doorFrameMat)
  doorFrame.position.set(HALF_W - 0.02, doorH / 2, -HALF_D + 0.6)
  doorFrame.castShadow = false
  walls.add(doorFrame)

  // Subtle wall stripe pattern (semi-transparent overlay on back wall)
  const stripeMat = new THREE.MeshBasicMaterial({
    color: 0xe8ddd0, transparent: true, opacity: 0.12, side: THREE.DoubleSide
  })
  for (let i = 0; i < 8; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.04, ROOM_H), stripeMat)
    stripe.position.set(-HALF_W + 0.5 + i * 0.5, ROOM_H / 2, -HALF_D + 0.06)
    walls.add(stripe)
  }

  // Wallpaper dot pattern on left wall
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xe0d5c8, transparent: true, opacity: 0.15 })
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 14; col++) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 6), dotMat)
      dot.position.set(-HALF_W + 0.06, 0.25 + row * 0.22, -HALF_D + 0.25 + col * 0.22)
      dot.rotation.y = Math.PI / 2
      walls.add(dot)
    }
  }

  // Picture rail molding near ceiling (all 3 walls)
  const moldingMat = mat(0xd4b08c, { roughness: 0.6 })
  const moldBack = box(ROOM_W, 0.03, 0.02, moldingMat)
  moldBack.position.set(0, ROOM_H - 0.15, -HALF_D + 0.06)
  moldBack.castShadow = false
  walls.add(moldBack)
  const moldLeft = box(0.02, 0.03, ROOM_D, moldingMat)
  moldLeft.position.set(-HALF_W + 0.06, ROOM_H - 0.15, 0)
  moldLeft.castShadow = false
  walls.add(moldLeft)
  const moldRight = box(0.02, 0.03, ROOM_D, moldingMat)
  moldRight.position.set(HALF_W - 0.06, ROOM_H - 0.15, 0)
  moldRight.castShadow = false
  walls.add(moldRight)

  // Power outlet on right wall
  const outletPlate = box(0.04, 0.06, 0.008, mat(0xf0ece8, { roughness: 0.5 }))
  outletPlate.position.set(HALF_W - 0.06, 0.3, 0.8)
  outletPlate.rotation.y = -Math.PI / 2
  walls.add(outletPlate)
  for (const dy of [-0.012, 0.012]) {
    const socket = box(0.015, 0.008, 0.003, mat(0x888888))
    socket.position.set(HALF_W - 0.055, 0.3 + dy, 0.8)
    socket.rotation.y = -Math.PI / 2
    walls.add(socket)
  }

  // Windowsill potted plant
  const sillPot = cyl(0.03, 0.025, 0.05, mat(0xc86040, { roughness: 0.8 }))
  sillPot.position.set(0.35, 1.2 + 0.025, -HALF_D + 0.08)
  walls.add(sillPot)
  for (let i = 0; i < 4; i++) {
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), mat(0x5a9e5a, { roughness: 0.8 }))
    const a = (i / 4) * Math.PI * 2
    lf.position.set(0.35 + Math.cos(a) * 0.02, 1.2 + 0.06 + i * 0.01, -HALF_D + 0.08 + Math.sin(a) * 0.02)
    walls.add(lf)
  }

  // Window condensation (frosted patch)
  const condensation = new THREE.Mesh(
    new THREE.CircleGeometry(0.15, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 })
  )
  condensation.position.set(-0.3, 1.2 + 0.4, -HALF_D + 0.02)
  walls.add(condensation)

  // Curtain bulge (overlapping boxes for fabric effect)
  for (const side of [-1, 1]) {
    const cx = side * (0.7 + 0.18)
    for (let i = 0; i < 3; i++) {
      const fold = box(0.06, 0.3, 0.03, mat(0xf0e0e8, { roughness: 0.95 }))
      fold.position.set(cx, 1.2 + 0.6 - i * 0.35, -HALF_D + 0.08 + (i % 2) * 0.015)
      fold.castShadow = false
      fold.name = 'curtain-fold'
      animRefs.curtainFolds.push(fold)
      walls.add(fold)
    }
  }

  return walls
}

function createDesk(): THREE.Group {
  const desk = new THREE.Group()
  const woodMat = mat(0xd4b08c, { roughness: 0.75 })
  const deskY = 0.72, deskW = 1.4, deskD = 0.6, deskT = 0.04

  const surface = box(deskW, deskT, deskD, toonMat(0xd4b08c))
  surface.position.y = deskY
  addEdgeOutline(surface)
  desk.add(surface)

  // Legs — slightly thicker for realism
  const legMat = mat(0xb8936e, { roughness: 0.8 })
  for (const [x, z] of [[-0.65, -0.25], [0.65, -0.25], [-0.65, 0.25], [0.65, 0.25]]) {
    const leg = cyl(0.025, 0.025, deskY, legMat)
    leg.position.set(x, deskY / 2, z)
    desk.add(leg)
  }

  // Laptop
  const laptopBase = box(0.35, 0.015, 0.25, mat(0x888888, { roughness: 0.3, metalness: 0.5 }))
  laptopBase.position.set(-0.2, deskY + deskT / 2 + 0.008, -0.05)
  desk.add(laptopBase)

  const laptopScreen = box(0.35, 0.25, 0.008, mat(0x333333, {
    emissive: 0xe8f0ff, emissiveIntensity: 0.8
  }))
  laptopScreen.position.set(-0.2, deskY + deskT / 2 + 0.14, -0.17)
  laptopScreen.rotation.x = -0.15
  animRefs.laptopScreen = laptopScreen
  desk.add(laptopScreen)

  // Coffee mug
  const mug = cyl(0.03, 0.025, 0.08, mat(0xffb0c8, { roughness: 0.6 }))
  mug.position.set(0.35, deskY + deskT / 2 + 0.04, -0.1)
  animRefs.mugPosition.set(0.35, deskY + deskT / 2 + 0.08, -0.1)
  desk.add(mug)

  // Books stack
  const bookColors = [0xffb3c6, 0xb8d4e3, 0xd4c5f9]
  for (let i = 0; i < 3; i++) {
    const book = box(0.18, 0.025, 0.13, mat(bookColors[i], { roughness: 0.85 }))
    book.position.set(0.4, deskY + deskT / 2 + 0.013 + i * 0.027, 0.1)
    book.rotation.y = 0.1 * (i - 1)
    desk.add(book)
  }

  // Desk lamp
  const lampBase = cyl(0.04, 0.05, 0.02, mat(0x444444, { metalness: 0.6 }))
  lampBase.position.set(0.55, deskY + deskT / 2 + 0.01, -0.15)
  desk.add(lampBase)
  const lampPole = cyl(0.01, 0.01, 0.35, mat(0x444444, { metalness: 0.6 }))
  lampPole.position.set(0.55, deskY + deskT / 2 + 0.19, -0.15)
  desk.add(lampPole)
  const lampShade = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.1, 16, 1, true),
    mat(0xfff0d0, { emissive: 0xfff0d0, emissiveIntensity: 0.6, side: THREE.DoubleSide })
  )
  lampShade.position.set(0.55, deskY + deskT / 2 + 0.38, -0.15)
  lampShade.rotation.x = Math.PI
  lampShade.castShadow = true
  desk.add(lampShade)

  // Desk drawer
  const drawer = box(0.5, 0.08, deskD - 0.04, mat(0xc8a070, { roughness: 0.75 }))
  drawer.position.set(0, deskY - 0.08, 0)
  addEdgeOutline(drawer)
  desk.add(drawer)
  const handle = box(0.06, 0.015, 0.015, mat(0x888888, { metalness: 0.5 }))
  handle.position.set(0, deskY - 0.04, deskD / 2 - 0.02)
  desk.add(handle)

  // Sticky notes
  const stickyColors = [0xffff88, 0xff88cc, 0x88ddff]
  for (let i = 0; i < 3; i++) {
    const sticky = box(0.05, 0.001, 0.05, mat(stickyColors[i], { roughness: 0.9 }))
    sticky.position.set(0.15 + i * 0.06, deskY + deskT / 2 + 0.001, 0.15)
    sticky.rotation.y = (i - 1) * 0.3
    desk.add(sticky)
  }

  // Mousepad
  const mousepad = box(0.2, 0.003, 0.18, mat(0x333340, { roughness: 0.9 }))
  mousepad.position.set(0.15, deskY + deskT / 2 + 0.002, -0.05)
  desk.add(mousepad)

  // Small succulent
  const succPot = cyl(0.02, 0.018, 0.03, mat(0xd4a06a, { roughness: 0.8 }))
  succPot.position.set(-0.55, deskY + deskT / 2 + 0.015, 0.1)
  desk.add(succPot)
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat(0x7ab87a, { roughness: 0.8 }))
    const a = (i / 5) * Math.PI * 2
    petal.position.set(-0.55 + Math.cos(a) * 0.012, deskY + deskT / 2 + 0.035, 0.1 + Math.sin(a) * 0.012)
    desk.add(petal)
  }

  // Headphones
  const hpMat = mat(0x333333, { roughness: 0.4, metalness: 0.3 })
  const hpBand = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.005, 8, 16, Math.PI), hpMat)
  hpBand.position.set(0.45, deskY + deskT / 2 + 0.06, -0.15)
  hpBand.rotation.z = Math.PI
  desk.add(hpBand)
  for (const side of [-1, 1]) {
    const cup = cyl(0.025, 0.025, 0.03, hpMat)
    cup.position.set(0.45 + side * 0.06, deskY + deskT / 2 + 0.015, -0.15)
    desk.add(cup)
  }

  // Keyboard dots on laptop base
  const kbDotMat = mat(0x666666, { roughness: 0.3 })
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 8; c++) {
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.002, 0.012), kbDotMat)
      dot.position.set(-0.2 - 0.13 + c * 0.035, deskY + deskT / 2 + 0.016, -0.05 - 0.06 + r * 0.035)
      dot.castShadow = false
      desk.add(dot)
    }
  }

  // Position: against back wall, shifted left
  desk.position.set(-0.3, 0, -HALF_D + 0.35)
  return desk
}

function createChair(): THREE.Group {
  const chair = new THREE.Group()
  const legMat = mat(0x444444, { metalness: 0.4, roughness: 0.5 })
  const seatY = 0.42, seatW = 0.42, seatD = 0.4

  const seat = box(seatW, 0.06, seatD, toonMat(0xffcad4))
  seat.position.y = seatY
  addEdgeOutline(seat)
  chair.add(seat)

  const back = box(seatW, 0.4, 0.04, toonMat(0xffcad4))
  back.position.set(0, seatY + 0.23, -seatD / 2 + 0.02)
  chair.add(back)

  for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) {
    const leg = cyl(0.015, 0.015, seatY, legMat)
    leg.position.set(x, seatY / 2, z)
    chair.add(leg)
  }

  // Tucked under desk (negative Z, near back wall)
  chair.position.set(-0.3, 0, -HALF_D + 1.05)
  return chair
}

function createBed(): THREE.Group {
  const bed = new THREE.Group()
  const bedW = 1.2, bedH = 0.35, bedD = 2.0

  // Frame — toon shaded for anime style
  const frame = box(bedW, bedH, bedD, toonMat(0xd9b892))
  frame.position.set(0, bedH / 2, 0)
  addEdgeOutline(frame)
  bed.add(frame)

  const mattress = box(bedW - 0.06, 0.12, bedD - 0.06, mat(0xf0d0e8, { roughness: 0.9 }))
  mattress.position.set(0, bedH + 0.06, 0)
  bed.add(mattress)

  const pillow = box(0.5, 0.1, 0.3, mat(0xfff0f5, { roughness: 0.95 }))
  pillow.position.set(0, bedH + 0.17, -bedD / 2 + 0.25)
  bed.add(pillow)

  // Second pillow for coziness
  const pillow2 = box(0.35, 0.08, 0.25, mat(0xfce4ec, { roughness: 0.95 }))
  pillow2.position.set(0.2, bedH + 0.14, -bedD / 2 + 0.25)
  pillow2.rotation.y = 0.15
  bed.add(pillow2)

  const headboard = box(bedW, 0.6, 0.06, toonMat(0xb8895e))
  headboard.position.set(0, bedH + 0.3, -bedD / 2)
  addEdgeOutline(headboard)
  bed.add(headboard)

  const blanket = box(bedW - 0.1, 0.05, bedD * 0.6, mat(0xe8c0d8, { roughness: 0.95 }))
  blanket.position.set(0, bedH + 0.14, 0.25)
  bed.add(blanket)

  // Sleeping cat on bed — curled up, detailed procedural cat
  const catGroup = new THREE.Group()
  catGroup.name = 'bed-cat'
  const catFur = mat(0xf5deb3, { roughness: 0.95 }) // Wheat/cream color
  const catDarkFur = mat(0xd4a574, { roughness: 0.9 }) // Tabby stripes
  // Body — elongated flattened sphere (curled up sleeping pose)
  const catBody = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), catFur)
  catBody.scale.set(1.3, 0.55, 1.0) // Wide, flat, sleeping shape
  catBody.castShadow = true
  catGroup.add(catBody)
  // Head — tucked against body
  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), catFur)
  catHead.position.set(0.13, 0.03, 0.08)
  catHead.castShadow = true
  catGroup.add(catHead)
  // Ears — two upright triangles
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.045, 4), catDarkFur)
    ear.position.set(0.15 + side * 0.04, 0.1, 0.08)
    ear.rotation.z = side * 0.15
    catGroup.add(ear)
  }
  // Eyes — closed (horizontal lines = sleeping)
  const eyeMat = mat(0x333333, { roughness: 0.3 })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.005), eyeMat)
    eye.position.set(0.19, 0.04, 0.08 + side * 0.03)
    catGroup.add(eye)
  }
  // Nose — tiny pink
  const catNose = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), mat(0xffaaaa))
  catNose.position.set(0.21, 0.02, 0.08)
  catGroup.add(catNose)
  // Tail — curved, wraps around body
  const tailSegments = 8
  for (let i = 0; i < tailSegments; i++) {
    const t = i / tailSegments
    const tailPiece = new THREE.Mesh(
      new THREE.SphereGeometry(0.018 - t * 0.008, 6, 4),
      i % 2 === 0 ? catFur : catDarkFur // Striped tail
    )
    const angle = t * Math.PI * 0.8 // Curl around
    tailPiece.position.set(
      -0.14 - Math.sin(angle) * (0.08 + t * 0.06),
      0.0,
      -0.02 + Math.cos(angle) * (0.08 + t * 0.06)
    )
    catGroup.add(tailPiece)
  }
  // Front paws — two small ovals tucked under head
  for (const side of [-1, 1]) {
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), catFur)
    paw.scale.set(1, 0.5, 1.3)
    paw.position.set(0.16, -0.02, 0.08 + side * 0.05)
    catGroup.add(paw)
  }
  // Position on bed
  catGroup.position.set(-0.2, bedH + 0.2, 0.3)
  catGroup.rotation.y = 0.3 // Slightly angled
  animRefs.cat = catGroup
  // Store ear refs for twitch animation
  catGroup.children.forEach(child => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.ConeGeometry && child.position.y > 0.08) {
      animRefs.catEars.push(child)
    }
  })
  bed.add(catGroup)

  // Folded throw blanket at foot of bed
  const throwBlanket = box(bedW - 0.2, 0.04, 0.35, mat(0xb8a0d0, { roughness: 0.95 }))
  throwBlanket.position.set(0.05, bedH + 0.16, bedD / 2 - 0.2)
  throwBlanket.rotation.y = 0.08
  bed.add(throwBlanket)

  // Star plushie
  const starGroup = new THREE.Group()
  const starMat = toonMat(0xfff06a)
  const starBody = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), starMat)
  starGroup.add(starBody)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 4), starMat)
    point.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0)
    point.rotation.z = a + Math.PI / 2
    starGroup.add(point)
  }
  // Eyes
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), mat(0x333333))
    eye.position.set(side * 0.02, 0.01, 0.065)
    starGroup.add(eye)
  }
  starGroup.position.set(0.3, bedH + 0.22, -bedD / 2 + 0.5)
  starGroup.rotation.x = -0.3
  bed.add(starGroup)

  // Bed skirt
  const skirtMat = mat(0xf0d0e8, { roughness: 0.95 })
  const skirtFront = box(bedW + 0.02, 0.12, 0.01, skirtMat)
  skirtFront.position.set(0, 0.06, bedD / 2)
  skirtFront.castShadow = false
  bed.add(skirtFront)
  for (const side of [-1, 1]) {
    const skirtSide = box(0.01, 0.12, bedD + 0.02, skirtMat)
    skirtSide.position.set(side * bedW / 2, 0.06, 0)
    skirtSide.castShadow = false
    bed.add(skirtSide)
  }

  // Bed against right wall, headboard toward back-right
  // Rotated so length runs along Z axis against right wall
  bed.position.set(HALF_W - 0.65, 0, 0.2)
  bed.rotation.y = -Math.PI / 2
  return bed
}

function createSlippers(): THREE.Group {
  const group = new THREE.Group()
  const slipperMat = toonMat(0xffb8c8)
  for (const side of [-1, 1]) {
    const slipper = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      slipperMat
    )
    slipper.scale.set(1, 0.5, 1.6)
    slipper.rotation.x = Math.PI
    slipper.position.set(side * 0.12, 0.02, 0)
    slipper.castShadow = true
    group.add(slipper)
  }
  // Next to bed on floor
  group.position.set(HALF_W - 1.3, 0, 0.8)
  return group
}

function createWallClock(): THREE.Group {
  const group = new THREE.Group()
  // Frame
  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.015, 8, 24),
    mat(0xb8936e, { roughness: 0.6, metalness: 0.3 })
  )
  group.add(frame)
  // Face
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 24),
    mat(0xfff8f0, { roughness: 0.8 })
  )
  face.position.z = 0.005
  group.add(face)
  // Hour hand
  const hourHand = box(0.01, 0.06, 0.005, mat(0x333333))
  hourHand.position.set(0, 0.03, 0.01)
  hourHand.rotation.z = -0.8
  hourHand.castShadow = false
  animRefs.clockHourHand = hourHand
  group.add(hourHand)
  // Minute hand
  const minHand = box(0.008, 0.09, 0.005, mat(0x333333))
  minHand.position.set(0, 0.04, 0.012)
  minHand.rotation.z = 0.5
  minHand.castShadow = false
  animRefs.clockMinuteHand = minHand
  group.add(minHand)

  // Above desk on back wall
  group.position.set(-0.3, 2.3, -HALF_D + 0.08)
  return group
}

function createTissueBox(): THREE.Group {
  const group = new THREE.Group()
  const boxMesh = box(0.1, 0.05, 0.06, mat(0xc8e0f0, { roughness: 0.7 }))
  boxMesh.position.y = 0.025
  group.add(boxMesh)
  // Tissue sticking out
  const tissue = box(0.04, 0.04, 0.005, mat(0xffffff, { roughness: 0.95 }))
  tissue.position.set(0, 0.06, 0)
  tissue.rotation.z = 0.2
  tissue.castShadow = false
  group.add(tissue)
  // On side table
  group.position.set(HALF_W - 0.35, 0.465, 1.5)
  return group
}

function createPencilHolder(): THREE.Group {
  const group = new THREE.Group()
  const holder = cyl(0.025, 0.025, 0.08, mat(0x8bb8d0, { roughness: 0.6 }))
  holder.position.y = 0.04
  group.add(holder)
  // Pencils
  const pencilColors = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff]
  for (let i = 0; i < 4; i++) {
    const pencil = cyl(0.004, 0.004, 0.1, mat(pencilColors[i], { roughness: 0.7 }), 6)
    pencil.position.set((i - 1.5) * 0.008, 0.1, 0)
    pencil.rotation.x = (Math.random() - 0.5) * 0.2
    pencil.rotation.z = (Math.random() - 0.5) * 0.15
    group.add(pencil)
  }
  // On desk surface, right side
  group.position.set(0.05, 0.74, -HALF_D + 0.45)
  return group
}

function createMirror(): THREE.Group {
  const group = new THREE.Group()
  // Frame
  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.02, 8, 24),
    mat(0xd4a06a, { roughness: 0.5, metalness: 0.3 })
  )
  group.add(frame)
  // Mirror surface
  const mirror = new THREE.Mesh(
    new THREE.CircleGeometry(0.17, 24),
    mat(0xd8e8f0, { roughness: 0.05, metalness: 0.9 })
  )
  mirror.position.z = 0.005
  group.add(mirror)
  // Left wall
  group.position.set(-HALF_W + 0.06, 1.5, 0.6)
  group.rotation.y = Math.PI / 2
  return group
}

function createFloorLamp(): THREE.Group {
  const group = new THREE.Group()
  // Base
  const base = cyl(0.08, 0.08, 0.02, toonMat(0x555555))
  base.position.y = 0.01
  group.add(base)
  // Pole
  const pole = cyl(0.015, 0.015, 1.5, toonMat(0x555555))
  pole.position.y = 0.77
  group.add(pole)
  // Shade
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.18, 16, 1, true),
    mat(0xfff0d8, { roughness: 0.8, side: THREE.DoubleSide, emissive: 0xfff0d0, emissiveIntensity: 0.3 })
  )
  shade.position.y = 1.58
  shade.rotation.x = Math.PI
  group.add(shade)
  // Back-left corner
  group.position.set(-HALF_W + 0.25, 0, HALF_D - 0.3)
  return group
}

function createCatFigure(): THREE.Group {
  const group = new THREE.Group()
  const catMat = mat(0x444444, { roughness: 0.7 })
  // Body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), catMat)
  body.position.y = 0.025
  body.scale.set(1, 0.8, 1.2)
  group.add(body)
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), catMat)
  head.position.set(0, 0.055, 0.015)
  group.add(head)
  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.007, 0.015, 3),
      catMat
    )
    ear.position.set(side * 0.012, 0.072, 0.015)
    group.add(ear)
  }
  // On bookshelf top shelf
  group.position.set(-HALF_W + 0.7, 2.03, -0.25)
  return group
}

function createThrowPillow(): THREE.Group {
  const group = new THREE.Group()
  // Cat-shaped pillow (cute neko cushion)
  const pillowMat = toonMat(0xffd4a8) // Warm orange-cream
  // Body — flattened sphere
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), pillowMat)
  body.scale.set(1.2, 0.5, 1.0)
  body.position.y = 0
  group.add(body)
  // Head — smaller sphere
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), pillowMat)
  head.position.set(0, 0.04, 0.12)
  group.add(head)
  // Ears — two small triangles
  const earMat = mat(0xffb888, { roughness: 0.9 })
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 4), earMat)
    ear.position.set(side * 0.06, 0.12, 0.12)
    ear.rotation.z = side * 0.2
    group.add(ear)
  }
  // Eyes — two tiny dark dots
  const eyeMat = mat(0x333333, { roughness: 0.5 })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4), eyeMat)
    eye.position.set(side * 0.035, 0.05, 0.2)
    group.add(eye)
  }
  // Nose — tiny pink triangle
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 4), mat(0xff8888))
  nose.position.set(0, 0.02, 0.2)
  group.add(nose)
  // On chair seat (updated position to match new chair z)
  group.position.set(-0.3, 0.48, -HALF_D + 1.05)
  return group
}

function createPhotoString(): THREE.Group {
  const group = new THREE.Group()
  const photoColors = [0xffc8dd, 0xbde0fe, 0xffd6a5, 0xc1e1c1, 0xf4c2c2]
  // String line
  const stringMat = new THREE.LineBasicMaterial({ color: 0x888888 })
  const points = [new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.5, 0, 0)]
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), stringMat)
  group.add(line)
  // Photos
  for (let i = 0; i < 5; i++) {
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.1),
      mat(photoColors[i], { roughness: 0.85 })
    )
    photo.position.set(-0.4 + i * 0.2, -0.05, 0.005)
    photo.rotation.z = (Math.random() - 0.5) * 0.15
    group.add(photo)
  }
  // Above bed headboard on right wall
  group.position.set(HALF_W - 0.05, 1.4, 0.2)
  group.rotation.y = -Math.PI / 2
  return group
}

function createSideTable(): THREE.Group {
  const table = new THREE.Group()
  const woodMat = mat(0xc8a070, { roughness: 0.75 })
  const tW = 0.35, tD = 0.3, tH = 0.45, tT = 0.03

  // Top
  const top = box(tW, tT, tD, toonMat(0xc8a070))
  top.position.y = tH
  addEdgeOutline(top)
  table.add(top)

  // Legs
  const legMat = toonMat(0xc8a070)
  for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) {
    const leg = cyl(0.015, 0.015, tH, legMat)
    leg.position.set(x, tH / 2, z)
    table.add(leg)
  }

  // Small alarm clock
  const clockBody = box(0.06, 0.06, 0.03, mat(0xf8c0d0, { roughness: 0.6 }))
  clockBody.position.set(0, tH + tT / 2 + 0.03, 0)
  table.add(clockBody)

  // Small lamp on side table
  const miniLampBase = cyl(0.025, 0.03, 0.015, mat(0xe0c0a0, { roughness: 0.6 }))
  miniLampBase.position.set(0.08, tH + tT / 2 + 0.008, -0.05)
  table.add(miniLampBase)
  const miniLampShade = cyl(0.04, 0.03, 0.06, mat(0xfff0e0, {
    emissive: 0xfff0e0, emissiveIntensity: 0.3, side: THREE.DoubleSide
  }))
  miniLampShade.position.set(0.08, tH + tT / 2 + 0.05, -0.05)
  table.add(miniLampShade)

  // Position next to bed (right wall area, forward of bed)
  table.position.set(HALF_W - 0.35, 0, 1.4)
  return table
}

function createBookshelf(): THREE.Group {
  const shelf = new THREE.Group()
  const shelfMat = toonMat(0xc49a6c)
  const rand = seededRandom(42)
  const sw = 0.8, sd = 0.3, sh = 2.2, thick = 0.03

  for (const x of [-sw / 2, sw / 2]) {
    const side = box(thick, sh, sd, shelfMat)
    side.position.set(x, sh / 2, 0)
    shelf.add(side)
  }

  const shelfYs = [0.02, 0.5, 1.0, 1.5, 2.0]
  for (const y of shelfYs) {
    const s = box(sw, thick, sd, shelfMat)
    s.position.set(0, y, 0)
    shelf.add(s)
  }

  const backPanel = box(sw, sh, 0.02, shelfMat)
  backPanel.position.set(0, sh / 2, -sd / 2 + 0.01)
  shelf.add(backPanel)

  // Books
  const bookColors = [0xffb3c6, 0xb8d4e3, 0xd4c5f9, 0xffd6a5, 0xc1e1c1, 0xf4c2c2, 0xb5ead7, 0xffdac1]
  for (let row = 0; row < 4; row++) {
    const baseY = shelfYs[row] + thick / 2
    let x = -sw / 2 + 0.08
    while (x < sw / 2 - 0.05) {
      const bw = 0.03 + rand() * 0.04
      const bh = 0.3 + rand() * 0.15
      const bd = 0.18 + rand() * 0.06
      const bookColor = bookColors[Math.floor(rand() * bookColors.length)]
      const b = box(bw, bh, bd, mat(bookColor, { roughness: 0.85 }))
      b.position.set(x + bw / 2, baseY + bh / 2, 0.02)
      b.rotation.z = (rand() - 0.5) * 0.05
      b.castShadow = false
      shelf.add(b)
      x += bw + 0.005
    }
  }

  // Leaning books on shelf 2
  const leanColors = [0xff9999, 0x99bbff, 0xddaa77]
  for (let i = 0; i < 3; i++) {
    const lb = box(0.04, 0.28, 0.18, mat(leanColors[i], { roughness: 0.85 }))
    lb.position.set(-sw / 2 + 0.6 + i * 0.05, shelfYs[2] + thick / 2 + 0.14, 0.02)
    lb.rotation.z = 0.3 - i * 0.15
    lb.castShadow = false
    shelf.add(lb)
  }

  // Small framed photo on shelf 3
  const photoFrame = box(0.08, 0.1, 0.015, mat(0xd4b08c, { roughness: 0.6 }))
  photoFrame.position.set(0.2, shelfYs[3] + thick / 2 + 0.05, 0.08)
  shelf.add(photoFrame)
  const photoArt = box(0.06, 0.075, 0.01, mat(0xffc8dd, { roughness: 0.9 }))
  photoArt.position.set(0.2, shelfYs[3] + thick / 2 + 0.05, 0.09)
  shelf.add(photoArt)

  // Tiny cactus on top shelf
  const cactusPot = cyl(0.02, 0.018, 0.025, mat(0xc86040, { roughness: 0.8 }))
  cactusPot.position.set(0.25, sh + 0.013, 0)
  shelf.add(cactusPot)
  const cactusBody = cyl(0.012, 0.012, 0.04, mat(0x4a8a4a, { roughness: 0.8 }), 6)
  cactusBody.position.set(0.25, sh + 0.045, 0)
  shelf.add(cactusBody)

  // Plant on top
  const pot = cyl(0.05, 0.04, 0.08, mat(0x8B5E3C, { roughness: 0.8 }))
  pot.position.set(0, sh + 0.04, 0)
  shelf.add(pot)
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 6),
      mat(0x6abf69, { roughness: 0.8 })
    )
    const angle = (i / 5) * Math.PI * 2
    leaf.position.set(Math.cos(angle) * 0.04, sh + 0.12, Math.sin(angle) * 0.04)
    leaf.castShadow = true
    shelf.add(leaf)
  }

  shelf.position.set(-HALF_W + 0.5, 0, -0.3)
  return shelf
}

function createRug(): THREE.Group {
  const group = new THREE.Group()
  // Outer rug ring — darker edge
  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 32),
    toonMat(0xeab8c8)
  )
  outer.rotation.x = -Math.PI / 2
  outer.position.set(0, 0.004, 0)
  group.add(outer)

  // Inner rug — lighter center
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 32),
    toonMat(0xffd0e0)
  )
  inner.rotation.x = -Math.PI / 2
  inner.position.set(0, 0.005, 0)
  group.add(inner)

  // Rug pattern — concentric rings
  const ringColors = [0xd8a0b8, 0xecc0d0, 0xd098b0]
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.15 + i * 0.12, 0.18 + i * 0.12, 32),
      toonMat(ringColors[i])
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.set(0, 0.006, 0)
    group.add(ring)
  }

  // Center at origin (character's spot)
  group.position.set(0, 0, 0)
  return group
}

function createFairyLights(): THREE.Group {
  const group = new THREE.Group()
  const count = 14
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const x = -HALF_W + 0.3 + t * (ROOM_W - 0.6)
    const y = ROOM_H - 0.15 + Math.sin(t * Math.PI * 3) * 0.08
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffe8b0, emissive: 0xffe8b0, emissiveIntensity: 1.0 })
    )
    bulb.position.set(x, y, -HALF_D + 0.15)
    animRefs.fairyBulbs.push(bulb)
    group.add(bulb)

    // Glow halo sprite
    const spriteMat = new THREE.SpriteMaterial({
      color: 0xffe8b0,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.scale.set(0.06, 0.06, 1)
    sprite.position.set(x, y, -HALF_D + 0.15)
    animRefs.fairySprites.push(sprite)
    group.add(sprite)
  }
  return group
}

function createCornerPlant(): THREE.Group {
  const plant = new THREE.Group()

  const pot = cyl(0.1, 0.08, 0.2, mat(0x8B5E3C, { roughness: 0.8 }))
  pot.position.y = 0.1
  plant.add(pot)

  const soil = cyl(0.09, 0.09, 0.02, mat(0x4a3728, { roughness: 1 }))
  soil.position.y = 0.21
  plant.add(soil)

  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2
    const r = 0.06 + Math.random() * 0.04
    const h = 0.25 + Math.random() * 0.2
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.15, 6),
      mat(0x5a9e5a + Math.floor(Math.random() * 0x202020), { roughness: 0.8 })
    )
    leaf.position.set(Math.cos(angle) * r, 0.22 + h / 2, Math.sin(angle) * r)
    leaf.rotation.x = (Math.random() - 0.5) * 0.3
    leaf.rotation.z = (Math.random() - 0.5) * 0.3
    leaf.castShadow = true
    animRefs.plantLeaves.push(leaf)
    plant.add(leaf)
  }

  // Move to back-left corner (away from character)
  plant.position.set(-HALF_W + 0.3, 0, -HALF_D + 0.3)
  return plant
}

function createPictureFrames(): THREE.Group {
  const group = new THREE.Group()
  const frameColors = [0xffc8dd, 0xbde0fe, 0xd0c4f7]
  const positions: [number, number, number, 'left' | 'back'][] = [
    [-HALF_W + 0.05, 1.8, -0.8, 'left'],
    [-HALF_W + 0.05, 1.5, 0.2, 'left'],
    [0.8, 1.9, -HALF_D + 0.05, 'back'],
  ]

  for (let i = 0; i < positions.length; i++) {
    const [x, y, z, wall] = positions[i]
    const frameMat = toonMat(0xd4b08c)
    const artMat = toonMat(frameColors[i])

    const frameGroup = new THREE.Group()
    const frame = box(0.28, 0.22, 0.02, frameMat)
    frame.castShadow = false
    const art = box(0.22, 0.16, 0.015, artMat)
    art.castShadow = false
    art.position.z = 0.005
    frameGroup.add(frame, art)

    frameGroup.position.set(x, y, z)
    if (wall === 'left') frameGroup.rotation.y = Math.PI / 2
    group.add(frameGroup)
  }

  return group
}

function createPoster(): THREE.Group {
  const group = new THREE.Group()

  // Large poster on right wall (above bed area)
  const posterW = 0.5, posterH = 0.7
  // Gradient-like poster using two overlapping planes
  const posterBg = new THREE.Mesh(
    new THREE.PlaneGeometry(posterW, posterH),
    mat(0xe8d0f0, { roughness: 0.9 })
  )
  posterBg.position.set(HALF_W - 0.04, 2.0, -0.4)
  posterBg.rotation.y = -Math.PI / 2
  group.add(posterBg)

  // Inner accent
  const posterInner = new THREE.Mesh(
    new THREE.PlaneGeometry(posterW - 0.08, posterH - 0.08),
    mat(0xd0b8e0, { roughness: 0.9 })
  )
  posterInner.position.set(HALF_W - 0.038, 2.0, -0.4)
  posterInner.rotation.y = -Math.PI / 2
  group.add(posterInner)

  // Star/shape decoration on poster
  const star = new THREE.Mesh(
    new THREE.CircleGeometry(0.06, 5),
    mat(0xffd0e8, { roughness: 0.9 })
  )
  star.position.set(HALF_W - 0.035, 2.05, -0.4)
  star.rotation.y = -Math.PI / 2
  group.add(star)

  return group
}

function createTrashCan(): THREE.Group {
  const group = new THREE.Group()
  const canMat = toonMat(0xe8e0d8)
  const can = cyl(0.08, 0.07, 0.22, canMat, 12)
  can.position.y = 0.11
  group.add(can)
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 8, 12), toonMat(0xe8e0d8))
  rim.position.y = 0.22
  rim.rotation.x = Math.PI / 2
  group.add(rim)
  // Near desk
  group.position.set(-0.9, 0, -HALF_D + 0.8)
  return group
}

function createWallShelf(): THREE.Group {
  const group = new THREE.Group()
  const shelfBoard = box(0.4, 0.02, 0.12, toonMat(0xc49a6c))
  group.add(shelfBoard)
  // Brackets
  for (const x of [-0.15, 0.15]) {
    const bracket = box(0.02, 0.08, 0.1, mat(0x888888, { metalness: 0.4 }))
    bracket.position.set(x, -0.04, 0)
    group.add(bracket)
  }
  // Small items on shelf
  const miniBook = box(0.04, 0.06, 0.03, mat(0xffb3c6, { roughness: 0.85 }))
  miniBook.position.set(-0.1, 0.04, 0)
  group.add(miniBook)
  const miniVase = cyl(0.015, 0.012, 0.04, mat(0x88bbdd, { roughness: 0.6 }))
  miniVase.position.set(0.08, 0.03, 0)
  group.add(miniVase)
  // On right wall near door
  group.position.set(HALF_W - 0.06, 1.6, -HALF_D + 0.8)
  group.rotation.y = -Math.PI / 2
  return group
}

function createAOCorners(): THREE.Group {
  const group = new THREE.Group()
  const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06 })
  // Floor-wall corners
  const corners: [number, number, number, number, number][] = [
    [ROOM_W, 0.15, -HALF_D, 0, 0.075],  // back
    [0.15, ROOM_D, -HALF_W, 0.075, 0],   // left (rotated)
    [0.15, ROOM_D, HALF_W, 0.075, 0],    // right
  ]
  // Back floor corner
  const aoBack = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, 0.15), aoMat)
  aoBack.rotation.x = -Math.PI / 2
  aoBack.position.set(0, 0.002, -HALF_D + 0.075)
  group.add(aoBack)
  // Left floor corner
  const aoLeft = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, 0.15), aoMat)
  aoLeft.rotation.x = -Math.PI / 2
  aoLeft.rotation.z = Math.PI / 2
  aoLeft.position.set(-HALF_W + 0.075, 0.002, 0)
  group.add(aoLeft)
  // Right floor corner
  const aoRight = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_D, 0.15), aoMat)
  aoRight.rotation.x = -Math.PI / 2
  aoRight.rotation.z = Math.PI / 2
  aoRight.position.set(HALF_W - 0.075, 0.002, 0)
  group.add(aoRight)
  return group
}

function createRoomLights(): THREE.Light[] {
  const lights: THREE.Light[] = []

  // Window light — casts shadows
  const windowLight = new THREE.DirectionalLight(0xffe4b0, 1.5)
  windowLight.name = 'room-window-light'
  windowLight.position.set(0, 2.5, -HALF_D - 1)
  windowLight.target.position.set(0, 0.5, 0)
  windowLight.castShadow = true
  windowLight.shadow.mapSize.set(1024, 1024)
  windowLight.shadow.camera.near = 0.1
  windowLight.shadow.camera.far = 8
  windowLight.shadow.camera.left = -3
  windowLight.shadow.camera.right = 3
  windowLight.shadow.camera.top = 4
  windowLight.shadow.camera.bottom = -1
  windowLight.shadow.bias = -0.002
  lights.push(windowLight)

  // Desk lamp light
  const deskLampLight = new THREE.PointLight(0xfff0d0, 0.8, 3)
  deskLampLight.name = 'room-desk-lamp'
  deskLampLight.position.set(0.25, 1.15, -HALF_D + 0.35)
  deskLampLight.castShadow = true
  deskLampLight.shadow.mapSize.set(512, 512)
  lights.push(deskLampLight)

  // Fairy lights glow
  const fairyLight = new THREE.PointLight(0xffe8c0, 0.3, 5)
  fairyLight.name = 'room-fairy-light'
  fairyLight.position.set(0, ROOM_H - 0.2, -HALF_D + 0.3)
  lights.push(fairyLight)

  // Warm ambient
  const ambient = new THREE.AmbientLight(0xfff5e8, 0.4)
  ambient.name = 'room-ambient'
  lights.push(ambient)

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0xfff0d0, 0xc8d0e0, 0.3)
  hemi.name = 'room-hemi'
  lights.push(hemi)

  // Floor lamp light (back-left corner)
  const floorLampLight = new THREE.PointLight(0xfff0d0, 0.4, 4)
  floorLampLight.name = 'room-floor-lamp'
  floorLampLight.position.set(-HALF_W + 0.25, 1.5, HALF_D - 0.3)
  lights.push(floorLampLight)

  // Warm bounce from floor
  const floorBounce = new THREE.PointLight(0xffd0b0, 0.3, 4)
  floorBounce.name = 'room-floor-bounce'
  floorBounce.position.set(0, 0.1, 0)
  lights.push(floorBounce)

  // Backlight behind character
  const charBacklight = new THREE.SpotLight(0xfff0e0, 0.5, 5, Math.PI / 4, 0.5)
  charBacklight.name = 'room-char-backlight'
  charBacklight.position.set(0, 2.5, -1.5)
  charBacklight.target.position.set(0, 1.0, 0.5)
  charBacklight.castShadow = false
  lights.push(charBacklight)

  return lights
}

// === Walkable bounds (export for animation system) ===

export function getWalkableBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: -0.8,
    maxX: 0.6,
    minZ: -0.6,
    maxZ: 1.2,
  }
}

export function isPositionSafe(x: number, z: number): boolean {
  const bounds = getWalkableBounds()
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
}

// === Init & mode switching ===

export function initRoomScene(): void {
  // Reset animation refs
  animRefs.cat = null; animRefs.clockHourHand = null; animRefs.clockMinuteHand = null
  animRefs.fairyBulbs = []; animRefs.fairySprites = []; animRefs.curtainFolds = []; animRefs.laptopScreen = null
  animRefs.steamParticles = []; animRefs.plantLeaves = []; animRefs.catEars = []
  animRefs.lightShaft = null; animRefs.dustMotes = null; animRefs.dustVelocities = null

  roomGroup = new THREE.Group()
  roomGroup.name = 'room-group'
  roomGroup.visible = false

  roomGroup.add(createFloor())
  roomGroup.add(createCeiling())
  roomGroup.add(createBaseboards())
  roomGroup.add(createWalls())
  roomGroup.add(createDesk())
  roomGroup.add(createChair())
  roomGroup.add(createBed())
  roomGroup.add(createSideTable())
  roomGroup.add(createBookshelf())
  roomGroup.add(createRug())
  roomGroup.add(createFairyLights())
  roomGroup.add(createCornerPlant())
  roomGroup.add(createPictureFrames())
  roomGroup.add(createPoster())
  roomGroup.add(createSlippers())
  roomGroup.add(createWallClock())
  roomGroup.add(createTissueBox())
  roomGroup.add(createPencilHolder())
  roomGroup.add(createMirror())
  roomGroup.add(createFloorLamp())
  roomGroup.add(createCatFigure())
  roomGroup.add(createThrowPillow())
  roomGroup.add(createPhotoString())
  roomGroup.add(createTrashCan())
  roomGroup.add(createWallShelf())
  roomGroup.add(createAOCorners())
  roomGroup.add(createWindowLightShaft())
  roomGroup.add(createDustMotes())

  // Create steam particles for coffee mug
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 })
  for (let i = 0; i < 4; i++) {
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), steamMat.clone())
    steam.visible = false // Will be shown in room mode
    roomGroup.add(steam)
    animRefs.steamParticles.push(steam)
  }

  scene.add(roomGroup)

  roomLights = createRoomLights()
}

export function enableRoomMode(): void {
  if (_isRoomMode) return
  _isRoomMode = true
  setThemeBackgroundSuppressed(true)

  // Save and disable outdoor lights
  savedOutdoorState = []
  const outdoorNames = ['ambient-light', 'sky-fill-light', 'key-light', 'rim-light', 'bounce-light',
    'face-fill', 'body-fill', 'chin-fill', 'rim2', 'top-spot']
  scene.traverse((obj) => {
    if ((obj as any).isLight && outdoorNames.includes(obj.name)) {
      savedOutdoorState.push({ name: obj.name, visible: obj.visible, intensity: (obj as any).intensity })
      obj.visible = false
    }
  })

  // Hide platform circles
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry instanceof THREE.CircleGeometry && obj.parent === scene) {
      (obj as any)._roomHidden = true
      obj.visible = false
    }
  })

  // Show room
  roomGroup.visible = true

  // Add room lights
  for (const light of roomLights) {
    scene.add(light)
    if ((light as any).target) scene.add((light as any).target)
  }

  // Enable shadows
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // Background & fog
  scene.background = new THREE.Color(0x1a1520)
  renderer.setClearColor(0x1a1520, 1)
  renderer.toneMappingExposure = 0.95
  scene.fog = new THREE.Fog(0x1a1520, 4, 8)

  // Camera — cozy diorama angle with free orbit
  camera.position.set(1.8, 2.0, 3.0)
  controls.target.set(0, 0.9, -0.3)
  controls.minDistance = 1.0
  controls.maxDistance = 4.5
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.5
  controls.minAzimuthAngle = -Math.PI * 0.75
  controls.maxAzimuthAngle = Math.PI * 0.75
  controls.enablePan = true
  controls.update()

  // Enable bloom post-processing (safe with solid background)
  setupRoomBloom()

  setRoomTheme(currentTheme)
}

export function disableRoomMode(): void {
  if (!_isRoomMode) return
  _isRoomMode = false

  roomGroup.visible = false

  for (const light of roomLights) {
    scene.remove(light)
    if ((light as any).target) scene.remove((light as any).target)
  }

  for (const saved of savedOutdoorState) {
    scene.traverse((obj) => {
      if (obj.name === saved.name) {
        obj.visible = saved.visible
        ;(obj as any).intensity = saved.intensity
      }
    })
  }

  scene.traverse((obj) => {
    if ((obj as any)._roomHidden) {
      obj.visible = true
      delete (obj as any)._roomHidden
    }
  })

  // Disable bloom
  teardownRoomBloom()

  // Remove fog
  scene.fog = null

  setThemeBackgroundSuppressed(false)
  renderer.toneMappingExposure = 1.06

  // Restore camera constraints
  controls.minDistance = 1.5
  controls.maxDistance = 8.0
  controls.minPolarAngle = 0
  controls.maxPolarAngle = Math.PI
  controls.minAzimuthAngle = -Infinity
  controls.maxAzimuthAngle = Infinity

  camera.position.set(0, 1.2, 3.0)
  controls.target.set(0, 0.9, 0)
  controls.update()
}

export function isRoomMode(): boolean {
  return _isRoomMode
}

/** Meeting mode: disable light shaft, dust motes, window glow, and tone down bright lights */
export function setMeetingLighting(): void {
  if (animRefs.lightShaft) animRefs.lightShaft.visible = false
  if (animRefs.dustMotes) animRefs.dustMotes.visible = false

  // Dim window glow
  const wg = roomGroup?.getObjectByName('window-glow') as THREE.Mesh | undefined
  if (wg) (wg.material as THREE.MeshBasicMaterial).opacity = 0.01

  // Tone down ALL lights + emissives in the room
  if (roomGroup) {
    roomGroup.traverse(obj => {
      if (obj instanceof THREE.PointLight) obj.intensity *= 0.2
      if (obj instanceof THREE.SpotLight) obj.intensity *= 0.2
      // Kill all emissive glow (lamp shades, fairy lights, etc.)
      if (obj instanceof THREE.Mesh && obj.material) {
        const m = obj.material as THREE.MeshStandardMaterial
        if (m.emissiveIntensity) m.emissiveIntensity *= 0.1
        // Dim bright BasicMaterials (window glow etc.)
        if (m instanceof THREE.MeshBasicMaterial && m.transparent) {
          m.opacity = Math.min(m.opacity, 0.05)
        }
      }
    })
  }
}

// Track cat ear twitch timing
let nextEarTwitch = 5
let earTwitchStart = -1

/** Update room animations (call every frame) */
export function updateRoom(elapsed: number): void {
  if (!_isRoomMode || !roomGroup) return

  // Cat breathing animation
  if (animRefs.cat && animRefs.cat.children[0]) {
    const breathe = 1.0 + Math.sin(elapsed * 1.5) * 0.03
    animRefs.cat.children[0].scale.set(1.3, 0.55 * breathe, 1.0)
  }

  // Cat ear twitch — every 5-8 seconds
  if (elapsed > nextEarTwitch && animRefs.catEars.length > 0) {
    earTwitchStart = elapsed
    nextEarTwitch = elapsed + 5 + Math.random() * 3
  }
  if (earTwitchStart > 0 && animRefs.catEars[0]) {
    const twitchT = elapsed - earTwitchStart
    if (twitchT < 0.3) {
      const angle = Math.sin(twitchT * Math.PI / 0.3) * 0.25
      animRefs.catEars[0].rotation.x = angle
    } else {
      animRefs.catEars[0].rotation.x = 0
      earTwitchStart = -1
    }
  }

  // Wall clock — real time (direct refs, no traversal)
  const now = new Date()
  const hours = now.getHours() % 12 + now.getMinutes() / 60
  const minutes = now.getMinutes() + now.getSeconds() / 60
  if (animRefs.clockHourHand) animRefs.clockHourHand.rotation.z = -(hours / 12) * Math.PI * 2
  if (animRefs.clockMinuteHand) animRefs.clockMinuteHand.rotation.z = -(minutes / 60) * Math.PI * 2

  // Fairy light twinkle (direct refs)
  for (let i = 0; i < animRefs.fairyBulbs.length; i++) {
    const m = animRefs.fairyBulbs[i].material as THREE.MeshStandardMaterial
    m.emissiveIntensity = 0.7 + 0.3 * Math.sin(elapsed * 2.5 + i * 1.7)
  }

  // Curtain sway (direct refs)
  for (const fold of animRefs.curtainFolds) {
    fold.position.z = -HALF_D + 0.08 + Math.sin(elapsed * 0.8 + fold.position.y * 3) * 0.005
  }

  // Laptop screen color shift (direct ref)
  if (animRefs.laptopScreen) {
    const m = animRefs.laptopScreen.material as THREE.MeshStandardMaterial
    const hue = (elapsed * 0.05) % 1
    m.emissive.setHSL(hue, 0.15, 0.85)
  }

  // Coffee mug steam — rising transparent spheres
  // Mug is inside the desk group which is positioned at (-0.3, 0, -HALF_D + 0.35)
  const deskOffset = new THREE.Vector3(-0.3, 0, -HALF_D + 0.35)
  for (let i = 0; i < animRefs.steamParticles.length; i++) {
    const steam = animRefs.steamParticles[i]
    steam.visible = true
    const phase = (elapsed * 0.4 + i * 0.25) % 1.0
    const worldMugX = deskOffset.x + animRefs.mugPosition.x + (i - 1.5) * 0.008
    const worldMugY = deskOffset.y + animRefs.mugPosition.y
    const worldMugZ = deskOffset.z + animRefs.mugPosition.z
    steam.position.set(
      worldMugX + Math.sin(elapsed * 1.5 + i) * 0.005,
      worldMugY + phase * 0.08,
      worldMugZ
    )
    const steamMat = steam.material as THREE.MeshBasicMaterial
    steamMat.opacity = 0.25 * (1 - phase)
  }

  // Plant leaf sway — gentle oscillation
  for (let i = 0; i < animRefs.plantLeaves.length; i++) {
    const leaf = animRefs.plantLeaves[i]
    leaf.rotation.x = (leaf.userData.baseRotX ?? leaf.rotation.x) + Math.sin(elapsed * 0.6 + i * 1.2) * 0.04
    leaf.rotation.z = (leaf.userData.baseRotZ ?? leaf.rotation.z) + Math.cos(elapsed * 0.5 + i * 0.8) * 0.03
    // Store base rotations on first frame
    if (leaf.userData.baseRotX === undefined) {
      leaf.userData.baseRotX = leaf.rotation.x
      leaf.userData.baseRotZ = leaf.rotation.z
    }
  }

  // Light shaft breathing pulse
  if (animRefs.lightShaft) {
    const pulse = 0.04 + Math.sin(elapsed * 0.4) * 0.02
    animRefs.lightShaft.children.forEach(child => {
      const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      m.opacity = currentTheme === 'night' ? 0.01 : pulse
    })
  }

  // Fairy light sprite glow sync
  for (let i = 0; i < animRefs.fairySprites.length; i++) {
    const sm = animRefs.fairySprites[i].material as THREE.SpriteMaterial
    sm.opacity = 0.2 + 0.15 * Math.sin(elapsed * 2.5 + i * 1.7)
  }

  // Dust motes drift
  if (animRefs.dustMotes && animRefs.dustVelocities) {
    const pos = animRefs.dustMotes.geometry.attributes.position as THREE.BufferAttribute
    const vel = animRefs.dustVelocities
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + vel[i * 3]
      let y = pos.getY(i) + vel[i * 3 + 1] + Math.sin(elapsed * 0.3 + i) * 0.0003
      let z = pos.getZ(i) + vel[i * 3 + 2]
      // Wrap around
      if (x < -1.0) x = 1.0; if (x > 1.0) x = -1.0
      if (y < 0.3) y = 2.8; if (y > 2.8) y = 0.3
      if (z < -1.0) z = 1.0; if (z > 1.0) z = -1.0
      pos.setXYZ(i, x, y, z)
    }
    pos.needsUpdate = true
    // Hide in night theme
    const dm = animRefs.dustMotes.material as THREE.PointsMaterial
    dm.opacity = currentTheme === 'night' ? 0.1 : 0.4
  }
}

/** Clamp camera position to stay inside room bounds */
export function clampCameraToRoom(): void {
  if (!_isRoomMode) return
  const margin = 0.3
  camera.position.x = Math.max(-HALF_W + margin, Math.min(HALF_W - margin, camera.position.x))
  camera.position.y = Math.max(0.2, Math.min(ROOM_H - margin, camera.position.y))
  camera.position.z = Math.max(-HALF_D + margin, Math.min(HALF_D - margin, camera.position.z))
}

/** Fade out walls when camera approaches them */
export function updateRoomWallTransparency(): void {
  if (!_isRoomMode || !roomGroup) return
  const fadeStart = 0.8  // Start fading at this distance
  const fadeEnd = 0.2    // Fully transparent at this distance

  const wallChecks: Array<{ name: string; axis: 'x' | 'y' | 'z'; wallPos: number; sign: number }> = [
    { name: 'wall-back', axis: 'z', wallPos: -HALF_D, sign: -1 },
    { name: 'wall-left', axis: 'x', wallPos: -HALF_W, sign: -1 },
    { name: 'wall-right', axis: 'x', wallPos: HALF_W, sign: 1 },
    { name: 'wall-floor', axis: 'y', wallPos: 0, sign: -1 },
    { name: 'wall-ceiling', axis: 'y', wallPos: ROOM_H, sign: 1 },
  ]

  for (const check of wallChecks) {
    const dist = Math.abs(camera.position[check.axis] - check.wallPos)
    const opacity = dist <= fadeEnd ? 0 : dist >= fadeStart ? 1 : (dist - fadeEnd) / (fadeStart - fadeEnd)

    roomGroup.traverse((obj) => {
      if (obj.name === check.name && obj instanceof THREE.Mesh) {
        const m = obj.material as THREE.MeshStandardMaterial
        if (m.transparent !== undefined) {
          m.opacity = opacity
          m.needsUpdate = true
        }
      }
    })
  }
}

const THEME_CONFIG: Record<string, Record<string, number>> = {
  cozy: {
    'room-window-light': 1.5, 'room-desk-lamp': 0.8, 'room-fairy-light': 0.3,
    'room-ambient': 0.4, 'room-hemi': 0.3, 'room-floor-bounce': 0.3,
    'room-char-backlight': 0.5, 'room-floor-lamp': 0.4,
  },
  study: {
    'room-window-light': 0.6, 'room-desk-lamp': 1.5, 'room-fairy-light': 0.15,
    'room-ambient': 0.2, 'room-hemi': 0.15, 'room-floor-bounce': 0.15,
    'room-char-backlight': 0.3, 'room-floor-lamp': 0.2,
  },
  night: {
    'room-window-light': 0.15, 'room-desk-lamp': 0.5, 'room-fairy-light': 0.6,
    'room-ambient': 0.15, 'room-hemi': 0.1, 'room-floor-bounce': 0.1,
    'room-char-backlight': 0.2, 'room-floor-lamp': 0.6,
  },
}

export function setRoomTheme(theme: 'cozy' | 'study' | 'night'): void {
  currentTheme = theme
  if (!_isRoomMode) return

  const windowGlow = roomGroup.getObjectByName('window-glow') as THREE.Mesh | undefined
  const config = THEME_CONFIG[theme]

  for (const light of roomLights) {
    if (config[light.name] !== undefined) {
      ;(light as any).intensity = config[light.name]
    }
    // Night mode: blue-tint window light
    if (light.name === 'room-window-light') {
      ;(light as THREE.DirectionalLight).color.set(theme === 'night' ? 0x4466aa : 0xffe4b0)
    }
  }

  if (windowGlow) {
    const glowMat = windowGlow.material as THREE.MeshBasicMaterial
    if (theme === 'night') {
      glowMat.color.set(0x224466)
      glowMat.opacity = 0.4
    } else {
      glowMat.color.set(0xffe4b0)
      glowMat.opacity = theme === 'study' ? 0.3 : 0.6
    }
  }

  // Night bloom boost
  if (roomBloomPass) {
    roomBloomPass.strength = theme === 'night' ? 0.5 : 0.3
  }
}
