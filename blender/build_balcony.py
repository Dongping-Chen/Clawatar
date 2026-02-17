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

# ── Scene Setup ──────────────────────────────────────────────────────
clear_scene()
OUT = "/tmp/blender-room"

# Materials
m_floor = mat("Floor", (0.35, 0.22, 0.14, 1), roughness=0.85)  # warm wood
m_floor_tile = mat("FloorTile", (0.55, 0.38, 0.25, 1), roughness=0.75)
m_railing = mat("Railing", (0.15, 0.15, 0.15, 1), roughness=0.3, metallic=0.9)
m_wall = mat("Wall", (0.85, 0.75, 0.6, 1), roughness=0.9)
m_table_top = mat("TableTop", (0.2, 0.2, 0.22, 1), roughness=0.35, metallic=0.8)
m_table_leg = mat("TableLeg", (0.18, 0.18, 0.2, 1), roughness=0.3, metallic=0.85)
m_chair = mat("Chair", (0.18, 0.18, 0.2, 1), roughness=0.35, metallic=0.8)
m_chair_seat = mat("ChairSeat", (0.6, 0.45, 0.3, 1), roughness=0.8)
m_pot = mat("Pot", (0.65, 0.35, 0.2, 1), roughness=0.8)
m_soil = mat("Soil", (0.2, 0.12, 0.08, 1), roughness=0.95)
m_leaf = mat("Leaf", (0.15, 0.35, 0.1, 1), roughness=0.8)
m_leaf2 = mat("Leaf2", (0.1, 0.25, 0.08, 1), roughness=0.8)
m_wire = mat("Wire", (0.08, 0.08, 0.08, 1), roughness=0.5, metallic=0.6)
m_bulb = emit_mat("Bulb", (1.0, 0.85, 0.5, 1), strength=15.0)
m_building_dark = mat("BuildingDark", (0.04, 0.03, 0.05, 1), roughness=0.95)
m_building_med = mat("BuildingMed", (0.06, 0.05, 0.07, 1), roughness=0.95)
m_window_glow = emit_mat("WindowGlow", (1.0, 0.8, 0.4, 1), strength=3.0)
m_cup = mat("Cup", (0.9, 0.88, 0.85, 1), roughness=0.4)
m_drink = emit_mat("Drink", (0.8, 0.4, 0.1, 1), strength=0.5)
m_cushion = mat("Cushion", (0.7, 0.25, 0.2, 1), roughness=0.9)

# Sky gradient - multiple emissive layers (THE hero)
sky_colors = [
    # (y_offset, color, strength, height)
    (-2.0, (1.0, 0.45, 0.05, 1), 12.0, 3.0),    # deep orange at horizon
    (-0.5, (1.0, 0.55, 0.15, 1), 10.0, 2.5),     # bright orange
    (1.0,  (1.0, 0.35, 0.15, 1), 8.0, 2.5),      # orange-red
    (2.5,  (0.95, 0.25, 0.2, 1), 6.0, 2.5),      # pink-orange
    (4.0,  (0.8, 0.2, 0.35, 1), 5.0, 2.5),       # pink
    (5.5,  (0.55, 0.15, 0.45, 1), 4.0, 2.5),     # pink-purple
    (7.0,  (0.3, 0.1, 0.5, 1), 3.0, 3.0),        # purple
    (9.0,  (0.15, 0.08, 0.35, 1), 2.0, 3.0),     # deep purple
]

for i, (yo, col, st, h) in enumerate(sky_colors):
    m_sky = emit_mat(f"Sky_{i}", col, st)
    box(f"SkyPanel_{i}", (0, 12, yo), (20, 0.05, h), m_sky)

# Sun disc
m_sun = emit_mat("Sun", (1.0, 0.7, 0.2, 1), 40.0)
sphere("SunDisc", (0.5, 11, -0.5), 0.8, m_sun)

# Sun halo / glow
m_halo = emit_mat("SunHalo", (1.0, 0.6, 0.15, 1), 6.0)
sphere("SunHalo", (0.5, 10.5, -0.5), 2.5, m_halo, sc=(1, 0.3, 1))

# ── Floor ────────────────────────────────────────────────────────────
# Main balcony floor
box("Floor", (0, 0, -0.05), (4.5, 3.5, 0.1), m_floor)

