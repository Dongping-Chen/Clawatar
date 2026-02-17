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

def torus(nm, loc, major, minor, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = nm
    if mt: o.data.materials.append(mt)
    return o

def vary_color(col, v=0.05):
    return (
        max(0, min(1, col[0] + random.uniform(-v, v))),
        max(0, min(1, col[1] + random.uniform(-v, v))),
        max(0, min(1, col[2] + random.uniform(-v, v))),
        1
    )

# ── Clear + render settings ──────────────────────────────────────────────
clear_scene()
random.seed(7)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'

# ── Room dims ────────────────────────────────────────────────────────────
W, D, H = 4.5, 3.5, 2.6
cx, cy = 0, 0

# ── Materials ────────────────────────────────────────────────────────────
dark_wood    = mat("DarkWood",   (0.18, 0.11, 0.06, 1), 0.55)
med_wood     = mat("MedWood",    (0.32, 0.20, 0.10, 1), 0.6)
light_wood   = mat("LightWood",  (0.48, 0.32, 0.17, 1), 0.65)
floor_dark   = mat("FloorDark",  (0.14, 0.09, 0.05, 1), 0.65)
floor_light  = mat("FloorLight", (0.23, 0.14, 0.07, 1), 0.65)
floor_gap    = mat("FloorGap",   (0.06, 0.04, 0.02, 1), 0.85)
cream_wall   = mat("CreamWall",  (0.55, 0.45, 0.32, 1), 0.75)
dark_ceiling = mat("DarkCeil",   (0.12, 0.08, 0.04, 1), 0.7)
beam_wood    = mat("BeamWood",   (0.10, 0.06, 0.03, 1), 0.65)
# Emissive variants for floor + ceiling beams
floor_dark_emit  = emit_mat("FloorDarkEmit",  (0.14, 0.09, 0.05, 1), 3.2)
floor_light_emit = emit_mat("FloorLightEmit", (0.23, 0.14, 0.07, 1), 3.2)
floor_gap_emit   = emit_mat("FloorGapEmit",   (0.06, 0.04, 0.02, 1), 3.0)
beam_emit        = emit_mat("BeamEmit",       (0.10, 0.06, 0.03, 1), 3.3)

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
label_white  = mat("LabelWhite", (0.92, 0.88, 0.78, 1), 0.9)
label_red    = mat("LabelRed",   (0.70, 0.12, 0.10, 1), 0.85)
label_blue   = mat("LabelBlue",  (0.20, 0.25, 0.55, 1), 0.85)
label_gold   = mat("LabelGold",  (0.85, 0.75, 0.30, 1), 0.4, 0.1)

beer_glass   = mat("BeerGlass",  (0.85, 0.80, 0.65, 1), 0.15, 0.0)
liquid_amber = mat("AmberLiquid",(0.85, 0.55, 0.15, 1), 0.18, 0.0)
clear_glass  = mat("ClearGlass", (0.92, 0.92, 0.92, 1), 0.12, 0.0)
glass_green  = mat("GlassGreen", (0.10, 0.30, 0.12, 1), 0.12, 0.0)
glass_brown  = mat("GlassBrown", (0.25, 0.14, 0.06, 1), 0.12, 0.0)
glass_blue   = mat("GlassBlue",  (0.10, 0.20, 0.45, 1), 0.12, 0.0)
stool_metal  = mat("StoolMetal", (0.18, 0.18, 0.20, 1), 0.35, 0.7)
cloth_mat    = mat("Cloth",      (0.85, 0.82, 0.75, 1), 0.9)
condiment_red= mat("CondimentRed", (0.60, 0.10, 0.10, 1), 0.7)

amber_emit   = emit_mat("AmberEmit", (1.0, 0.6, 0.2, 1), 6.0)
menu_text_emit = emit_mat("MenuText", (1.0, 0.9, 0.7, 1), 6.0)

# Lantern materials — HERO (25-30)
lantern_emit_orange = emit_mat("LanternOrange", (1.0, 0.5, 0.1, 1), 28.0)
lantern_emit_red    = emit_mat("LanternRed",    (1.0, 0.2, 0.05, 1), 27.0)
lantern_emit_warm   = emit_mat("LanternWarm",   (1.0, 0.6, 0.2, 1), 30.0)
candle_emit         = emit_mat("CandleEmit",    (1.0, 0.65, 0.25, 1), 8.0)

# ── Floor (warm wood plank pattern) ──────────────────────────────────────
box("FloorBase", (cx, cy, 0), (W, D, 0.05), floor_gap_emit)
plank_w = 0.26
gap = 0.02
count = int((W - 0.2) / (plank_w + gap))
start_x = -W/2 + 0.1 + plank_w/2
for i in range(count):
    x = start_x + i * (plank_w + gap)
    m = floor_dark_emit if i % 2 == 0 else floor_light_emit
    box(f"Plank{i}", (x, cy, 0.012), (plank_w, D-0.12, 0.04), m)

# ── Walls ────────────────────────────────────────────────────────────────
box("BackWall", (cx, -D/2, H/2), (W, 0.08, H), cream_wall)
box("LeftWall",  (-W/2, cy, H/2), (0.08, D, H), cream_wall)
box("RightWall", (W/2, cy, H/2),  (0.08, D, H), cream_wall)
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
for i in range(4):
    x = -W/2 + 0.7 + i * (W/3)
    box(f"CeilBeamX{i}", (x, cy, H-0.06), (0.08, D, 0.12), beam_emit)
for i in range(3):
    y = -D/2 + 0.5 + i * (D/2)
    box(f"CeilBeamY{i}", (cx, y, H-0.06), (W, 0.08, 0.10), beam_emit)

# ── Raised platform (booth area) ────────────────────────────────────────
plat_w, plat_d, plat_h = 3.2, 1.6, 0.1
plat_x, plat_y = 0, -D/2 + plat_d/2 + 0.15
box("Platform", (plat_x, plat_y, plat_h/2), (plat_w, plat_d, plat_h), med_wood)
box("PlatEdge", (plat_x, plat_y + plat_d/2, plat_h/2), (plat_w+0.02, 0.04, plat_h+0.01), dark_wood)

# Booth partitions
for side_x in [-plat_w/2 + 0.02, plat_w/2 - 0.02]:
    box(f"Partition_{side_x}", (side_x, plat_y, plat_h + 0.55), (0.04, plat_d - 0.1, 1.0), dark_wood)

# ── Low table ────────────────────────────────────────────────────────────
tbl_h = plat_h + 0.30
tbl_x, tbl_y = plat_x, plat_y + 0.05
rbox("TableTop", (tbl_x, tbl_y, tbl_h), (1.0, 0.55, 0.035), dark_wood, r=0.01)
for dx, dy in [(-0.40, -0.20), (0.40, -0.20), (-0.40, 0.20), (0.40, 0.20)]:
    rbox(f"TblLeg_{dx}_{dy}", (tbl_x+dx, tbl_y+dy, plat_h + 0.15), (0.035, 0.035, 0.26), dark_wood, r=0.005)

# Zabuton cushions
for i, dx in enumerate([-0.35, 0.35]):
    rbox(f"Zabuton_back{i}", (tbl_x+dx, plat_y - 0.35, plat_h + 0.035), (0.45, 0.45, 0.055), cushion_red, r=0.02)
    rbox(f"BackRest{i}", (tbl_x+dx, -D/2 + 0.18, plat_h + 0.28), (0.40, 0.07, 0.40), cushion_red, r=0.03)
for i, dx in enumerate([-0.35, 0.35]):
    rbox(f"Zabuton_front{i}", (tbl_x+dx, plat_y + 0.48, plat_h + 0.035), (0.45, 0.45, 0.055), cushion_navy, r=0.02)

# Rug under table
box("Rug", (tbl_x, tbl_y, plat_h + 0.005), (1.3, 0.95, 0.008), rug_mat)

# ── Paper lanterns (HERO) ────────────────────────────────────────────────
lantern_data = [
    (tbl_x - 0.45, tbl_y, H - 0.55, lantern_emit_orange, 260, 0.22, 1.5),
    (tbl_x + 0.45, tbl_y, H - 0.55, lantern_emit_red,    250, 0.22, 1.5),
    (tbl_x,        tbl_y, H - 0.40, lantern_emit_warm,    290, 0.24, 1.4),
    (-W/2 + 0.7,   D/2 - 0.7, H - 0.55, lantern_emit_orange, 190, 0.18, 1.4),
    (W/2 - 0.7,    D/2 - 0.7, H - 0.55, lantern_emit_red,    190, 0.18, 1.4),
]

for idx, (lx, ly, lz, lmat, energy, rad, squash) in enumerate(lantern_data):
    sphere(f"Lantern{idx}", (lx, ly, lz), rad, lmat, sc=(1, 1, squash))
    for ring_z in [-0.6, -0.2, 0.2, 0.6]:
        rz = lz + ring_z * rad * squash
        r_ring = rad * (1.0 - abs(ring_z) * 0.3)
        cyl(f"LRing{idx}_{ring_z}", (lx, ly, rz), r_ring + 0.003, 0.003, black_mat)
    cyl(f"LCap{idx}", (lx, ly, lz + rad*squash + 0.02), 0.04, 0.025, dark_wood)
    cyl(f"LBot{idx}", (lx, ly, lz - rad*squash - 0.01), 0.025, 0.015, dark_wood)
    string_h = H - (lz + rad*squash + 0.03)
    cyl(f"LString{idx}", (lx, ly, lz + rad*squash + 0.03 + string_h/2), 0.005, string_h, rope_mat)
    bpy.ops.object.light_add(type='POINT', location=(lx, ly, lz))
    lt = bpy.context.active_object
    lt.name = f"LanternPt{idx}"
    lt.data.energy = energy
    lt.data.color = (1.0, 0.55, 0.18)
    lt.data.shadow_soft_size = 0.25

# Main SPOT light from center lantern → table
bpy.ops.object.light_add(type='SPOT', location=(tbl_x, tbl_y, H - 0.35))
spot = bpy.context.active_object
spot.name = "TableSpot"
spot.data.energy = 160
spot.data.color = (1.0, 0.55, 0.2)
spot.data.spot_size = math.radians(55)
spot.data.spot_blend = 0.7
spot.data.shadow_soft_size = 0.25
spot.rotation_euler = (0, 0, 0)

# ── Table items (larger) ────────────────────────────────────────────────
# Tokkuri (sake flask)
cyl("Tokkuri1", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.10), 0.035, 0.18, ceramic_w)
sphere("TokkuriBulb", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.05), 0.04, ceramic_w, sc=(1,1,0.7))
cyl("TokkuriNeck", (tbl_x - 0.12, tbl_y - 0.08, tbl_h + 0.20), 0.015, 0.05, ceramic_w)

