import bpy, math, os, random

# ── Helpers ──────────────────────────────────────────────────────────────
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

def rbox(nm, loc, dim, mt, r=0.03, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.name = nm; o.scale = dim; o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new("B",'BEVEL'); bv.width = r; bv.segments = 3; bv.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="B")
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

# ── Clear ────────────────────────────────────────────────────────────────
clear_scene()

# ── Room dims ────────────────────────────────────────────────────────────
W, D, H = 4.5, 3.5, 2.6
cx, cy = 0, 0

# ── Materials ────────────────────────────────────────────────────────────
dark_wood    = mat("DarkWood",   (0.18, 0.11, 0.06, 1), 0.55)
med_wood     = mat("MedWood",    (0.32, 0.20, 0.10, 1), 0.6)
light_wood   = mat("LightWood",  (0.50, 0.35, 0.20, 1), 0.65)
tatami_mat   = mat("Tatami",     (0.55, 0.50, 0.30, 1), 0.85)
cream_wall   = mat("CreamWall",  (0.55, 0.45, 0.32, 1), 0.75)
dark_ceiling = mat("DarkCeil",   (0.12, 0.08, 0.04, 1), 0.7)
noren_red    = mat("NorenRed",   (0.55, 0.06, 0.04, 1), 0.8)
noren_indigo = mat("NorenIndigo",(0.06, 0.05, 0.18, 1), 0.8)
ceramic_w    = mat("CeramicW",   (0.82, 0.78, 0.70, 1), 0.35)
ceramic_g    = mat("CeramicG",   (0.12, 0.22, 0.12, 1), 0.35)
ceramic_blue = mat("CeramicBlue",(0.10, 0.12, 0.30, 1), 0.35)
sake_glass   = mat("SakeGlass",  (0.18, 0.32, 0.12, 1), 0.12, 0.0)
black_mat    = mat("Black",      (0.02, 0.02, 0.02, 1), 0.9)
bamboo_mat   = mat("Bamboo",     (0.45, 0.50, 0.22, 1), 0.55)
gold_mat     = mat("Gold",       (0.75, 0.55, 0.12, 1), 0.3, 0.8)
paper_mat    = mat("Paper",      (0.88, 0.82, 0.65, 1), 0.9)
rope_mat     = mat("Rope",       (0.35, 0.25, 0.12, 1), 0.85)
cushion_red  = mat("CushionRed", (0.40, 0.04, 0.04, 1), 0.8)
cushion_navy = mat("CushionNavy",(0.04, 0.04, 0.18, 1), 0.8)
barrel_mat   = mat("Barrel",     (0.28, 0.18, 0.08, 1), 0.65)
menu_board   = mat("MenuBoard",  (0.06, 0.04, 0.03, 1), 0.7)
chalk_mat    = mat("Chalk",      (0.88, 0.82, 0.65, 1), 0.9)
rug_mat      = mat("Rug",        (0.30, 0.06, 0.04, 1), 0.9)

# Lantern materials — MUCH brighter
lantern_emit_orange = emit_mat("LanternOrange", (1.0, 0.5, 0.1, 1), 25.0)
lantern_emit_red    = emit_mat("LanternRed",    (1.0, 0.2, 0.05, 1), 20.0)
lantern_emit_warm   = emit_mat("LanternWarm",   (1.0, 0.6, 0.2, 1), 22.0)
candle_emit         = emit_mat("CandleEmit",    (1.0, 0.65, 0.25, 1), 8.0)

# ── Room shell ───────────────────────────────────────────────────────────
# Floor
box("Floor", (cx, cy, 0), (W, D, 0.05), tatami_mat)
# Tatami grid lines
for i in range(6):
    x = -W/2 + 0.02 + i * (W/5)
    box(f"TatamiLX{i}", (x, cy, 0.026), (0.015, D-0.1, 0.002), dark_wood)