# Floor planks pattern
for i in range(9):
    x = -2.0 + i * 0.5
    shade = 0.3 + random.uniform(-0.05, 0.05)
    m_plank = mat(f"Plank_{i}", (shade+0.1, shade-0.05, shade-0.12, 1), roughness=0.85)
    box(f"Plank_{i}", (x, 0, 0.01), (0.45, 3.4, 0.02), m_plank)

# ── Back wall (partial - left side) ─────────────────────────────────
box("BackWallL", (-1.8, -1.4, 1.2), (0.8, 0.15, 2.5), m_wall)
# Wall section right
box("BackWallR", (1.8, -1.4, 1.2), (0.8, 0.15, 2.5), m_wall)
# Wall bottom connecting
box("WallBottom", (0, -1.4, 0.15), (4.5, 0.15, 0.4), m_wall)

# ── Railing ──────────────────────────────────────────────────────────
rail_y = 1.5  # front edge
rail_h = 1.0

# Top rail bar
cyl("RailTop", (0, rail_y, rail_h), 0.025, 4.2, m_railing, rot=(0, math.pi/2, 0))
# Bottom rail bar
cyl("RailBot", (0, rail_y, 0.15), 0.02, 4.2, m_railing, rot=(0, math.pi/2, 0))
# Middle rail bar
cyl("RailMid", (0, rail_y, 0.55), 0.015, 4.2, m_railing, rot=(0, math.pi/2, 0))

# Vertical posts
for x in [-2.0, -1.0, 0.0, 1.0, 2.0]:
    cyl(f"Post_{x}", (x, rail_y, 0.5), 0.03, rail_h, m_railing)

# Side railings
for side_x in [-2.1, 2.1]:
    cyl(f"SideRailTop_{side_x}", (side_x, 0.05, rail_h), 0.025, 3.0, m_railing, rot=(math.pi/2, 0, 0))
    cyl(f"SideRailBot_{side_x}", (side_x, 0.05, 0.15), 0.02, 3.0, m_railing, rot=(math.pi/2, 0, 0))
    for yy in range(-1, 2):
        cyl(f"SidePost_{side_x}_{yy}", (side_x, yy * 0.7, 0.5), 0.025, rail_h, m_railing)

# ── City Skyline Silhouettes ─────────────────────────────────────────
random.seed(42)
buildings = [
    (-7, 8, 3.5), (-5.5, 9, 5.0), (-4.2, 8.5, 4.0), (-3, 9, 6.5),
    (-1.8, 8, 3.0), (-0.8, 9.5, 7.0), (0.5, 8, 4.5), (1.5, 9, 5.5),
    (2.8, 8.5, 3.8), (4.0, 9, 6.0), (5.2, 8, 4.2), (6.5, 9, 5.0),
    (7.5, 8.5, 3.5),
]
for i, (bx, by, bh) in enumerate(buildings):
    bw = random.uniform(0.8, 1.5)
    m_b = m_building_dark if i % 2 == 0 else m_building_med
    box(f"Building_{i}", (bx, by, bh/2 - 1), (bw, 0.8, bh), m_b)
    # windows
    for wi in range(int(bh * 1.5)):
        if random.random() > 0.6:
            wy = bh/2 - 1 - bh/2 + wi * 0.5 + 0.3
            wx = bx + random.uniform(-bw/3, bw/3)
            box(f"Win_{i}_{wi}", (wx, by - 0.41, wy), (0.12, 0.02, 0.15), m_window_glow)

# ── Bistro Table ─────────────────────────────────────────────────────
tx, ty = -1.3, -0.2  # moved to far left — center clear for character
# Table top (round-ish - octagonal via cylinder)
cyl("TableTop", (tx, ty, 0.7), 0.35, 0.03, m_table_top)
# Center leg
cyl("TableLeg", (tx, ty, 0.35), 0.025, 0.7, m_table_leg)
# Base
cyl("TableBase", (tx, ty, 0.02), 0.2, 0.03, m_table_leg)
# Base feet
for a in range(3):
    angle = a * math.pi * 2 / 3
    fx = tx + math.cos(angle) * 0.18
    fy = ty + math.sin(angle) * 0.18
    cyl(f"TableFoot_{a}", (fx, fy, 0.015), 0.025, 0.03, m_table_leg)

# Cup on table
cyl("Cup", (tx + 0.1, ty + 0.05, 0.78), 0.04, 0.1, m_cup)
cyl("CupDrink", (tx + 0.1, ty + 0.05, 0.82), 0.035, 0.02, m_drink)

