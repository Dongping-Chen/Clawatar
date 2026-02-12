import * as THREE from 'three'
import { scene, renderer, lightingRig, camera, controls } from './scene'

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

function createFloor(): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(0xc49a6c, { roughness: 0.75 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 0)
  floor.receiveShadow = true
  return floor
}

function createCeiling(): THREE.Group {
  const group = new THREE.Group()
  // Main ceiling
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(0xf0e8de, { roughness: 0.9 })
  )
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
  const wallMat = mat(0xf5ede3, { roughness: 0.9 })

  // Back wall with window hole
  const winW = 1.4, winH = 1.2, winBottom = 1.2
  const winTop = winBottom + winH
  const blW = (ROOM_W - winW) / 2
  const bl = box(blW, ROOM_H, 0.1, wallMat)
  bl.position.set(-HALF_W + blW / 2, ROOM_H / 2, -HALF_D)
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
  const leftWall = box(0.1, ROOM_H, ROOM_D, wallMat)
  leftWall.position.set(-HALF_W, ROOM_H / 2, 0)
  leftWall.castShadow = false; leftWall.receiveShadow = true
  walls.add(leftWall)

  // Right wall
  const rightWall = box(0.1, ROOM_H, ROOM_D, wallMat)
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

  return walls
}

function createDesk(): THREE.Group {
  const desk = new THREE.Group()
  const woodMat = mat(0xd4b08c, { roughness: 0.75 })
  const deskY = 0.72, deskW = 1.4, deskD = 0.6, deskT = 0.04

  const surface = box(deskW, deskT, deskD, woodMat)
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
  desk.add(laptopScreen)

  // Coffee mug
  const mug = cyl(0.03, 0.025, 0.08, mat(0xffb0c8, { roughness: 0.6 }))
  mug.position.set(0.35, deskY + deskT / 2 + 0.04, -0.1)
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

  // Position: against back wall, shifted left
  desk.position.set(-0.3, 0, -HALF_D + 0.35)
  return desk
}

function createChair(): THREE.Group {
  const chair = new THREE.Group()
  const legMat = mat(0x444444, { metalness: 0.4, roughness: 0.5 })
  const seatY = 0.42, seatW = 0.42, seatD = 0.4

  const seat = box(seatW, 0.06, seatD, mat(0xffcad4, { roughness: 0.9 }))
  seat.position.y = seatY
  addEdgeOutline(seat)
  chair.add(seat)

  const back = box(seatW, 0.4, 0.04, mat(0xffcad4, { roughness: 0.9 }))
  back.position.set(0, seatY + 0.23, -seatD / 2 + 0.02)
  chair.add(back)

  for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) {
    const leg = cyl(0.015, 0.015, seatY, legMat)
    leg.position.set(x, seatY / 2, z)
    chair.add(leg)
  }

  // Tucked under desk (negative Z, near back wall)
  chair.position.set(-0.3, 0, -HALF_D + 0.7)
  return chair
}

function createBed(): THREE.Group {
  const bed = new THREE.Group()
  const bedW = 1.2, bedH = 0.35, bedD = 2.0

  // Frame — slightly warmer wood
  const frame = box(bedW, bedH, bedD, mat(0xd9b892, { roughness: 0.75 }))
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

  const headboard = box(bedW, 0.6, 0.06, mat(0xb8895e, { roughness: 0.7 }))
  headboard.position.set(0, bedH + 0.3, -bedD / 2)
  addEdgeOutline(headboard)
  bed.add(headboard)

  const blanket = box(bedW - 0.1, 0.05, bedD * 0.6, mat(0xe8c0d8, { roughness: 0.95 }))
  blanket.position.set(0, bedH + 0.14, 0.25)
  bed.add(blanket)

  // Stuffed animal on bed
  const plushBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 12, 10),
    mat(0xffd4b8, { roughness: 0.95 })
  )
  plushBody.position.set(-0.2, bedH + 0.22, 0.1)
  plushBody.castShadow = true
  bed.add(plushBody)
  const plushHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    mat(0xffd4b8, { roughness: 0.95 })
  )
  plushHead.position.set(-0.2, bedH + 0.34, 0.1)
  plushHead.castShadow = true
  bed.add(plushHead)

  // Bed against right wall, headboard toward back-right
  // Rotated so length runs along Z axis against right wall
  bed.position.set(HALF_W - 0.65, 0, 0.2)
  bed.rotation.y = -Math.PI / 2
  return bed
}

