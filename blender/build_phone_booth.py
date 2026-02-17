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
        # Transmission for glass
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

# ─── Clear & Setup ─────────────────────────────────────────
clear_scene()
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.film_transparent = False

# GPU Metal
prefs = bpy.context.preferences.addons.get('cycles')
if prefs:
    cp = prefs.preferences
    cp.compute_device_type = 'METAL'
    cp.get_devices()
    for d in cp.devices:
        d.use = True

# World - dark night sky with slight blue
world = bpy.data.worlds.new("NightWorld")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
for n in list(wn): wn.remove(n)
bg = wn.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.01, 0.015, 0.035, 1.0)
bg.inputs["Strength"].default_value = 0.3
out = wn.new("ShaderNodeOutputWorld")
wl.new(bg.outputs["Background"], out.inputs["Surface"])

# ─── Materials ─────────────────────────────────────────────
mat_red = mat("PhoneBoothRed", (0.7, 0.05, 0.02, 1.0), roughness=0.35, metallic=0.1)
mat_red_dark = mat("RedDark", (0.5, 0.03, 0.01, 1.0), roughness=0.4, metallic=0.15)
mat_glass = glass_mat("Glass", (0.6, 0.75, 0.8, 1.0), roughness=0.02, alpha=0.12)
mat_metal = mat("Metal", (0.15, 0.15, 0.17, 1.0), roughness=0.3, metallic=0.9)
mat_dark_metal = mat("DarkMetal", (0.05, 0.05, 0.06, 1.0), roughness=0.25, metallic=0.95)
mat_pavement = mat("WetPavement", (0.04, 0.04, 0.045, 1.0), roughness=0.12, metallic=0.0)
mat_sidewalk = mat("Sidewalk", (0.08, 0.08, 0.07, 1.0), roughness=0.15, metallic=0.0)
mat_building = mat("Building", (0.03, 0.03, 0.04, 1.0), roughness=0.8, metallic=0.0)
mat_building2 = mat("Building2", (0.04, 0.035, 0.05, 1.0), roughness=0.75, metallic=0.0)
mat_concrete = mat("Concrete", (0.06, 0.06, 0.055, 1.0), roughness=0.85, metallic=0.0)
mat_phone_body = mat("PhoneBody", (0.02, 0.02, 0.02, 1.0), roughness=0.5, metallic=0.3)
mat_booth_floor = mat("BoothFloor", (0.05, 0.05, 0.04, 1.0), roughness=0.4, metallic=0.0)
mat_warm_glow = emit_mat("WarmGlow", (1.0, 0.7, 0.3, 1.0), strength=15.0)
mat_amber_light = emit_mat("AmberLight", (1.0, 0.65, 0.2, 1.0), strength=25.0)
mat_sign_glow = emit_mat("SignGlow", (0.2, 0.8, 1.0, 1.0), strength=4.0)
mat_sign_glow2 = emit_mat("SignGlow2", (1.0, 0.3, 0.5, 1.0), strength=3.0)
mat_window_lit = emit_mat("WindowLit", (1.0, 0.85, 0.5, 1.0), strength=1.5)
mat_white_stripe = mat("WhiteStripe", (0.6, 0.6, 0.6, 1.0), roughness=0.5)
mat_curb = mat("Curb", (0.1, 0.1, 0.09, 1.0), roughness=0.6)
mat_puddle = mat("Puddle", (0.02, 0.025, 0.04, 1.0), roughness=0.02, metallic=0.0)

# ─── Ground ────────────────────────────────────────────────
# Main wet road
box("Road", (1.0, 0, -0.01), (6, 5, 0.02), mat_pavement)
# Sidewalk (raised slightly)
box("Sidewalk", (-0.8, 0, 0.03), (1.8, 5, 0.06), mat_sidewalk)
# Curb
box("Curb", (0.05, 0, 0.04), (0.12, 5, 0.08), mat_curb)

# Rain puddles on the road - irregular placement
for i, (px, py, sx, sy) in enumerate([
    (0.8, -0.5, 0.6, 0.35), (1.5, 0.8, 0.45, 0.3), (2.0, -0.3, 0.5, 0.25),
    (-0.3, 0.4, 0.3, 0.2), (0.5, 1.2, 0.35, 0.2), (1.2, -1.0, 0.55, 0.3),
]):
    box(f"Puddle_{i}", (px, py, 0.005), (sx, sy, 0.01), mat_puddle)