# Second tokkuri
cyl("Tokkuri2", (tbl_x + 0.2, tbl_y + 0.12, tbl_h + 0.09), 0.032, 0.16, ceramic_blue)
cyl("Tokkuri2Neck", (tbl_x + 0.2, tbl_y + 0.12, tbl_h + 0.19), 0.014, 0.05, ceramic_blue)

# Ochoko (sake cups)
for i, (dx, dy) in enumerate([(0.08, -0.14), (0.18, 0.08), (-0.28, 0.1), (-0.15, 0.18)]):
    cyl(f"Ochoko{i}", (tbl_x+dx, tbl_y+dy, tbl_h + 0.03), 0.028, 0.05, ceramic_w if i%2==0 else ceramic_blue)

# Larger dishes with food
for i, (dx, dy, m) in enumerate([(-0.04, 0.12, ceramic_g), (0.22, -0.06, ceramic_w), (-0.32, -0.05, ceramic_blue)]):
    cyl(f"Dish{i}", (tbl_x+dx, tbl_y+dy, tbl_h + 0.015), 0.08, 0.018, m)
    for j in range(4):
        fx = dx + random.uniform(-0.03, 0.03)
        fy = dy + random.uniform(-0.03, 0.03)
        sphere(f"Food{i}_{j}", (tbl_x+fx, tbl_y+fy, tbl_h + 0.035), 0.018, ceramic_w, sc=(1,1,0.6))

