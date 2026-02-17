"""
Café Scene v4 — Fix Lamp + Add Props
- Fix floating pendant lamp by adding ceiling + canopy
- Add coffee cups on tables (radius 0.04, height 0.08)
- Add coffee machine box behind counter
- Add counter items: menu card + sugar bowl
- GLB export only (no cameras/renders)
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

    # Ceiling plane (so pendant lamps attach to something)
    m_ceil = mat("Ceiling", (0.96, 0.94, 0.90, 1), 0.9)
    box("Ceiling", (0, 0, STAGE_H+0.025), (STAGE_W+0.3, STAGE_D+0.3, 0.05), m_ceil)

    # Back wall — exposed brick (warm terracotta, higher roughness)
    m_wall = mat("Wall", (0.65, 0.42, 0.32, 1), 0.9)
    box("WBack", (0, -hd, STAGE_H/2), (STAGE_W, 0.08, STAGE_H), m_wall)

    # Brick texture hint — horizontal mortar lines (subtle)
    m_mortar = mat("Mortar", (0.55, 0.50, 0.45, 1), 0.95)
    for bz in [x*0.08 for x in range(2, int(STAGE_H/0.08))]:
        if bz < STAGE_H-0.1:
            box(f"Mort{bz:.0f}", (0, -hd+0.042, bz), (STAGE_W-0.2, 0.002, 0.008), m_mortar)

    # Left wall — warm plaster with wood wainscoting
    m_wall2 = mat("Wall2", (0.88, 0.82, 0.72, 1), 0.85)
    box("WLeft", (-hw, 0, STAGE_H/2), (0.08, STAGE_D, STAGE_H), m_wall2)

    # Wood wainscoting on left wall (bottom half)
    m_wainscot = mat("Wainscot", (0.38, 0.26, 0.17, 1), 0.5)
    box("Wainscot", (-hw+0.045, 0, 0.50), (0.02, STAGE_D-0.1, 1.0), m_wainscot)

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

    # ── COFFEE MACHINE BOX (simple box behind counter) ──
    m_mach_box = mat("MachBox", (0.18, 0.18, 0.20, 1), 0.2, 0.6)
    rbox("CoffeeBox", (-0.5, -hd+0.20, 1.25), (0.42, 0.25, 0.45), m_mach_box, 0.02)

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

    # Menu card (standing)
    m_menu = mat("MenuCard", (0.96, 0.90, 0.82, 1), 0.6)
    rbox("MenuCard", (1.15, -hd+0.48, 1.12), (0.07, 0.01, 0.12), m_menu, 0.003)

    # Sugar bowl
    m_sugar = mat("Sugar", (0.92, 0.88, 0.82, 1), 0.4)
    m_sugar_l = mat("SugarLid", (0.85, 0.80, 0.75, 1), 0.3)
    cyl("SugarBowl", (0.4, -hd+0.48, 1.07), 0.05, 0.06, m_sugar)
    cyl("SugarLid", (0.4, -hd+0.48, 1.10), 0.04, 0.02, m_sugar_l)
    sphere("SugarKnob", (0.4, -hd+0.48, 1.12), 0.01, m_sugar_l)


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

    # ── COZY BOOTH (replace one table with a bench seat against left wall) ──
    m_bench_f = mat("BenchF", (0.40, 0.28, 0.18, 1), 0.4)
    m_bench_c = mat("BenchC", (0.72, 0.48, 0.32, 1), 0.65)
    m_cushion = mat("Cushion", (0.85, 0.60, 0.50, 1), 0.85)
    # Bench frame
    rbox("Bench", (-hw+0.45, 1.0, 0.25), (0.50, 0.80, 0.50), m_bench_f, 0.02)
    # Bench seat cushion
    rbox("BenchCush", (-hw+0.48, 1.0, 0.52), (0.45, 0.75, 0.06), m_cushion, 0.02)
    # Bench back cushion
    rbox("BenchBack", (-hw+0.20, 1.0, 0.65), (0.06, 0.70, 0.30), m_cushion, 0.015)
    # Throw pillow on bench
    m_pillow = mat("Pillow", (0.90, 0.70, 0.55, 1), 0.9)
    rbox("Pillow", (-hw+0.30, 0.7, 0.58), (0.12, 0.12, 0.10), m_pillow, 0.03)

    # Coffee cups on tables — radius 0.04, height 0.08 (warm brown/cream)
    m_cup_cream = mat("CupCream", (0.95, 0.90, 0.82, 1), 0.45)
    m_cup_brown = mat("CupBrown", (0.55, 0.38, 0.25, 1), 0.55)
    cup_z = 0.755  # sits on 0.70 table top

    for tx, ty in [(1.2, 1.0), (0, 1.8)]:
        # Table top (round)
        cyl(f"TT{tx}{ty}", (tx, ty, 0.70), 0.28, 0.03, m_table)
        # Table leg
        cyl(f"TL{tx}{ty}", (tx, ty, 0.35), 0.03, 0.70, m_table)
        # Table base
        cyl(f"TB{tx}{ty}", (tx, ty, 0.02), 0.15, 0.03, m_table)

        # Two cups per table
        cyl(f"TCupA_{tx}{ty}", (tx+0.05, ty-0.05, cup_z), 0.04, 0.08, m_cup_cream)
        cyl(f"TCupB_{tx}{ty}", (tx-0.05, ty+0.05, cup_z), 0.04, 0.08, m_cup_brown)

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
    m_canopy = mat("Canopy", (0.25, 0.22, 0.20, 1), 0.4)
    m_shade = mat("Shade", (0.85, 0.78, 0.65, 1), 0.6)
    m_bulb = emit_mat("Bulb", (1.0, 0.88, 0.60, 1), 18.0)  # brighter

    for lx in [-1.5, 0, 1.5]:
        # Ceiling canopy (anchor)
        cyl(f"PTop{lx}", (lx, 0, STAGE_H-0.01), 0.05, 0.02, m_canopy)
        # Cord
        cyl(f"PC{lx}", (lx, 0, STAGE_H-0.35), 0.005, 0.70, m_cord)
        # Shade (cone)
        bpy.ops.mesh.primitive_cone_add(radius1=0.15, radius2=0.04, depth=0.12,
                                         location=(lx, 0, STAGE_H-0.72))
        sh = bpy.context.active_object; sh.name = f"PS{lx}"
        sh.data.materials.append(m_shade)
        # Bulb glow
        sphere(f"PB{lx}", (lx, 0, STAGE_H-0.80), 0.04, m_bulb)

    # ── WINDOW on left wall (real window — night view with street light) ──
    m_wf = mat("WinF", (0.42, 0.30, 0.20, 1), 0.3)
    m_wg = emit_mat("WinG", (0.15, 0.20, 0.35, 1), 2.0)  # night blue glow

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
    # Street lamp visible through window
    m_slamp = emit_mat("SLamp", (1.0, 0.90, 0.60, 1), 8.0)
    sphere("SLamp", (wx-0.05, 0.3, wz+0.3), 0.04, m_slamp)

    # Window curtain — white/cream lace (half drawn)
    m_curt = mat("Curt", (0.92, 0.88, 0.80, 1), 0.95)
    box("CurtL", (wx+0.02, 0.5-ww/2+0.08, wz+0.15), (0.015, 0.18, wh+0.1), m_curt)
    box("CurtR", (wx+0.02, 0.5+ww/2-0.08, wz+0.15), (0.015, 0.18, wh+0.1), m_curt)

    # Plant on windowsill
    m_pot = mat("Pot", (0.65, 0.40, 0.30, 1), 0.5)
    m_plant = mat("Plant", (0.30, 0.55, 0.25, 1), 0.7)
    cyl("Pot", (wx+0.04, 0.2, wz-wh/2+0.10), 0.05, 0.10, m_pot)
    sphere("PlantL", (wx+0.04, 0.2, wz-wh/2+0.22), 0.08, m_plant, (1.0, 1.0, 0.8))

    # ── FAKE WINDOW on BACK WALL (Dongping's idea — adds depth + light) ──
    m_fwf = mat("FWF", (0.42, 0.30, 0.20, 1), 0.3)
    # Warm evening scene behind fake window — emissive cityscape glow
    m_fwg = emit_mat("FWG", (0.25, 0.22, 0.40, 1), 3.0)  # evening purple-blue
    m_fwg_warm = emit_mat("FWGw", (0.90, 0.70, 0.40, 1), 2.5)  # warm street glow bottom

    fwx, fwz = -hd+0.04, 1.8
    fww, fwh = 0.80, 0.65
    # Window pane (night sky)
    box("FWG", (1.6, fwx, fwz), (0.01, fww, fwh), m_fwg)
    # Warm glow at bottom of fake window (street lights below)
    box("FWGw", (1.6, fwx, fwz-fwh/2+0.1), (0.01, fww, 0.20), m_fwg_warm)
    # Frame
    for fn, fl, fd in [
        ("FT", (1.6, fwx, fwz+fwh/2), (0.04, fww+0.06, 0.04)),
        ("FB", (1.6, fwx, fwz-fwh/2), (0.04, fww+0.06, 0.04)),
        ("FL", (1.6, fwx-fww/2, fwz), (0.04, 0.04, fwh)),
        ("FR", (1.6, fwx+fww/2, fwz), (0.04, 0.04, fwh)),
        ("FM", (1.6, fwx, fwz), (0.04, 0.03, fwh)),  # mullion
    ]:
        box(f"FW{fn}", fl, fd, m_fwf)
    # Windowsill
    rbox("FWSill", (1.6, fwx+0.04, fwz-fwh/2-0.02), (0.06, fww+0.08, 0.03), m_fwf, 0.005)
    # Small succulent on fake windowsill
    m_spig = mat("Succ", (0.35, 0.55, 0.30, 1), 0.7)
    m_spot2 = mat("SPot", (0.75, 0.50, 0.35, 1), 0.5)
    cyl("SPot", (1.6, fwx+0.04, fwz-fwh/2+0.05), 0.03, 0.05, m_spot2)
    sphere("Succ", (1.6, fwx+0.04, fwz-fwh/2+0.12), 0.03, m_spig)

    # ── FLOWER VASES on tables (tiny colored accents) ──
    m_vase1 = mat("Vase1", (0.80, 0.85, 0.90, 1), 0.3)
    m_vase2 = mat("Vase2", (0.85, 0.75, 0.68, 1), 0.4)
    m_flower = mat("Flower", (0.95, 0.65, 0.70, 1), 0.7)
    m_flower2 = mat("Flower2", (0.95, 0.85, 0.50, 1), 0.7)
    m_stem = mat("Stem", (0.30, 0.50, 0.25, 1), 0.6)

    for i, (vx, vy) in enumerate([(-1.2, 1.0), (1.2, 1.0), (0, 1.8)]):
        vm = m_vase1 if i%2==0 else m_vase2
        cyl(f"Vase{i}", (vx-0.08, vy+0.06, 0.73), 0.02, 0.06, vm)
        cyl(f"VStem{i}", (vx-0.08, vy+0.06, 0.78), 0.003, 0.08, m_stem)
        fm = m_flower if i%2==0 else m_flower2
        sphere(f"VFlower{i}", (vx-0.08, vy+0.06, 0.83), 0.015, fm)

    # ── STRING LIGHTS along back wall top — with actual glow ──
    m_sl = emit_mat("SLight", (1.0, 0.92, 0.70, 1), 15.0)
    m_slp = emit_mat("SLightP", (1.0, 0.80, 0.85, 1), 12.0)
    m_wire = mat("SWire", (0.20, 0.18, 0.15, 1), 0.5)
    for i in range(18):
        sx = -hw+0.3 + i*(STAGE_W-0.6)/17
        sz = STAGE_H-0.12 + math.sin(i*0.7)*0.05
        m = m_sl if i%3!=0 else m_slp
        sphere(f"SL{i}", (sx, -hd+0.08, sz), 0.018, m)
    # Wire connecting them
    box("SWire", (0, -hd+0.08, STAGE_H-0.10), (STAGE_W-0.4, 0.003, 0.003), m_wire)

    # String lights also along left wall top
    for i in range(10):
        sy = -hd+0.3 + i*(STAGE_D-0.6)/9
        sz = STAGE_H-0.12 + math.sin(i*0.9)*0.04
        m = m_sl if i%2==0 else m_slp
        sphere(f"SLL{i}", (-hw+0.08, sy, sz), 0.016, m)

    # ── "OPEN" sign (simple emissive) ──
    m_sign = emit_mat("Sign", (1.0, 0.85, 0.50, 1), 3.0)
    m_sign_bg = mat("SignBg", (0.25, 0.20, 0.15, 1), 0.5)
    rbox("SignBg", (-hw+0.04, -0.8, 1.8), (0.03, 0.40, 0.15), m_sign_bg, 0.008)
    box("SignT", (-hw+0.05, -0.8, 1.8), (0.01, 0.35, 0.10), m_sign)

    # ── Picture frames on back wall (more of them, varied) ──
    m_pf = mat("PicF", (0.40, 0.30, 0.20, 1), 0.3)
    m_pf_dark = mat("PicFD", (0.25, 0.20, 0.15, 1), 0.3)
    pics = [
        (-2.0, 2.1, 0.30, 0.22, m_pf), (-1.4, 1.95, 0.20, 0.28, m_pf_dark),
        (1.6, 2.0, 0.25, 0.35, m_pf), (2.2, 2.15, 0.18, 0.18, m_pf_dark),
    ]
    pic_colors = [(0.80, 0.70, 0.55, 1), (0.60, 0.50, 0.40, 1),
                  (0.75, 0.65, 0.50, 1), (0.70, 0.60, 0.55, 1)]
    for i, (px, pz, pw, ph, mf) in enumerate(pics):
        rbox(f"PF{i}", (px, -hd+0.04, pz), (pw, 0.02, ph), mf, 0.008)
        box(f"PI{i}", (px, -hd+0.05, pz), (pw-0.04, 0.01, ph-0.04),
            mat(f"P{i}", pic_colors[i], 0.8))

    # ── WALL SHELF with books (left wall, above wainscoting) ──
    m_shelf_w = mat("WShelf", (0.38, 0.26, 0.17, 1), 0.4)
    rbox("WShelf", (-hw+0.08, 0.0, 1.3), (0.14, 0.80, 0.02), m_shelf_w, 0.005)
    # Books on shelf
    book_colors = [
        (0.65, 0.25, 0.20, 1), (0.25, 0.40, 0.55, 1), (0.80, 0.75, 0.60, 1),
        (0.35, 0.55, 0.35, 1), (0.70, 0.50, 0.30, 1), (0.50, 0.30, 0.45, 1),
        (0.85, 0.40, 0.30, 1), (0.30, 0.35, 0.50, 1),
    ]
    bx = -0.30
    for i, bc in enumerate(book_colors):
        bw = 0.025 + (i%3)*0.005
        rbox(f"Book{i}", (-hw+0.08, bx, 1.37), (0.10, bw, 0.12+i%2*0.02),
             mat(f"Bk{i}", bc, 0.7), 0.003)
        bx += bw + 0.008

    # ── HANGING PLANT (macramé style from ceiling) ──
    m_rope = mat("Rope", (0.80, 0.75, 0.65, 1), 0.9)
    m_hpot = mat("HPot", (0.70, 0.45, 0.30, 1), 0.6)
    m_hplant = mat("HPlant", (0.25, 0.50, 0.22, 1), 0.7)
    cyl("HRope", (1.8, 0.5, STAGE_H-0.25), 0.005, 0.50, m_rope)
    cyl("HPot", (1.8, 0.5, STAGE_H-0.55), 0.06, 0.10, m_hpot)
    sphere("HPlantL", (1.8, 0.5, STAGE_H-0.42), 0.10, m_hplant, (1.2, 1.2, 0.7))


def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # 1. Key light — REDUCED so pendants can be hero
    bpy.ops.object.light_add(type='SUN', location=(2, 2, 4))
    s = bpy.context.active_object; s.name = "Key"
    s.data.energy = 0.8  # gentle key to reveal surfaces
    s.data.color = (1.0, 0.92, 0.78)
    s.rotation_euler = (math.radians(50), math.radians(-20), math.radians(15))
    s.data.angle = math.radians(10)

    # 2. Pendant SPOT lights — focused warm cones onto tables
    # Table positions: (-1.2, 1.0), (1.2, 1.0), (0, 1.8), counter area (0, -hd+0.7)
    pendant_targets = [
        (-1.2, 1.0, "TableL"), (1.2, 1.0, "TableR"), (0, 1.8, "TableC"),
        (-0.5, -hd+0.7, "CounterL"), (0.8, -hd+0.7, "CounterR"),
    ]
    for lx, ly, nm in pendant_targets:
        bpy.ops.object.light_add(type='SPOT', location=(lx, ly, STAGE_H-0.4))
        sp = bpy.context.active_object; sp.name = f"Pend_{nm}"
        sp.data.energy = 1200  # VERY strong focused spot
        sp.data.color = (1.0, 0.80, 0.45)  # warm amber
        sp.data.spot_size = math.radians(35)  # TIGHTER cone
        sp.data.spot_blend = 0.2  # sharper edge
        sp.rotation_euler = (math.radians(90), 0, 0)  # point straight down

    # 3. Window light — cool afternoon
    bpy.ops.object.light_add(type='AREA', location=(-hw+0.3, 0.5, 1.5))
    w = bpy.context.active_object; w.name = "WinLight"
    w.data.energy = 5  # MINIMAL — night time, window barely lit
    w.data.color = (0.90, 0.95, 1.0)
    w.data.size = 1.0; w.data.size_y = 1.2
    w.rotation_euler = (0, 0, math.radians(90))

    # 4. Counter back light
    bpy.ops.object.light_add(type='AREA', location=(0, -hd+0.2, 1.5))
    cl = bpy.context.active_object; cl.name = "CounterL"
    cl.data.energy = 3  # minimal counter backlight
    cl.data.color = (1.0, 0.90, 0.72)
    cl.data.size = STAGE_W*0.6; cl.data.size_y = 0.5
    cl.rotation_euler = (math.radians(90), 0, 0)

    # 5. Front fill — REDUCED
    bpy.ops.object.light_add(type='AREA', location=(0, hd+2, 2.0))
    ff = bpy.context.active_object; ff.name = "FrontFill"
    ff.data.energy = 5  # minimal front fill
    ff.data.color = (1.0, 0.95, 0.88)
    ff.data.size = 3.0; ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(110), 0, 0)

    # 6. Floor bounce — STRONGER to show details
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.05))
    fb = bpy.context.active_object; fb.name = "FloorB"
    fb.data.energy = 20
    fb.data.color = (0.90, 0.75, 0.55)
    fb.data.size = STAGE_W*0.6; fb.data.size_y = STAGE_D*0.6

    # 7. AMBIENT FILL — warm, very soft, to show the brick/details
    bpy.ops.object.light_add(type='AREA', location=(0, 0, STAGE_H-0.2))
    af = bpy.context.active_object; af.name = "AmbFill"
    af.data.energy = 60  # enough to reveal walls but not overpower spots
    af.data.color = (1.0, 0.88, 0.65)
    af.data.size = STAGE_W*0.8; af.data.size_y = STAGE_D*0.8

    # 8. Brick wall wash — to show exposed brick texture
    bpy.ops.object.light_add(type='AREA', location=(0, -hd+0.5, 2.5))
    bw = bpy.context.active_object; bw.name = "BrickWash"
    bw.data.energy = 30
    bw.data.color = (1.0, 0.85, 0.60)
    bw.data.size = STAGE_W*0.5; bw.data.size_y = 1.5
    bw.rotation_euler = (math.radians(90), 0, 0)

    # 9. Booth sconce — warm spot to light the bench area
    bpy.ops.object.light_add(type='SPOT', location=(-hw+0.3, 1.0, 1.8))
    bs = bpy.context.active_object; bs.name = "BoothSconce"
    bs.data.energy = 200
    bs.data.color = (1.0, 0.85, 0.55)
    bs.data.spot_size = math.radians(50)
    bs.data.spot_blend = 0.4
    bs.rotation_euler = (math.radians(90), 0, 0)

    # World — warm dark but NOT pitch black
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.12, 0.09, 0.06, 1)
        bg.inputs["Strength"].default_value = 0.15  # visible ambient


def export_glb():
    g = os.path.join(OUTPUT_DIR, "cafe.glb")
    bpy.ops.export_scene.gltf(filepath=g, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  Café v4 — Fix Lamp + Add Props")
    print("="*50)
    clear_scene()
    build_shell()
    build_counter()
    build_seating()
    build_decorations()
    build_lighting()
    export_glb()
    print("DONE ✓")


if __name__ == "__main__":
    main()