# ─── PHONE BOOTH (center-left) ────────────────────────────
bx, by = -1.4, 0.6  # booth to the side+back — center is clear for character
bw, bd, bh = 0.45, 0.45, 1.1  # width, depth, height

# Floor
box("BoothFloor", (bx, by, 0.06), (bw+0.06, bd+0.06, 0.03), mat_booth_floor)

# Four corner posts (red metal)
for cx, cy in [(bw/2, bd/2), (-bw/2, bd/2), (bw/2, -bd/2), (-bw/2, -bd/2)]:
    rbox(f"Post_{cx}_{cy}", (bx+cx, by+cy, bh/2+0.06), (0.04, 0.04, bh), mat_red, r=0.005)

# Top frame (red)
box("TopFrame", (bx, by, bh+0.06), (bw+0.06, bd+0.06, 0.05), mat_red)
# Roof cap
rbox("RoofCap", (bx, by, bh+0.12), (bw+0.12, bd+0.12, 0.04), mat_red_dark, r=0.01)

# Bottom rail (red, 3 sides - front is open/door)
box("BottomRailBack", (bx, by+bd/2, 0.22), (bw, 0.03, 0.28), mat_red)
box("BottomRailLeft", (bx-bw/2, by, 0.22), (0.03, bd, 0.28), mat_red)
box("BottomRailRight", (bx+bw/2, by, 0.22), (0.03, bd, 0.28), mat_red)

# Top rail (all 4 sides)
for nm, lx, ly, sx, sy in [
    ("TopRailBack", bx, by+bd/2, bw, 0.03),
    ("TopRailFront", bx, by-bd/2, bw, 0.03),
    ("TopRailLeft", bx-bw/2, by, 0.03, bd),
    ("TopRailRight", bx+bw/2, by, 0.03, bd),
]:
    box(nm, (lx, ly, bh-0.05+0.06), (sx, sy, 0.04), mat_red)

# Mid rail
for nm, lx, ly, sx, sy in [
    ("MidRailBack", bx, by+bd/2, bw, 0.03),
    ("MidRailLeft", bx-bw/2, by, 0.03, bd),
    ("MidRailRight", bx+bw/2, by, 0.03, bd),
]:
    box(nm, (lx, ly, 0.55+0.06), (sx, sy, 0.025), mat_red)

# Glass panels (3 sides - back, left, right; upper and lower)
glass_h_upper = (bh - 0.05 - 0.55) / 2  # from mid rail to top rail
glass_h_lower = (0.55 - 0.28) / 2  # from bottom rail to mid rail
for side, lx, ly, sx, sy in [
    ("Back", bx, by+bd/2-0.005, bw-0.06, 0.008),
    ("Left", bx-bw/2+0.005, by, 0.008, bd-0.06),
    ("Right", bx+bw/2-0.005, by, 0.008, bd-0.06),
]:
    # Upper glass
    box(f"GlassU_{side}", (lx, ly, 0.55+0.06 + glass_h_upper + 0.01), (sx, sy, glass_h_upper*2), mat_glass)
    # Lower glass
    box(f"GlassL_{side}", (lx, ly, 0.28+0.06 + glass_h_lower), (sx, sy, glass_h_lower*2), mat_glass)

# Front glass panels (door area - two panels with gap)
front_y = by - bd/2 + 0.005
# Left door panel
box("GlassFrontL", (bx-0.12, front_y, 0.55+0.06 + glass_h_upper+0.01), (0.15, 0.008, glass_h_upper*2), mat_glass)
# Right door panel  
box("GlassFrontR", (bx+0.12, front_y, 0.55+0.06 + glass_h_upper+0.01), (0.15, 0.008, glass_h_upper*2), mat_glass)

# Phone unit inside
box("PhoneMount", (bx, by+0.15, 0.65), (0.2, 0.05, 0.25), mat_phone_body)
# Handset
cyl("Handset", (bx, by+0.12, 0.8), 0.015, 0.12, mat_phone_body, rot=(0.3, 0, 0))
# Cord
cyl("Cord", (bx, by+0.13, 0.7), 0.005, 0.15, mat_dark_metal, rot=(0.5, 0, 0))
# Coin slot area
box("CoinSlot", (bx, by+0.14, 0.58), (0.08, 0.03, 0.04), mat_metal)

