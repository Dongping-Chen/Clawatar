import bpy, math, os, random

# ─── Helpers ───────────────────────────────────────────────
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

def glass_mat(name, color=(0.7, 0.85, 0.9, 1.0), roughness=0.05, ior=1.45, alpha=0.15):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = roughness
        b.inputs["Metallic"].default_value = 0.0
        b.inputs["IOR"].default_value = ior
        if "Transmission Weight" in b.inputs:
            b.inputs["Transmission Weight"].default_value = 0.85
        elif "Transmission" in b.inputs:
            b.inputs["Transmission"].default_value = 0.85
        b.inputs["Alpha"].default_value = alpha
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

OUT = "/tmp/blender-room"
os.makedirs(OUT, exist_ok=True)

# ─── Clear & Setup ─────────────────────────────────────────
clear_scene()
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 64
scene.cycles.use_denoising = True

# World - dark night sky
world = bpy.data.worlds.new("NightWorld")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
for n in list(wn): wn.remove(n)
bg = wn.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.005, 0.008, 0.025, 1.0)
bg.inputs["Strength"].default_value = 0.2
vol = wn.new("ShaderNodeVolumeScatter")
vol.inputs["Color"].default_value = (0.5, 0.55, 0.7, 1.0)
vol.inputs["Density"].default_value = 0.025
vol.inputs["Anisotropy"].default_value = 0.4
out = wn.new("ShaderNodeOutputWorld")
wl.new(bg.outputs["Background"], out.inputs["Surface"])
wl.new(vol.outputs["Volume"], out.inputs["Volume"])

# ─── Materials ─────────────────────────────────────────────
# Phone booth - DEEP CRIMSON RED
mat_red = mat("PhoneBoothRed", (0.9, 0.01, 0.005, 1.0), roughness=0.25, metallic=0.2)
mat_red_dark = mat("RedDark", (0.7, 0.005, 0.002, 1.0), roughness=0.3, metallic=0.25)
mat_glass = glass_mat("Glass", (0.5, 0.7, 0.75, 1.0), roughness=0.02, alpha=0.1)
mat_metal = mat("Metal", (0.15, 0.15, 0.17, 1.0), roughness=0.3, metallic=0.9)
mat_dark_metal = mat("DarkMetal", (0.05, 0.05, 0.06, 1.0), roughness=0.25, metallic=0.95)
# WET road - procedural roughness variation for realistic wet asphalt
mat_pavement = bpy.data.materials.new("WetPavement")
mat_pavement.use_nodes = True
nodes_p = mat_pavement.node_tree.nodes; links_p = mat_pavement.node_tree.links
bsdf_p = nodes_p.get("Principled BSDF")
bsdf_p.inputs["Base Color"].default_value = (0.02, 0.02, 0.025, 1.0)
bsdf_p.inputs["Metallic"].default_value = 0.0
# Add noise texture for roughness variation (wet patches vs drier areas)
tex_coord = nodes_p.new("ShaderNodeTexCoord")
noise = nodes_p.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 3.0
noise.inputs["Detail"].default_value = 8.0
noise.inputs["Roughness"].default_value = 0.7
ramp = nodes_p.new("ShaderNodeMapRange")
ramp.inputs["From Min"].default_value = 0.3
ramp.inputs["From Max"].default_value = 0.7
ramp.inputs["To Min"].default_value = 0.03  # very wet puddle areas
ramp.inputs["To Max"].default_value = 0.15  # slightly drier patches
links_p.new(tex_coord.outputs["Object"], noise.inputs["Vector"])
links_p.new(noise.outputs["Fac"], ramp.inputs["Value"])
links_p.new(ramp.outputs["Result"], bsdf_p.inputs["Roughness"])
# Add bump for asphalt texture
bump_noise = nodes_p.new("ShaderNodeTexNoise")
bump_noise.inputs["Scale"].default_value = 50.0
bump_noise.inputs["Detail"].default_value = 10.0
bump = nodes_p.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.05
links_p.new(tex_coord.outputs["Object"], bump_noise.inputs["Vector"])
links_p.new(bump_noise.outputs["Fac"], bump.inputs["Height"])
links_p.new(bump.outputs["Normal"], bsdf_p.inputs["Normal"])
mat_sidewalk = mat("Sidewalk", (0.06, 0.06, 0.055, 1.0), roughness=0.12, metallic=0.0)
mat_building = mat("Building", (0.03, 0.03, 0.04, 1.0), roughness=0.8, metallic=0.0)
mat_building2 = mat("Building2", (0.04, 0.035, 0.05, 1.0), roughness=0.75, metallic=0.0)
mat_phone_body = mat("PhoneBody", (0.02, 0.02, 0.02, 1.0), roughness=0.5, metallic=0.3)
mat_booth_floor = mat("BoothFloor", (0.05, 0.05, 0.04, 1.0), roughness=0.4, metallic=0.0)
mat_curb = mat("Curb", (0.08, 0.08, 0.07, 1.0), roughness=0.5)
mat_white_stripe = mat("WhiteStripe", (0.6, 0.6, 0.6, 1.0), roughness=0.5)
# Puddles - MIRROR-LIKE
mat_puddle = mat("Puddle", (0.01, 0.015, 0.03, 1.0), roughness=0.02, metallic=0.0)