# ── Chair ────────────────────────────────────────────────────────────
cx, cy = -1.3, -0.85  # chair near table, both on far left
# Seat
box("ChairSeat", (cx, cy, 0.42), (0.4, 0.4, 0.04), m_chair_seat)
# Legs
for dx, dy in [(-0.15,-0.15),(0.15,-0.15),(-0.15,0.15),(0.15,0.15)]:
    cyl(f"ChairLeg_{dx}_{dy}", (cx+dx, cy+dy, 0.2), 0.015, 0.42, m_chair)

# Back rest
box("ChairBack", (cx, cy - 0.18, 0.65), (0.38, 0.02, 0.42), m_chair)
# Back rest bars
for bx_off in [-0.12, 0, 0.12]:
    cyl(f"ChairBar_{bx_off}", (cx + bx_off, cy - 0.18, 0.65), 0.01, 0.4, m_chair)

# Cushion on chair
box("Cushion", (cx, cy + 0.02, 0.46), (0.32, 0.32, 0.05), m_cushion)

# Second chair (angled, facing sunset)
cx2, cy2 = -0.7, -0.5  # second chair also away from center
rot2 = (0, 0, math.radians(30))
box("Chair2Seat", (cx2, cy2, 0.42), (0.4, 0.4, 0.04), m_chair_seat, rot=rot2)
for dx, dy in [(-0.15,-0.15),(0.15,-0.15),(-0.15,0.15),(0.15,0.15)]:
    a = math.radians(30)
    rx = dx * math.cos(a) - dy * math.sin(a)
    ry = dx * math.sin(a) + dy * math.cos(a)
    cyl(f"Chair2Leg_{dx}_{dy}", (cx2+rx, cy2+ry, 0.2), 0.015, 0.42, m_chair)
box("Chair2Back", (cx2 - 0.09, cy2 - 0.16, 0.65), (0.38, 0.02, 0.42), m_chair, rot=rot2)

# ── Potted Plants ────────────────────────────────────────────────────
def make_plant(name, px, py, pot_h=0.25, pot_r=0.12):
    cyl(f"{name}_Pot", (px, py, pot_h/2), pot_r, pot_h, m_pot)
    cyl(f"{name}_Soil", (px, py, pot_h - 0.01), pot_r - 0.01, 0.03, m_soil)
    # Leaves
    for j in range(8):
        angle = j * math.pi * 2 / 8 + random.uniform(-0.3, 0.3)
        dist = random.uniform(0.03, 0.1)
        lx = px + math.cos(angle) * dist
        ly = py + math.sin(angle) * dist
        lz = pot_h + random.uniform(0.05, 0.25)
        lr = random.uniform(0.04, 0.08)
        m_l = m_leaf if j % 2 == 0 else m_leaf2
        sphere(f"{name}_Leaf_{j}", (lx, ly, lz), lr, m_l,
               sc=(1, 1, random.uniform(0.6, 1.2)))

# Corner plants
make_plant("PlantL", -1.8, 1.2, 0.3, 0.15)
make_plant("PlantR", 1.8, 1.2, 0.25, 0.12)
make_plant("PlantBack", -1.5, -1.2, 0.35, 0.18)
# Small herb on table
make_plant("Herb", tx - 0.12, ty - 0.08, 0.08, 0.04)
# move herb up to table height
for o in bpy.data.objects:
    if o.name.startswith("Herb_"):
        o.location.z += 0.72

# Tall plant near wall
make_plant("TallPlant", 1.5, -1.2, 0.4, 0.18)
for o in bpy.data.objects:
    if o.name.startswith("TallPlant_Leaf"):
        o.location.z += 0.15
        o.scale *= 1.5

# ── String Lights ────────────────────────────────────────────────────
light_pts = []
num_lights = 12
for i in range(num_lights):
    t = i / (num_lights - 1)
    lx = -1.8 + t * 3.6
    ly = -1.3 + math.sin(t * math.pi) * 0.5
    lz = 2.2 + math.sin(t * math.pi * 2) * 0.15
    light_pts.append((lx, ly, lz))
    # Bulb
    sphere(f"Bulb_{i}", (lx, ly, lz), 0.035, m_bulb)
    # Wire segments
    if i > 0:
        px, py, pz = light_pts[i-1]
        mx, my, mz = (lx+px)/2, (ly+py)/2, (lz+pz)/2
        dx, dy, dz = lx-px, ly-py, lz-pz
        length = math.sqrt(dx**2 + dy**2 + dz**2)
        # angle
        ry = math.atan2(dz, math.sqrt(dx**2 + dy**2))
        rz = math.atan2(dy, dx)
        cyl(f"Wire_{i}", (mx, my, mz), 0.005, length, m_wire,
            rot=(0, -ry, rz))