# Interior warm light (THE key visual - amber glow from inside)
booth_light = bpy.data.lights.new("BoothLight", 'POINT')
booth_light.energy = 60
booth_light.color = (1.0, 0.7, 0.3)
booth_light.shadow_soft_size = 0.15
bl_obj = bpy.data.objects.new("BoothLight", booth_light)
scene.collection.objects.link(bl_obj)
bl_obj.location = (bx, by, bh - 0.1)

# Ceiling light emissive panel
box("CeilingLight", (bx, by, bh+0.04), (0.3, 0.3, 0.02), mat_warm_glow)

# Second booth light (lower, for floor glow)
booth_light2 = bpy.data.lights.new("BoothLight2", 'POINT')
booth_light2.energy = 20
booth_light2.color = (1.0, 0.75, 0.35)
booth_light2.shadow_soft_size = 0.2
bl2_obj = bpy.data.objects.new("BoothLight2", booth_light2)
scene.collection.objects.link(bl2_obj)
bl2_obj.location = (bx, by, 0.4)

# "電話" sign on top (small emissive box)
box("PhoneSign", (bx, by-bd/2-0.02, bh+0.18), (0.2, 0.02, 0.08), mat_warm_glow)

# ─── STREET LAMP ───────────────────────────────────────────
lamp_x, lamp_y = 1.2, -0.5
# Pole
cyl("LampPole", (lamp_x, lamp_y, 1.2), 0.03, 2.4, mat_dark_metal)
# Arm
box("LampArm", (lamp_x-0.15, lamp_y, 2.35), (0.35, 0.03, 0.03), mat_dark_metal)
# Lamp housing
rbox("LampHousing", (lamp_x-0.3, lamp_y, 2.3), (0.2, 0.12, 0.08), mat_dark_metal, r=0.01)
# Lamp emissive
box("LampGlow", (lamp_x-0.3, lamp_y, 2.27), (0.16, 0.08, 0.02), mat_amber_light)

# Street lamp spot light
sl = bpy.data.lights.new("StreetSpot", 'SPOT')
sl.energy = 400
sl.color = (1.0, 0.7, 0.25)
sl.spot_size = math.radians(55)
sl.spot_blend = 0.4
sl.shadow_soft_size = 0.08
sl_obj = bpy.data.objects.new("StreetSpot", sl)
scene.collection.objects.link(sl_obj)
sl_obj.location = (lamp_x-0.3, lamp_y, 2.25)
sl_obj.rotation_euler = (math.radians(2), 0, 0)

# Second subtle fill from lamp
sl2 = bpy.data.lights.new("StreetFill", 'POINT')
sl2.energy = 15
sl2.color = (1.0, 0.75, 0.35)
sl2.shadow_soft_size = 0.3
sl2_obj = bpy.data.objects.new("StreetFill", sl2)
scene.collection.objects.link(sl2_obj)
sl2_obj.location = (lamp_x-0.3, lamp_y, 2.2)

# ─── BUILDINGS (backdrop) ──────────────────────────────────
# Back row of buildings
buildings = [
    ("Bldg1", (-2.0, 2.5, 1.5), (1.2, 0.8, 3.0), mat_building),
    ("Bldg2", (-0.6, 2.5, 2.0), (1.0, 0.8, 4.0), mat_building2),
    ("Bldg3", (0.6, 2.5, 1.8), (1.1, 0.8, 3.6), mat_building),
    ("Bldg4", (1.8, 2.5, 1.3), (1.0, 0.8, 2.6), mat_building2),
    ("Bldg5", (3.0, 2.5, 2.2), (1.2, 0.8, 4.4), mat_building),
]
for nm, loc, dim, mt in buildings:
    box(nm, loc, dim, mt)

# Side buildings (left)
box("BldgL1", (-2.2, 0.5, 1.5), (0.8, 1.5, 3.0), mat_building)
box("BldgL2", (-2.2, -0.8, 1.8), (0.8, 1.2, 3.6), mat_building2)