# Emissive materials
mat_warm_glow = emit_mat("WarmGlow", (1.0, 0.55, 0.15, 1.0), strength=20.0)
mat_amber_light = emit_mat("AmberLight", (1.0, 0.6, 0.15, 1.0), strength=30.0)
# NEON RED glow for booth
# Deeper crimson neon - less orange, more pure red
mat_red_neon = emit_mat("RedNeon", (1.0, 0.01, 0.005, 1.0), strength=30.0)
mat_red_neon_strong = emit_mat("RedNeonStrong", (1.0, 0.005, 0.002, 1.0), strength=55.0)
mat_sign_glow = emit_mat("SignGlow", (0.2, 0.9, 0.4, 1.0), strength=6.0)
mat_sign_glow2 = emit_mat("SignGlow2", (1.0, 0.2, 0.5, 1.0), strength=5.0)
mat_window_lit = emit_mat("WindowLit", (1.0, 0.85, 0.5, 1.0), strength=10.0)
mat_vend_glow = emit_mat("VendGlow", (0.3, 0.7, 1.0, 1.0), strength=8.0)
mat_vend_glow2 = emit_mat("VendGlow2", (1.0, 0.4, 0.1, 1.0), strength=7.0)
mat_traffic_red = emit_mat("TrafficRed", (1.0, 0.1, 0.05, 1.0), strength=10.0)
mat_traffic_green = emit_mat("TrafficGreen", (0.1, 1.0, 0.3, 1.0), strength=6.0)
mat_neon_blue = emit_mat("NeonBlue", (0.1, 0.4, 1.0, 1.0), strength=10.0)
mat_neon_pink = emit_mat("NeonPink", (1.0, 0.1, 0.5, 1.0), strength=9.0)
mat_conv_store = emit_mat("ConvStore", (0.1, 1.0, 0.5, 1.0), strength=8.0)

# Extra mats
mat_shutter = mat("Shutter", (0.04, 0.04, 0.05, 1.0), roughness=0.5, metallic=0.4)
mat_awning = mat("Awning", (0.06, 0.04, 0.03, 1.0), roughness=0.8)
mat_awning2 = mat("Awning2", (0.04, 0.04, 0.06, 1.0), roughness=0.8)
mat_ac = mat("ACUnit", (0.08, 0.08, 0.09, 1.0), roughness=0.6, metallic=0.3)
mat_vend = mat("Vending", (0.05, 0.08, 0.12, 1.0), roughness=0.4, metallic=0.2)
mat_vend2 = mat("Vending2", (0.12, 0.05, 0.04, 1.0), roughness=0.4, metallic=0.2)
mat_rubber = mat("Rubber", (0.02, 0.02, 0.02, 1.0), roughness=0.9, metallic=0.0)
mat_bicycle = mat("Bicycle", (0.1, 0.1, 0.12, 1.0), roughness=0.4, metallic=0.7)
mat_garbage = mat("Garbage", (0.04, 0.06, 0.04, 1.0), roughness=0.7, metallic=0.1)
mat_manhole = mat("Manhole", (0.06, 0.06, 0.06, 1.0), roughness=0.3, metallic=0.8)
mat_sign_post = mat("SignPost", (0.1, 0.1, 0.1, 1.0), roughness=0.5, metallic=0.6)
mat_sign_face = mat("SignFace", (0.15, 0.15, 0.2, 1.0), roughness=0.5, metallic=0.3)

# Extra prop materials
mat_bench_wood = mat("BenchWood", (0.18, 0.1, 0.05, 1.0), roughness=0.6, metallic=0.1)
mat_bench_metal = mat("BenchMetal", (0.08, 0.08, 0.1, 1.0), roughness=0.35, metallic=0.7)
mat_hydrant = mat("Hydrant", (0.9, 0.08, 0.06, 1.0), roughness=0.35, metallic=0.2)
mat_mailbox = mat("Mailbox", (0.05, 0.12, 0.35, 1.0), roughness=0.4, metallic=0.4)
mat_news = mat("NewsStand", (0.08, 0.25, 0.12, 1.0), roughness=0.5, metallic=0.25)

# Sky / stars emissive materials
mat_sky_bottom = emit_mat("SkyBottom", (0.02, 0.05, 0.12, 1.0), strength=3.0)
mat_sky_top = emit_mat("SkyTop", (0.005, 0.008, 0.02, 1.0), strength=3.0)
mat_star = emit_mat("Star", (1.0, 1.0, 1.0, 1.0), strength=12.0)
mat_neon_far = emit_mat("DistantNeon", (0.2, 0.7, 1.0, 1.0), strength=12.0)

# ─── Ground ────────────────────────────────────────────────
# Main wet road - wider
box("Road", (1.5, 0, -0.01), (8, 6, 0.02), mat_pavement)
# Sidewalk (raised slightly)
box("Sidewalk", (-0.8, 0, 0.03), (1.8, 6, 0.06), mat_sidewalk)
# Curb
box("Curb", (0.05, 0, 0.04), (0.12, 6, 0.08), mat_curb)

