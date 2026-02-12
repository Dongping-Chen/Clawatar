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
// Room center offset: character at origin, room surrounds them
// Back wall at z = -ROOM_D/2, front open, left wall at x = -ROOM_W/2, right at x = ROOM_W/2
const HALF_W = ROOM_W / 2
const HALF_D = ROOM_D / 2

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, ...opts })
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
}

function cyl(rT: number, rB: number, h: number, material: THREE.Material, seg = 16): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg), material)
}

function createFloor(): THREE.Mesh {
  // Wood plank floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_W, ROOM_D),
    mat(0xc49a6c, { roughness: 0.75 })
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 0)
  floor.receiveShadow = true
  return floor
}

function createWalls(): THREE.Group {
  const walls = new THREE.Group()
  const wallMat = mat(0xf5ede3, { roughness: 0.9 })

  // Back wall (with window hole) — at z = -HALF_D
  // We'll build it as 4 pieces around the window
  const winW = 1.4, winH = 1.2, winBottom = 1.2
  const winTop = winBottom + winH
  // Left of window
  const blW = (ROOM_W - winW) / 2
  const bl = box(blW, ROOM_H, 0.1, wallMat)
  bl.position.set(-HALF_W + blW / 2, ROOM_H / 2, -HALF_D)
  walls.add(bl)
  // Right of window
  const br = box(blW, ROOM_H, 0.1, wallMat)
  br.position.set(HALF_W - blW / 2, ROOM_H / 2, -HALF_D)
  walls.add(br)
  // Above window
  const ba = box(winW, ROOM_H - winTop, 0.1, wallMat)
  ba.position.set(0, winTop + (ROOM_H - winTop) / 2, -HALF_D)
  walls.add(ba)
  // Below window
  const bb = box(winW, winBottom, 0.1, wallMat)
  bb.position.set(0, winBottom / 2, -HALF_D)
  walls.add(bb)

  // Window glow plane
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
  // Horizontal bars
  for (const y of [winBottom, winTop]) {
    const bar = box(winW + 0.08, frameT, 0.06, frameMat)
    bar.position.set(0, y, -HALF_D + 0.03)
    walls.add(bar)
  }
  // Vertical bars
  for (const x of [-winW / 2, 0, winW / 2]) {
    const bar = box(frameT, winH, 0.06, frameMat)
    bar.position.set(x, winBottom + winH / 2, -HALF_D + 0.03)
    walls.add(bar)
  }

  // Left wall — at x = -HALF_W
  const leftWall = box(0.1, ROOM_H, ROOM_D, wallMat)
  leftWall.position.set(-HALF_W, ROOM_H / 2, 0)
  walls.add(leftWall)

  // Right wall (with door outline) — at x = HALF_W
  const doorW = 0.8, doorH = 2.1
  // Above door
  const rd = box(0.1, ROOM_H - doorH, ROOM_D * 0.3, wallMat)
  rd.position.set(HALF_W, doorH + (ROOM_H - doorH) / 2, -HALF_D + ROOM_D * 0.15)
  walls.add(rd)
  // Right wall - main section
  const rMain = box(0.1, ROOM_H, ROOM_D * 0.7, wallMat)
  rMain.position.set(HALF_W, ROOM_H / 2, -HALF_D + ROOM_D * 0.3 + ROOM_D * 0.35)
  walls.add(rMain)
  // Right wall - left of door
  // Actually let's simplify: full right wall + door frame overlay
  const rightWall = box(0.1, ROOM_H, ROOM_D, wallMat)
  rightWall.position.set(HALF_W, ROOM_H / 2, 0)
  walls.add(rightWall)
  // Remove the partial pieces
  walls.remove(rd, rMain)

  // Door frame on right wall
  const doorFrameMat = mat(0xc49a6c, { roughness: 0.7 })
  const doorFrame = box(0.06, doorH, doorW, doorFrameMat)
  doorFrame.position.set(HALF_W - 0.02, doorH / 2, -HALF_D + 0.6)
  walls.add(doorFrame)

  return walls
}