for j in range(5):
    y = -D/2 + 0.02 + j * (D/4)
    box(f"TatamiLY{j}", (cx, y, 0.026), (W-0.1, 0.015, 0.002), dark_wood)

# Walls
box("BackWall", (cx, -D/2, H/2), (W, 0.08, H), cream_wall)
box("LeftWall",  (-W/2, cy, H/2), (0.08, D, H), cream_wall)
box("RightWall", (W/2, cy, H/2),  (0.08, D, H), cream_wall)
# Front wall (partial, with opening)
box("FrontWallL", (-W/2 + 0.5, D/2, H/2), (1.0, 0.08, H), cream_wall)
box("FrontWallR", (W/2 - 0.5, D/2, H/2), (1.0, 0.08, H), cream_wall)
box("FrontWallTop", (cx, D/2, H - 0.3), (W - 2.0, 0.08, 0.6), cream_wall)

# Ceiling
box("Ceiling", (cx, cy, H), (W, D, 0.06), dark_ceiling)

# Dark wood wainscoting (lower 1m of walls)
wh = 1.0
box("WainBack",  (cx, -D/2+0.045, wh/2), (W-0.1, 0.02, wh), dark_wood)
box("WainLeft",  (-W/2+0.045, cy, wh/2),  (0.02, D-0.1, wh), dark_wood)
box("WainRight", (W/2-0.045, cy, wh/2),   (0.02, D-0.1, wh), dark_wood)
# Horizontal trim at wainscot top
box("TrimBack", (cx, -D/2+0.05, wh+0.02), (W-0.08, 0.03, 0.04), med_wood)
box("TrimLeft", (-W/2+0.05, cy, wh+0.02), (0.03, D-0.08, 0.04), med_wood)
box("TrimRight",(W/2-0.05, cy, wh+0.02),  (0.03, D-0.08, 0.04), med_wood)

# Ceiling beams (exposed dark wood)
for i in range(5):
    y = -D/2 + 0.3 + i * (D/4)
    box(f"CeilBeam{i}", (cx, y, H-0.06), (W, 0.08, 0.12), dark_wood)
for i in range(4):
    x = -W/2 + 0.6 + i * (W/3)
    box(f"CrossBeam{i}", (x, cy, H-0.06), (0.06, D, 0.1), dark_wood)

# ── Raised platform (booth area) ────────────────────────────────────────
plat_w, plat_d, plat_h = 3.2, 1.6, 0.1
plat_x, plat_y = 0, -D/2 + plat_d/2 + 0.15
box("Platform", (plat_x, plat_y, plat_h/2), (plat_w, plat_d, plat_h), med_wood)
box("PlatEdge", (plat_x, plat_y + plat_d/2, plat_h/2), (plat_w+0.02, 0.04, plat_h+0.01), dark_wood)

# ── Booth partitions (wooden, for intimacy) ─────────────────────────────
for side_x in [-plat_w/2 + 0.02, plat_w/2 - 0.02]:
    box(f"Partition_{side_x}", (side_x, plat_y, plat_h + 0.55), (0.04, plat_d - 0.1, 1.0), dark_wood)

# ── Low table ────────────────────────────────────────────────────────────
tbl_h = plat_h + 0.30
tbl_x, tbl_y = plat_x, plat_y + 0.05
rbox("TableTop", (tbl_x, tbl_y, tbl_h), (1.0, 0.55, 0.035), dark_wood, r=0.01)
for dx, dy in [(-0.40, -0.20), (0.40, -0.20), (-0.40, 0.20), (0.40, 0.20)]:
    rbox(f"TblLeg_{dx}_{dy}", (tbl_x+dx, tbl_y+dy, plat_h + 0.15), (0.035, 0.035, 0.26), dark_wood, r=0.005)