function createSlippers(): THREE.Group {
  const group = new THREE.Group()
  const slipperMat = mat(0xffb8c8, { roughness: 0.9 })
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
  group.add(hourHand)
  // Minute hand
  const minHand = box(0.008, 0.09, 0.005, mat(0x333333))
  minHand.position.set(0, 0.04, 0.012)
  minHand.rotation.z = 0.5
  minHand.castShadow = false
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
  const base = cyl(0.08, 0.08, 0.02, mat(0x555555, { metalness: 0.5 }))
  base.position.y = 0.01
  group.add(base)
  // Pole
  const pole = cyl(0.015, 0.015, 1.5, mat(0x555555, { metalness: 0.5 }))
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
  const pillow = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    mat(0xffb347, { roughness: 0.9 })
  )
  pillow.scale.set(1, 0.6, 1)
  pillow.position.y = 0
  group.add(pillow)
  // On chair seat
  group.position.set(-0.3, 0.48, -HALF_D + 0.7)
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
  const top = box(tW, tT, tD, woodMat)
  top.position.y = tH
  addEdgeOutline(top)
  table.add(top)

  // Legs
  for (const [x, z] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) {
    const leg = cyl(0.015, 0.015, tH, woodMat)
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
  const shelfMat = mat(0xc49a6c, { roughness: 0.7 })
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
      const bw = 0.03 + Math.random() * 0.04
      const bh = 0.3 + Math.random() * 0.15
      const bd = 0.18 + Math.random() * 0.06
      const bookColor = bookColors[Math.floor(Math.random() * bookColors.length)]
      const b = box(bw, bh, bd, mat(bookColor, { roughness: 0.85 }))
      b.position.set(x + bw / 2, baseY + bh / 2, 0.02)
      b.rotation.z = (Math.random() - 0.5) * 0.05
      b.castShadow = false
      shelf.add(b)
      x += bw + 0.005
    }
  }

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
    mat(0xeab8c8, { roughness: 0.95 })
  )
  outer.rotation.x = -Math.PI / 2
  outer.position.set(0, 0.004, 0)
  group.add(outer)

  // Inner rug — lighter center
  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 32),
    mat(0xffd0e0, { roughness: 0.95 })
  )
  inner.rotation.x = -Math.PI / 2
  inner.position.set(0, 0.005, 0)
  group.add(inner)

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
    group.add(bulb)
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
    const frameMat = mat(0xd4b08c, { roughness: 0.6 })
    const artMat = mat(frameColors[i], { roughness: 0.9 })

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

  scene.add(roomGroup)

  roomLights = createRoomLights()
}

export function enableRoomMode(): void {
  if (_isRoomMode) return
  _isRoomMode = true

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

  // Camera — cozy diorama angle
  camera.position.set(1.8, 2.0, 3.0)
  controls.target.set(0, 0.9, -0.3)
  controls.minDistance = 2.0
  controls.maxDistance = 6.0
  controls.minPolarAngle = 0.3
  controls.maxPolarAngle = 1.4
  controls.update()

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

  // Remove fog
  scene.fog = null

  scene.background = new THREE.Color(0xf8e8f0)
  renderer.setClearColor(0xf8e8f0, 1)
  renderer.toneMappingExposure = 1.06

  // Restore camera constraints
  controls.minDistance = 1.5
  controls.maxDistance = 8.0
  controls.minPolarAngle = 0
  controls.maxPolarAngle = Math.PI

  camera.position.set(0, 1.2, 3.0)
  controls.target.set(0, 0.9, 0)
  controls.update()
}

export function isRoomMode(): boolean {
  return _isRoomMode
}

export function setRoomTheme(theme: 'cozy' | 'study' | 'night'): void {
  currentTheme = theme
  if (!_isRoomMode) return

  const windowGlow = roomGroup.getObjectByName('window-glow') as THREE.Mesh | undefined

  for (const light of roomLights) {
    if (theme === 'cozy') {
      if (light.name === 'room-window-light') (light as THREE.DirectionalLight).intensity = 1.5
      if (light.name === 'room-desk-lamp') (light as THREE.PointLight).intensity = 0.8
      if (light.name === 'room-fairy-light') (light as THREE.PointLight).intensity = 0.3
      if (light.name === 'room-ambient') (light as THREE.AmbientLight).intensity = 0.4
      if (light.name === 'room-hemi') (light as THREE.HemisphereLight).intensity = 0.3
      if (light.name === 'room-floor-bounce') (light as THREE.PointLight).intensity = 0.3
      if (light.name === 'room-char-backlight') (light as THREE.SpotLight).intensity = 0.5
      if (light.name === 'room-floor-lamp') (light as THREE.PointLight).intensity = 0.4
    } else if (theme === 'study') {
      if (light.name === 'room-window-light') (light as THREE.DirectionalLight).intensity = 0.6
      if (light.name === 'room-desk-lamp') (light as THREE.PointLight).intensity = 1.5
      if (light.name === 'room-fairy-light') (light as THREE.PointLight).intensity = 0.15
      if (light.name === 'room-ambient') (light as THREE.AmbientLight).intensity = 0.2
      if (light.name === 'room-hemi') (light as THREE.HemisphereLight).intensity = 0.15
      if (light.name === 'room-floor-bounce') (light as THREE.PointLight).intensity = 0.15
      if (light.name === 'room-char-backlight') (light as THREE.SpotLight).intensity = 0.3
      if (light.name === 'room-floor-lamp') (light as THREE.PointLight).intensity = 0.2
    } else if (theme === 'night') {
      if (light.name === 'room-window-light') {
        (light as THREE.DirectionalLight).intensity = 0.15
        ;(light as THREE.DirectionalLight).color.set(0x4466aa)
      }
      if (light.name === 'room-desk-lamp') (light as THREE.PointLight).intensity = 0.5
      if (light.name === 'room-fairy-light') (light as THREE.PointLight).intensity = 0.6
      if (light.name === 'room-ambient') (light as THREE.AmbientLight).intensity = 0.15
      if (light.name === 'room-hemi') (light as THREE.HemisphereLight).intensity = 0.1
      if (light.name === 'room-floor-bounce') (light as THREE.PointLight).intensity = 0.1
      if (light.name === 'room-char-backlight') (light as THREE.SpotLight).intensity = 0.2
      if (light.name === 'room-floor-lamp') (light as THREE.PointLight).intensity = 0.6
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
}