# Rain puddles - MORE and BIGGER for reflections
puddle_data = [
    (0.5, -0.5, 0.8, 0.5), (1.5, 0.8, 0.6, 0.4), (2.0, -0.3, 0.7, 0.35),
    (-0.3, 0.4, 0.4, 0.25), (0.5, 1.2, 0.5, 0.3), (1.2, -1.0, 0.7, 0.4),
    (0.3, -0.2, 1.0, 0.6), (1.8, 0.2, 0.5, 0.35), (2.5, -0.8, 0.6, 0.4),
    (0.8, 0.5, 0.9, 0.5), (-0.1, -0.8, 0.5, 0.3), (1.0, -0.6, 0.6, 0.45),
    (0.2, 0.1, 1.2, 0.7),  # BIG puddle right in front of booth - money shot
]
for i, (px, py, sx, sy) in enumerate(puddle_data):
    box(f"Puddle_{i}", (px, py, 0.005), (sx, sy, 0.01), mat_puddle)

booth_objs_before = set(bpy.data.objects)

# ─── PHONE BOOTH ───────────────────────────────────────────
# Realistic phone booth size: ~2.4m tall, ~0.9m wide, ~0.9m deep
bx, by = -1.0, 0.8
bw, bd, bh = 0.9, 0.9, 2.4

box("BoothFloor", (bx, by, 0.06), (bw+0.06, bd+0.06, 0.03), mat_booth_floor)

for cx, cy in [(bw/2, bd/2), (-bw/2, bd/2), (bw/2, -bd/2), (-bw/2, -bd/2)]:
    rbox(f"Post_{cx}_{cy}", (bx+cx, by+cy, bh/2+0.06), (0.04, 0.04, bh), mat_red, r=0.005)

box("TopFrame", (bx, by, bh+0.06), (bw+0.06, bd+0.06, 0.05), mat_red)
rbox("RoofCap", (bx, by, bh+0.12), (bw+0.12, bd+0.12, 0.04), mat_red_dark, r=0.01)

box("BottomRailBack", (bx, by+bd/2, 0.22), (bw, 0.03, 0.28), mat_red)
box("BottomRailLeft", (bx-bw/2, by, 0.22), (0.03, bd, 0.28), mat_red)
box("BottomRailRight", (bx+bw/2, by, 0.22), (0.03, bd, 0.28), mat_red)

for nm, lx, ly, sx, sy in [
    ("TopRailBack", bx, by+bd/2, bw, 0.03),
    ("TopRailFront", bx, by-bd/2, bw, 0.03),
    ("TopRailLeft", bx-bw/2, by, 0.03, bd),
    ("TopRailRight", bx+bw/2, by, 0.03, bd),
]:
    box(nm, (lx, ly, bh-0.05+0.06), (sx, sy, 0.04), mat_red)

for nm, lx, ly, sx, sy in [
    ("MidRailBack", bx, by+bd/2, bw, 0.03),
    ("MidRailLeft", bx-bw/2, by, 0.03, bd),
    ("MidRailRight", bx+bw/2, by, 0.03, bd),
]:
    box(nm, (lx, ly, 0.55+0.06), (sx, sy, 0.025), mat_red)

glass_h_upper = (bh - 0.05 - 0.55) / 2
glass_h_lower = (0.55 - 0.28) / 2
for side, lx, ly, sx, sy in [
    ("Back", bx, by+bd/2-0.005, bw-0.06, 0.008),
    ("Left", bx-bw/2+0.005, by, 0.008, bd-0.06),
    ("Right", bx+bw/2-0.005, by, 0.008, bd-0.06),
]:
    box(f"GlassU_{side}", (lx, ly, 0.55+0.06 + glass_h_upper + 0.01), (sx, sy, glass_h_upper*2), mat_glass)
    box(f"GlassL_{side}", (lx, ly, 0.28+0.06 + glass_h_lower), (sx, sy, glass_h_lower*2), mat_glass)

front_y = by - bd/2 + 0.005
box("GlassFrontL", (bx-0.12, front_y, 0.55+0.06 + glass_h_upper+0.01), (0.15, 0.008, glass_h_upper*2), mat_glass)
box("GlassFrontR", (bx+0.12, front_y, 0.55+0.06 + glass_h_upper+0.01), (0.15, 0.008, glass_h_upper*2), mat_glass)

# Phone unit inside
box("PhoneMount", (bx, by+0.15, 0.65), (0.2, 0.05, 0.25), mat_phone_body)
cyl("Handset", (bx, by+0.12, 0.8), 0.015, 0.12, mat_phone_body, rot=(0.3, 0, 0))
cyl("Cord", (bx, by+0.13, 0.7), 0.005, 0.15, mat_dark_metal, rot=(0.5, 0, 0))
box("CoinSlot", (bx, by+0.14, 0.58), (0.08, 0.03, 0.04), mat_metal)

# ─── BOOTH LIGHTING - KEY IMPROVEMENT ──────────────────────
# Interior warm light
booth_light = bpy.data.lights.new("BoothLight", 'POINT')
booth_light.energy = 100
booth_light.color = (1.0, 0.55, 0.2)
booth_light.shadow_soft_size = 0.15
bl_obj = bpy.data.objects.new("BoothLight", booth_light)
scene.collection.objects.link(bl_obj)
bl_obj.location = (bx, by, bh - 0.1)

# Ceiling light emissive - warmer, brighter
box("CeilingLight", (bx, by, bh+0.04), (0.3, 0.3, 0.02), mat_warm_glow)