function createDesk(): THREE.Group {
  const desk = new THREE.Group()
  const woodMat = mat(0xd4b08c, { roughness: 0.75 })
  const deskY = 0.72, deskW = 1.4, deskD = 0.6, deskT = 0.04

  // Surface
  const surface = box(deskW, deskT, deskD, woodMat)
  surface.position.y = deskY
  desk.add(surface)

  // 4 legs
  const legMat = mat(0xc49a6c, { roughness: 0.8 })
  for (const [x, z] of [[-0.65, -0.25], [0.65, -0.25], [-0.65, 0.25], [0.65, 0.25]]) {
    const leg = cyl(0.02, 0.02, deskY, legMat)
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
  desk.add(lampShade)

  desk.position.set(0, 0, -HALF_D + 0.35)
  return desk
}

function createChair(): THREE.Group {
  const chair = new THREE.Group()
  const legMat = mat(0x444444, { metalness: 0.4, roughness: 0.5 })
  const seatY = 0.42, seatW = 0.42, seatD = 0.4

  // Seat cushion
  const seat = box(seatW, 0.06, seatD, mat(0xffcad4, { roughness: 0.9 }))
  seat.position.y = seatY
  chair.add(seat)

  // Back
  const back = box(seatW, 0.4, 0.04, mat(0xffcad4, { roughness: 0.9 }))
  back.position.set(0, seatY + 0.23, -seatD / 2 + 0.02)
  chair.add(back)

  // 4 legs
  for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) {
    const leg = cyl(0.015, 0.015, seatY, legMat)
    leg.position.set(x, seatY / 2, z)
    chair.add(leg)
  }

  chair.position.set(0, 0, -HALF_D + 0.95)
  return chair
}

function createBed(): THREE.Group {
  const bed = new THREE.Group()
  const bedW = 1.2, bedH = 0.35, bedD = 2.0

  // Frame
  const frame = box(bedW, bedH, bedD, mat(0xd4b08c, { roughness: 0.75 }))
  frame.position.set(0, bedH / 2, 0)
  bed.add(frame)

  // Mattress
  const mattress = box(bedW - 0.06, 0.12, bedD - 0.06, mat(0xf0d0e8, { roughness: 0.9 }))
  mattress.position.set(0, bedH + 0.06, 0)
  bed.add(mattress)

  // Pillow
  const pillow = box(0.5, 0.1, 0.3, mat(0xfff0f5, { roughness: 0.95 }))
  pillow.position.set(0, bedH + 0.17, -bedD / 2 + 0.25)
  bed.add(pillow)

  // Headboard
  const headboard = box(bedW, 0.6, 0.06, mat(0xc49a6c, { roughness: 0.7 }))
  headboard.position.set(0, bedH + 0.3, -bedD / 2)
  bed.add(headboard)

  // Blanket (slightly draped — just a thinner, different-colored box)
  const blanket = box(bedW - 0.1, 0.05, bedD * 0.6, mat(0xe8c0d8, { roughness: 0.95 }))
  blanket.position.set(0, bedH + 0.14, 0.25)
  bed.add(blanket)

  bed.position.set(HALF_W - 0.7, 0, 0)
  bed.rotation.y = -Math.PI / 2
  return bed
}

function createBookshelf(): THREE.Group {
  const shelf = new THREE.Group()
  const shelfMat = mat(0xc49a6c, { roughness: 0.7 })
  const sw = 0.8, sd = 0.3, sh = 2.2, thick = 0.03

  // Side panels
  for (const x of [-sw / 2, sw / 2]) {
    const side = box(thick, sh, sd, shelfMat)
    side.position.set(x, sh / 2, 0)
    shelf.add(side)
  }

  // Shelves (5 horizontal)
  const shelfYs = [0.02, 0.5, 1.0, 1.5, 2.0]
  for (const y of shelfYs) {
    const s = box(sw, thick, sd, shelfMat)
    s.position.set(0, y, 0)
    shelf.add(s)
  }

  // Back panel
  const backPanel = box(sw, sh, 0.02, shelfMat)
  backPanel.position.set(0, sh / 2, -sd / 2 + 0.01)
  shelf.add(backPanel)

  // Fill with books
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
    shelf.add(leaf)
  }

  shelf.position.set(-HALF_W + 0.5, 0, -0.3)
  return shelf
}

function createRug(): THREE.Mesh {
  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 32),
    mat(0xffd0e0, { roughness: 0.95 })
  )
  rug.rotation.x = -Math.PI / 2
  rug.position.set(0, 0.005, 0.3)
  return rug
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

    // Wire between bulbs
    if (i > 0) {
      const prev = group.children[group.children.length - 2] as THREE.Mesh
      const wire = box(0.005, 0.005, 0.005, mat(0x333333))
      wire.position.lerpVectors(prev.position, bulb.position, 0.5)
      // Skip wire for simplicity, the bulbs are enough
    }
  }
  return group
}