# Second string across front
for i in range(8):
    t = i / 7
    lx = -1.5 + t * 3.0
    ly = 1.2
    lz = 1.8 + math.sin(t * math.pi) * 0.1
    sphere(f"FrontBulb_{i}", (lx, ly, lz), 0.03, m_bulb)

# ── Lighting ─────────────────────────────────────────────────────────
# Sun light (very low angle - golden hour)
bpy.ops.object.light_add(type='SUN', location=(5, 10, 2))
sun = bpy.context.active_object
sun.name = "GoldenSun"
sun.data.energy = 4.0
sun.data.color = (1.0, 0.65, 0.25)
sun.rotation_euler = (math.radians(82), math.radians(10), math.radians(-30))

# Warm fill from sky
bpy.ops.object.light_add(type='AREA', location=(0, 5, 5))
fill = bpy.context.active_object
fill.name = "SkyFill"
fill.data.energy = 200
fill.data.color = (1.0, 0.5, 0.3)
fill.data.size = 8
fill.rotation_euler = (math.radians(45), 0, 0)

# Spot light on table area (intimate pool)
bpy.ops.object.light_add(type='SPOT', location=(0, -0.5, 2.5))
spot = bpy.context.active_object
spot.name = "TableSpot"
spot.data.energy = 80
spot.data.color = (1.0, 0.75, 0.4)
spot.data.spot_size = math.radians(50)
spot.data.spot_blend = 0.8
spot.rotation_euler = (math.radians(15), 0, 0)

# Warm bounce from floor
bpy.ops.object.light_add(type='AREA', location=(0, 0, -0.5))
bounce = bpy.context.active_object
bounce.name = "FloorBounce"
bounce.data.energy = 30
bounce.data.color = (1.0, 0.6, 0.3)
bounce.data.size = 4
bounce.rotation_euler = (math.radians(180), 0, 0)

# Subtle purple rim from above-behind
bpy.ops.object.light_add(type='AREA', location=(0, -2, 3))
rim = bpy.context.active_object
rim.name = "PurpleRim"
rim.data.energy = 50
rim.data.color = (0.6, 0.3, 0.8)
rim.data.size = 3
rim.rotation_euler = (math.radians(60), 0, 0)

# ── Render Settings ──────────────────────────────────────────────────
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.image_settings.file_format = 'PNG'

# GPU Metal
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for d in prefs.devices:
    d.use = True

# Film transparent OFF - we want our sky
scene.render.film_transparent = False
# Background - deep warm dark
scene.world = bpy.data.worlds.new("SunsetWorld")
scene.world.use_nodes = True
bg = scene.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (0.02, 0.01, 0.03, 1)
    bg.inputs["Strength"].default_value = 0.3

# ── Camera Angles ────────────────────────────────────────────────────
cameras = {
    "main": {
        "loc": (0.5, -3.5, 1.8),
        "rot": (math.radians(72), 0, math.radians(5)),
    },
    "skyline": {
        "loc": (-0.5, -1.0, 1.2),
        "rot": (math.radians(80), 0, math.radians(-10)),
    },
    "closeup": {
        "loc": (0.5, -1.5, 1.0),
        "rot": (math.radians(75), 0, math.radians(15)),
    },
    "wide": {
        "loc": (0, -5.0, 2.5),
        "rot": (math.radians(68), 0, 0),
    },
}

for name, cam_data in cameras.items():
    bpy.ops.object.camera_add(location=cam_data["loc"])
    cam = bpy.context.active_object
    cam.name = f"Cam_{name}"
    cam.rotation_euler = cam_data["rot"]
    cam.data.lens = 35

    scene.camera = cam
    scene.render.filepath = os.path.join(OUT, f"balcony_{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: balcony_{name}.png")

# ── Export GLB ───────────────────────────────────────────────────────
glb_path = os.path.join(OUT, "sunset-balcony.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, export_format='GLB')
print(f"Exported: {glb_path}")

# Copy to viewer
import shutil
dest = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/scenes/sunset-balcony.glb"
shutil.copy2(glb_path, dest)
print(f"Copied to: {dest}")
print("DONE!")