# ── Zabuton cushions ────────────────────────────────────────────────────
# Back (against wall) — 2 cushions
for i, dx in enumerate([-0.35, 0.35]):
    rbox(f"Zabuton_back{i}", (tbl_x+dx, plat_y - 0.35, plat_h + 0.035), (0.45, 0.45, 0.055), cushion_red, r=0.02)
    # Back rest cushion
    rbox(f"BackRest{i}", (tbl_x+dx, -D/2 + 0.18, plat_h + 0.28), (0.40, 0.07, 0.40), cushion_red, r=0.03)

# Front — 2 cushions
for i, dx in enumerate([-0.35, 0.35]):
    rbox(f"Zabuton_front{i}", (tbl_x+dx, plat_y + 0.48, plat_h + 0.035), (0.45, 0.45, 0.055), cushion_navy, r=0.02)

# ── Rug under table ─────────────────────────────────────────────────────
box("Rug", (tbl_x, tbl_y, plat_h + 0.005), (1.3, 0.95, 0.008), rug_mat)

# ══════════════════════════════════════════════════════════════════════════
# ── PAPER LANTERNS (HERO) — bigger, brighter, with visible string ────────
# ══════════════════════════════════════════════════════════════════════════
lantern_data = [
    # (x, y, z, material, point_energy, radius, squash)
    # Main trio above table
    (tbl_x - 0.45, tbl_y, H - 0.55, lantern_emit_orange, 200, 0.18, 1.5),
    (tbl_x + 0.45, tbl_y, H - 0.55, lantern_emit_red,    180, 0.18, 1.5),
    (tbl_x,        tbl_y, H - 0.40, lantern_emit_warm,    250, 0.22, 1.4),
    # Side lanterns
    (-W/2 + 0.5, D/2 - 0.5, H - 0.55, lantern_emit_orange, 100, 0.14, 1.4),
    (W/2 - 0.5,  D/2 - 0.5, H - 0.55, lantern_emit_red,    100, 0.14, 1.4),
    # Back corners
    (-W/2 + 0.5, -D/2 + 0.5, H - 0.50, lantern_emit_warm, 80, 0.12, 1.3),
    (W/2 - 0.5,  -D/2 + 0.5, H - 0.50, lantern_emit_orange, 80, 0.12, 1.3),
]

for idx, (lx, ly, lz, lmat, energy, rad, squash) in enumerate(lantern_data):
    # Lantern body (oblate sphere — paper lantern shape)
    sphere(f"Lantern{idx}", (lx, ly, lz), rad, lmat, sc=(1, 1, squash))
    # Wire frame rings (dark)
    for ring_z in [-0.6, -0.2, 0.2, 0.6]:
        rz = lz + ring_z * rad * squash
        r_ring = rad * (1.0 - abs(ring_z) * 0.3)
        cyl(f"LRing{idx}_{ring_z}", (lx, ly, rz), r_ring + 0.003, 0.003, black_mat)
    # Top cap
    cyl(f"LCap{idx}", (lx, ly, lz + rad*squash + 0.02), 0.04, 0.025, dark_wood)
    # Bottom cap
    cyl(f"LBot{idx}", (lx, ly, lz - rad*squash - 0.01), 0.025, 0.015, dark_wood)
    # Hanging string to ceiling
    string_h = H - (lz + rad*squash + 0.03)
    cyl(f"LString{idx}", (lx, ly, lz + rad*squash + 0.03 + string_h/2), 0.005, string_h, rope_mat)
    
    # POINT light inside — warm amber
    bpy.ops.object.light_add(type='POINT', location=(lx, ly, lz))
    lt = bpy.context.active_object
    lt.name = f"LanternPt{idx}"
    lt.data.energy = energy
    lt.data.color = (1.0, 0.55, 0.18)
    lt.data.shadow_soft_size = 0.2

# Main SPOT light from center lantern → table
bpy.ops.object.light_add(type='SPOT', location=(tbl_x, tbl_y, H - 0.35))
spot = bpy.context.active_object
spot.name = "TableSpot"
spot.data.energy = 150
spot.data.color = (1.0, 0.55, 0.2)
spot.data.spot_size = math.radians(55)
spot.data.spot_blend = 0.7
spot.data.shadow_soft_size = 0.25
spot.rotation_euler = (0, 0, 0)

