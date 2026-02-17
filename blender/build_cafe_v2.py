"""
Café Scene v2 — Reze's Coffee Shop
v1 issues: no visible coffee machine/coffee, too empty, pendant lights not bright enough
v2 fixes: BIGGER coffee machine, coffee cups on tables, more items, warmer lighting
"""

import bpy
import math
import os

OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 5.5
STAGE_D = 4.5
STAGE_H = 3.0

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


def build_shell():
    hw, hd = STAGE_W/2, STAGE_D/2

    # Floor — warm dark wood
    m_floor = mat("Floor", (0.40, 0.28, 0.18, 1), 0.4)
    box("Floor", (0, 0, -0.025), (STAGE_W+0.3, STAGE_D+0.3, 0.05), m_floor)

    # Back wall — warm cream
    m_wall = mat("Wall", (0.95, 0.90, 0.82, 1), 0.8)
    box("WBack", (0, -hd, STAGE_H/2), (STAGE_W, 0.08, STAGE_H), m_wall)

    # Left wall — slightly darker
    m_wall2 = mat("Wall2", (0.90, 0.85, 0.78, 1), 0.8)
    box("WLeft", (-hw, 0, STAGE_H/2), (0.08, STAGE_D, STAGE_H), m_wall2)

    # Baseboard
    m_bb = mat("BB", (0.45, 0.33, 0.22, 1), 0.4)
    box("BB_B", (0, -hd+0.045, 0.05), (STAGE_W, 0.02, 0.10), m_bb)
    box("BB_L", (-hw+0.045, 0, 0.05), (0.02, STAGE_D, 0.10), m_bb)

    # Crown molding
    m_cr = mat("Crown", (0.92, 0.87, 0.80, 1), 0.5)
    box("CR_B", (0, -hd+0.045, STAGE_H-0.03), (STAGE_W, 0.03, 0.06), m_cr)