# Candle
cyl("CandleHolder", (tbl_x, tbl_y + 0.15, tbl_h + 0.02), 0.035, 0.025, ceramic_w)
cyl("CandleWax", (tbl_x, tbl_y + 0.15, tbl_h + 0.045), 0.014, 0.03, ceramic_w)
sphere("CandleFlame", (tbl_x, tbl_y + 0.15, tbl_h + 0.065), 0.012, candle_emit, sc=(1,1,1.8))
bpy.ops.object.light_add(type='POINT', location=(tbl_x, tbl_y + 0.15, tbl_h + 0.08))
cl = bpy.context.active_object; cl.name = "CandleLt"
cl.data.energy = 25; cl.data.color = (1.0, 0.65, 0.25); cl.data.shadow_soft_size = 0.05

# ── Back bar counter + wood strip top ───────────────────────────────────
bar_w, bar_d, bar_h = 1.7, 0.5, 0.95
bar_x, bar_y = 0.0, -D/2 + 0.30
rbox("BarBase", (bar_x, bar_y, bar_h/2), (bar_w, bar_d, bar_h), med_wood, r=0.02)
rbox("BarTop", (bar_x, bar_y, bar_h + 0.03), (bar_w+0.08, bar_d+0.08, 0.06), dark_wood, r=0.015)
# Front wood planks for grain variation
front_strip_count = 10
front_strip_w = bar_w / front_strip_count
for i in range(front_strip_count):
    x = bar_x - bar_w/2 + front_strip_w/2 + i * front_strip_w
    m = light_wood if i % 2 == 0 else dark_wood
    box(f"BarFrontStrip{i}", (x, bar_y + bar_d/2 + 0.01, bar_h/2), (front_strip_w-0.01, 0.015, bar_h-0.05), m)