# ── Table items ──────────────────────────────────────────────────────────
# Tokkuri (sake flask)
cyl("Tokkuri1", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.08), 0.028, 0.14, ceramic_w)
sphere("TokkuriBulb", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.04), 0.032, ceramic_w, sc=(1,1,0.7))
cyl("TokkuriNeck", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.17), 0.013, 0.04, ceramic_w)

# Second tokkuri
cyl("Tokkuri2", (tbl_x + 0.2, tbl_y + 0.12, tbl_h + 0.07), 0.025, 0.12, ceramic_blue)
cyl("Tokkuri2Neck", (tbl_x + 0.2, tbl_y + 0.12, tbl_h + 0.15), 0.012, 0.035, ceramic_blue)

# Ochoko (sake cups)
for i, (dx, dy) in enumerate([(0.08, -0.14), (0.18, 0.08), (-0.28, 0.1), (-0.15, 0.18)]):
    cyl(f"Ochoko{i}", (tbl_x+dx, tbl_y+dy, tbl_h + 0.02), 0.018, 0.035, ceramic_w if i%2==0 else ceramic_blue)

# Small dishes with food
for i, (dx, dy, m) in enumerate([(-0.04, 0.12, ceramic_g), (0.22, -0.06, ceramic_w), (-0.32, -0.05, ceramic_blue)]):
    cyl(f"Dish{i}", (tbl_x+dx, tbl_y+dy, tbl_h + 0.01), 0.05, 0.012, m)

# Green sake bottle
cyl("SakeBottle", (tbl_x + 0.32, tbl_y + 0.02, tbl_h + 0.11), 0.022, 0.20, sake_glass)
cyl("SakeBottleCap", (tbl_x + 0.32, tbl_y + 0.02, tbl_h + 0.22), 0.012, 0.018, gold_mat)

# Candle
cyl("CandleHolder", (tbl_x, tbl_y + 0.15, tbl_h + 0.015), 0.03, 0.02, ceramic_w)
cyl("CandleWax", (tbl_x, tbl_y + 0.15, tbl_h + 0.035), 0.012, 0.025, ceramic_w)
sphere("CandleFlame", (tbl_x, tbl_y + 0.15, tbl_h + 0.055), 0.01, candle_emit, sc=(1,1,1.8))
bpy.ops.object.light_add(type='POINT', location=(tbl_x, tbl_y + 0.15, tbl_h + 0.07))
cl = bpy.context.active_object; cl.name = "CandleLt"
cl.data.energy = 20; cl.data.color = (1.0, 0.65, 0.25); cl.data.shadow_soft_size = 0.05

# ── Noren curtain (entrance/front) ──────────────────────────────────────
noren_y = D/2 - 0.04
noren_z_top = H - 0.15
cyl("NorenBar", (0, noren_y, noren_z_top), 0.018, 2.4, dark_wood, rot=(0, math.pi/2, 0))
# 5 hanging strips
for i in range(5):
    x = -1.0 + i * 0.5
    strip_h = 1.0 + random.uniform(-0.05, 0.05)
    m = noren_indigo if i % 2 == 0 else noren_red
    box(f"NorenS{i}", (x, noren_y - 0.02, noren_z_top - strip_h/2 - 0.05), (0.015, 0.22, strip_h), m,
        rot=(0, 0, random.uniform(-0.03, 0.03)))

# ── Side noren (left wall, small decorative) ─────────────────────────────
cyl("NorenBar2", (-W/2 + 0.06, 0.3, H - 0.35), 0.012, 0.6, dark_wood, rot=(math.pi/2, 0, 0))
for i in range(3):
    y = 0.1 + i * 0.2
    box(f"NorenS2_{i}", (-W/2 + 0.07, y, H - 0.35 - 0.35), (0.01, 0.14, 0.6), noren_red)