# Lower booth light for floor glow
booth_light2 = bpy.data.lights.new("BoothLight2", 'POINT')
booth_light2.energy = 30
booth_light2.color = (1.0, 0.6, 0.2)
booth_light2.shadow_soft_size = 0.2
bl2_obj = bpy.data.objects.new("BoothLight2", booth_light2)
scene.collection.objects.link(bl2_obj)
bl2_obj.location = (bx, by, 0.4)

# RED NEON GLOW - NEW: emissive strips on booth frame
# Thin red neon strips along the vertical posts (visible from outside)
for cx, cy in [(bw/2, bd/2), (-bw/2, bd/2), (bw/2, -bd/2), (-bw/2, -bd/2)]:
    box(f"NeonStrip_{cx}_{cy}", (bx+cx, by+cy, bh/2+0.06), (0.02, 0.02, bh*0.8), mat_red_neon)

# Red neon strip along top
box("NeonTop", (bx, by-bd/2, bh+0.08), (bw, 0.02, 0.02), mat_red_neon_strong)
box("NeonTopBack", (bx, by+bd/2, bh+0.08), (bw, 0.02, 0.02), mat_red_neon)
box("NeonTopL", (bx-bw/2, by, bh+0.08), (0.02, bd, 0.02), mat_red_neon)
box("NeonTopR", (bx+bw/2, by, bh+0.08), (0.02, bd, 0.02), mat_red_neon)

# RED SPOT LIGHT inside pointing outward - THE key light for red glow on street
red_spot = bpy.data.lights.new("RedSpot", 'SPOT')
red_spot.energy = 600
red_spot.color = (1.0, 0.02, 0.005)
red_spot.spot_size = math.radians(90)
red_spot.spot_blend = 0.6
red_spot.shadow_soft_size = 0.1
rs_obj = bpy.data.objects.new("RedSpot", red_spot)
scene.collection.objects.link(rs_obj)
rs_obj.location = (bx, by-0.1, 0.7)
rs_obj.rotation_euler = (math.radians(100), 0, 0)  # pointing down/outward

# Second red spot pointing down for ground reflection
red_spot2 = bpy.data.lights.new("RedSpot2", 'SPOT')
red_spot2.energy = 450
red_spot2.color = (1.0, 0.02, 0.005)
red_spot2.spot_size = math.radians(120)
red_spot2.spot_blend = 0.7
red_spot2.shadow_soft_size = 0.15
rs2_obj = bpy.data.objects.new("RedSpot2", red_spot2)
scene.collection.objects.link(rs2_obj)
rs2_obj.location = (bx, by, 0.3)
rs2_obj.rotation_euler = (math.radians(180), 0, 0)  # straight down

# Warm area light near booth for ground spill
area_light = bpy.data.lights.new("BoothSpill", 'AREA')
area_light.energy = 80
area_light.color = (1.0, 0.4, 0.1)
area_light.size = 0.6
al_obj = bpy.data.objects.new("BoothSpill", area_light)
scene.collection.objects.link(al_obj)
al_obj.location = (bx+0.3, by, 0.15)
al_obj.rotation_euler = (0, math.radians(45), 0)

# "電話" sign on top - RED NEON now
box("PhoneSign", (bx, by-bd/2-0.02, bh+0.18), (0.22, 0.03, 0.1), mat_red_neon_strong)

# Scale entire phone booth down to 65%
booth_objs = [o for o in bpy.data.objects if o not in booth_objs_before]
booth_root = bpy.data.objects.new("PhoneBoothRoot", None)
scene.collection.objects.link(booth_root)
booth_root.location = (bx, by, 0.0)
for o in booth_objs:
    o.parent = booth_root
    o.matrix_parent_inverse = booth_root.matrix_world.inverted()
booth_root.scale = (0.65, 0.65, 0.65)

# ─── STREET LAMP ───────────────────────────────────────────
lamp1_objs_before = set(bpy.data.objects)
lamp_x, lamp_y = -1.6, 1.1
cyl("LampPole", (lamp_x, lamp_y, 1.2), 0.03, 2.4, mat_dark_metal)
box("LampArm", (lamp_x-0.15, lamp_y, 2.35), (0.35, 0.03, 0.03), mat_dark_metal)
rbox("LampHousing", (lamp_x-0.3, lamp_y, 2.3), (0.2, 0.12, 0.08), mat_dark_metal, r=0.01)
box("LampGlow", (lamp_x-0.3, lamp_y, 2.27), (0.16, 0.08, 0.02), mat_amber_light)

sl = bpy.data.lights.new("StreetSpot", 'SPOT')
sl.energy = 900
sl.color = (1.0, 0.65, 0.2)
sl.spot_size = math.radians(55)
sl.spot_blend = 0.4
sl.shadow_soft_size = 0.08
sl_obj = bpy.data.objects.new("StreetSpot", sl)
scene.collection.objects.link(sl_obj)
sl_obj.location = (lamp_x-0.3, lamp_y, 2.25)
sl_obj.rotation_euler = (math.radians(2), 0, 0)

# Scale down main street lamp to 75%
lamp1_objs = [o for o in bpy.data.objects if o not in lamp1_objs_before]
lamp1_root = bpy.data.objects.new("StreetLampRoot", None)
scene.collection.objects.link(lamp1_root)
lamp1_root.location = (lamp_x, lamp_y, 0.0)
for o in lamp1_objs:
    o.parent = lamp1_root
    o.matrix_parent_inverse = lamp1_root.matrix_world.inverted()
