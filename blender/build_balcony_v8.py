import bpy, math, os, random

# ── Helpers ──────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes:
        if b.users == 0:
            bpy.data.meshes.remove(b)
    for b in bpy.data.materials:
        if b.users == 0:
            bpy.data.materials.remove(b)


def mat(name, color, roughness=0.6, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = roughness
        b.inputs["Metallic"].default_value = metallic
    return m


def emit_mat(name, color, strength=5.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def box(nm, loc, dim, mt, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.scale = dim
    o.rotation_euler = rot
    if mt:
        o.data.materials.append(mt)
    return o


def cyl(nm, loc, rad, dep, mt, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=dep, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.rotation_euler = rot
    if mt:
        o.data.materials.append(mt)
    return o


def sphere(nm, loc, rad, mt, sc=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = nm
    o.scale = sc
    if mt:
        o.data.materials.append(mt)
    return o


# ── Scene Setup ──────────────────────────────────────────────────────
clear_scene()
OUT = "/tmp"
random.seed(11)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True

# ── Materials (all emissive ≥ 3.0) ───────────────────────────────────
m_floor_a = emit_mat("FloorA", (0.62, 0.46, 0.34, 1), 14.4)
m_floor_b = emit_mat("FloorB", (0.52, 0.38, 0.28, 1), 15.2)
m_wall = emit_mat("Wall", (0.94, 0.86, 0.76, 1), 12.8)
m_interior = emit_mat("Interior", (1.0, 0.86, 0.7, 1), 14.4)
m_window_frame = emit_mat("WindowFrame", (0.28, 0.22, 0.18, 1), 13.6)
m_window_glow = emit_mat("WindowGlow", (1.0, 0.8, 0.55, 1), 30.0)
m_door_glow = emit_mat("DoorGlow", (1.0, 0.78, 0.5, 1), 30.0)

m_railing = emit_mat("Railing", (0.92, 0.88, 0.82, 1), 16.0)
m_railing_cap = emit_mat("RailingCap", (0.98, 0.95, 0.9, 1), 18.4)

m_table = emit_mat("Table", (0.25, 0.2, 0.22, 1), 17.6)
m_chair = emit_mat("Chair", (0.25, 0.2, 0.22, 1), 16.8)
m_seat = emit_mat("Seat", (0.86, 0.5, 0.28, 1), 18.4)

m_pot = emit_mat("Pot", (0.7, 0.36, 0.2, 1), 16.8)
m_soil = emit_mat("Soil", (0.2, 0.12, 0.08, 1), 12.8)
m_leaf1 = emit_mat("Leaf1", (0.2, 0.56, 0.22, 1), 14.4)
m_leaf2 = emit_mat("Leaf2", (0.12, 0.46, 0.16, 1), 14.4)

m_building = emit_mat("Building", (0.08, 0.08, 0.12, 1), 12.8)
m_win = emit_mat("WindowLight", (1.0, 0.8, 0.45, 1), 30.0)

m_bulb = emit_mat("Bulb", (1.0, 0.88, 0.6, 1), 32.0)
m_moon = emit_mat("Moon", (1.0, 1.0, 1.0, 1), 40.0)
m_star = emit_mat("Star", (1.0, 1.0, 1.0, 1), 30.0)

m_plate = emit_mat("Plate", (0.95, 0.92, 0.88, 1), 13.6)
m_book = emit_mat("Book", (0.3, 0.15, 0.1, 1), 15.2)
m_wine = emit_mat("Wine", (0.62, 0.12, 0.2, 1), 19.2)

m_glass = mat("Glass", (0.7, 0.8, 0.9, 1), roughness=0.08, metallic=0.0)
m_wire = mat("Wire", (0.06, 0.06, 0.06, 1), roughness=0.45, metallic=0.8)

# ── Sky Gradient (hero) ──────────────────────────────────────────────
sky_layers = [
    (2.0,  (1.0, 0.55, 0.2, 1), 5.0, 4.0),
    (6.0,  (0.98, 0.4, 0.45, 1), 4.6, 4.6),
    (10.0, (0.55, 0.22, 0.62, 1), 4.2, 5.2),
    (14.5, (0.12, 0.1, 0.28, 1), 3.6, 6.0),
]
for i, (z, col, st, h) in enumerate(sky_layers):
    m = emit_mat(f"Sky{i}", col, st)
    box(f"Sky{i}", (0, -18.0, z), (16, 0.2, h/2), m)

# Moon + Stars
cyl("Moon", (3.0, 17.8, 11.2), 0.8, 0.08, m_moon, rot=(math.pi/2, 0, 0))
for i in range(36):
    sx = random.uniform(-9.0, 9.0)
    sy = random.uniform(17.0, 19.5)
    sz = random.uniform(8.0, 16.0)
    sphere(f"Star{i}", (sx, sy, sz), 0.04, m_star)

# ── Floor (warm tiles) ───────────────────────────────────────────────
tile = 0.5
for ix in range(12):
    for iy in range(8):
        x = -2.75 + ix * tile
        y = -1.75 + iy * tile
        mt = m_floor_a if (ix + iy) % 2 == 0 else m_floor_b
        box(f"Tile_{ix}_{iy}", (x, y, -0.01), (tile/2 - 0.01, tile/2 - 0.01, 0.01), mt)

# Interior floor slab
box("InteriorFloor", (0, -2.6, -0.015), (1.7, 0.7, 0.015), m_floor_b)

# ── Walls ────────────────────────────────────────────────────────────
wall_h = 2.5
box("WallL", (-3.05, 0.0, wall_h/2), (0.08, 2.0, wall_h/2), m_wall)
box("WallR", (3.05, 0.0, wall_h/2), (0.08, 2.0, wall_h/2), m_wall)
box("WallBack", (0, -2.05, wall_h/2), (3.1, 0.08, wall_h/2), m_interior)

# ── Window + Sliding Door (warm interior glow) ───────────────────────
frame_y = -2.02
# Window
win_cx, win_cz = -1.1, 1.25
win_w, win_h = 1.6, 1.05
frame = 0.07
box("WinTop", (win_cx, frame_y, win_cz + win_h/2), (win_w/2 + frame, 0.05, frame), m_window_frame)
box("WinBot", (win_cx, frame_y, win_cz - win_h/2), (win_w/2 + frame, 0.05, frame), m_window_frame)
box("WinL", (win_cx - win_w/2, frame_y, win_cz), (frame, 0.05, win_h/2), m_window_frame)
box("WinR", (win_cx + win_w/2, frame_y, win_cz), (frame, 0.05, win_h/2), m_window_frame)
box("WinGlow", (win_cx, frame_y - 0.05, win_cz), (win_w/2 - 0.05, 0.02, win_h/2 - 0.05), m_window_glow)

# Door
door_cx, door_cz = 1.45, 1.1
door_w, door_h = 1.2, 2.05
box("DoorTop", (door_cx, frame_y, door_cz + door_h/2), (door_w/2 + frame, 0.05, frame), m_window_frame)
box("DoorBot", (door_cx, frame_y, door_cz - door_h/2), (door_w/2 + frame, 0.05, frame), m_window_frame)
box("DoorL", (door_cx - door_w/2, frame_y, door_cz), (frame, 0.05, door_h/2), m_window_frame)
box("DoorR", (door_cx + door_w/2, frame_y, door_cz), (frame, 0.05, door_h/2), m_window_frame)
box("DoorGlass", (door_cx, frame_y + 0.01, door_cz), (door_w/2 - 0.05, 0.02, door_h/2 - 0.08), m_glass)
box("DoorGlow", (door_cx, frame_y - 0.05, door_cz), (door_w/2 - 0.05, 0.02, door_h/2 - 0.1), m_door_glow)

# Interior warm glow panel + lamp
box("InteriorGlow", (0, -2.8, 1.2), (2.0, 0.02, 1.2), emit_mat("InteriorGlowMat", (1.0, 0.84, 0.58, 1), 28.0))
sphere("InteriorLamp", (0.6, -2.7, 2.1), 0.12, emit_mat("InteriorLampMat", (1.0, 0.86, 0.64, 1), 42.0))

# ── Railing (warm white) ─────────────────────────────────────────────
rail_y = -1.6
box("RailCap", (0, rail_y, 1.06), (3.2, 0.07, 0.06), m_railing_cap)
box("RailMid", (0, rail_y, 0.7), (3.15, 0.04, 0.035), m_railing)
box("RailLow", (0, rail_y, 0.35), (3.15, 0.04, 0.03), m_railing)
for x in [-2.8, -2.1, -1.4, -0.7, 0, 0.7, 1.4, 2.1, 2.8]:
    box(f"Post_{x}", (x, rail_y, 0.5), (0.05, 0.05, 0.5), m_railing)

for sx in [-3.0, 3.0]:
    box(f"SideCap_{sx}", (sx, -0.2, 1.04), (0.06, 1.9, 0.05), m_railing_cap)
    box(f"SideMid_{sx}", (sx, -0.2, 0.7), (0.04, 1.9, 0.03), m_railing)
    box(f"SideLow_{sx}", (sx, -0.2, 0.35), (0.04, 1.9, 0.03), m_railing)

# ── City Skyline (silhouette + glowing windows) ──────────────────────
bldg_xs = [-7.5, -6.2, -4.8, -3.4, -2.0, -0.6, 0.8, 2.2, 3.6, 5.0, 6.4]
for i, bx in enumerate(bldg_xs):
    bw = random.uniform(0.9, 1.7)
    bh = random.uniform(4.0, 8.5)
    by = -8.2
    base_z = -2.2
    box(f"Bldg{i}", (bx, by, base_z + bh/2), (bw/2, 0.55, bh/2), m_building)
    for w in range(int(bh * 2.4)):
        if random.random() > 0.5:
            wx = bx + random.uniform(-bw/2 + 0.12, bw/2 - 0.12)
            wz = base_z + 0.4 + w * 0.34
            box(f"Win{i}_{w}", (wx, by + 0.55, wz), (0.06, 0.02, 0.08), m_win)

# ── Bistro Table + Setting ───────────────────────────────────────────
tx, ty = -1.6, -0.8
cyl("TableTop", (tx, ty, 0.74), 0.38, 0.05, m_table)
cyl("TableLeg", (tx, ty, 0.37), 0.03, 0.74, m_table)
cyl("TableBase", (tx, ty, 0.02), 0.22, 0.04, m_table)

cyl("Plate", (tx-0.08, ty+0.05, 0.77), 0.16, 0.02, m_plate)
box("Book", (tx+0.18, ty-0.05, 0.77), (0.16, 0.22, 0.02), m_book, rot=(0, 0, math.radians(15)))

cyl("GlassStem", (tx+0.02, ty+0.18, 0.78), 0.015, 0.18, m_glass)
sphere("GlassBowl", (tx+0.02, ty+0.18, 0.9), 0.07, m_glass, sc=(1, 1, 1.2))
sphere("Wine", (tx+0.02, ty+0.18, 0.86), 0.05, m_wine)

# ── Chairs ───────────────────────────────────────────────────────────

def make_chair(prefix, cx, cy, angle=0):
    a = math.radians(angle)
    rot = (0, 0, a)
    box(f"{prefix}Seat", (cx, cy, 0.43), (0.4, 0.4, 0.04), m_seat, rot=rot)
    box(f"{prefix}Cush", (cx, cy, 0.47), (0.32, 0.32, 0.04), m_seat, rot=rot)
    for dx, dy in [(-0.16, -0.16), (0.16, -0.16), (-0.16, 0.16), (0.16, 0.16)]:
        rx = dx * math.cos(a) - dy * math.sin(a)
        ry = dx * math.sin(a) + dy * math.cos(a)
        cyl(f"{prefix}Leg{dx}{dy}", (cx + rx, cy + ry, 0.21), 0.02, 0.42, m_chair)
    box(f"{prefix}Back", (cx, cy - 0.2 * math.cos(a), 0.7), (0.38, 0.03, 0.5), m_chair, rot=rot)

make_chair("ChA", -1.6, -1.4, 10)
make_chair("ChB", -0.6, -0.6, 30)

# ── Plants (leaf clusters) ───────────────────────────────────────────

def leaf_cluster(name, cx, cy, cz, base_r, count=6):
    for i in range(count):
        ang = i * 2 * math.pi / count + random.uniform(-0.3, 0.3)
        dist = random.uniform(0.02, base_r)
        lx = cx + math.cos(ang) * dist
        ly = cy + math.sin(ang) * dist
        lz = cz + random.uniform(-0.02, 0.05)
        lr = random.uniform(0.05, 0.09)
        m = m_leaf1 if i % 2 == 0 else m_leaf2
        sphere(f"{name}Leaf{i}", (lx, ly, lz), lr, m, sc=(1, 1, random.uniform(0.7, 1.3)))


def make_plant(name, px, py, pot_h=0.28, pot_r=0.14, tall=False, base_z=0.0):
    cyl(f"{name}Pot", (px, py, base_z + pot_h/2), pot_r, pot_h, m_pot)
    cyl(f"{name}Soil", (px, py, base_z + pot_h - 0.01), pot_r - 0.02, 0.03, m_soil)
    levels = 4 if tall else 3
    for j in range(levels):
        h = base_z + pot_h + 0.08 + j * (0.12 if tall else 0.08)
        leaf_cluster(f"{name}C{j}", px, py, h, 0.18 if tall else 0.12, count=7 if tall else 5)

make_plant("PlantL", -2.5, 1.2, pot_h=0.32, pot_r=0.16)
make_plant("PlantR", 2.4, 1.1, pot_h=0.28, pot_r=0.14)
make_plant("PlantTall", -2.2, -1.5, pot_h=0.36, pot_r=0.18, tall=True)
make_plant("PlantTall2", 2.1, -1.4, pot_h=0.34, pot_r=0.17, tall=True)

# Hanging plant over railing
hp_x, hp_y, hp_z = 0.9, 1.55, 1.25
cyl("HangPot", (hp_x, hp_y, hp_z), 0.1, 0.12, m_pot)
for i, off in enumerate([-0.08, 0, 0.08]):
    cyl(f"HangWire{i}", (hp_x + off, hp_y, hp_z + 0.25), 0.004, 0.5, m_wire)
for k in range(8):
    sphere(f"HangLeaf{k}", (hp_x + random.uniform(-0.12, 0.12), hp_y + random.uniform(-0.08, 0.08), hp_z - 0.15 - k*0.04), 0.05, m_leaf1)

# ── String Lights ────────────────────────────────────────────────────
cyl("LightWire", (0, 1.52, 1.28), 0.01, 6.0, m_wire, rot=(0, math.pi/2, 0))
for i in range(13):
    t = i / 12
    lx = -2.8 + t * 5.6
    lz = 1.26 + math.sin(t * math.pi) * 0.08
    sphere(f"Bulb{i}", (lx, 1.52, lz), 0.035, m_bulb)

# ── Atmospheric birds ────────────────────────────────────────────────
for i, bx in enumerate([-1.5, 1.2]):
    by, bz = 15.5, 7.8 + i * 0.6
    box(f"Bird{i}L", (bx - 0.08, by, bz), (0.12, 0.02, 0.01), m_building, rot=(0, 0, math.radians(20)))
    box(f"Bird{i}R", (bx + 0.08, by, bz), (0.12, 0.02, 0.01), m_building, rot=(0, 0, math.radians(-20)))

# ── Subtle lighting ─────────────────────────────────────────────────
bpy.ops.object.light_add(type='AREA', location=(0, -1.0, 2.5))
key = bpy.context.active_object
key.data.energy = 55
key.data.color = (1.0, 0.72, 0.46)
key.data.size = 4
key.rotation_euler = (math.radians(70), 0, 0)

bpy.ops.object.light_add(type='SUN', location=(5, 8, 5))
sun = bpy.context.active_object
sun.data.energy = 1.8
sun.data.color = (1.0, 0.6, 0.35)

# ── Export GLB ───────────────────────────────────────────────────────
glb = os.path.join(OUT, "sunset-balcony.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', export_apply=True)
print(f"Exported: {glb}")
print("DONE!")
