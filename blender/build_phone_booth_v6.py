import bpy, math, os, random

# ─── Helpers ───────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes:
        if b.users == 0:
            bpy.data.meshes.remove(b)
    for b in bpy.data.materials:
        if b.users == 0:
            bpy.data.materials.remove(b)


def mat_emissive(name, base_color, emission_color=None, emission_strength=4.0, roughness=0.6, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = base_color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission_color is None:
            emission_color = base_color
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = emission_color
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = emission_strength
    return m


def mat_glass(name, color=(0.7, 0.85, 0.95, 1.0), roughness=0.05, ior=1.45, alpha=0.12):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["IOR"].default_value = ior
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.9
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = 0.9
        bsdf.inputs["Alpha"].default_value = alpha
    return m


def emit_mat(name, color, strength=10.0):
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


def box(name, loc, scale, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    o.rotation_euler = rot
    if mat:
        o.data.materials.append(mat)
    return o


def rbox(name, loc, scale, mat, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new("B", 'BEVEL')
    bv.width = bevel
    bv.segments = 3
    bv.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="B")
    if mat:
        o.data.materials.append(mat)
    return o


def cyl(name, loc, rad, depth, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = rot
    if mat:
        o.data.materials.append(mat)
    return o


def sphere(name, loc, rad, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=18, ring_count=12)
    o = bpy.context.active_object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    return o


OUT = "/tmp"

# ─── Scene Setup ──────────────────────────────────────────
clear_scene()
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True

# World
world = bpy.data.worlds.new("NightWorld")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
for n in list(wn):
    wn.remove(n)

bg = wn.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.01, 0.02, 0.05, 1.0)
bg.inputs["Strength"].default_value = 0.3
out = wn.new("ShaderNodeOutputWorld")
wl.new(bg.outputs["Background"], out.inputs["Surface"])

# ─── Materials ─────────────────────────────────────────────
# Ground/road/sidewalk (emission 3-5)
mat_road = mat_emissive("Road", (0.02, 0.02, 0.025, 1.0), emission_strength=4.5, roughness=0.2)
mat_sidewalk = mat_emissive("Sidewalk", (0.06, 0.06, 0.055, 1.0), emission_strength=3.5, roughness=0.25)
mat_curb = mat_emissive("Curb", (0.08, 0.08, 0.07, 1.0), emission_strength=3.2, roughness=0.3)
mat_line = mat_emissive("RoadLine", (0.7, 0.7, 0.7, 1.0), emission_strength=4.0, roughness=0.5)
mat_puddle = mat_emissive("Puddle", (0.03, 0.04, 0.08, 1.0), emission_strength=4.5, roughness=0.05)

# Booth materials
mat_booth_red = mat_emissive("BoothRed", (0.9, 0.05, 0.05, 1.0), emission_strength=5.0, roughness=0.35, metallic=0.3)
mat_booth_dark = mat_emissive("BoothDark", (0.4, 0.02, 0.02, 1.0), emission_strength=4.0, roughness=0.4, metallic=0.4)
mat_metal = mat_emissive("Metal", (0.08, 0.08, 0.1, 1.0), emission_strength=3.2, roughness=0.35, metallic=0.8)
mat_phone = mat_emissive("PhoneBody", (0.03, 0.03, 0.03, 1.0), emission_strength=3.0, roughness=0.6, metallic=0.2)
mat_glass = mat_glass("Glass", (0.6, 0.8, 0.9, 1.0), roughness=0.03, alpha=0.12)

# Emissive hero glows
mat_booth_glow = emit_mat("BoothGlow", (1.0, 0.55, 0.2, 1.0), strength=25.0)
mat_neon_red = emit_mat("NeonRed", (1.0, 0.05, 0.05, 1.0), strength=28.0)
mat_neon_blue = emit_mat("NeonBlue", (0.2, 0.5, 1.0, 1.0), strength=18.0)
mat_neon_pink = emit_mat("NeonPink", (1.0, 0.1, 0.5, 1.0), strength=16.0)
mat_window = emit_mat("Window", (1.0, 0.85, 0.55, 1.0), strength=10.0)
mat_vend_glow = emit_mat("VendGlow", (0.35, 0.75, 1.0, 1.0), strength=10.0)
mat_vend_glow2 = emit_mat("VendGlow2", (1.0, 0.45, 0.15, 1.0), strength=10.0)
mat_lamp_glow = emit_mat("LampGlow", (1.0, 0.7, 0.25, 1.0), strength=18.0)

# Props
mat_bench_wood = mat_emissive("BenchWood", (0.18, 0.1, 0.05, 1.0), emission_strength=3.5, roughness=0.6)
mat_bench_metal = mat_emissive("BenchMetal", (0.08, 0.08, 0.1, 1.0), emission_strength=3.5, roughness=0.35, metallic=0.7)
mat_hydrant = mat_emissive("Hydrant", (0.9, 0.08, 0.06, 1.0), emission_strength=4.0, roughness=0.35)
mat_trash = mat_emissive("Trash", (0.06, 0.08, 0.06, 1.0), emission_strength=3.2, roughness=0.7)
mat_news = mat_emissive("NewsStand", (0.1, 0.25, 0.12, 1.0), emission_strength=3.5, roughness=0.5)
mat_vend_body = mat_emissive("Vending", (0.05, 0.1, 0.15, 1.0), emission_strength=3.5, roughness=0.4)
mat_vend_body2 = mat_emissive("Vending2", (0.15, 0.06, 0.05, 1.0), emission_strength=3.5, roughness=0.4)
mat_sign = mat_emissive("Sign", (0.15, 0.15, 0.2, 1.0), emission_strength=3.2, roughness=0.5)

# Buildings
mat_building = mat_emissive("Building", (0.03, 0.03, 0.05, 1.0), emission_strength=3.0, roughness=0.9)
mat_building2 = mat_emissive("Building2", (0.04, 0.035, 0.06, 1.0), emission_strength=3.0, roughness=0.85)

# ─── Ground ────────────────────────────────────────────────
box("Road", (1.6, 0, -0.01), (9, 6.5, 0.02), mat_road)
box("Sidewalk", (-0.9, 0, 0.04), (2.1, 6.5, 0.08), mat_sidewalk)
box("Curb", (0.1, 0, 0.05), (0.12, 6.5, 0.1), mat_curb)

# Road markings
for i in range(9):
    box(f"RoadLine_{i}", (2.2, -2.6 + i * 0.7, 0.008), (0.04, 0.28, 0.01), mat_line)
box("StopLine", (1.2, -2.0, 0.008), (1.6, 0.08, 0.01), mat_line)

# Puddles (wet reflections)
puddle_data = [
    (0.5, -0.3, 1.0, 0.6), (1.4, 0.6, 0.8, 0.5), (2.1, -0.5, 0.9, 0.45),
    (-0.2, 0.5, 0.6, 0.35), (0.6, 1.2, 0.7, 0.4), (1.2, -1.2, 0.9, 0.5),
    (0.3, -0.6, 1.3, 0.7)
]
for i, (px, py, sx, sy) in enumerate(puddle_data):
    box(f"Puddle_{i}", (px, py, 0.006), (sx, sy, 0.008), mat_puddle)

# ─── Phone Booth (hero) ───────────────────────────────────
bx, by = -1.2, 0.7
bw, bd, bh = 0.9, 0.9, 2.4

box("BoothFloor", (bx, by, 0.06), (bw + 0.06, bd + 0.06, 0.04), mat_booth_dark)

for cx, cy in [(bw / 2, bd / 2), (-bw / 2, bd / 2), (bw / 2, -bd / 2), (-bw / 2, -bd / 2)]:
    rbox(f"Post_{cx}_{cy}", (bx + cx, by + cy, bh / 2 + 0.06), (0.05, 0.05, bh), mat_booth_red, bevel=0.01)

box("TopFrame", (bx, by, bh + 0.06), (bw + 0.08, bd + 0.08, 0.05), mat_booth_red)
box("RoofCap", (bx, by, bh + 0.13), (bw + 0.14, bd + 0.14, 0.05), mat_booth_dark)

# Rails
box("BottomRailBack", (bx, by + bd / 2, 0.24), (bw, 0.03, 0.3), mat_booth_red)
box("BottomRailLeft", (bx - bw / 2, by, 0.24), (0.03, bd, 0.3), mat_booth_red)
box("BottomRailRight", (bx + bw / 2, by, 0.24), (0.03, bd, 0.3), mat_booth_red)

# Glass panels
front_y = by - bd / 2 + 0.005
for side, lx, ly, sx, sy in [
    ("Back", bx, by + bd / 2 - 0.005, bw - 0.06, 0.008),
    ("Left", bx - bw / 2 + 0.005, by, 0.008, bd - 0.06),
    ("Right", bx + bw / 2 - 0.005, by, 0.008, bd - 0.06),
]:
    box(f"GlassU_{side}", (lx, ly, 1.6), (sx, sy, 0.7), mat_glass)
    box(f"GlassL_{side}", (lx, ly, 0.6), (sx, sy, 0.55), mat_glass)

box("GlassFrontL", (bx - 0.18, front_y, 1.6), (0.2, 0.008, 0.7), mat_glass)
box("GlassFrontR", (bx + 0.18, front_y, 1.6), (0.2, 0.008, 0.7), mat_glass)

# Phone unit inside
box("PhoneMount", (bx, by + 0.15, 0.68), (0.22, 0.05, 0.28), mat_phone)
cyl("Handset", (bx, by + 0.12, 0.82), 0.02, 0.12, mat_phone, rot=(0.3, 0, 0))
box("CoinSlot", (bx, by + 0.14, 0.58), (0.1, 0.03, 0.05), mat_metal)

# Booth glow
box("CeilingGlow", (bx, by, bh + 0.04), (0.4, 0.4, 0.03), mat_booth_glow)
box("TopSign", (bx, by - bd / 2 - 0.03, bh + 0.18), (0.32, 0.03, 0.12), mat_neon_red)

# Neon strips
for cx, cy in [(bw / 2, bd / 2), (-bw / 2, bd / 2), (bw / 2, -bd / 2), (-bw / 2, -bd / 2)]:
    box(f"NeonStrip_{cx}_{cy}", (bx + cx, by + cy, 1.2), (0.02, 0.02, 1.8), mat_neon_red)

# Booth lights
booth_light = bpy.data.lights.new("BoothLight", 'POINT')
booth_light.energy = 140
booth_light.color = (1.0, 0.6, 0.25)
booth_light.shadow_soft_size = 0.2
booth_light_obj = bpy.data.objects.new("BoothLight", booth_light)
scene.collection.objects.link(booth_light_obj)
booth_light_obj.location = (bx, by, 1.8)

booth_light2 = bpy.data.lights.new("BoothLight2", 'POINT')
booth_light2.energy = 80
booth_light2.color = (1.0, 0.5, 0.2)
booth_light2.shadow_soft_size = 0.2
booth_light2_obj = bpy.data.objects.new("BoothLight2", booth_light2)
scene.collection.objects.link(booth_light2_obj)
booth_light2_obj.location = (bx, by, 0.5)

# ─── Street Lamp ──────────────────────────────────────────
lamp_x, lamp_y = -1.8, 1.2
cyl("LampPole", (lamp_x, lamp_y, 1.2), 0.03, 2.4, mat_metal)
box("LampArm", (lamp_x - 0.2, lamp_y, 2.35), (0.4, 0.03, 0.03), mat_metal)
rbox("LampHousing", (lamp_x - 0.35, lamp_y, 2.3), (0.22, 0.12, 0.08), mat_metal, bevel=0.01)
box("LampGlow", (lamp_x - 0.35, lamp_y, 2.27), (0.18, 0.08, 0.02), mat_lamp_glow)

sl = bpy.data.lights.new("StreetSpot", 'SPOT')
sl.energy = 900
sl.color = (1.0, 0.7, 0.25)
sl.spot_size = math.radians(60)
sl.spot_blend = 0.5
sl.shadow_soft_size = 0.1
sl_obj = bpy.data.objects.new("StreetSpot", sl)
scene.collection.objects.link(sl_obj)
sl_obj.location = (lamp_x - 0.35, lamp_y, 2.25)
sl_obj.rotation_euler = (math.radians(8), 0, 0)

# ─── Props ────────────────────────────────────────────────
# Bench
bench_x, bench_y = -2.3, 1.3
box("BenchSeat", (bench_x, bench_y, 0.25), (0.6, 0.2, 0.05), mat_bench_wood)
box("BenchBack", (bench_x, bench_y - 0.1, 0.45), (0.6, 0.05, 0.25), mat_bench_wood)
for lx in [-0.25, 0.25]:
    box(f"BenchLeg_{lx}", (bench_x + lx, bench_y - 0.06, 0.12), (0.03, 0.03, 0.12), mat_bench_metal)
    box(f"BenchLeg2_{lx}", (bench_x + lx, bench_y + 0.06, 0.12), (0.03, 0.03, 0.12), mat_bench_metal)

# Trash can
cyl("TrashCan", (-1.9, -0.7, 0.2), 0.08, 0.4, mat_trash)
cyl("TrashLid", (-1.9, -0.7, 0.42), 0.09, 0.03, mat_metal)

# Fire hydrant
hx, hy = 2.2, -1.1
cyl("HydrantBase", (hx, hy, 0.18), 0.08, 0.36, mat_hydrant)
cyl("HydrantTop", (hx, hy, 0.42), 0.1, 0.1, mat_hydrant)
cyl("HydrantNozzleL", (hx - 0.1, hy, 0.28), 0.03, 0.08, mat_hydrant, rot=(0, math.radians(90), 0))
cyl("HydrantNozzleR", (hx + 0.1, hy, 0.28), 0.03, 0.08, mat_hydrant, rot=(0, math.radians(90), 0))

# Newspaper stand
nx, ny = 0.9, 3.9
rbox("NewsStandBase", (nx, ny, 0.35), (0.28, 0.2, 0.36), mat_news, bevel=0.02)
box("NewsStandTop", (nx, ny - 0.08, 0.6), (0.28, 0.05, 0.08), mat_news)
box("NewsStandSign", (nx, ny - 0.12, 0.7), (0.24, 0.02, 0.1), mat_neon_blue)

# Vending machines
rbox("Vending1", (1.5, 4.2, 0.45), (0.32, 0.26, 0.9), mat_vend_body, bevel=0.02)
box("VendLight1", (1.5, 3.95, 0.7), (0.26, 0.02, 0.22), mat_vend_glow)

rbox("Vending2", (1.1, 4.2, 0.45), (0.3, 0.26, 0.9), mat_vend_body2, bevel=0.02)
box("VendLight2", (1.1, 3.95, 0.7), (0.24, 0.02, 0.22), mat_vend_glow2)

# Sign pole
cyl("SignPole", (0.2, -1.3, 0.8), 0.015, 1.6, mat_sign)
box("StreetSign1", (0.2, -1.3, 1.55), (0.26, 0.02, 0.08), mat_sign)
box("StreetSign2", (0.2, -1.3, 1.4), (0.22, 0.02, 0.06), mat_neon_blue)

# Utility pole + wires
cyl("UtilityPole", (3.6, 2.0, 1.5), 0.04, 3.0, mat_metal)
box("PoleArm1", (3.6, 2.0, 2.9), (0.7, 0.03, 0.03), mat_metal)
box("PoleArm2", (3.6, 2.0, 2.6), (0.5, 0.03, 0.03), mat_metal)
for py in [-0.3, 0.0, 0.3]:
    cyl(f"Wire_{py}", (0.3, py, 2.85), 0.003, 8.0, mat_metal, rot=(0, math.radians(90), 0))

# ─── Buildings + Windows ─────────────────────────────────
back_buildings = [
    ("B1", (-2.0, 5.2, 1.6), (1.4, 0.8, 3.2), mat_building),
    ("B2", (-0.5, 5.2, 2.0), (1.2, 0.8, 4.0), mat_building2),
    ("B3", (0.8, 5.2, 1.8), (1.2, 0.8, 3.6), mat_building),
    ("B4", (2.2, 5.2, 1.4), (1.1, 0.8, 2.8), mat_building2),
    ("B5", (3.5, 5.2, 2.2), (1.3, 0.8, 4.4), mat_building),
]
for nm, loc, dim, mt in back_buildings:
    box(nm, loc, dim, mt)

box("BLeft1", (-3.5, 0.6, 1.6), (0.9, 1.6, 3.2), mat_building)
box("BLeft2", (-3.5, -0.8, 1.8), (0.9, 1.4, 3.6), mat_building2)
box("BRight1", (5.0, 0.0, 1.3), (1.1, 2.0, 2.6), mat_building)

windows = [
    (-0.5, 4.79, 1.8), (-0.5, 4.79, 2.4), (0.7, 4.79, 1.6), (0.7, 4.79, 2.3),
    (2.2, 4.79, 1.2), (-2.0, 4.79, 1.6), (3.5, 4.79, 2.6),
    (-3.49, 0.6, 1.4), (-3.49, 0.1, 2.0), (4.9, -0.4, 1.5)
]
for i, (wx, wy, wz) in enumerate(windows):
    box(f"Window_{i}", (wx, wy, wz), (0.12, 0.02, 0.16), mat_window)

# Neon signs
box("NeonSign1", (-1.6, 4.78, 2.6), (0.45, 0.03, 0.12), mat_neon_pink)
box("NeonSign2", (1.9, 4.78, 2.1), (0.5, 0.03, 0.14), mat_neon_blue)
box("NeonSign3", (3.2, 4.78, 3.2), (0.6, 0.03, 0.16), mat_neon_red)

# ─── Extra ambient lights ─────────────────────────────────
# Convenience store spill
conv_light = bpy.data.lights.new("ConvLight", 'SPOT')
conv_light.energy = 120
conv_light.color = (0.5, 1.0, 0.7)
conv_light.spot_size = math.radians(70)
conv_light.spot_blend = 0.6
conv_light.shadow_soft_size = 0.15
conv_light_obj = bpy.data.objects.new("ConvLight", conv_light)
scene.collection.objects.link(conv_light_obj)
conv_light_obj.location = (0.6, 4.7, 2.5)
conv_light_obj.rotation_euler = (math.radians(160), 0, 0)

# Vending spill
vend_light = bpy.data.lights.new("VendLight", 'POINT')
vend_light.energy = 25
vend_light.color = (0.4, 0.7, 1.0)
vend_light.shadow_soft_size = 0.2
vend_light_obj = bpy.data.objects.new("VendLight", vend_light)
scene.collection.objects.link(vend_light_obj)
vend_light_obj.location = (1.3, 3.9, 0.6)

# ─── Sky Backdrop (avoid black void) ───────────────────────
sky_bottom = emit_mat("SkyBottom", (0.02, 0.05, 0.12, 1.0), strength=3.0)
sky_top = emit_mat("SkyTop", (0.01, 0.015, 0.04, 1.0), strength=3.0)
box("SkyBackBottom", (1.0, 6.8, 1.6), (8.0, 0.08, 1.6), sky_bottom)
box("SkyBackTop", (1.0, 6.8, 3.8), (8.0, 0.08, 1.8), sky_top)

random.seed(7)
for i in range(50):
    sx = random.uniform(-4.5, 5.5)
    sy = random.uniform(6.7, 7.2)
    sz = random.uniform(3.2, 5.0)
    sphere(f"Star_{i}", (sx, sy, sz), 0.02, emit_mat(f"Star_{i}_mat", (1.0, 1.0, 1.0, 1.0), 12.0))

# ─── Export ────────────────────────────────────────────────
glb_path = os.path.join(OUT, "phone-booth.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
print(f"Exported: {glb_path}")
print("DONE")
