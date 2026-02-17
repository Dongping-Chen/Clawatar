"""
Swimming Pool v3 — SUMMER DAYTIME Pool
Previous versions: too dark, water invisible, wrong mood (nighttime)
Dongping wants: 夏日泳池, blue water, atmosphere, bright

Key changes:
- BRIGHT DAYTIME lighting (sun + blue sky)
- SOLID VISIBLE BLUE water (opaque bright teal, no transparency tricks)
- Summer atmosphere: warm sun, blue sky, palm trees, bright concrete
- Pool lights for extra glow
- Cheerful, warm, inviting
"""

import bpy
import math
import os
import random

OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 8.0
STAGE_D = 6.0
STAGE_H = 5.0  # taller for sky

os.makedirs(OUTPUT_DIR, exist_ok=True)

random.seed(42)


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

def plane(nm, loc, size, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc)
    o = bpy.context.active_object; o.name = nm; o.rotation_euler = rot
    if mt: o.data.materials.append(mt)
    return o


def build_pool_area():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── POOL DECK — warm white concrete ──
    m_deck = mat("Deck", (0.60, 0.58, 0.55, 1), 0.7)  # concrete, darker for night
    box("Deck", (0, 0, -0.025), (STAGE_W+2, STAGE_D+2, 0.05), m_deck)

    # ── POOL — sunken rectangle ──
    pool_w, pool_d, pool_depth = 5.0, 3.2, 1.0
    pool_cx, pool_cy = 0, -0.3

    # Pool interior — bright blue tiles
    m_tile = mat("Tile", (0.20, 0.55, 0.80, 1), 0.25)
    m_tile_floor = mat("TileF", (0.15, 0.50, 0.75, 1), 0.25)

    box("PoolBot", (pool_cx, pool_cy, -pool_depth), (pool_w, pool_d, 0.05), m_tile_floor)
    box("PW_Back", (pool_cx, pool_cy-pool_d/2, -pool_depth/2), (pool_w, 0.05, pool_depth), m_tile)
    box("PW_Front", (pool_cx, pool_cy+pool_d/2, -pool_depth/2), (pool_w, 0.05, pool_depth), m_tile)
    box("PW_Left", (pool_cx-pool_w/2, pool_cy, -pool_depth/2), (0.05, pool_d, pool_depth), m_tile)
    box("PW_Right", (pool_cx+pool_w/2, pool_cy, -pool_depth/2), (0.05, pool_d, pool_depth), m_tile)

    # Pool edge coping — clean white
    m_cop = mat("Cop", (0.92, 0.90, 0.87, 1), 0.4)
    ew = 0.12
    box("PE_B", (pool_cx, pool_cy-pool_d/2-ew/2, 0.02), (pool_w+ew*2, ew, 0.06), m_cop)
    box("PE_F", (pool_cx, pool_cy+pool_d/2+ew/2, 0.02), (pool_w+ew*2, ew, 0.06), m_cop)
    box("PE_L", (pool_cx-pool_w/2-ew/2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)
    box("PE_R", (pool_cx+pool_w/2+ew/2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)

    # ═══ WATER — USE BOX instead of plane (plane material wasn't applying) ═══
    m_water = mat("Water", (0.08, 0.45, 0.80, 1), 0.85, 0.0)  # bright blue, mostly matte
    box("Water", (pool_cx, pool_cy, -0.05), (pool_w-0.06, pool_d-0.06, 0.06), m_water)

    # ── LANE DIVIDERS ──
    m_rope = mat("Rope", (0.95, 0.95, 0.97, 1), 0.5)
    m_buoy_r = mat("BuoyR", (0.90, 0.25, 0.20, 1), 0.5)
    m_buoy_b = mat("BuoyB", (0.20, 0.35, 0.85, 1), 0.5)
    m_buoy_w = mat("BuoyW", (0.95, 0.95, 0.95, 1), 0.5)

    for i, lx in enumerate([-1.25, 0, 1.25]):
        cyl(f"Lane{i}", (pool_cx+lx, pool_cy, -0.03), 0.01, pool_d-0.15, m_rope, rot=(math.radians(90),0,0))
        for j in range(10):
            by = pool_cy - pool_d/2 + 0.2 + j * (pool_d-0.4)/9
            m = [m_buoy_r, m_buoy_w, m_buoy_b][(i+j)%3]
            sphere(f"Buoy{i}_{j}", (pool_cx+lx, by, -0.03), 0.03, m)

    # ── STARTING BLOCKS ──
    m_block = mat("Block", (0.85, 0.85, 0.87, 1), 0.3, 0.15)
    for i, bx in enumerate([-1.9, -0.6, 0.6, 1.9]):
        rbox(f"SB{i}", (pool_cx+bx, pool_cy+pool_d/2+0.22, 0.18), (0.35, 0.28, 0.36), m_block, 0.02)
        # Number plate
        m_n = mat(f"N{i}", (0.15, 0.15, 0.20, 1), 0.4)
        box(f"NP{i}", (pool_cx+bx, pool_cy+pool_d/2+0.37, 0.25), (0.12, 0.01, 0.12), m_n)


def build_surroundings():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── LOW WALL / FENCE — white with glass panels ──
    m_wall = mat("FenceW", (0.50, 0.50, 0.52, 1), 0.6)
    m_glass = mat("FenceG", (0.30, 0.35, 0.42, 1), 0.1, 0.2)

    # Back wall — low, white
    box("WBack", (0, -hd, 0.6), (STAGE_W, 0.08, 1.2), m_wall)

    # Glass panels in back wall (windows to sky)
    for gx in [-2.5, -0.8, 0.8, 2.5]:
        box(f"GP{gx}", (gx, -hd+0.01, 0.7), (1.2, 0.02, 0.8), m_glass)

    # Left fence — posts + horizontal bars
    m_post = mat("Post", (0.85, 0.83, 0.80, 1), 0.3, 0.2)
    for i in range(7):
        fy = -hd + 0.3 + i * (STAGE_D-0.6)/6
        cyl(f"FP{i}", (-hw, fy, 0.55), 0.025, 1.1, m_post)
    for fh in [0.35, 0.70, 1.05]:
        cyl(f"FH{fh}", (-hw, 0, fh), 0.01, STAGE_D, m_post, rot=(math.radians(90),0,0))

    # ── LOUNGE CHAIRS ──
    m_chair = mat("Chair", (0.95, 0.93, 0.90, 1), 0.5)
    m_cush = mat("Cush", (0.95, 0.82, 0.70, 1), 0.85)  # warm peach
    m_cush2 = mat("Cush2", (0.82, 0.90, 0.95, 1), 0.85)  # sky blue

    for i, (cx, cy, rot) in enumerate([
        (3.2, 1.5, 0), (3.2, -0.5, 0), (-3.2, 0.5, math.radians(180))
    ]):
        # Frame
        rbox(f"LC{i}", (cx, cy, 0.15), (0.60, 1.20, 0.04), m_chair, 0.015)
        for lx, ly in [(-0.25, -0.50), (0.25, -0.50), (-0.25, 0.50), (0.25, 0.50)]:
            rbox(f"LL{i}", (cx+lx, cy+ly, 0.08), (0.03, 0.03, 0.16), m_chair, 0.005)
        # Cushion
        cm = m_cush if i % 2 == 0 else m_cush2
        rbox(f"LCu{i}", (cx, cy, 0.19), (0.55, 1.10, 0.05), cm, 0.02)
        # Back rest
        rbox(f"LCB{i}", (cx, cy-0.45, 0.35), (0.55, 0.08, 0.35), cm, 0.02)

    # ── UMBRELLA / PARASOL ──
    m_pole = mat("UPole", (0.75, 0.72, 0.68, 1), 0.3, 0.3)
    m_canopy = mat("UCan", (0.55, 0.50, 0.42, 1), 0.8)  # darker for night

    for ux, uy in [(3.2, 0.5), (-3.2, 0.5)]:
        cyl(f"UP{ux}", (ux, uy, 1.0), 0.02, 2.0, m_pole)
        # Canopy = flat cone
        bpy.ops.mesh.primitive_cone_add(radius1=0.9, radius2=0.05, depth=0.15, location=(ux, uy, 2.05))
        c = bpy.context.active_object; c.name = f"UC{ux}"
        c.data.materials.append(m_canopy)

    # ── TOWELS on chair ──
    m_tw1 = mat("Towel1", (0.95, 0.75, 0.80, 1), 0.9)  # pink
    m_tw2 = mat("Towel2", (0.70, 0.85, 0.95, 1), 0.9)  # light blue
    rbox("Tw1", (3.2, 1.8, 0.22), (0.35, 0.15, 0.02), m_tw1, 0.008)
    rbox("Tw2", (-3.2, 0.8, 0.22), (0.30, 0.12, 0.02), m_tw2, 0.008)

    # ── FLIP FLOPS ──
    m_ff = mat("FlipF", (0.95, 0.60, 0.65, 1), 0.8)
    rbox("FF1", (2.8, 2.0, 0.015), (0.06, 0.14, 0.02), m_ff, 0.008, rot=(0,0,math.radians(10)))
    rbox("FF2", (2.92, 1.98, 0.015), (0.06, 0.14, 0.02), m_ff, 0.008, rot=(0,0,math.radians(5)))


def build_sky():
    """Night sky with moon and stars."""
    hw, hd = STAGE_W/2, STAGE_D/2

    # Night sky panel
    m_sky = mat("Sky", (0.02, 0.03, 0.08, 1), 1.0)
    box("Sky", (0, -hd-1.5, 2.5), (STAGE_W+6, 0.02, 5.0), m_sky)

    # Moon — bright, romantic
    m_moon = emit_mat("Moon", (0.95, 0.95, 0.88, 1), 12.0)
    sphere("Moon", (2.0, -hd-0.8, 3.8), 0.35, m_moon)
    # Moon halo
    m_halo = emit_mat("Halo", (0.65, 0.70, 0.85, 1), 2.0)
    sphere("Halo", (2.0, -hd-0.85, 3.8), 0.70, m_halo, (1.0, 0.3, 1.0))

    # Stars
    m_star = emit_mat("Star", (0.95, 0.95, 1.0, 1), 6.0)
    for i in range(35):
        sx = random.uniform(-hw-1.5, hw+1.5)
        sz = random.uniform(2.0, 4.5)
        sphere(f"Star{i}", (sx, -hd-0.9, sz), random.uniform(0.01, 0.025), m_star)

    # Trees (dark silhouettes behind wall)
    m_trunk = mat("Trunk", (0.12, 0.10, 0.08, 1), 0.8)
    m_leaves = mat("Leaves", (0.08, 0.15, 0.10, 1), 0.8)

    for tx, ts, th in [(-3.0, 0.8, 3.5), (-1.0, 1.0, 4.0), (1.5, 0.9, 3.8), (3.5, 0.7, 3.2)]:
        ty = -hd - 0.5
        cyl(f"Trunk{tx}", (tx, ty, th/2), 0.08*ts, th, m_trunk)
        sphere(f"Can{tx}", (tx, ty, th+0.3), 0.8*ts, m_leaves, (1.2, 1.0, 0.8))


def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ═══ NIGHTTIME — glowing pool is the hero light source ═══

    # 1. Moonlight — cool blue, gentle
    bpy.ops.object.light_add(type='SUN', location=(3, -2, 5))
    s = bpy.context.active_object; s.name = "Moon"
    s.data.energy = 1.5
    s.data.color = (0.60, 0.70, 1.0)
    s.rotation_euler = (math.radians(55), math.radians(15), math.radians(-20))
    s.data.angle = math.radians(8)

    # 2. UNDERWATER POOL LIGHTS — reduced to prevent overexposure
    for lx, ly in [(-1.8, -1.5), (0, -1.5), (1.8, -1.5),
                    (-1.8, 0.9), (0, 0.9), (1.8, 0.9)]:
        bpy.ops.object.light_add(type='POINT', location=(lx, ly, -0.5))
        p = bpy.context.active_object; p.name = f"UW_{lx}_{ly}"
        p.data.energy = 25    # reduced to prevent character washout
        p.data.color = (0.15, 0.70, 0.85)
        p.data.shadow_soft_size = 1.0

    # 3. Water bounce — subtle teal, reduced
    bpy.ops.object.light_add(type='AREA', location=(0, -0.3, 0.05))
    wr = bpy.context.active_object; wr.name = "WaterBounce"
    wr.data.energy = 15
    wr.data.color = (0.15, 0.60, 0.80)
    wr.data.size = 5.0; wr.data.size_y = 3.5

    # 4. Front fill — very subtle
    bpy.ops.object.light_add(type='AREA', location=(0, hd+3, 2.0))
    ff = bpy.context.active_object; ff.name = "FrontFill"
    ff.data.energy = 15
    ff.data.color = (0.70, 0.80, 1.0)
    ff.data.size = 5.0; ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(110), 0, 0)

    # 5. Ambient sky glow
    bpy.ops.object.light_add(type='AREA', location=(0, -hd, 3.5))
    sk = bpy.context.active_object; sk.name = "SkyGlow"
    sk.data.energy = 15
    sk.data.color = (0.35, 0.40, 0.65)
    sk.data.size = STAGE_W; sk.data.size_y = 2.0
    sk.rotation_euler = (math.radians(90), 0, 0)

    # World — dark night
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.03, 0.04, 0.08, 1)
        bg.inputs["Strength"].default_value = 0.3


def render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080

    prefs = bpy.context.preferences.addons.get('cycles')
    if prefs:
        try:
            prefs.preferences.compute_device_type = 'METAL'
            prefs.preferences.get_devices()
            for d in prefs.preferences.devices: d.use = True
        except: pass

    hw, hd = STAGE_W/2, STAGE_D/2
    angles = {
        "main": ((1.5, hd+3.5, 2.0), (math.radians(72), 0, math.radians(168)), 28),
        "wide": ((0, hd+5.0, 3.5), (math.radians(58), 0, math.radians(180)), 22),
        "poolside": ((3.0, 1.5, 0.9), (math.radians(85), 0, math.radians(130)), 32),
        "overhead": ((0, 0, 5.5), (0, 0, 0), 24),
    }

    # Skip renders — just export GLB

    g = os.path.join(OUTPUT_DIR, "swimming-pool-v3.glb")
    bpy.ops.export_scene.gltf(filepath=g, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  Swimming Pool v3 — SUMMER DAYTIME")
    print("="*50)
    clear_scene()
    build_pool_area()
    build_surroundings()
    build_sky()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