def build_counter():
    """Main coffee counter along back wall — where Reze works."""
    hw, hd = STAGE_W/2, STAGE_D/2

    # Counter top — dark wood
    m_top = mat("CTop", (0.35, 0.22, 0.14, 1), 0.3)
    m_front = mat("CFront", (0.42, 0.30, 0.20, 1), 0.4)
    m_shelf = mat("CShelf", (0.38, 0.26, 0.17, 1), 0.4)

    # Main counter
    rbox("Counter", (0, -hd+0.45, 0.50), (STAGE_W-0.6, 0.55, 1.0), m_front, 0.02)
    rbox("CTop", (0, -hd+0.45, 1.02), (STAGE_W-0.5, 0.60, 0.04), m_top, 0.015)

    # Back counter (shelving unit against wall)
    rbox("BackC", (0, -hd+0.12, 0.85), (STAGE_W-0.4, 0.18, 1.70), m_shelf, 0.02)

    # Shelves on back counter (for cups, supplies)
    for sz in [0.55, 0.90, 1.25, 1.60]:
        rbox(f"Sh{sz}", (0, -hd+0.12, sz), (STAGE_W-0.5, 0.20, 0.02), m_shelf, 0.005)

    # ── COFFEE MACHINE — BIG and prominent ──
    m_mach = mat("Mach", (0.22, 0.22, 0.25, 1), 0.15, 0.7)
    m_mach_a = mat("MachA", (0.85, 0.18, 0.12, 1), 0.3, 0.3)
    m_mach_s = mat("MachS", (0.70, 0.70, 0.72, 1), 0.1, 0.8)

    # Main body — BIGGER
    rbox("CoffeM", (0.8, -hd+0.18, 1.15), (0.50, 0.35, 0.55), m_mach, 0.025)
    # Top with group heads
    rbox("CMTop", (0.8, -hd+0.18, 1.45), (0.52, 0.30, 0.06), m_mach_s, 0.01)
    # Portafilter handles (2)
    for px in [0.65, 0.95]:
        cyl(f"PF{px}", (px, -hd+0.38, 1.15), 0.015, 0.12, m_mach_s, rot=(math.radians(90),0,0))
    # Steam wand
    cyl("Steam", (1.08, -hd+0.30, 1.10), 0.008, 0.20, m_mach_s, rot=(math.radians(20),0,0))
    # Red accent strip
    box("CMstrip", (0.8, -hd+0.36, 1.30), (0.48, 0.01, 0.06), m_mach_a)
    # Drip tray
    rbox("DripT", (0.8, -hd+0.38, 0.92), (0.45, 0.15, 0.03), m_mach_s, 0.005)

    # ── GRINDER next to espresso machine ──
    m_grind = mat("Grind", (0.18, 0.18, 0.20, 1), 0.2, 0.6)
    rbox("Grinder", (0.3, -hd+0.18, 1.05), (0.18, 0.18, 0.35), m_grind, 0.02)
    # Hopper (bean container on top)
    cyl("GHopper", (0.3, -hd+0.18, 1.30), 0.07, 0.15, m_grind)

    # ── CUPS on shelves — bigger ──
    m_cup_w = mat("CupW", (0.95, 0.93, 0.90, 1), 0.4)
    m_cup_b = mat("CupB", (0.82, 0.70, 0.55, 1), 0.4)
    m_cup_r = mat("CupR", (0.85, 0.55, 0.50, 1), 0.4)
    for i, (cx, sz) in enumerate([
        (-1.8, 0.57), (-1.5, 0.57), (-1.2, 0.57), (-0.9, 0.57), (-0.6, 0.57),
        (-1.8, 0.92), (-1.5, 0.92), (-1.2, 0.92), (-0.9, 0.92),
        (-0.3, 1.27), (-0.1, 1.27), (0.1, 1.27),
    ]):
        m = [m_cup_w, m_cup_b, m_cup_r][i % 3]
        cyl(f"Cup{i}", (cx, -hd+0.12, sz+0.05), 0.03, 0.07, m)

    # ── COFFEE BOTTLES on shelves ──
    m_bottle = mat("Bottle", (0.30, 0.20, 0.12, 1), 0.3)
    m_bottle2 = mat("Bottle2", (0.15, 0.25, 0.15, 1), 0.3)
    for i, (bx, bz) in enumerate([
        (1.5, 0.57), (1.7, 0.57), (1.3, 0.92), (1.5, 0.92), (1.7, 0.92),
    ]):
        m = m_bottle if i%2==0 else m_bottle2
        cyl(f"Bot{i}", (bx, -hd+0.12, bz+0.08), 0.025, 0.14, m)

    # ── Items on counter top ──
    # Cake stand / display
    m_glass_d = mat("GlassD", (0.90, 0.92, 0.95, 1), 0.1, 0.05)
    cyl("CakeStand", (-0.5, -hd+0.45, 1.04), 0.14, 0.005, m_glass_d)
    cyl("CakeDome", (-0.5, -hd+0.45, 1.14), 0.13, 0.18, m_glass_d)
    # Cake inside
    m_cake = mat("Cake", (0.85, 0.72, 0.55, 1), 0.8)
    cyl("Cake", (-0.5, -hd+0.45, 1.06), 0.10, 0.06, m_cake)

    # Coffee pot (pour-over style)
    m_pot = mat("CPot", (0.20, 0.20, 0.22, 1), 0.2, 0.5)
    cyl("CPot", (-1.0, -hd+0.48, 1.08), 0.04, 0.10, m_pot)
    # Spout
    cyl("CPS", (-1.0, -hd+0.55, 1.15), 0.008, 0.06, m_pot, rot=(math.radians(45),0,0))

    # Menu / chalkboard on back wall
    m_chalk = mat("Chalk", (0.15, 0.18, 0.15, 1), 0.9)
    m_chalk_f = mat("ChalkF", (0.40, 0.30, 0.20, 1), 0.4)
    rbox("ChalkF", (0, -hd+0.04, 2.0), (1.2, 0.02, 0.70), m_chalk_f, 0.015)
    box("ChalkB", (0, -hd+0.05, 2.0), (1.1, 0.01, 0.60), m_chalk)
    # Chalk writing (simple light lines)
    m_chalk_t = emit_mat("ChalkT", (0.90, 0.88, 0.80, 1), 0.5)
    for i, cy in enumerate([2.18, 2.08, 1.98, 1.88]):
        w = 0.6 + (i%2)*0.2
        box(f"CT{i}", (0, -hd+0.055, cy), (w, 0.005, 0.02), m_chalk_t)

    # Cash register
    m_reg = mat("Reg", (0.30, 0.28, 0.25, 1), 0.3, 0.4)
    rbox("Register", (1.5, -hd+0.45, 1.12), (0.25, 0.20, 0.18), m_reg, 0.015)

    # Napkin holder
    m_napkin = mat("Napkin", (0.85, 0.82, 0.78, 1), 0.5, 0.2)
    rbox("Napkin", (-1.2, -hd+0.50, 1.07), (0.08, 0.06, 0.10), m_napkin, 0.008)