bar_top_z = bar_h + 0.06

# Wood strips (alternating)
strip_count = 8
strip_w = (bar_w + 0.02) / strip_count
for i in range(strip_count):
    x = bar_x - bar_w/2 + strip_w/2 + i * strip_w
    m = light_wood if i % 2 == 0 else dark_wood
    box(f"BarStrip{i}", (x, bar_y, bar_top_z + 0.015), (strip_w-0.01, bar_d+0.04, 0.01), m)

# Raised lip
lip_h = 0.03
lip_z = bar_top_z + 0.03
box("BarLipFront", (bar_x, bar_y + bar_d/2 + 0.03, lip_z), (bar_w+0.1, 0.02, lip_h), dark_wood)
box("BarLipBack",  (bar_x, bar_y - bar_d/2 - 0.03, lip_z), (bar_w+0.1, 0.02, lip_h), dark_wood)
box("BarLipL",     (bar_x - bar_w/2 - 0.03, bar_y, lip_z), (0.02, bar_d+0.06, lip_h), dark_wood)
box("BarLipR",     (bar_x + bar_w/2 + 0.03, bar_y, lip_z), (0.02, bar_d+0.06, lip_h), dark_wood)

# ── Bar stools (3-4) ────────────────────────────────────────────────────
def add_stool(name, x, y):
    seat_h = 0.55
    seat_th = 0.04
    cyl(f"{name}_Seat", (x, y, seat_h), 0.18, seat_th, light_wood)
    leg_h = seat_h - 0.05
    for dx, dy in [(0.11, 0.11), (-0.11, 0.11), (0.11, -0.11), (-0.11, -0.11)]:
        cyl(f"{name}_Leg_{dx}_{dy}", (x+dx, y+dy, leg_h/2), 0.02, leg_h, stool_metal)
    torus(f"{name}_Ring", (x, y, 0.25), 0.12, 0.01, stool_metal, rot=(math.radians(90), 0, 0))

stool_y = bar_y + bar_d/2 + 0.38
for i, sx in enumerate([-0.6, -0.2, 0.2, 0.6]):
    add_stool(f"Stool{i}", sx, stool_y)

# ── Shelving behind bar with bottles ────────────────────────────────────
shelf_w, shelf_d = 3.0, 0.18
shelf_x, shelf_y = 0.0, -D/2 + 0.14
shelf_zs = [1.05, 1.35, 1.65, 1.95]