# ── Menu board (back wall) ──────────────────────────────────────────────
mb_x = 1.3
rbox("MenuBoard", (mb_x, -D/2 + 0.06, 1.55), (0.5, 0.03, 0.65), menu_board, r=0.01)
box("MBFrameT", (mb_x, -D/2+0.065, 1.88), (0.54, 0.012, 0.025), med_wood)
box("MBFrameB", (mb_x, -D/2+0.065, 1.22), (0.54, 0.012, 0.025), med_wood)
box("MBFrameL", (mb_x-0.27, -D/2+0.065, 1.55), (0.025, 0.012, 0.65), med_wood)
box("MBFrameR", (mb_x+0.27, -D/2+0.065, 1.55), (0.025, 0.012, 0.65), med_wood)
# Chalk lines
for i in range(7):
    w = 0.15 + random.uniform(0, 0.15)
    box(f"Chalk{i}", (mb_x + random.uniform(-0.05, 0.02), -D/2 + 0.075, 1.82 - i*0.08),
        (w, 0.003, 0.012), chalk_mat)

# Small light for menu board
bpy.ops.object.light_add(type='SPOT', location=(mb_x, -D/2 + 0.3, 2.0))
mbl = bpy.context.active_object; mbl.name = "MenuSpot"
mbl.data.energy = 25; mbl.data.color = (1.0, 0.7, 0.3)
mbl.data.spot_size = math.radians(40); mbl.data.spot_blend = 0.8
mbl.rotation_euler = (math.radians(15), 0, 0)

# ── Shoji screen (back wall, left) ──────────────────────────────────────
shoji_x = -1.3
rbox("ShojiFrame", (shoji_x, -D/2 + 0.06, 1.7), (0.75, 0.025, 1.1), dark_wood, r=0.005)
box("ShojiPaper", (shoji_x, -D/2 + 0.065, 1.7), (0.68, 0.008, 1.0), paper_mat)
for i in range(3):
    box(f"ShojiV{i}", (shoji_x - 0.22 + i*0.22, -D/2 + 0.07, 1.7), (0.008, 0.005, 1.0), dark_wood)
for j in range(4):
    box(f"ShojiH{j}", (shoji_x, -D/2 + 0.07, 1.3 + j*0.27), (0.68, 0.005, 0.008), dark_wood)
# Backlight shoji slightly
bpy.ops.object.light_add(type='POINT', location=(shoji_x, -D/2 - 0.1, 1.7))
sjl = bpy.context.active_object; sjl.name = "ShojiGlow"
sjl.data.energy = 15; sjl.data.color = (1.0, 0.8, 0.5); sjl.data.shadow_soft_size = 0.3

# ── Sake barrel (front-left corner) ─────────────────────────────────────
bx, by = -W/2 + 0.4, D/2 - 0.4
cyl("Barrel", (bx, by, 0.28), 0.22, 0.50, barrel_mat)
for z in [0.08, 0.28, 0.48]:
    cyl(f"BBand_{z}", (bx, by, z), 0.23, 0.018, black_mat)
cyl("BarrelLid", (bx, by, 0.54), 0.22, 0.02, med_wood)
box("BarrelLabel", (bx + 0.225, by, 0.28), (0.005, 0.12, 0.18), paper_mat)

# ── Maneki-neko (on shelf, right wall) ──────────────────────────────────
nx, ny = W/2 - 0.06, -D/2 + 0.6
rbox("NekoShelf", (nx, ny, 1.35), (0.06, 0.3, 0.025), dark_wood, r=0.005)
sphere("NekoBody", (nx - 0.01, ny, 1.44), 0.055, ceramic_w, sc=(1, 0.85, 1.15))
sphere("NekoHead", (nx - 0.01, ny + 0.01, 1.53), 0.045, ceramic_w)
box("NekoEarL", (nx - 0.04, ny + 0.01, 1.57), (0.018, 0.012, 0.022), ceramic_w)
box("NekoEarR", (nx + 0.02, ny + 0.01, 1.57), (0.018, 0.012, 0.022), ceramic_w)
box("NekoPaw", (nx + 0.04, ny + 0.025, 1.49), (0.018, 0.018, 0.07), ceramic_w)
cyl("NekoCollar", (nx - 0.01, ny + 0.005, 1.49), 0.035, 0.008, gold_mat)