lamp1_root.scale = (0.75, 0.75, 0.75)

# ─── SECOND STREET LAMP (far) ─────────────────────────────
lamp2_objs_before = set(bpy.data.objects)
lamp2_x, lamp2_y = 4.0, 2.5
cyl("LampPole2", (lamp2_x, lamp2_y, 1.2), 0.025, 2.4, mat_dark_metal)
box("LampArm2", (lamp2_x-0.12, lamp2_y, 2.35), (0.3, 0.025, 0.025), mat_dark_metal)
box("LampGlow2", (lamp2_x-0.25, lamp2_y, 2.27), (0.14, 0.07, 0.02), mat_amber_light)
sl3 = bpy.data.lights.new("StreetSpot2", 'SPOT')
sl3.energy = 700
sl3.color = (1.0, 0.7, 0.25)
sl3.spot_size = math.radians(50)
sl3.spot_blend = 0.5
sl3.shadow_soft_size = 0.1
sl3_obj = bpy.data.objects.new("StreetSpot2", sl3)
scene.collection.objects.link(sl3_obj)
sl3_obj.location = (lamp2_x-0.25, lamp2_y, 2.25)
sl3_obj.rotation_euler = (math.radians(5), 0, 0)

# Scale down far street lamp to 75%
lamp2_objs = [o for o in bpy.data.objects if o not in lamp2_objs_before]
lamp2_root = bpy.data.objects.new("StreetLampRoot2", None)
scene.collection.objects.link(lamp2_root)
lamp2_root.location = (lamp2_x, lamp2_y, 0.0)
for o in lamp2_objs:
    o.parent = lamp2_root
    o.matrix_parent_inverse = lamp2_root.matrix_world.inverted()
lamp2_root.scale = (0.75, 0.75, 0.75)

# ─── THIRD STREET LAMP (foreground right) ─────────────────
lamp3_objs_before = set(bpy.data.objects)
lamp3_x, lamp3_y = 2.6, -1.9
cyl("LampPole3", (lamp3_x, lamp3_y, 1.2), 0.028, 2.4, mat_dark_metal)
box("LampArm3", (lamp3_x-0.12, lamp3_y, 2.35), (0.3, 0.025, 0.025), mat_dark_metal)
rbox("LampHousing3", (lamp3_x-0.26, lamp3_y, 2.3), (0.18, 0.1, 0.08), mat_dark_metal, r=0.01)
box("LampGlow3", (lamp3_x-0.26, lamp3_y, 2.27), (0.14, 0.07, 0.02), mat_amber_light)
sl4 = bpy.data.lights.new("StreetSpot3", 'SPOT')
sl4.energy = 800
sl4.color = (1.0, 0.7, 0.25)
sl4.spot_size = math.radians(55)
sl4.spot_blend = 0.45
sl4.shadow_soft_size = 0.1
sl4_obj = bpy.data.objects.new("StreetSpot3", sl4)
scene.collection.objects.link(sl4_obj)
sl4_obj.location = (lamp3_x-0.26, lamp3_y, 2.25)
sl4_obj.rotation_euler = (math.radians(8), 0, 0)

lamp3_objs = [o for o in bpy.data.objects if o not in lamp3_objs_before]
lamp3_root = bpy.data.objects.new("StreetLampRoot3", None)
scene.collection.objects.link(lamp3_root)
lamp3_root.location = (lamp3_x, lamp3_y, 0.0)
for o in lamp3_objs:
    o.parent = lamp3_root
    o.matrix_parent_inverse = lamp3_root.matrix_world.inverted()
lamp3_root.scale = (0.75, 0.75, 0.75)

# ─── FOURTH STREET LAMP (back left) ───────────────────────
lamp4_objs_before = set(bpy.data.objects)
lamp4_x, lamp4_y = -2.8, 2.6
cyl("LampPole4", (lamp4_x, lamp4_y, 1.2), 0.028, 2.4, mat_dark_metal)
box("LampArm4", (lamp4_x-0.12, lamp4_y, 2.35), (0.3, 0.025, 0.025), mat_dark_metal)
rbox("LampHousing4", (lamp4_x-0.26, lamp4_y, 2.3), (0.18, 0.1, 0.08), mat_dark_metal, r=0.01)
box("LampGlow4", (lamp4_x-0.26, lamp4_y, 2.27), (0.14, 0.07, 0.02), mat_amber_light)
sl5 = bpy.data.lights.new("StreetSpot4", 'SPOT')
sl5.energy = 750
sl5.color = (1.0, 0.7, 0.25)
sl5.spot_size = math.radians(55)
sl5.spot_blend = 0.45
sl5.shadow_soft_size = 0.1
sl5_obj = bpy.data.objects.new("StreetSpot4", sl5)
scene.collection.objects.link(sl5_obj)
sl5_obj.location = (lamp4_x-0.26, lamp4_y, 2.25)
sl5_obj.rotation_euler = (math.radians(10), 0, 0)

lamp4_objs = [o for o in bpy.data.objects if o not in lamp4_objs_before]
lamp4_root = bpy.data.objects.new("StreetLampRoot4", None)
scene.collection.objects.link(lamp4_root)
lamp4_root.location = (lamp4_x, lamp4_y, 0.0)
for o in lamp4_objs:
    o.parent = lamp4_root
    o.matrix_parent_inverse = lamp4_root.matrix_world.inverted()