def build_seating():
    """Customer seating area — bar stools + small tables."""
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── BAR STOOLS (along counter) ──
    m_stool_s = mat("StoolS", (0.50, 0.38, 0.25, 1), 0.4)
    m_stool_c = mat("StoolC", (0.75, 0.55, 0.38, 1), 0.6)

    for sx in [-1.5, -0.5, 0.5, 1.5]:
        # Stool leg
        cyl(f"SL{sx}", (sx, -hd+1.0, 0.30), 0.02, 0.60, m_stool_s)
        # Stool seat
        cyl(f"SS{sx}", (sx, -hd+1.0, 0.62), 0.14, 0.05, m_stool_c)
        # Footrest ring
        cyl(f"SF{sx}", (sx, -hd+1.0, 0.18), 0.10, 0.015, m_stool_s)

    # ── SMALL TABLES (front area) ──
    m_table = mat("Table", (0.42, 0.30, 0.20, 1), 0.35)
    m_chair_s = mat("ChairS", (0.45, 0.33, 0.22, 1), 0.4)
    m_chair_c = mat("ChairC", (0.70, 0.50, 0.35, 1), 0.6)

    for tx, ty in [(-1.2, 1.0), (1.2, 1.0), (0, 1.8)]:
        # Table top (round)
        cyl(f"TT{tx}{ty}", (tx, ty, 0.70), 0.28, 0.03, m_table)
        # Table leg
        cyl(f"TL{tx}{ty}", (tx, ty, 0.35), 0.03, 0.70, m_table)
        # Table base
        cyl(f"TB{tx}{ty}", (tx, ty, 0.02), 0.15, 0.03, m_table)

        # Coffee cup + saucer on table
        m_tcup = mat(f"TCup{tx}", (0.95, 0.93, 0.90, 1), 0.35, 0.05)
        m_coffee = mat(f"Cof{tx}", (0.25, 0.15, 0.08, 1), 0.3)
        cyl(f"TS{tx}{ty}", (tx+0.05, ty-0.05, 0.715), 0.04, 0.005, m_tcup)  # saucer
        cyl(f"TC{tx}{ty}", (tx+0.05, ty-0.05, 0.74), 0.025, 0.05, m_tcup)  # cup
        cyl(f"TCL{tx}{ty}", (tx+0.05, ty-0.05, 0.75), 0.022, 0.02, m_coffee)  # coffee liquid

        # 2 chairs per table
        for ci, (cx, cy) in enumerate([(tx-0.35, ty), (tx+0.35, ty)]):
            # Chair legs
            for lx, ly in [(-0.08,-0.08),(0.08,-0.08),(-0.08,0.08),(0.08,0.08)]:
                box(f"CL{tx}{ci}{lx}", (cx+lx, cy+ly, 0.20), (0.02, 0.02, 0.40), m_chair_s)
            # Chair seat
            rbox(f"CSt{tx}{ci}", (cx, cy, 0.42), (0.28, 0.25, 0.04), m_chair_c, 0.015)
            # Chair back
            rbox(f"CB{tx}{ci}", (cx, cy-0.12, 0.65), (0.26, 0.03, 0.30), m_chair_c, 0.01)