function createCornerPlant(): THREE.Group {
  const plant = new THREE.Group()

  const pot = cyl(0.1, 0.08, 0.2, mat(0x8B5E3C, { roughness: 0.8 }))
  pot.position.y = 0.1
  plant.add(pot)

  // Soil
  const soil = cyl(0.09, 0.09, 0.02, mat(0x4a3728, { roughness: 1 }))
  soil.position.y = 0.21
  plant.add(soil)

  // Leaves (cones + spheres)
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
    plant.add(leaf)
  }

  plant.position.set(HALF_W - 0.3, 0, HALF_D - 0.3)
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
    const art = box(0.22, 0.16, 0.015, artMat)
    art.position.z = 0.005
    frameGroup.add(frame, art)

    frameGroup.position.set(x, y, z)
    if (wall === 'left') {
      frameGroup.rotation.y = Math.PI / 2
    }
    group.add(frameGroup)
  }

  return group
}

function createRoomLights(): THREE.Light[] {
  const lights: THREE.Light[] = []

  // Window light
  const windowLight = new THREE.DirectionalLight(0xffe4b0, 1.5)
  windowLight.name = 'room-window-light'
  windowLight.position.set(0, 2.5, -HALF_D - 1)
  windowLight.target.position.set(0, 0.5, 0)
  lights.push(windowLight)

  // Desk lamp light
  const deskLampLight = new THREE.PointLight(0xfff0d0, 0.8, 3)
  deskLampLight.name = 'room-desk-lamp'
  deskLampLight.position.set(0.55, 1.15, -HALF_D + 0.35)
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

  return lights
}

export function initRoomScene(): void {
  roomGroup = new THREE.Group()
  roomGroup.name = 'room-group'
  roomGroup.visible = false

  roomGroup.add(createFloor())
  roomGroup.add(createWalls())
  roomGroup.add(createDesk())
  roomGroup.add(createChair())
  roomGroup.add(createBed())
  roomGroup.add(createBookshelf())
  roomGroup.add(createRug())
  roomGroup.add(createFairyLights())
  roomGroup.add(createCornerPlant())
  roomGroup.add(createPictureFrames())

  scene.add(roomGroup)

  // Create lights but don't add yet
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

  // Set background
  scene.background = new THREE.Color(0x1a1520)
  renderer.setClearColor(0x1a1520, 1)
  renderer.toneMappingExposure = 0.95

  // Camera
  camera.position.set(2, 2.2, 3.5)
  controls.target.set(0, 0.8, 0)
  controls.update()

  setRoomTheme(currentTheme)
}

export function disableRoomMode(): void {
  if (!_isRoomMode) return
  _isRoomMode = false

  roomGroup.visible = false

  // Remove room lights
  for (const light of roomLights) {
    scene.remove(light)
    if ((light as any).target) scene.remove((light as any).target)
  }

  // Restore outdoor lights
  for (const saved of savedOutdoorState) {
    scene.traverse((obj) => {
      if (obj.name === saved.name) {
        obj.visible = saved.visible
        ;(obj as any).intensity = saved.intensity
      }
    })
  }

  // Restore platform circles
  scene.traverse((obj) => {
    if ((obj as any)._roomHidden) {
      obj.visible = true
      delete (obj as any)._roomHidden
    }
  })

  // Restore background
  scene.background = new THREE.Color(0xf8e8f0)
  renderer.setClearColor(0xf8e8f0, 1)
  renderer.toneMappingExposure = 1.06

  // Restore camera
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
    } else if (theme === 'study') {
      if (light.name === 'room-window-light') (light as THREE.DirectionalLight).intensity = 0.6
      if (light.name === 'room-desk-lamp') (light as THREE.PointLight).intensity = 1.5
      if (light.name === 'room-fairy-light') (light as THREE.PointLight).intensity = 0.15
      if (light.name === 'room-ambient') (light as THREE.AmbientLight).intensity = 0.2
      if (light.name === 'room-hemi') (light as THREE.HemisphereLight).intensity = 0.15
    } else if (theme === 'night') {
      if (light.name === 'room-window-light') {
        (light as THREE.DirectionalLight).intensity = 0.15
        ;(light as THREE.DirectionalLight).color.set(0x4466aa)
      }
      if (light.name === 'room-desk-lamp') (light as THREE.PointLight).intensity = 0.5
      if (light.name === 'room-fairy-light') (light as THREE.PointLight).intensity = 0.6
      if (light.name === 'room-ambient') (light as THREE.AmbientLight).intensity = 0.15
      if (light.name === 'room-hemi') (light as THREE.HemisphereLight).intensity = 0.1
    }
  }

  if (windowGlow) {
    const glowMat = windowGlow.material as THREE.MeshBasicMaterial
    if (theme === 'night') {
      glowMat.color.set(0x2244660)
      glowMat.opacity = 0.4
    } else {
      glowMat.color.set(0xffe4b0)
      glowMat.opacity = theme === 'study' ? 0.3 : 0.6
    }
  }
}
