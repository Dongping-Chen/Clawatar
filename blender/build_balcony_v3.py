import bpy, math, os, random

# ── Helpers ──────────────────────────────────────────────────────────
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes:
        if b.users == 0: bpy.data.meshes.remove(b)
    for b in bpy.data.materials:
        if b.users == 0: bpy.data.materials.remove(b)

def mat(name, color, roughness=0.7, metallic=0.0):
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
    nodes = m.node_tree.nodes; links = m.node_tree.links
    for n in list(nodes): nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

def box(nm, loc, dim, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = nm; o.scale = dim; o.rotation_euler = rot
    if mt: o.data.materials.append(mt)
    return o

def cyl(nm, loc, rad, dep, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=dep, location=loc)
    o = bpy.context.active_object; o.name = nm; o.rotation_euler = rot
    if mt: o.data.materials.append(mt)
    return o

def sphere(nm, loc, rad, mt, sc=(1,1,1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object; o.name = nm; o.scale = sc
    if mt: o.data.materials.append(mt)
    return o

# ── Scene Setup ──────────────────────────────────────────────────────
clear_scene()
OUT = "/tmp/blender-room"

# ── Materials ────────────────────────────────────────────────────────
m_floor = mat("Floor", (0.45, 0.28, 0.15, 1), roughness=0.85)
m_railing = mat("Railing", (0.12, 0.12, 0.12, 1), roughness=0.3, metallic=0.9)
m_wall = mat("Wall", (0.9, 0.78, 0.6, 1), roughness=0.9)
m_table = mat("Table", (0.15, 0.15, 0.17, 1), roughness=0.35, metallic=0.85)
m_chair = mat("Chair", (0.15, 0.15, 0.17, 1), roughness=0.35, metallic=0.8)
m_seat = mat("Seat", (0.65, 0.35, 0.2, 1), roughness=0.85)
m_pot = mat("Pot", (0.6, 0.3, 0.15, 1), roughness=0.8)
m_leaf = mat("Leaf", (0.18, 0.4, 0.12, 1), roughness=0.75)
m_leaf2 = mat("Leaf2", (0.12, 0.3, 0.08, 1), roughness=0.8)
m_soil = mat("Soil", (0.2, 0.12, 0.08, 1), roughness=0.95)
m_bulb = emit_mat("Bulb", (1.0, 0.85, 0.5, 1), strength=40.0)
m_wire = mat("Wire", (0.06, 0.06, 0.06, 1), roughness=0.5, metallic=0.6)
m_building = mat("Building", (0.03, 0.02, 0.04, 1), roughness=0.95)
m_win = emit_mat("Win", (1.0, 0.8, 0.4, 1), strength=4.0)
m_cup = mat("Cup", (0.92, 0.9, 0.87, 1), roughness=0.4)
m_cushion = mat("Cushion", (0.75, 0.22, 0.18, 1), roughness=0.9)

# ── SKY GRADIENT — THE HERO ─────────────────────────────────────────
sky_layers = [
    (-2.5, (1.0, 0.5, 0.05, 1), 36.0, 3.0),
    (-0.5, (1.0, 0.6, 0.1, 1), 30.0, 2.5),
    (1.5,  (1.0, 0.4, 0.12, 1), 24.0, 2.5),
    (3.5,  (0.95, 0.3, 0.2, 1), 18.0, 2.5),
    (5.5,  (0.85, 0.2, 0.35, 1), 14.0, 2.5),
    (7.5,  (0.6, 0.15, 0.5, 1), 10.0, 3.0),
    (10.0, (0.3, 0.1, 0.55, 1), 7.0, 3.5),
    (13.0, (0.12, 0.06, 0.3, 1), 4.0, 4.0),
]
for i, (z, col, st, h) in enumerate(sky_layers):
    m = emit_mat(f"Sky{i}", col, st)
    box(f"Sky{i}", (0, 15, z), (30, 0.1, h), m)

# Sun disc
m_sun = emit_mat("Sun", (1.0, 0.75, 0.2, 1), 100.0)
sphere("Sun", (1.0, 14, -1.0), 1.2, m_sun)
# Sun halo
m_halo = emit_mat("Halo", (1.0, 0.6, 0.15, 1), 16.0)
sphere("Halo", (1.0, 13, -1.0), 3.5, m_halo, sc=(1, 0.4, 0.8))

# ── FLOOR ────────────────────────────────────────────────────────────
box("Floor", (0, 0, -0.05), (4.5, 3.5, 0.1), m_floor)
random.seed(42)
for i in range(9):
    x = -2.0 + i * 0.5
    c = 0.35 + random.uniform(-0.05, 0.05)
    mp = mat(f"Plank{i}", (c+0.12, c-0.02, c-0.15, 1), roughness=0.85)
    box(f"Plank{i}", (x, 0, 0.01), (0.45, 3.4, 0.02), mp)

# ── WALLS ────────────────────────────────────────────────────────────
box("WallL", (-2.1, -0.5, 1.2), (0.12, 2.5, 2.5), m_wall)
box("WallR", (2.1, -0.5, 1.2), (0.12, 2.5, 2.5), m_wall)
box("WallBack", (0, -1.5, 0.3), (4.3, 0.12, 0.7), m_wall)

# ── RAILING ──────────────────────────────────────────────────────────
ry = 1.5; rh = 1.0
cyl("RailTop", (0, ry, rh), 0.025, 4.2, m_railing, rot=(0, math.pi/2, 0))
cyl("RailMid", (0, ry, 0.55), 0.015, 4.2, m_railing, rot=(0, math.pi/2, 0))
cyl("RailBot", (0, ry, 0.15), 0.018, 4.2, m_railing, rot=(0, math.pi/2, 0))
for x in [-2.0, -1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0]:
    cyl(f"Bal{x}", (x, ry, 0.55), 0.012, 0.9, m_railing)

for sx in [-2.1, 2.1]:
    cyl(f"SRTop{sx}", (sx, 0.5, rh), 0.022, 2.2, m_railing, rot=(math.pi/2, 0, 0))
    cyl(f"SRBot{sx}", (sx, 0.5, 0.15), 0.015, 2.2, m_railing, rot=(math.pi/2, 0, 0))
    for yp in range(-1, 2):
        cyl(f"SBal{sx}_{yp}", (sx, yp*0.6 + 0.3, 0.55), 0.012, 0.9, m_railing)

# ── CITY SKYLINE ─────────────────────────────────────────────────────
bldgs = [
    (-8,  12, 4), (-6, 13, 6), (-4.5, 12, 3.5), (-3, 13, 7.5),
    (-1.5, 12, 4.5), (-0.3, 13, 8), (1.2, 12, 5), (2.5, 13, 6.5),
    (4, 12, 4), (5.5, 13, 7), (7, 12, 4.5), (8.5, 13, 5),
]
for i, (bx, by, bh) in enumerate(bldgs):
    bw = random.uniform(0.9, 1.6)
    box(f"Bldg{i}", (bx, by, bh/2 - 2), (bw, 1.0, bh), m_building)
    for w in range(int(bh * 2)):
        if random.random() > 0.55:
            wz = bh/2 - 2 - bh/2 + w * 0.4 + 0.3
            wx = bx + random.uniform(-bw/3, bw/3)
            box(f"W{i}_{w}", (wx, by - 0.52, wz), (0.1, 0.02, 0.13), m_win)

# ── BISTRO TABLE ─────────────────────────────────────────────────────
tx, ty = -1.5, -0.5
cyl("TTop", (tx, ty, 0.72), 0.35, 0.025, m_table)
cyl("TLeg", (tx, ty, 0.36), 0.022, 0.72, m_table)
cyl("TBase", (tx, ty, 0.02), 0.2, 0.025, m_table)
for a in range(3):
    ang = a * 2 * math.pi / 3
    cyl(f"TFoot{a}", (tx+math.cos(ang)*0.17, ty+math.sin(ang)*0.17, 0.015), 0.022, 0.025, m_table)

cyl("Cup", (tx+0.12, ty+0.08, 0.79), 0.035, 0.1, m_cup)

# ── CHAIRS ───────────────────────────────────────────────────────────
def make_chair(prefix, cx, cy, angle=0):
    a = math.radians(angle)
    rot = (0, 0, a)
    box(f"{prefix}Seat", (cx, cy, 0.43), (0.4, 0.4, 0.04), m_seat, rot=rot)
    box(f"{prefix}Cush", (cx, cy, 0.47), (0.32, 0.32, 0.04), m_cushion, rot=rot)
    for dx, dy in [(-0.16,-0.16),(0.16,-0.16),(-0.16,0.16),(0.16,0.16)]:
        rx = dx*math.cos(a) - dy*math.sin(a)
        ry2 = dx*math.sin(a) + dy*math.cos(a)
        cyl(f"{prefix}Leg{dx}{dy}", (cx+rx, cy+ry2, 0.21), 0.014, 0.42, m_chair)
    box(f"{prefix}Back", (cx, cy-0.18*math.cos(a), 0.7), (0.38, 0.02, 0.5), m_chair, rot=rot)
    for off in [-0.12, 0, 0.12]:
        bx2 = cx + off*math.cos(a)
        cyl(f"{prefix}Bar{off}", (bx2, cy - 0.18, 0.7), 0.008, 0.48, m_chair, rot=rot)

make_chair("ChA", -1.5, -1.3, 0)
make_chair("ChB", -0.5, -0.5, 25)

# ── POTTED PLANTS ────────────────────────────────────────────────────
def make_plant(name, px, py, pot_h=0.25, pot_r=0.12, tall=False):
    cyl(f"{name}Pot", (px, py, pot_h/2), pot_r, pot_h, m_pot)
    cyl(f"{name}Soil", (px, py, pot_h-0.01), pot_r-0.01, 0.025, m_soil)
    n_leaves = 12 if tall else 8
    max_h = 0.4 if tall else 0.2
    for j in range(n_leaves):
        ang = j * 2 * math.pi / n_leaves + random.uniform(-0.3, 0.3)
        dist = random.uniform(0.02, 0.12 if tall else 0.08)
        lx = px + math.cos(ang) * dist
        ly = py + math.sin(ang) * dist
        lz = pot_h + random.uniform(0.05, max_h)
        lr = random.uniform(0.04, 0.1 if tall else 0.07)
        m_l = m_leaf if j % 2 == 0 else m_leaf2
        sphere(f"{name}L{j}", (lx, ly, lz), lr, m_l, sc=(1, 1, random.uniform(0.7, 1.3)))

make_plant("PL", -1.8, 1.2, 0.3, 0.15)
make_plant("PR", 1.7, 1.1, 0.25, 0.12)
make_plant("PB", -1.5, -1.2, 0.35, 0.18, tall=True)
make_plant("PT", 1.5, -1.1, 0.4, 0.17, tall=True)

# ── STRING LIGHTS ────────────────────────────────────────────────────
for i in range(14):
    t = i / 13
    lx = -1.9 + t * 3.8
    ly = -1.2 + math.sin(t * math.pi) * 1.8
    lz = 2.3 + math.sin(t * math.pi * 2.5) * 0.12 - 0.3 * math.sin(t * math.pi)
    sphere(f"Blb{i}", (lx, ly, lz), 0.03, m_bulb)

for i in range(10):
    t = i / 9
    lx = -1.8 + t * 3.6
    lz = 1.7 + math.sin(t * math.pi) * 0.08
    sphere(f"FBlb{i}", (lx, 1.3, lz), 0.025, m_bulb)

# ── LIGHTING ─────────────────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', location=(5, 10, 1))
sun = bpy.context.active_object; sun.name = "Sun"
sun.data.energy = 6.0
sun.data.color = (1.0, 0.6, 0.2)
sun.rotation_euler = (math.radians(85), math.radians(5), math.radians(-20))

bpy.ops.object.light_add(type='AREA', location=(0, 8, 3))
o = bpy.context.active_object; o.name = "SkyFill"
o.data.energy = 500; o.data.color = (1.0, 0.55, 0.2); o.data.size = 12
o.rotation_euler = (math.radians(60), 0, 0)

bpy.ops.object.light_add(type='AREA', location=(1, 6, 0))
o = bpy.context.active_object; o.name = "HorizonFill"
o.data.energy = 300; o.data.color = (1.0, 0.5, 0.15); o.data.size = 10
o.rotation_euler = (math.radians(85), 0, 0)

bpy.ops.object.light_add(type='SPOT', location=(0, -0.3, 2.8))
o = bpy.context.active_object; o.name = "TableSpot"
o.data.energy = 120; o.data.color = (1.0, 0.7, 0.35)
o.data.spot_size = math.radians(45); o.data.spot_blend = 0.8
o.rotation_euler = (math.radians(10), 0, 0)

bpy.ops.object.light_add(type='AREA', location=(0, -2.5, 3.5))
o = bpy.context.active_object; o.name = "PurpleRim"
o.data.energy = 80; o.data.color = (0.5, 0.25, 0.7); o.data.size = 4
o.rotation_euler = (math.radians(55), 0, 0)

bpy.ops.object.light_add(type='AREA', location=(0, 0, -0.3))
o = bpy.context.active_object; o.name = "Bounce"
o.data.energy = 60; o.data.color = (1.0, 0.55, 0.25); o.data.size = 5
o.rotation_euler = (math.pi, 0, 0)

# ── EXPORT GLB ───────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
glb = os.path.join(OUT, "sunset-balcony.glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB')
print(f"Exported: {glb}")
print("DONE!")