def build_decorations():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── PENDANT LIGHTS (3 hanging from ceiling) ──
    m_cord = mat("Cord", (0.20, 0.18, 0.15, 1), 0.4)
    m_shade = mat("Shade", (0.85, 0.78, 0.65, 1), 0.6)
    m_bulb = emit_mat("Bulb", (1.0, 0.88, 0.60, 1), 18.0)  # brighter

    for lx in [-1.5, 0, 1.5]:
        # Cord
        cyl(f"PC{lx}", (lx, 0, STAGE_H-0.35), 0.005, 0.70, m_cord)
        # Shade (cone)
        bpy.ops.mesh.primitive_cone_add(radius1=0.15, radius2=0.04, depth=0.12,
                                         location=(lx, 0, STAGE_H-0.72))
        sh = bpy.context.active_object; sh.name = f"PS{lx}"
        sh.data.materials.append(m_shade)
        # Bulb glow
        sphere(f"PB{lx}", (lx, 0, STAGE_H-0.80), 0.04, m_bulb)

    # ── WINDOW on left wall ──
    m_wf = mat("WinF", (0.42, 0.30, 0.20, 1), 0.3)
    m_wg = emit_mat("WinG", (0.85, 0.90, 0.95, 1), 4.0)  # afternoon light

    wx, wz = -hw+0.03, 1.5
    ww, wh = 1.2, 1.0
    box("WinG", (wx, 0.5, wz), (0.02, ww, wh), m_wg)
    for n, l, d in [
        ("T", (wx, 0.5, wz+wh/2), (0.04, ww+0.06, 0.04)),
        ("B", (wx, 0.5, wz-wh/2), (0.04, ww+0.06, 0.04)),
        ("L", (wx, 0.5-ww/2, wz), (0.04, 0.04, wh)),
        ("R", (wx, 0.5+ww/2, wz), (0.04, 0.04, wh)),
        ("M", (wx, 0.5, wz), (0.04, 0.03, wh)),
    ]:
        box(f"WF{n}", l, d, m_wf)

    # Window curtain — white/cream lace
    m_curt = mat("Curt", (0.95, 0.92, 0.85, 1), 0.95)
    box("Curt", (wx+0.03, 0.5+ww/2+0.08, wz+0.1), (0.02, 0.20, wh+0.2), m_curt)

    # Plant on windowsill
    m_pot = mat("Pot", (0.65, 0.40, 0.30, 1), 0.5)
    m_plant = mat("Plant", (0.30, 0.55, 0.25, 1), 0.7)
    cyl("Pot", (wx+0.04, 0.2, wz-wh/2+0.10), 0.05, 0.10, m_pot)
    sphere("PlantL", (wx+0.04, 0.2, wz-wh/2+0.22), 0.08, m_plant, (1.0, 1.0, 0.8))

    # ── "OPEN" sign (simple emissive) ──
    m_sign = emit_mat("Sign", (1.0, 0.85, 0.50, 1), 3.0)
    m_sign_bg = mat("SignBg", (0.25, 0.20, 0.15, 1), 0.5)
    rbox("SignBg", (-hw+0.04, -0.8, 1.8), (0.03, 0.40, 0.15), m_sign_bg, 0.008)
    box("SignT", (-hw+0.05, -0.8, 1.8), (0.01, 0.35, 0.10), m_sign)

    # ── Picture frames on back wall ──
    m_pf = mat("PicF", (0.40, 0.30, 0.20, 1), 0.3)
    for px, pz, pw, ph in [(-2.0, 2.0, 0.30, 0.22), (2.0, 1.9, 0.25, 0.35)]:
        rbox(f"PF{px}", (px, -hd+0.04, pz), (pw, 0.02, ph), m_pf, 0.008)
        box(f"PI{px}", (px, -hd+0.05, pz), (pw-0.04, 0.01, ph-0.04),
            mat(f"P{px}", (0.80, 0.75, 0.68, 1), 0.8))