# ── Bamboo (right-front corner) ─────────────────────────────────────────
bam_x, bam_y = W/2 - 0.25, D/2 - 0.3
for i in range(3):
    h = 1.4 + i * 0.35
    dx = (i - 1) * 0.07
    cyl(f"Bamboo{i}", (bam_x + dx, bam_y, h/2), 0.022, h, bamboo_mat)
    for j in range(int(h / 0.28)):
        cyl(f"BNode{i}_{j}", (bam_x + dx, bam_y, 0.12 + j*0.28), 0.025, 0.012, bamboo_mat)

# ── Small wall shelf (left wall, with bottles) ──────────────────────────
sx, sy = -W/2 + 0.06, -0.3
rbox("WShelf", (sx, sy, 1.3), (0.06, 0.5, 0.025), dark_wood, r=0.005)
for i, dy in enumerate([-0.15, 0, 0.15]):
    h = 0.10 + random.uniform(0, 0.06)
    m = [sake_glass, ceramic_g, ceramic_blue][i]
    cyl(f"ShelfItem{i}", (sx + 0.01, sy + dy, 1.33 + h/2), 0.02, h, m)

# ── Additional wall details: wooden slat accent ─────────────────────────
for i in range(8):
    x = -W/2 + 0.5 + i * 0.5
    if abs(x - shoji_x) > 0.5 and abs(x - mb_x) > 0.4:
        box(f"WSlat{i}", (x, -D/2 + 0.05, 1.7), (0.06, 0.015, 0.8), dark_wood)

# ── World ────────────────────────────────────────────────────────────────
world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
bpy.context.scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (0.02, 0.015, 0.01, 1)
    bg.inputs["Strength"].default_value = 0.03

# ── Render ───────────────────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.image_settings.file_format = 'PNG'

prefs = bpy.context.preferences.addons.get('cycles')
if prefs:
    prefs.preferences.compute_device_type = 'METAL'
    prefs.preferences.get_devices()
    for d in prefs.preferences.devices:
        d.use = True

out_dir = "/tmp/blender-room"
os.makedirs(out_dir, exist_ok=True)

cameras = [
    # Main date POV: sitting at front cushion looking at partner across table, lanterns above
    ("main_date_pov", (0, 1.6, 0.7), (math.radians(80), 0, math.radians(180))),
    # Booth detail: side angle showing depth, partitions, cushions
    ("booth_detail",  (-1.5, 0.3, 0.65), (math.radians(80), 0, math.radians(235))),
    # Lantern + table: showing lanterns hanging with table below
    ("lantern_closeup", (0.8, 0.8, 1.8), (math.radians(45), 0, math.radians(160))),
    # Wide: full room from entrance area
    ("wide_angle",    (0, 2.5, 1.6), (math.radians(55), 0, math.radians(180))),
]

for cam_name, loc, rot in cameras:
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.active_object
    cam.name = cam_name
    cam.rotation_euler = rot
    cam.data.lens = 24 if cam_name == "wide_angle" else 32
    
    scene.camera = cam
    scene.render.filepath = os.path.join(out_dir, f"izakaya_{cam_name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {scene.render.filepath}")

# ── GLB export ───────────────────────────────────────────────────────────
glb_path = os.path.join(out_dir, "izakaya.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
print(f"Exported GLB: {glb_path}")

import shutil
dest = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/scenes/izakaya.glb"
shutil.copy2(glb_path, dest)
print(f"Copied to: {dest}")
print("DONE")