rbox("ShelfPostL", (shelf_x - shelf_w/2 + 0.05, shelf_y, 1.55), (0.06, shelf_d, 1.1), dark_wood, r=0.005)
rbox("ShelfPostR", (shelf_x + shelf_w/2 - 0.05, shelf_y, 1.55), (0.06, shelf_d, 1.1), dark_wood, r=0.005)
box("ShelfBack", (shelf_x, shelf_y - 0.06, 1.55), (shelf_w, 0.02, 1.1), dark_wood)

for i, z in enumerate(shelf_zs):
    rbox(f"Shelf{i}", (shelf_x, shelf_y, z), (shelf_w, shelf_d, 0.04), med_wood, r=0.005)

bottle_mats = [glass_green, glass_brown, clear_glass, glass_blue, ceramic_w, ceramic_blue, ceramic_g]
label_mats = [label_white, label_red, label_blue, label_gold, None]
styles = ["tall", "short", "round"]

def add_bottle(name, x, y, base_z, style, mat_b, label_m=None, scale=1.0):
    if style == "tall":
        body_h = 0.26 * scale; body_r = 0.035 * scale
        cyl(f"{name}_Body", (x, y, base_z + body_h/2), body_r, body_h, mat_b)
        cyl(f"{name}_Neck", (x, y, base_z + body_h + 0.05*scale/2), 0.016*scale, 0.05*scale, mat_b)
        cap_z = base_z + body_h + 0.05*scale
    elif style == "short":
        body_h = 0.18 * scale; body_r = 0.045 * scale
        cyl(f"{name}_Body", (x, y, base_z + body_h/2), body_r, body_h, mat_b)
        sphere(f"{name}_Shoulder", (x, y, base_z + body_h - 0.01*scale), body_r*0.85, mat_b, sc=(1,1,0.7))
        cyl(f"{name}_Neck", (x, y, base_z + body_h + 0.04*scale/2), 0.016*scale, 0.04*scale, mat_b)
        cap_z = base_z + body_h + 0.04*scale
    else:
        rad = 0.055 * scale
        sphere(f"{name}_Body", (x, y, base_z + rad), rad, mat_b, sc=(1,1,0.9))
        cyl(f"{name}_Neck", (x, y, base_z + rad*2 + 0.04*scale/2), 0.016*scale, 0.04*scale, mat_b)
        cap_z = base_z + rad*2 + 0.04*scale
    cyl(f"{name}_Cap", (x, y, cap_z + 0.012*scale), 0.012*scale, 0.02*scale, gold_mat)
    if label_m:
        box(f"{name}_Label", (x, y + 0.04*scale, base_z + 0.10*scale), (0.05*scale, 0.003, 0.10*scale), label_m)

for s_idx, z in enumerate(shelf_zs):
    count = 7 if s_idx < 3 else 5
    for i in range(count):
        x = -shelf_w/2 + 0.25 + i * (shelf_w / count)
        x += random.uniform(-0.08, 0.08)
        style = random.choice(styles)
        mat_b = random.choice(bottle_mats)
        label_m = random.choice(label_mats)
        scale = random.uniform(0.9, 1.2)
        add_bottle(f"ShelfBottle{s_idx}_{i}", x, shelf_y + 0.02, z + 0.04, style, mat_b, label_m, scale)

# ── Bottles and props on bar counter ─────────────────────────────────────
# Varied bottles (front row)
bar_bottle_specs = [
    ("BarBottleTall", -0.55, glass_green, "tall", 1.1),
    ("BarBottleShort", -0.32, glass_brown, "short", 1.0),
    ("BarBottleRound", -0.05, clear_glass, "round", 1.0),
    ("BarBottleTall2", 0.25, glass_blue, "tall", 1.0),
    ("BarBottleShort2", 0.55, ceramic_blue, "short", 1.05),
]
for nm, dx, m, st, sc in bar_bottle_specs:
    add_bottle(nm, bar_x + dx, bar_y - 0.08, bar_top_z + 0.02, st, m, random.choice(label_mats), sc)

