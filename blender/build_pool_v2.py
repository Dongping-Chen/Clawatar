"""
Swimming Pool Scene v2 — BRIGHTER moonlit night
v1 issues: way too dark, water invisible, moon not visible, no atmosphere
v2 fixes: 3x brighter lights, glowing water, bigger moon, more underwater glow
"""

import bpy
import math
import os

OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 8.0   # wider than bedroom
STAGE_D = 6.0   # deeper
STAGE_H = 4.0   # taller for sky feel

os.makedirs(OUTPUT_DIR, exist_ok=True)


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


def glass_mat(name, color, alpha=0.3):
    """Semi-transparent water material."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = 0.05
        b.inputs["Metallic"].default_value = 0.0
        if "Alpha" in b.inputs:
            b.inputs["Alpha"].default_value = alpha
        if "Transmission Weight" in b.inputs:
            b.inputs["Transmission Weight"].default_value = 0.8
        elif "Transmission" in b.inputs:
            b.inputs["Transmission"].default_value = 0.8
        b.inputs["IOR"].default_value = 1.33  # water
        if "Specular IOR Level" in b.inputs:
            b.inputs["Specular IOR Level"].default_value = 0.5
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

    # ── GROUND / POOL DECK — light concrete ──
    m_deck = mat("Deck", (0.70, 0.72, 0.75, 1), 0.8)
    box("Deck", (0, 0, -0.025), (STAGE_W+1, STAGE_D+1, 0.05), m_deck)

    # ── POOL — sunken rectangle ──
    pool_w, pool_d, pool_depth = 5.0, 3.5, 1.2
    pool_cx, pool_cy = 0, -0.3

    # Pool walls (inner) — tile blue
    m_tile = mat("Tile", (0.20, 0.45, 0.65, 1), 0.25)  # brighter
    m_tile_light = mat("TileL", (0.25, 0.55, 0.75, 1), 0.25)  # brighter

    # Pool bottom
    box("PoolBot", (pool_cx, pool_cy, -pool_depth), (pool_w, pool_d, 0.05), m_tile_light)

    # Pool walls
    box("PW_Back", (pool_cx, pool_cy-pool_d/2, -pool_depth/2), (pool_w, 0.05, pool_depth), m_tile)
    box("PW_Front", (pool_cx, pool_cy+pool_d/2, -pool_depth/2), (pool_w, 0.05, pool_depth), m_tile)
    box("PW_Left", (pool_cx-pool_w/2, pool_cy, -pool_depth/2), (0.05, pool_d, pool_depth), m_tile)
    box("PW_Right", (pool_cx+pool_w/2, pool_cy, -pool_depth/2), (0.05, pool_d, pool_depth), m_tile)

    # Pool edge / coping — lighter concrete
    m_coping = mat("Coping", (0.78, 0.80, 0.82, 1), 0.5)
    edge_w = 0.15
    box("PE_B", (pool_cx, pool_cy-pool_d/2-edge_w/2, 0.02), (pool_w+edge_w*2, edge_w, 0.06), m_coping)
    box("PE_F", (pool_cx, pool_cy+pool_d/2+edge_w/2, 0.02), (pool_w+edge_w*2, edge_w, 0.06), m_coping)
    box("PE_L", (pool_cx-pool_w/2-edge_w/2, pool_cy, 0.02), (edge_w, pool_d, 0.06), m_coping)
    box("PE_R", (pool_cx+pool_w/2+edge_w/2, pool_cy, 0.02), (edge_w, pool_d, 0.06), m_coping)

    # ── WATER SURFACE — mix of glass + emission for visible glow ──
    m_water = bpy.data.materials.new("Water")
    m_water.use_nodes = True
    nodes = m_water.node_tree.nodes; links = m_water.node_tree.links
    for n in list(nodes): nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")

    # Glass component
    glass = nodes.new("ShaderNodeBsdfGlass")
    glass.inputs["Color"].default_value = (0.10, 0.40, 0.55, 1)
    glass.inputs["Roughness"].default_value = 0.08
    glass.inputs["IOR"].default_value = 1.33

    # Emission component — teal glow
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.05, 0.50, 0.70, 1)  # MORE saturated teal
    emit.inputs["Strength"].default_value = 4.0

    mix.inputs["Fac"].default_value = 0.7  # 70% emission, 30% glass
    links.new(glass.outputs["BSDF"], mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])

    p = plane("Water", (pool_cx, pool_cy, -0.05), 1.0, m_water)
    p.scale = (pool_w, pool_d, 1)

    # Stronger underwater glow plane
    m_wglow = emit_mat("WGlow", (0.05, 0.55, 0.70, 1), 8.0)  # much brighter
    pg = plane("WGlow", (pool_cx, pool_cy, -0.20), 1.0, m_wglow)
    pg.scale = (pool_w*0.95, pool_d*0.95, 1)

    # ── LANE DIVIDERS (floating ropes with buoys) ──
    m_rope = mat("Rope", (0.90, 0.90, 0.92, 1), 0.5)
    m_buoy_r = mat("BuoyR", (0.85, 0.20, 0.20, 1), 0.6)
    m_buoy_b = mat("BuoyB", (0.20, 0.30, 0.80, 1), 0.6)

    for i, lx in enumerate([-1.25, 0, 1.25]):
        # Rope line
        cyl(f"Lane{i}", (pool_cx+lx, pool_cy, -0.05), 0.008, pool_d-0.2, m_rope, rot=(math.radians(90),0,0))
        # Buoys along rope
        for j in range(8):
            by = pool_cy - pool_d/2 + 0.3 + j * (pool_d-0.6)/7
            m = m_buoy_r if (i+j)%2 == 0 else m_buoy_b
            sphere(f"Buoy{i}_{j}", (pool_cx+lx, by, -0.04), 0.025, m)

    # ── STARTING BLOCKS ──
    m_block = mat("Block", (0.75, 0.75, 0.78, 1), 0.4, 0.1)
    for i, bx in enumerate([-1.9, -0.6, 0.6, 1.9]):
        rbox(f"SB{i}", (pool_cx+bx, pool_cy+pool_d/2+0.25, 0.15), (0.35, 0.30, 0.30), m_block, 0.02)
        # Number
        m_num = emit_mat(f"Num{i}", (0.9, 0.9, 0.95, 1), 0.5)
        box(f"NumP{i}", (pool_cx+bx, pool_cy+pool_d/2+0.40, 0.22), (0.10, 0.01, 0.10), m_num)


def build_surroundings():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── LOW WALL / FENCE (back + left) ──
    m_wall = mat("Wall", (0.55, 0.58, 0.62, 1), 0.6)
    m_fence = mat("Fence", (0.50, 0.52, 0.55, 1), 0.3, 0.5)

    # Back wall (low)
    box("WBack", (0, -hd, 1.0), (STAGE_W, 0.10, 2.0), m_wall)

    # Chain-link fence posts (left side)
    for i in range(6):
        fz = -hd + 0.3 + i * (STAGE_D-0.6)/5
        cyl(f"FP{i}", (-hw, fz, 0.75), 0.02, 1.5, m_fence)
    # Fence horizontal bars
    for fh in [0.5, 1.0, 1.5]:
        cyl(f"FH{fh}", (-hw, 0, fh), 0.008, STAGE_D, m_fence, rot=(math.radians(90),0,0))

    # ── BENCHES (pool deck) ──
    m_bench = mat("Bench", (0.60, 0.52, 0.40, 1), 0.5)
    for bx in [-2.8, 2.8]:
        rbox(f"BS{bx}", (bx, hd-0.3, 0.20), (0.80, 0.30, 0.04), m_bench, 0.01)
        for lx in [-0.30, 0.30]:
            rbox(f"BL{bx}{lx}", (bx+lx, hd-0.3, 0.10), (0.04, 0.25, 0.20), m_bench, 0.008)

    # ── TREES (background, behind back wall) ──
    m_trunk = mat("Trunk", (0.35, 0.25, 0.18, 1), 0.6)
    m_leaves = mat("Leaves", (0.12, 0.25, 0.15, 1), 0.8)
    m_leaves2 = mat("Leaves2", (0.15, 0.30, 0.18, 1), 0.8)

    for tx, ts, th in [(-3.0, 0.8, 3.5), (-1.0, 1.0, 4.0), (1.5, 0.9, 3.8), (3.5, 0.7, 3.2)]:
        ty = -hd - 0.5
        cyl(f"Trunk{tx}", (tx, ty, th/2), 0.08*ts, th, m_trunk)
        # Canopy = scaled sphere
        sphere(f"Canopy{tx}", (tx, ty, th+0.3), 0.8*ts, m_leaves if tx < 0 else m_leaves2, (1.2, 1.0, 0.8))

    # ── TOWELS on bench ──
    m_towel = mat("Towel", (0.90, 0.70, 0.75, 1), 0.9)  # pink!
    rbox("Towel", (-2.8, hd-0.25, 0.24), (0.40, 0.20, 0.03), m_towel, 0.01)


def build_sky():
    """Night sky backdrop."""
    hw, hd = STAGE_W/2, STAGE_D/2

    # Sky panel behind back wall
    m_sky = mat("Sky", (0.03, 0.05, 0.12, 1), 1.0)
    box("Sky", (0, -hd-1.0, 2.5), (STAGE_W+4, 0.02, 5.0), m_sky)

    # Moon — BIGGER and BRIGHTER
    m_moon = emit_mat("Moon", (0.95, 0.95, 0.88, 1), 15.0)
    sphere("Moon", (2.0, -hd-0.8, 3.5), 0.45, m_moon)
    # Moon glow halo
    m_halo = emit_mat("Halo", (0.70, 0.75, 0.90, 1), 2.0)
    sphere("Halo", (2.0, -hd-0.85, 3.5), 0.80, m_halo, (1.0, 0.3, 1.0))

    # Stars — brighter
    m_star = emit_mat("Star", (0.95, 0.95, 1.0, 1), 8.0)
    import random
    random.seed(42)
    for i in range(40):
        sx = random.uniform(-hw-1.5, hw+1.5)
        sz = random.uniform(2.0, 4.5)
        sphere(f"Star{i}", (sx, -hd-0.9, sz), random.uniform(0.01, 0.03), m_star)


def build_underwater_lights():
    """Teal/cyan underwater glow lights in the pool."""
    pool_cx, pool_cy = 0, -0.3

    m_ulight = emit_mat("ULight", (0.15, 0.70, 0.80, 1), 8.0)
    # 4 underwater lights on the long walls
    for i, (lx, ly) in enumerate([
        (-1.5, pool_cy-1.7), (1.5, pool_cy-1.7),
        (-1.5, pool_cy+1.7), (1.5, pool_cy+1.7)
    ]):
        sphere(f"UL{i}", (pool_cx+lx, ly, -0.8), 0.06, m_ulight)


def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # 1. Moonlight — cool blue, MUCH stronger
    bpy.ops.object.light_add(type='SUN', location=(3, -3, 5))
    s = bpy.context.active_object; s.name = "Moon"
    s.data.energy = 5.0   # was 2.0
    s.data.color = (0.65, 0.75, 1.0)
    s.rotation_euler = (math.radians(55), math.radians(15), math.radians(-20))
    s.data.angle = math.radians(8)

    # 2. Pool underwater glow — teal, MUCH stronger
    for i, (lx, ly) in enumerate([(-1.5, -2.0), (1.5, -2.0), (-1.5, 1.4), (1.5, 1.4),
                                    (0, -0.3), (-0.8, 0.6), (0.8, 0.6)]):
        bpy.ops.object.light_add(type='POINT', location=(lx, ly, -0.6))
        p = bpy.context.active_object; p.name = f"UWL{i}"
        p.data.energy = 80   # was 30
        p.data.color = (0.20, 0.65, 0.80)
        p.data.shadow_soft_size = 0.8

    # 3. Deck lights — warm spots (STRONGER)
    for i, (lx, ly) in enumerate([(-3.0, 2.0), (3.0, 2.0), (0, 2.5)]):
        bpy.ops.object.light_add(type='SPOT', location=(lx, ly, 2.5))
        sp = bpy.context.active_object; sp.name = f"DeckL{i}"
        sp.data.energy = 200   # was 80
        sp.data.color = (1.0, 0.90, 0.70)
        sp.data.spot_size = math.radians(65); sp.data.spot_blend = 0.7
        sp.rotation_euler = (math.radians(90), 0, 0)

    # 4. Front fill — STRONGER
    bpy.ops.object.light_add(type='AREA', location=(0, hd+3, 2.0))
    ff = bpy.context.active_object; ff.name = "FrontFill"
    ff.data.energy = 80   # was 25
    ff.data.color = (0.80, 0.85, 1.0)
    ff.data.size = 6.0; ff.data.size_y = 3.0
    ff.rotation_euler = (math.radians(110), 0, 0)

    # 5. Sky ambient — STRONGER
    bpy.ops.object.light_add(type='AREA', location=(0, -hd, 3.5))
    sk = bpy.context.active_object; sk.name = "SkyFill"
    sk.data.energy = 40   # was 10
    sk.data.color = (0.40, 0.50, 0.75)
    sk.data.size = STAGE_W; sk.data.size_y = 3.0
    sk.rotation_euler = (math.radians(90), 0, 0)

    # 6. Water surface reflection light — bouncing up from pool
    bpy.ops.object.light_add(type='AREA', location=(0, -0.3, -0.3))
    wr = bpy.context.active_object; wr.name = "WaterRefl"
    wr.data.energy = 40
    wr.data.color = (0.15, 0.55, 0.70)
    wr.data.size = 4.0; wr.data.size_y = 3.0

    # World — slightly brighter dark blue
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.04, 0.05, 0.10, 1)
        bg.inputs["Strength"].default_value = 0.5


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
        "main": ((1.5, hd+3.5, 1.8), (math.radians(78), 0, math.radians(168)), 28),
        "wide": ((0, hd+5.0, 3.0), (math.radians(62), 0, math.radians(180)), 24),
        "poolside": ((3.0, 1.5, 0.8), (math.radians(88), 0, math.radians(130)), 35),
        "moonlit": ((-1.0, hd+2.0, 1.2), (math.radians(82), 0, math.radians(195)), 32),
    }

    for name, (loc, rot, lens) in angles.items():
        cd = bpy.data.cameras.new(f"C{name}"); cd.lens = lens
        co = bpy.data.objects.new(f"C{name}", cd)
        bpy.context.collection.objects.link(co)
        co.location = loc; co.rotation_euler = rot
        scene.camera = co
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"pool2_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ pool_{name}.png")

    g = os.path.join(OUTPUT_DIR, "swimming-pool-v2.glb")
    bpy.ops.export_scene.gltf(filepath=g, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  Swimming Pool v2 — BRIGHTER Moonlit Night")
    print("="*50)
    clear_scene()
    build_pool_area()
    build_surroundings()
    build_sky()
    build_underwater_lights()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