lamp4_root.scale = (0.75, 0.75, 0.75)

# ─── UTILITY POLE with wires ──────────────────────────────
cyl("UtilityPole", (3.5, 2.0, 1.5), 0.04, 3.0, mat_dark_metal)
box("PoleArm1", (3.5, 2.0, 2.9), (0.7, 0.03, 0.03), mat_dark_metal)
box("PoleArm2", (3.5, 2.0, 2.6), (0.5, 0.03, 0.03), mat_dark_metal)
# Wires
for py_off in [-0.3, 0.0, 0.3]:
    cyl(f"Wire_{py_off}", (0.2, py_off, 2.85), 0.003, 8.0, mat_dark_metal, rot=(0, math.radians(90), 0))
# Cross arm wires
for py_off in [-0.2, 0.2]:
    cyl(f"Wire2_{py_off}", (0.2, py_off, 2.55), 0.003, 7.0, mat_dark_metal, rot=(0, math.radians(90), 0))

# ─── BUILDINGS (backdrop) ──────────────────────────────────
buildings = [
    ("Bldg1", (-2.0, 5.2, 1.5), (1.2, 0.8, 3.0), mat_building),
    ("Bldg2", (-0.6, 5.2, 2.0), (1.0, 0.8, 4.0), mat_building2),
    ("Bldg3", (0.6, 5.2, 1.8), (1.1, 0.8, 3.6), mat_building),
    ("Bldg4", (1.8, 5.2, 1.3), (1.0, 0.8, 2.6), mat_building2),
    ("Bldg5", (3.0, 5.2, 2.2), (1.2, 0.8, 4.4), mat_building),
]
for nm, loc, dim, mt in buildings:
    box(nm, loc, dim, mt)

box("BldgL1", (-3.5, 0.5, 1.5), (0.8, 1.5, 3.0), mat_building)
box("BldgL2", (-3.5, -0.8, 1.8), (0.8, 1.2, 3.6), mat_building2)
box("BldgR1", (5.0, 0.0, 1.2), (1.0, 2.0, 2.4), mat_building)

# Lit windows
windows = [
    (-0.6, 4.79, 1.8, 0.12, 0.15), (-0.6, 4.79, 2.3, 0.12, 0.15),
    (-0.4, 4.79, 1.5, 0.1, 0.12), (0.6, 4.79, 1.5, 0.12, 0.15),
    (0.6, 4.79, 2.1, 0.12, 0.15), (1.8, 4.79, 1.2, 0.1, 0.12),
    (-2.0, 4.79, 1.6, 0.1, 0.12), (-2.0, 4.79, 2.2, 0.1, 0.12),
    (3.0, 4.79, 2.0, 0.12, 0.15), (3.0, 4.79, 3.0, 0.12, 0.15),
    (-3.49, 0.5, 1.5, 0.12, 0.15), (-3.49, 0.2, 2.0, 0.1, 0.12),
    (-0.8, 4.79, 2.8, 0.1, 0.12), (0.3, 4.79, 2.5, 0.1, 0.12),
    (2.5, 4.79, 2.8, 0.12, 0.15), (4.8, -0.5, 1.5, 0.12, 0.15),
]
for i, (wx, wy, wz, ws, wh) in enumerate(windows):
    m = mat_window_lit if i % 3 != 2 else emit_mat(f"WinCool_{i}", (0.6, 0.8, 1.0, 1.0), 8.0)
    box(f"Window_{i}", (wx, wy, wz), (ws, 0.02, wh), m)

# ─── SKY GRADIENT + STARS ────────────────────────────────
# Large emissive backdrop to avoid black void
box("SkyBackBottom", (1.0, 6.8, 1.6), (7.5, 0.08, 1.6), mat_sky_bottom)
box("SkyBackTop", (1.0, 6.8, 3.8), (7.5, 0.08, 1.8), mat_sky_top)
# Subtle horizon glow panel
box("SkyHorizonGlow", (1.0, 6.6, 0.7), (7.0, 0.06, 0.6), emit_mat("SkyGlow", (0.08, 0.12, 0.2, 1.0), 4.0))

# Stars scattered across the upper sky
random.seed(7)
for i in range(60):
    sx = random.uniform(-4.5, 5.5)
    sy = random.uniform(6.7, 7.2)
    sz = random.uniform(3.2, 5.3)
    sphere(f"Star_{i}", (sx, sy, sz), 0.02, mat_star)

# ─── CONVENIENCE STORE (with bright signage) ──────────────
# Brighter, bigger sign
box("ConvSign", (0.6, 4.78, 2.8), (0.7, 0.04, 0.18), mat_conv_store)
# Bar/restaurant sign
box("BarSign", (1.8, 4.78, 2.0), (0.4, 0.03, 0.12), mat_sign_glow2)
# Additional neon signs
box("KaraokeSign", (-1.5, 4.78, 2.5), (0.35, 0.03, 0.1), mat_neon_pink)
box("DrugStoreSign", (3.0, 4.78, 3.5), (0.5, 0.03, 0.12), mat_neon_blue)
# Distant neon billboard
box("DistantNeonSign", (4.2, 4.78, 2.6), (0.7, 0.03, 0.18), mat_neon_far)