# Sake cups + coasters
cup_positions = [(-0.05, 0.14), (0.08, 0.12), (0.22, 0.14), (-0.22, 0.12)]
for i, (dx, dy) in enumerate(cup_positions):
    cxp = bar_x + dx
    cyp = bar_y + dy
    cup_mat = ceramic_w if i % 2 == 0 else ceramic_blue
    cyl(f"CounterCup{i}", (cxp, cyp, bar_top_z + 0.03), 0.03, 0.06, cup_mat)
    if i in [1, 3]:
        cyl(f"Coaster{i}", (cxp, cyp, bar_top_z + 0.005), 0.045, 0.01, dark_wood)

# Tokkuri on counter
cyl("BarTokkuri", (bar_x - 0.1, bar_y + 0.12, bar_top_z + 0.10), 0.035, 0.18, ceramic_w)
cyl("BarTokkuriNeck", (bar_x - 0.1, bar_y + 0.12, bar_top_z + 0.20), 0.015, 0.05, ceramic_w)

# Beer mug with handle
mug_x, mug_y = bar_x + 0.45, bar_y + 0.16
mug_h = 0.12
cyl("BeerMug", (mug_x, mug_y, bar_top_z + mug_h/2), 0.05, mug_h, beer_glass)
cyl("BeerLiquid", (mug_x, mug_y, bar_top_z + mug_h/2 - 0.005), 0.042, mug_h - 0.02, liquid_amber)
torus("BeerHandle", (mug_x + 0.06, mug_y, bar_top_z + 0.05), 0.032, 0.009, beer_glass, rot=(0, math.radians(90), 0))

# Larger plates with food
plate_specs = [(-0.38, 0.16), (0.05, 0.18), (0.35, 0.13)]
for i, (dx, dy) in enumerate(plate_specs):
    px, py = bar_x + dx, bar_y + dy
    cyl(f"BarPlate{i}", (px, py, bar_top_z + 0.012), 0.085, 0.018, ceramic_w if i%2==0 else ceramic_g)
    for j in range(5):
        sphere(f"BarFood{i}_{j}", (px + random.uniform(-0.03,0.03), py + random.uniform(-0.03,0.03), bar_top_z + 0.035),
               0.018, ceramic_w, sc=(1,1,0.6))

# Chopsticks (enlarged)
for i, off in enumerate([-0.010, 0.010]):
    cyl(f"Chopstick{i}", (bar_x - 0.35, bar_y + 0.20 + off, bar_top_z + 0.02), 0.007, 0.40, bamboo_mat,
        rot=(0, math.radians(90), math.radians(10)))

# Small dish plates (enlarged)
for i, (dx, dy, m) in enumerate([(-0.48, 0.12, ceramic_w), (-0.25, 0.18, ceramic_g)]):
    cyl(f"BarDish{i}", (bar_x + dx, bar_y + dy, bar_top_z + 0.01), 0.08, 0.018, m)

# Condiment tray + soy sauce bottle + towel (oshibori)
box("CondimentTray", (bar_x + 0.15, bar_y - 0.02, bar_top_z + 0.015), (0.18, 0.10, 0.02), dark_wood)
cyl("ShoyuBottle", (bar_x + 0.12, bar_y - 0.02, bar_top_z + 0.07), 0.025, 0.10, glass_brown)
cyl("ShoyuCap", (bar_x + 0.12, bar_y - 0.02, bar_top_z + 0.13), 0.012, 0.02, condiment_red)
# Small spice bottle
cyl("SpiceBottle", (bar_x + 0.20, bar_y - 0.02, bar_top_z + 0.06), 0.02, 0.08, ceramic_w)
cyl("SpiceCap", (bar_x + 0.20, bar_y - 0.02, bar_top_z + 0.11), 0.012, 0.02, condiment_red)
# Oshibori towel
cyl("Oshibori", (bar_x - 0.05, bar_y - 0.02, bar_top_z + 0.02), 0.03, 0.12, cloth_mat, rot=(0, math.radians(90), 0))