def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # 1. Warm ambient — café glow
    bpy.ops.object.light_add(type='SUN', location=(2, 2, 4))
    s = bpy.context.active_object; s.name = "Key"
    s.data.energy = 2.5
    s.data.color = (1.0, 0.92, 0.78)
    s.rotation_euler = (math.radians(50), math.radians(-20), math.radians(15))
    s.data.angle = math.radians(10)

    # 2. Pendant light points (warm amber — these ARE the atmosphere)
    for i, lx in enumerate([-1.5, 0, 1.5]):
        bpy.ops.object.light_add(type='POINT', location=(lx, 0, STAGE_H-0.85))
        p = bpy.context.active_object; p.name = f"Pendant{i}"
        p.data.energy = 65  # brighter pendant pools of light
        p.data.color = (1.0, 0.85, 0.55)
        p.data.shadow_soft_size = 0.3

    # 3. Window light — cool afternoon
    bpy.ops.object.light_add(type='AREA', location=(-hw+0.3, 0.5, 1.5))
    w = bpy.context.active_object; w.name = "WinLight"
    w.data.energy = 60
    w.data.color = (0.90, 0.95, 1.0)
    w.data.size = 1.0; w.data.size_y = 1.2
    w.rotation_euler = (0, 0, math.radians(90))

    # 4. Counter back light
    bpy.ops.object.light_add(type='AREA', location=(0, -hd+0.2, 1.5))
    cl = bpy.context.active_object; cl.name = "CounterL"
    cl.data.energy = 20
    cl.data.color = (1.0, 0.90, 0.72)
    cl.data.size = STAGE_W*0.6; cl.data.size_y = 0.5
    cl.rotation_euler = (math.radians(90), 0, 0)

    # 5. Front fill
    bpy.ops.object.light_add(type='AREA', location=(0, hd+2, 2.0))
    ff = bpy.context.active_object; ff.name = "FrontFill"
    ff.data.energy = 25
    ff.data.color = (1.0, 0.95, 0.88)
    ff.data.size = 3.0; ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(110), 0, 0)

    # 6. Floor bounce
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.05))
    fb = bpy.context.active_object; fb.name = "FloorB"
    fb.data.energy = 8
    fb.data.color = (0.90, 0.75, 0.55)
    fb.data.size = STAGE_W*0.5; fb.data.size_y = STAGE_D*0.5

    # World — warm dark
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.10, 0.08, 0.06, 1)
        bg.inputs["Strength"].default_value = 0.4


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
        "main": ((1.0, hd+2.5, 1.6), (math.radians(78), 0, math.radians(170)), 32),
        "counter": ((0, -hd+1.5, 1.3), (math.radians(85), 0, math.radians(180)), 35),
        "window": ((-hw+1.5, hd+1.0, 1.4), (math.radians(82), 0, math.radians(215)), 30),
        "wide": ((0, hd+3.5, 2.5), (math.radians(65), 0, math.radians(180)), 26),
    }

    for name, (loc, rot, lens) in angles.items():
        cd = bpy.data.cameras.new(f"C{name}"); cd.lens = lens
        co = bpy.data.objects.new(f"C{name}", cd)
        bpy.context.collection.objects.link(co)
        co.location = loc; co.rotation_euler = rot
        scene.camera = co
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"cafe2_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ cafe2_{name}.png")

    g = os.path.join(OUTPUT_DIR, "cafe-v2.glb")
    bpy.ops.export_scene.gltf(filepath=g, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  Café v2 — Reze's Coffee Shop")
    print("="*50)
    clear_scene()
    build_shell()
    build_counter()
    build_seating()
    build_decorations()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