# Store front lighting (convenience store light spill)
conv_light = bpy.data.lights.new("ConvLight", 'SPOT')
conv_light.energy = 100
conv_light.color = (0.5, 1.0, 0.7)
conv_light.spot_size = math.radians(70)
conv_light.spot_blend = 0.5
conv_light.shadow_soft_size = 0.15
cl_obj = bpy.data.objects.new("ConvLight", conv_light)
scene.collection.objects.link(cl_obj)
cl_obj.location = (0.6, 4.7, 2.5)
cl_obj.rotation_euler = (math.radians(160), 0, 0)

# ─── TRAFFIC LIGHT ─────────────────────────────────────────
tl_x, tl_y = 3.0, 2.0
cyl("TrafficPole", (tl_x, tl_y, 1.2), 0.025, 2.4, mat_dark_metal)
box("TrafficArm", (tl_x-0.4, tl_y, 2.35), (0.8, 0.025, 0.025), mat_dark_metal)
# Traffic light housing
rbox("TrafficBox", (tl_x-0.8, tl_y, 2.35), (0.08, 0.08, 0.22), mat_dark_metal, r=0.01)
# Red light (active)
box("TLRed", (tl_x-0.8, tl_y-0.042, 2.42), (0.04, 0.01, 0.04), mat_traffic_red)
# Green light (dim)
box("TLGreen", (tl_x-0.8, tl_y-0.042, 2.28), (0.04, 0.01, 0.04),
    emit_mat("TLGreenDim", (0.05, 0.3, 0.1, 1.0), 3.5))

# Traffic light glow
tl_light = bpy.data.lights.new("TrafficGlow", 'SPOT')
tl_light.energy = 30
tl_light.color = (1.0, 0.1, 0.05)
tl_light.spot_size = math.radians(40)
tl_light.spot_blend = 0.6
tl_obj = bpy.data.objects.new("TrafficGlow", tl_light)
scene.collection.objects.link(tl_obj)
tl_obj.location = (tl_x-0.8, tl_y-0.1, 2.42)
tl_obj.rotation_euler = (math.radians(100), 0, 0)

# ─── VENDING MACHINES (2) ─────────────────────────────────
# Blue vending machine
rbox("VendingMachine1", (1.5, 4.2, 0.45), (0.3, 0.25, 0.85), mat_vend, r=0.02)
box("VendLight1", (1.5, 3.95, 0.7), (0.25, 0.02, 0.2), mat_vend_glow)
# Red/orange vending machine
rbox("VendingMachine2", (1.15, 4.2, 0.45), (0.28, 0.25, 0.85), mat_vend2, r=0.02)
box("VendLight2", (1.15, 3.95, 0.7), (0.22, 0.02, 0.2), mat_vend_glow2)

# Vending machine light spill
vm_light = bpy.data.lights.new("VendSpill", 'POINT')
vm_light.energy = 15
vm_light.color = (0.4, 0.7, 1.0)
vm_light.shadow_soft_size = 0.2
vm_obj = bpy.data.objects.new("VendSpill", vm_light)
scene.collection.objects.link(vm_obj)
vm_obj.location = (1.3, 3.9, 0.5)

# ─── GARBAGE BIN ───────────────────────────────────────────
cyl("GarbageBin", (-1.8, -0.7, 0.2), 0.08, 0.4, mat_garbage)
cyl("GarbageLid", (-1.8, -0.7, 0.42), 0.09, 0.03, mat_dark_metal)

# ─── BENCH ────────────────────────────────────────────────
bench_x, bench_y = -2.2, 1.3
box("BenchSeat", (bench_x, bench_y, 0.25), (0.5, 0.18, 0.04), mat_bench_wood)
box("BenchBack", (bench_x, bench_y-0.08, 0.45), (0.5, 0.04, 0.25), mat_bench_wood)
for lx in [-0.22, 0.22]:
    box(f"BenchLeg_{lx}", (bench_x+lx, bench_y-0.05, 0.12), (0.03, 0.03, 0.12), mat_bench_metal)
    box(f"BenchLeg2_{lx}", (bench_x+lx, bench_y+0.05, 0.12), (0.03, 0.03, 0.12), mat_bench_metal)

# ─── FIRE HYDRANT ─────────────────────────────────────────
hx, hy = 2.2, -1.0
cyl("HydrantBase", (hx, hy, 0.18), 0.07, 0.36, mat_hydrant)
cyl("HydrantTop", (hx, hy, 0.42), 0.09, 0.08, mat_hydrant)
cyl("HydrantNozzleL", (hx-0.08, hy, 0.28), 0.03, 0.08, mat_hydrant, rot=(0, math.radians(90), 0))
cyl("HydrantNozzleR", (hx+0.08, hy, 0.28), 0.03, 0.08, mat_hydrant, rot=(0, math.radians(90), 0))

# ─── MAILBOX ──────────────────────────────────────────────
mx, my = -0.5, -2.2
cyl("MailboxPost", (mx, my, 0.35), 0.03, 0.7, mat_mailbox)
rbox("MailboxBox", (mx, my, 0.7), (0.22, 0.12, 0.12), mat_mailbox, r=0.02)
box("MailboxSlot", (mx+0.12, my, 0.7), (0.02, 0.12, 0.08), mat_dark_metal)