# Right side buildings
box("BldgR1", (3.5, 0.0, 1.2), (1.0, 2.0, 2.4), mat_building)

# Lit windows on buildings (emissive rectangles)
windows = [
    (-0.6, 2.09, 1.8, 0.12, 0.15), (-0.6, 2.09, 2.3, 0.12, 0.15),
    (-0.4, 2.09, 1.5, 0.1, 0.12), (0.6, 2.09, 1.5, 0.12, 0.15),
    (0.6, 2.09, 2.1, 0.12, 0.15), (1.8, 2.09, 1.2, 0.1, 0.12),
    (-2.0, 2.09, 1.6, 0.1, 0.12), (-2.0, 2.09, 2.2, 0.1, 0.12),
    (3.0, 2.09, 2.0, 0.12, 0.15), (3.0, 2.09, 3.0, 0.12, 0.15),
    (-2.19, 0.5, 1.5, 0.12, 0.15), (-2.19, 0.2, 2.0, 0.1, 0.12),
]
for i, (wx, wy, wz, ws, wh) in enumerate(windows):
    m = mat_window_lit if i % 3 != 2 else emit_mat(f"WinCool_{i}", (0.6, 0.8, 1.0, 1.0), 1.0)
    box(f"Window_{i}", (wx, wy, wz), (ws, 0.02, wh), m)

# ─── CONVENIENCE STORE SIGN ───────────────────────────────
# Glowing sign on building behind
box("ConvSign", (0.6, 2.08, 2.8), (0.6, 0.03, 0.15), mat_sign_glow)
# Another sign (pinkish - like a bar/restaurant)
box("BarSign", (1.8, 2.08, 2.0), (0.35, 0.03, 0.1), mat_sign_glow2)

# Building detail: awnings
mat_awning = mat("Awning", (0.06, 0.04, 0.03, 1.0), roughness=0.8)
mat_awning2 = mat("Awning2", (0.04, 0.04, 0.06, 1.0), roughness=0.8)
for i, (ax, az, aw) in enumerate([(-0.6, 1.1, 0.5), (0.6, 0.9, 0.4), (1.8, 0.8, 0.35)]):
    box(f"Awning_{i}", (ax, 2.08, az), (aw, 0.15, 0.02), mat_awning if i%2==0 else mat_awning2)
    # Awning supports
    box(f"AwnSupL_{i}", (ax-aw/2+0.02, 2.08, az-0.05), (0.02, 0.1, 0.08), mat_dark_metal)
    box(f"AwnSupR_{i}", (ax+aw/2-0.02, 2.08, az-0.05), (0.02, 0.1, 0.08), mat_dark_metal)

# AC units on buildings
mat_ac = mat("ACUnit", (0.08, 0.08, 0.09, 1.0), roughness=0.6, metallic=0.3)
for i, (acx, acz) in enumerate([(-1.6, 1.3), (-0.3, 1.8), (1.0, 1.6), (2.5, 1.4)]):
    rbox(f"AC_{i}", (acx, 2.08, acz), (0.15, 0.1, 0.1), mat_ac, r=0.01)

# Pipes on buildings  
for i, (px, pz, ph) in enumerate([(-1.8, 1.5, 1.5), (0.2, 1.5, 2.0), (2.2, 1.2, 1.8)]):
    cyl(f"Pipe_{i}", (px, 2.08, pz), 0.015, ph, mat_dark_metal)

# Vending machine (classic Japanese street detail)
mat_vend = mat("Vending", (0.05, 0.08, 0.12, 1.0), roughness=0.4, metallic=0.2)
mat_vend_glow = emit_mat("VendGlow", (0.3, 0.7, 1.0, 1.0), strength=3.0)
rbox("VendingMachine", (1.5, 1.8, 0.45), (0.3, 0.25, 0.85), mat_vend, r=0.02)
box("VendLight", (1.5, 1.55, 0.7), (0.25, 0.02, 0.15), mat_vend_glow)

# Trash can near vending machine
cyl("TrashCan", (1.2, 1.7, 0.2), 0.06, 0.4, mat_dark_metal)

# Ground-level store fronts
mat_shutter = mat("Shutter", (0.04, 0.04, 0.05, 1.0), roughness=0.5, metallic=0.4)
box("Shutter1", (-0.6, 2.08, 0.45), (0.8, 0.03, 0.85), mat_shutter)
box("Shutter2", (1.8, 2.08, 0.4), (0.6, 0.03, 0.75), mat_shutter)