# ── Noren curtain (wider strips + variation) ────────────────────────────
noren_y = D/2 - 0.04
noren_z_top = H - 0.15
cyl("NorenBar", (0, noren_y, noren_z_top), 0.018, 2.6, dark_wood, rot=(0, math.pi/2, 0))
for i in range(5):
    x = -1.05 + i * 0.53
    strip_h = 1.05 + random.uniform(-0.05, 0.05)
    base_col = (0.55, 0.06, 0.04, 1) if i % 2 else (0.06, 0.05, 0.18, 1)
    m = mat(f"NorenVar{i}", vary_color(base_col, 0.05), 0.8)
    box(f"NorenS{i}", (x, noren_y - 0.02, noren_z_top - strip_h/2 - 0.05), (0.07, 0.02, strip_h), m,
        rot=(math.radians(random.uniform(-6, 6)), 0, math.radians(random.uniform(-6, 6))))

# Side noren (left wall)
cyl("NorenBar2", (-W/2 + 0.06, 0.3, H - 0.35), 0.012, 0.6, dark_wood, rot=(math.pi/2, 0, 0))
for i in range(3):
    y = 0.1 + i * 0.2
    box(f"NorenS2_{i}", (-W/2 + 0.07, y, H - 0.35 - 0.35), (0.04, 0.02, 0.62), noren_red,
        rot=(math.radians(random.uniform(-5, 5)), 0, math.radians(random.uniform(-4, 4))))

# ── Hanging items row (garlic + dried fish) ─────────────────────────────
def add_garlic_string(name, x, y, z, count=5):
    cyl(f"{name}_Rope", (x, y, z), 0.004, 0.45, rope_mat, rot=(math.radians(90), 0, 0))
    for i in range(count):
        gy = y - 0.18 + i * 0.09
        sphere(f"{name}_Garlic{i}", (x, gy, z - 0.06), 0.03, ceramic_w, sc=(1, 1, 1.2))
        sphere(f"{name}_GarlicTop{i}", (x, gy, z - 0.03), 0.015, ceramic_w, sc=(1, 1, 1))

add_garlic_string("GarlicA", -0.8, 0.85, H - 0.45, 5)
add_garlic_string("GarlicB", 0.8, 0.85, H - 0.45, 4)

# Dried fish string
cyl("FishRope", (0.0, 0.9, H - 0.42), 0.004, 0.6, rope_mat, rot=(math.radians(90), 0, 0))
for i in range(4):
    fy = 0.65 + i * 0.16
    box(f"Fish{i}", (0.0, fy, H - 0.52), (0.10, 0.02, 0.06), paper_mat,
        rot=(math.radians(90), 0, math.radians(random.uniform(-20, 20))))

# ── Menu board (back wall with emissive writing) ─────────────────────────
mb_x = 1.3
rbox("MenuBoard", (mb_x, -D/2 + 0.06, 1.55), (0.5, 0.03, 0.65), menu_board, r=0.01)
box("MBFrameT", (mb_x, -D/2+0.065, 1.88), (0.54, 0.012, 0.025), med_wood)
box("MBFrameB", (mb_x, -D/2+0.065, 1.22), (0.54, 0.012, 0.025), med_wood)
box("MBFrameL", (mb_x-0.27, -D/2+0.065, 1.55), (0.025, 0.012, 0.65), med_wood)
box("MBFrameR", (mb_x+0.27, -D/2+0.065, 1.55), (0.025, 0.012, 0.65), med_wood)
# Emissive writing lines
for i in range(7):
    w = 0.16 + random.uniform(0, 0.15)
    box(f"Chalk{i}", (mb_x + random.uniform(-0.05, 0.02), -D/2 + 0.075, 1.82 - i*0.08),
        (w, 0.003, 0.012), menu_text_emit)

# Small light for menu board
bpy.ops.object.light_add(type='SPOT', location=(mb_x, -D/2 + 0.3, 2.0))
mbl = bpy.context.active_object; mbl.name = "MenuSpot"
mbl.data.energy = 30; mbl.data.color = (1.0, 0.7, 0.3)
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
sjl.data.energy = 20; sjl.data.color = (1.0, 0.8, 0.5); sjl.data.shadow_soft_size = 0.3

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
    bg.inputs["Strength"].default_value = 0.04

# ── GLB export ───────────────────────────────────────────────────────────
glb_path = "/tmp/izakaya.glb"
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB', export_apply=True)
print(f"Exported GLB: {glb_path}")