# ─── NEWSPAPER STAND ──────────────────────────────────────
nx, ny = 0.9, 3.8
rbox("NewsStandBase", (nx, ny, 0.35), (0.25, 0.18, 0.35), mat_news, r=0.02)
box("NewsStandTop", (nx, ny-0.07, 0.6), (0.25, 0.05, 0.08), mat_news)
box("NewsStandSign", (nx, ny-0.12, 0.7), (0.22, 0.02, 0.1), emit_mat("NewsGlow", (0.8, 0.9, 1.0, 1.0), 6.0))

# ─── MANHOLE COVER ─────────────────────────────────────────
cyl("Manhole", (1.2, 0.0, 0.005), 0.15, 0.01, mat_manhole)

# ─── ROAD MARKINGS ─────────────────────────────────────────
# Center line dashes
for i in range(8):
    box(f"RoadLine_{i}", (2.0, -2.5 + i*0.7, 0.008), (0.04, 0.3, 0.01), mat_white_stripe)
# Stop line
box("StopLine", (1.2, -1.8, 0.008), (1.5, 0.08, 0.01), mat_white_stripe)

# ─── BICYCLE ──────────────────────────────────────────────
bike_x, bike_y = -2.5, -0.3
# Wheels (thin cylinders)
cyl("BikeWheel1", (bike_x, bike_y, 0.15), 0.13, 0.02, mat_bicycle, rot=(math.radians(90), 0, 0))
cyl("BikeWheel2", (bike_x+0.3, bike_y, 0.15), 0.13, 0.02, mat_bicycle, rot=(math.radians(90), 0, 0))
# Frame
box("BikeFrame", (bike_x+0.15, bike_y, 0.2), (0.35, 0.02, 0.02), mat_bicycle, rot=(0, 0, math.radians(5)))
box("BikeSeat", (bike_x+0.05, bike_y, 0.32), (0.06, 0.03, 0.02), mat_rubber)
# Handlebars
box("BikeHandle", (bike_x+0.3, bike_y, 0.3), (0.02, 0.12, 0.02), mat_bicycle)

# ─── STREET SIGNS ──────────────────────────────────────────
# Street sign on pole
cyl("SignPole", (0.1, -1.2, 0.8), 0.015, 1.6, mat_sign_post)
box("StreetSign1", (0.1, -1.2, 1.55), (0.25, 0.02, 0.08), mat_sign_face)
box("StreetSign2", (0.1, -1.2, 1.4), (0.2, 0.02, 0.06),
    emit_mat("SignReflect", (0.8, 0.8, 0.8, 1.0), 3.0))

# ─── AWNINGS ──────────────────────────────────────────────
for i, (ax, az, aw) in enumerate([(-0.6, 1.1, 0.5), (0.6, 0.9, 0.4), (1.8, 0.8, 0.35)]):
    box(f"Awning_{i}", (ax, 4.78, az), (aw, 0.15, 0.02), mat_awning if i%2==0 else mat_awning2)

# ─── AC UNITS ─────────────────────────────────────────────
for i, (acx, acz) in enumerate([(-1.6, 1.3), (-0.3, 1.8), (1.0, 1.6), (2.5, 1.4)]):
    rbox(f"AC_{i}", (acx, 4.78, acz), (0.15, 0.1, 0.1), mat_ac, r=0.01)

# ─── PIPES ─────────────────────────────────────────────────
for i, (px, pz, ph) in enumerate([(-1.8, 1.5, 1.5), (0.2, 1.5, 2.0), (2.2, 1.2, 1.8)]):
    cyl(f"Pipe_{i}", (px, 4.78, pz), 0.015, ph, mat_dark_metal)

# ─── SHUTTERS ──────────────────────────────────────────────
box("Shutter1", (-0.6, 4.78, 0.45), (0.8, 0.03, 0.85), mat_shutter)
box("Shutter2", (1.8, 4.78, 0.4), (0.6, 0.03, 0.75), mat_shutter)

# ─── NEON ACCENTS on buildings ─────────────────────────────
box("NeonAccent1", (-3.49, -0.3, 2.2), (0.02, 0.4, 0.04), emit_mat("Neon1", (1.0, 0.2, 0.4, 1.0), 6.0))
box("NeonAccent2", (-3.49, 0.8, 1.8), (0.02, 0.3, 0.04), emit_mat("Neon2", (0.2, 0.5, 1.0, 1.0), 5.0))
box("NeonAccent3", (4.99, -0.5, 1.8), (0.02, 0.5, 0.04), emit_mat("Neon3", (1.0, 0.5, 0.1, 1.0), 5.0))

# ─── TRASH CAN ─────────────────────────────────────────────
cyl("TrashCan", (1.2, 4.1, 0.2), 0.06, 0.4, mat_dark_metal)

# ─── RAIN ──────────────────────────────────────────────────
rain_mat = mat("Rain", (0.5, 0.55, 0.7, 1.0), roughness=0.1, metallic=0.0)
random.seed(42)
for i in range(120):
    rx = random.uniform(-2.5, 4.0)
    ry = random.uniform(-2.5, 3.0)
    rz = random.uniform(0.3, 2.8)
    cyl(f"Rain_{i}", (rx, ry, rz), 0.002, 0.1, rain_mat, rot=(random.uniform(-0.15, 0.15), 0, 0))

# ─── EXPORT GLB ────────────────────────────────────────────
glb_path = os.path.join(OUT, "phone-booth.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
print(f"Exported: {glb_path}")

print("DONE!")
