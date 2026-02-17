import bpy, math, random

# ── Helpers ──────────────────────────────────────────────────────────────
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes:
        if b.users == 0:
            bpy.data.meshes.remove(b)
    for b in bpy.data.materials:
        if b.users == 0:
            bpy.data.materials.remove(b)

def emit_mat(name, color, strength=5.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes; links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial')
    em = nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m

def box(nm, loc, dim, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.scale = dim
    o.rotation_euler = rot
    if mt:
        o.data.materials.append(mt)
    return o

def cyl(nm, loc, rad, dep, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=dep, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = nm
    if mt:
        o.data.materials.append(mt)
    return o

def sphere(nm, loc, rad, mt, sc=(1,1,1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = nm
    o.scale = sc
    if mt:
        o.data.materials.append(mt)
    return o

# ── Scene setup ──────────────────────────────────────────────────────────
clear_scene()
random.seed(7)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'

# ── Dimensions ───────────────────────────────────────────────────────────
W, D, H = 5.2, 3.6, 2.6

# ── Materials (Emission Only) ────────────────────────────────────────────
# Floor tiles 8-10
floor_a = emit_mat('FloorA', (0.55, 0.32, 0.18, 1), 9.0)
floor_b = emit_mat('FloorB', (0.45, 0.26, 0.14, 1), 8.5)
# Railing / furniture 10-14
rail_white = emit_mat('RailWhite', (0.95, 0.92, 0.88, 1), 12.5)
wood_warm = emit_mat('WoodWarm', (0.55, 0.32, 0.16, 1), 12.0)
metal_dark = emit_mat('MetalDark', (0.20, 0.20, 0.22, 1), 10.5)
# Wall/interior 8-10
wall_cream = emit_mat('WallCream', (0.85, 0.76, 0.62, 1), 9.0)
interior_glow = emit_mat('InteriorGlow', (1.0, 0.72, 0.38, 1), 28.0)
# Plants 8-10
leaf_green = emit_mat('LeafGreen', (0.25, 0.60, 0.25, 1), 9.0)
pot_terra = emit_mat('PotTerra', (0.55, 0.32, 0.18, 1), 9.5)
# String lights bulbs 45-55
bulb_gold = emit_mat('BulbGold', (1.0, 0.88, 0.55, 1), 50.0)
wire_dark = emit_mat('WireDark', (0.08, 0.08, 0.08, 1), 10.0)
# Sky gradient 6-12
sky_orange = emit_mat('SkyOrange', (1.0, 0.50, 0.15, 1), 12.0)
sky_peach  = emit_mat('SkyPeach',  (1.0, 0.65, 0.40, 1), 10.0)
sky_pink   = emit_mat('SkyPink',   (0.90, 0.50, 0.60, 1), 9.0)
sky_purple = emit_mat('SkyPurple', (0.50, 0.30, 0.50, 1), 8.0)
sky_dark   = emit_mat('SkyDark',   (0.15, 0.10, 0.20, 1), 6.5)
# City windows 25-30
window_glow = emit_mat('WindowGlow', (1.0, 0.72, 0.38, 1), 28.0)
building_dark = emit_mat('BuildingDark', (0.10, 0.10, 0.12, 1), 8.0)
# Moon & stars
moon_glow = emit_mat('MoonGlow', (1.0, 0.97, 0.85, 1), 46.0)
star_glow = emit_mat('StarGlow', (1.0, 0.95, 0.85, 1), 15.0)
# Table setting 10-14
plate_white = emit_mat('PlateWhite', (0.95, 0.92, 0.88, 1), 12.0)
cloth_red = emit_mat('ClothRed', (0.55, 0.12, 0.12, 1), 10.0)
candle_emit = emit_mat('CandleEmit', (1.0, 0.75, 0.35, 1), 35.0)
glass_teal = emit_mat('GlassTeal', (0.60, 0.85, 0.85, 1), 12.0)

# ── Floor (terracotta tiles) ─────────────────────────────────────────────
box('FloorBase', (0, 0, -0.05), (W/2, D/2, 0.05), floor_b)
# Checkerboard tiles
rows, cols = 10, 12
start_x = -W/2 + 0.25
start_y = -D/2 + 0.25
step_x = (W - 0.5) / cols
step_y = (D - 0.5) / rows
for r in range(rows):
    for c in range(cols):
        x = start_x + c * step_x
        y = start_y + r * step_y
        m = floor_a if (r + c) % 2 == 0 else floor_b
        box(f'Tile_{r}_{c}', (x, y, 0.01), (step_x*0.45, step_y*0.45, 0.02), m)

# ── Railing ──────────────────────────────────────────────────────────────
rail_y = -D/2 + 0.05
box('RailBase', (0, rail_y, 0.45), (W/2, 0.04, 0.06), rail_white)
box('RailTop', (0, rail_y, 1.05), (W/2, 0.06, 0.05), rail_white)
# Posts
for i in range(-5, 6):
    px = i * (W/10)
    box(f'RailPost_{i}', (px, rail_y, 0.75), (0.05, 0.05, 0.35), rail_white)
# Side rails
box('RailSideL', (-W/2+0.05, 0, 0.85), (0.04, D/2, 0.06), rail_white)
box('RailSideR', (W/2-0.05, 0, 0.85), (0.04, D/2, 0.06), rail_white)

# ── Back wall + interior door glow ───────────────────────────────────────
box('BackWall', (0, D/2-0.02, 1.2), (W/2, 0.04, 1.2), wall_cream)
# Sliding door frame
box('DoorFrame', (0, D/2-0.04, 1.1), (1.2, 0.02, 1.0), wall_cream)
box('DoorGlow', (0, D/2-0.06, 1.1), (1.0, 0.01, 0.9), interior_glow)

# ── Bistro table & chairs ────────────────────────────────────────────────
# Table
box('TableTop', (0.9, 0.4, 0.72), (0.45, 0.35, 0.03), wood_warm)
box('TableLeg', (0.9, 0.4, 0.35), (0.05, 0.05, 0.35), wood_warm)
box('TableBase', (0.9, 0.4, 0.05), (0.18, 0.18, 0.03), metal_dark)
# Chairs
for i, cx in enumerate([0.35, 1.45]):
    box(f'ChairSeat_{i}', (cx, 0.1, 0.45), (0.25, 0.25, 0.04), wood_warm)
    box(f'ChairBack_{i}', (cx, 0.02, 0.70), (0.25, 0.04, 0.30), wood_warm)
    for dx, dy in [(-0.10,-0.10), (0.10,-0.10), (-0.10,0.10), (0.10,0.10)]:
        box(f'ChairLeg_{i}_{dx}_{dy}', (cx+dx, 0.1+dy, 0.22), (0.03, 0.03, 0.22), metal_dark)
    box(f'ChairCushion_{i}', (cx, 0.1, 0.50), (0.22, 0.22, 0.03), cloth_red)

# Table setting
box('Plate', (0.9, 0.45, 0.76), (0.18, 0.18, 0.01), plate_white)
box('Napkin', (1.05, 0.30, 0.75), (0.12, 0.08, 0.01), cloth_red)
sphere('WineGlass', (0.75, 0.38, 0.82), 0.06, glass_teal, sc=(1,1,1.3))
box('CandleBase', (0.95, 0.55, 0.76), (0.05, 0.05, 0.02), wood_warm)
sphere('CandleFlame', (0.95, 0.55, 0.82), 0.03, candle_emit, sc=(1,1,1.5))

# ── Plants ───────────────────────────────────────────────────────────────
for i, (px, py) in enumerate([(-1.6, 0.4), (-2.0, -0.8), (1.8, -0.6)]):
    cyl(f'Pot_{i}', (px, py, 0.2), 0.18, 0.35, pot_terra)
    for j in range(5):
        lx = px + random.uniform(-0.12, 0.12)
        ly = py + random.uniform(-0.12, 0.12)
        sphere(f'Leaf_{i}_{j}', (lx, ly, 0.55+random.uniform(0,0.2)), 0.12, leaf_green, sc=(1,1,1.2))

# ── String lights (hero) ────────────────────────────────────────────────
wire_y = 0.2
wire_z = 2.35
box('Wire', (0, wire_y, wire_z), (W/2, 0.01, 0.01), wire_dark)
# 10 bulbs across
for i in range(10):
    x = -W/2 + 0.35 + i * (W-0.7) / 9
    sphere(f'Bulb_{i}', (x, wire_y, wire_z), 0.06, bulb_gold)

# ── Sky gradient ─────────────────────────────────────────────────────────
sky_z = 1.3
strip_h = 0.9
sky_y = -D/2 - 0.8
box('SkyStrip0', (0, sky_y, sky_z - 1.8), (W*1.2, 0.02, strip_h), sky_orange)
box('SkyStrip1', (0, sky_y, sky_z - 0.9), (W*1.2, 0.02, strip_h), sky_peach)
box('SkyStrip2', (0, sky_y, sky_z + 0.0), (W*1.2, 0.02, strip_h), sky_pink)
box('SkyStrip3', (0, sky_y, sky_z + 0.9), (W*1.2, 0.02, strip_h), sky_purple)
box('SkyStrip4', (0, sky_y, sky_z + 1.8), (W*1.2, 0.02, strip_h), sky_dark)

# ── City skyline ─────────────────────────────────────────────────────────
city_y = -D/2 - 0.2
for i in range(6):
    bw = random.uniform(0.4, 0.7)
    bh = random.uniform(0.6, 1.4)
    bx = -2.5 + i * 0.9
    box(f'Building_{i}', (bx, city_y, bh/2), (bw, 0.2, bh), building_dark)
    # Windows
    for w in range(3):
        wx = bx + random.uniform(-bw*0.3, bw*0.3)
        wz = random.uniform(0.3, bh-0.2)
        box(f'Win_{i}_{w}', (wx, city_y+0.12, wz), (0.06, 0.01, 0.08), window_glow)

# ── Moon & stars ─────────────────────────────────────────────────────────
sphere('Moon', (-2.0, sky_y-0.1, 2.6), 0.18, moon_glow)
for i in range(18):
    sx = random.uniform(-2.8, 2.8)
    sy = sky_y - 0.15
    sz = random.uniform(2.0, 3.2)
    sphere(f'Star_{i}', (sx, sy, sz), 0.03, star_glow)

# ── Export GLB ───────────────────────────────────────────────────────────
glb_path = '/tmp/sunset-balcony.glb'
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
print(f'Exported GLB: {glb_path}')