# Small neon accent
box("NeonAccent", (-2.19, -0.3, 2.2), (0.02, 0.4, 0.04), emit_mat("Neon1", (1.0, 0.2, 0.4, 1.0), 6.0))

# ─── POWER LINES (subtle detail) ──────────────────────────
for py_off in [-0.3, 0.3]:
    cyl(f"PowerLine_{py_off}", (0.5, py_off, 2.8), 0.003, 5.0, mat_dark_metal, rot=(0, math.radians(90), 0))

# ─── UTILITY POLE ─────────────────────────────────────────
cyl("UtilityPole", (2.5, -0.8, 1.5), 0.04, 3.0, mat_dark_metal)
box("PoleArm", (2.5, -0.8, 2.9), (0.6, 0.03, 0.03), mat_dark_metal)

# ─── WHITE ROAD MARKINGS ──────────────────────────────────
for i in range(6):
    box(f"RoadLine_{i}", (1.5 + i*0.01, -2.0 + i*0.7, 0.008), (0.04, 0.3, 0.01), mat_white_stripe)

# ─── RAIN EFFECT (scattered small cylinders) ──────────────
rain_mat = mat("Rain", (0.5, 0.55, 0.7, 1.0), roughness=0.1, metallic=0.0)
random.seed(42)
for i in range(80):
    rx = random.uniform(-2.5, 3.5)
    ry = random.uniform(-2.5, 2.5)
    rz = random.uniform(0.3, 2.5)
    cyl(f"Rain_{i}", (rx, ry, rz), 0.002, 0.08, rain_mat, rot=(random.uniform(-0.1, 0.1), 0, 0))

# ─── VOLUME FOG (atmosphere) ───────────────────────────────
# Add volume scatter to world for atmospheric fog
world.node_tree.nodes.clear()
bg = world.node_tree.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (0.01, 0.015, 0.035, 1.0)
bg.inputs["Strength"].default_value = 0.3
vol = world.node_tree.nodes.new("ShaderNodeVolumeScatter")
vol.inputs["Color"].default_value = (0.6, 0.65, 0.75, 1.0)
vol.inputs["Density"].default_value = 0.015
vol.inputs["Anisotropy"].default_value = 0.3
out = world.node_tree.nodes.new("ShaderNodeOutputWorld")
world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
world.node_tree.links.new(vol.outputs["Volume"], out.inputs["Volume"])

# ─── CAMERAS ───────────────────────────────────────────────
cameras = {
    "main": {
        "loc": (1.2, -2.5, 1.1),
        "rot": (math.radians(78), 0, math.radians(18)),
        "focal": 32,
    },
    "close": {
        "loc": (-0.1, -1.3, 0.85),
        "rot": (math.radians(82), 0, math.radians(5)),
        "focal": 45,
    },
    "wide": {
        "loc": (2.0, -3.2, 1.6),
        "rot": (math.radians(72), 0, math.radians(22)),
        "focal": 22,
    },
    "street": {
        "loc": (2.2, -1.8, 0.7),
        "rot": (math.radians(86), 0, math.radians(55)),
        "focal": 28,
    },
}

for name, cfg in cameras.items():
    cam_data = bpy.data.cameras.new(f"Cam_{name}")
    cam_data.lens = cfg["focal"]
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.8
    cam_obj = bpy.data.objects.new(f"Cam_{name}", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = cfg["loc"]
    cam_obj.rotation_euler = cfg["rot"]
    
    # Focus on phone booth
    cam_data.dof.focus_distance = (
        sum((a-b)**2 for a,b in zip(cfg["loc"], (bx, by, 0.6)))**0.5
    )

# ─── RENDER ALL VIEWS ─────────────────────────────────────
for name in cameras:
    scene.camera = bpy.data.objects[f"Cam_{name}"]
    scene.render.filepath = os.path.join(OUT, f"phone_{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: phone_{name}.png")

# ─── EXPORT GLB ────────────────────────────────────────────
glb_path = os.path.join(OUT, "phone-booth.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
print(f"Exported: {glb_path}")

print("DONE!")
