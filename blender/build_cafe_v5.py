"""
Café Scene v5 — Major Upgrade (Window, Tiles, Decor, Beams, Props)
- Large window with exterior emissive view + door
- Checkerboard tile floor
- More seating + table details
- Bigger counter equipment + pastry display
- Wall decor, shelf with coffee jars
- Ceiling beams + more pendant lamps
- Plants + hanging ivy
- GLB export only (no cameras/renders)
"""

import bpy
import math
import os

OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 6.0
STAGE_D = 5.0
STAGE_H = 3.0

os.makedirs(OUTPUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for b in bpy.data.meshes:
        if b.users == 0:
            bpy.data.meshes.remove(b)
    for b in bpy.data.materials:
        if b.users == 0:
            bpy.data.materials.remove(b)


def mat(name, color, roughness=0.7, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = roughness
        b.inputs["Metallic"].default_value = metallic
    return m


def glass_mat(name, color=(0.75, 0.85, 0.95, 1), roughness=0.08, transmission=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Base Color"].default_value = color
        b.inputs["Roughness"].default_value = roughness
        if "Transmission" in b.inputs:
            b.inputs["Transmission"].default_value = transmission
        elif "Transmission Weight" in b.inputs:
            b.inputs["Transmission Weight"].default_value = transmission
        if "IOR" in b.inputs:
            b.inputs["IOR"].default_value = 1.45
        if "Specular" in b.inputs:
            b.inputs["Specular"].default_value = 0.5
    return m


def emit_mat(name, color, strength=5.0):
    # NOTE: Emission strength MUST be >= 3.0
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = max(3.0, strength)
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def box(nm, loc, dim, mt, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.scale = dim
    o.rotation_euler = rot
    if mt:
        o.data.materials.append(mt)
    return o


def rbox(nm, loc, dim, mt, r=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.scale = dim
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    bv = o.modifiers.new("B", 'BEVEL')
    bv.width = r
    bv.segments = 3
    bv.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="B")
    if mt:
        o.data.materials.append(mt)
    return o


def cyl(nm, loc, rad, dep, mt, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=dep, location=loc)
    o = bpy.context.active_object
    o.name = nm
    o.rotation_euler = rot
    if mt:
        o.data.materials.append(mt)
    return o


def sphere(nm, loc, rad, mt, sc=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = nm
    o.scale = sc
    if mt:
        o.data.materials.append(mt)
    return o


# ------------------------------------------------------------
# Shell / Room
# ------------------------------------------------------------

def build_shell():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    # Base floor slab
    m_base = mat("FloorBase", (0.25, 0.18, 0.12, 1), 0.7)
    box("FloorBase", (0, 0, -0.05), (STAGE_W + 0.3, STAGE_D + 0.3, 0.06), m_base)

    # Checkerboard tile floor
    m_tile_a = mat("TileA", (0.78, 0.72, 0.62, 1), 0.55)
    m_tile_b = mat("TileB", (0.32, 0.22, 0.15, 1), 0.55)
    tile = 0.5
    nx = int(STAGE_W / tile)
    ny = int(STAGE_D / tile)
    for i in range(nx):
        for j in range(ny):
            x = -hw + tile / 2 + i * tile
            y = -hd + tile / 2 + j * tile
            m = m_tile_a if (i + j) % 2 == 0 else m_tile_b
            box(f"Tile_{i}_{j}", (x, y, -0.01), (tile * 0.48, tile * 0.48, 0.02), m)

    # Ceiling plane
    m_ceil = mat("Ceiling", (0.96, 0.94, 0.90, 1), 0.9)
    box("Ceiling", (0, 0, STAGE_H + 0.025), (STAGE_W + 0.3, STAGE_D + 0.3, 0.05), m_ceil)

    # Walls
    m_wall_back = mat("WallBack", (0.62, 0.40, 0.30, 1), 0.9)
    m_wall_side = mat("WallSide", (0.88, 0.82, 0.72, 1), 0.85)
    box("WBack", (0, -hd, STAGE_H / 2), (STAGE_W, 0.08, STAGE_H), m_wall_back)
    box("WLeft", (-hw, 0, STAGE_H / 2), (0.08, STAGE_D, STAGE_H), m_wall_side)
    box("WRight", (hw, 0, STAGE_H / 2), (0.08, STAGE_D, STAGE_H), m_wall_side)

    # Wainscoting on left + right
    m_wains = mat("Wainscot", (0.38, 0.26, 0.17, 1), 0.45)
    box("WainsL", (-hw + 0.045, 0, 0.50), (0.02, STAGE_D - 0.2, 1.0), m_wains)
    box("WainsR", (hw - 0.045, 0, 0.50), (0.02, STAGE_D - 0.2, 1.0), m_wains)

    # Baseboards
    m_bb = mat("BB", (0.45, 0.33, 0.22, 1), 0.4)
    box("BB_B", (0, -hd + 0.045, 0.05), (STAGE_W, 0.02, 0.10), m_bb)
    box("BB_L", (-hw + 0.045, 0, 0.05), (0.02, STAGE_D, 0.10), m_bb)
    box("BB_R", (hw - 0.045, 0, 0.05), (0.02, STAGE_D, 0.10), m_bb)

    # Crown molding
    m_cr = mat("Crown", (0.92, 0.87, 0.80, 1), 0.5)
    box("CR_B", (0, -hd + 0.045, STAGE_H - 0.03), (STAGE_W, 0.03, 0.06), m_cr)
    box("CR_L", (-hw + 0.045, 0, STAGE_H - 0.03), (0.03, STAGE_D, 0.06), m_cr)
    box("CR_R", (hw - 0.045, 0, STAGE_H - 0.03), (0.03, STAGE_D, 0.06), m_cr)

    # Ceiling beams
    m_beam = mat("Beam", (0.30, 0.22, 0.16, 1), 0.45)
    for by in [-1.6, 0.0, 1.6]:
        box(f"Beam{by}", (0, by, STAGE_H - 0.12), (STAGE_W + 0.2, 0.10, 0.12), m_beam)


# ------------------------------------------------------------
# Counter + Equipment
# ------------------------------------------------------------

def build_counter():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    m_top = mat("CTop", (0.35, 0.22, 0.14, 1), 0.3)
    m_front = mat("CFront", (0.42, 0.30, 0.20, 1), 0.4)
    m_shelf = mat("CShelf", (0.38, 0.26, 0.17, 1), 0.4)

    # Main counter
    rbox("Counter", (0, -hd + 0.50, 0.52), (STAGE_W - 0.8, 0.70, 1.04), m_front, 0.03)
    rbox("CTop", (0, -hd + 0.50, 1.06), (STAGE_W - 0.7, 0.75, 0.04), m_top, 0.02)

    # Back counter / shelving unit
    rbox("BackC", (0, -hd + 0.16, 0.90), (STAGE_W - 0.6, 0.22, 1.80), m_shelf, 0.02)

    for sz in [0.55, 0.95, 1.35, 1.70]:
        rbox(f"Sh{sz}", (0, -hd + 0.16, sz), (STAGE_W - 0.7, 0.22, 0.02), m_shelf, 0.005)

    # ── BIG COFFEE MACHINE ──
    m_mach = mat("Mach", (0.22, 0.22, 0.25, 1), 0.18, 0.7)
    m_mach_a = mat("MachA", (0.85, 0.18, 0.12, 1), 0.3, 0.3)
    m_mach_s = mat("MachS", (0.70, 0.70, 0.72, 1), 0.1, 0.8)

    rbox("CoffeeM", (1.0, -hd + 0.20, 1.20), (0.70, 0.40, 0.62), m_mach, 0.03)
    rbox("CMTop", (1.0, -hd + 0.20, 1.52), (0.72, 0.32, 0.06), m_mach_s, 0.01)
    for px in [0.80, 1.05, 1.28]:
        cyl(f"PF{px}", (px, -hd + 0.40, 1.20), 0.018, 0.14, m_mach_s, rot=(math.radians(90), 0, 0))
    cyl("Steam", (1.35, -hd + 0.30, 1.15), 0.01, 0.24, m_mach_s, rot=(math.radians(25), 0, 0))
    box("CMstrip", (1.0, -hd + 0.38, 1.34), (0.65, 0.012, 0.06), m_mach_a)
    rbox("DripT", (1.0, -hd + 0.40, 0.94), (0.60, 0.18, 0.03), m_mach_s, 0.005)

    # Grinder
    m_grind = mat("Grind", (0.18, 0.18, 0.20, 1), 0.2, 0.6)
    rbox("Grinder", (0.45, -hd + 0.20, 1.05), (0.22, 0.20, 0.40), m_grind, 0.02)
    cyl("GHopper", (0.45, -hd + 0.20, 1.32), 0.08, 0.18, m_grind)

    # ── Pastry display case ──
    m_case = mat("Case", (0.30, 0.24, 0.20, 1), 0.4)
    m_glass = glass_mat("CaseGlass", (0.85, 0.90, 0.95, 1), 0.08, 0.9)
    m_case_light = emit_mat("CaseLight", (1.0, 0.88, 0.60, 1), 8.0)
    rbox("CaseBase", (-1.3, -hd + 0.46, 1.02), (0.70, 0.35, 0.18), m_case, 0.02)
    box("CaseGlass", (-1.3, -hd + 0.46, 1.22), (0.66, 0.30, 0.22), m_glass)
    box("CaseLight", (-1.3, -hd + 0.46, 1.12), (0.60, 0.02, 0.02), m_case_light)
    # Pastries inside
    m_pastry1 = mat("Pastry1", (0.80, 0.65, 0.45, 1), 0.8)
    m_pastry2 = mat("Pastry2", (0.90, 0.75, 0.55, 1), 0.8)
    for i, px in enumerate([-1.45, -1.30, -1.15]):
        m = m_pastry1 if i % 2 == 0 else m_pastry2
        rbox(f"Pastry{i}", (px, -hd + 0.46, 1.10), (0.12, 0.08, 0.05), m, 0.01)

    # ── Cash register (bigger) ──
    m_reg = mat("Reg", (0.30, 0.28, 0.25, 1), 0.3, 0.4)
    rbox("Register", (1.65, -hd + 0.46, 1.16), (0.32, 0.24, 0.20), m_reg, 0.02)

    # ── Cups on shelves (bigger) ──
    m_cup_w = mat("CupW", (0.95, 0.93, 0.90, 1), 0.4)
    m_cup_b = mat("CupB", (0.82, 0.70, 0.55, 1), 0.4)
    m_cup_r = mat("CupR", (0.85, 0.55, 0.50, 1), 0.4)
    for i, (cx, sz) in enumerate([
        (-1.9, 0.58), (-1.6, 0.58), (-1.3, 0.58), (-1.0, 0.58), (-0.7, 0.58),
        (-1.9, 0.96), (-1.6, 0.96), (-1.3, 0.96), (-1.0, 0.96),
        (-0.4, 1.35), (-0.15, 1.35), (0.10, 1.35),
    ]):
        m = [m_cup_w, m_cup_b, m_cup_r][i % 3]
        cyl(f"Cup{i}", (cx, -hd + 0.16, sz + 0.06), 0.035, 0.08, m)

    # ── Coffee jars on shelf ──
    m_jar = mat("Jar", (0.60, 0.48, 0.32, 1), 0.3)
    m_jar2 = mat("Jar2", (0.45, 0.40, 0.25, 1), 0.3)
    for i, (bx, bz) in enumerate([
        (1.3, 0.58), (1.55, 0.58), (1.8, 0.58),
        (1.3, 0.96), (1.55, 0.96), (1.8, 0.96),
    ]):
        m = m_jar if i % 2 == 0 else m_jar2
        cyl(f"Jar{i}", (bx, -hd + 0.16, bz + 0.08), 0.03, 0.16, m)

    # ── Items on counter top ──
    m_glass_d = glass_mat("GlassD", (0.90, 0.92, 0.95, 1), 0.08, 0.9)
    cyl("CakeStand", (-0.6, -hd + 0.50, 1.05), 0.16, 0.005, m_glass_d)
    cyl("CakeDome", (-0.6, -hd + 0.50, 1.18), 0.15, 0.22, m_glass_d)
    m_cake = mat("Cake", (0.85, 0.72, 0.55, 1), 0.8)
    cyl("Cake", (-0.6, -hd + 0.50, 1.08), 0.12, 0.06, m_cake)

    # Coffee pot
    m_pot = mat("CPot", (0.20, 0.20, 0.22, 1), 0.2, 0.5)
    cyl("CPot", (-1.05, -hd + 0.52, 1.10), 0.05, 0.12, m_pot)
    cyl("CPS", (-1.05, -hd + 0.59, 1.18), 0.01, 0.08, m_pot, rot=(math.radians(45), 0, 0))


# ------------------------------------------------------------
# Seating / Tables / Chairs
# ------------------------------------------------------------

def build_seating():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    m_stool_s = mat("StoolS", (0.50, 0.38, 0.25, 1), 0.4)
    m_stool_c = mat("StoolC", (0.75, 0.55, 0.38, 1), 0.6)

    for sx in [-1.6, -0.6, 0.6, 1.6]:
        cyl(f"SL{sx}", (sx, -hd + 1.05, 0.30), 0.02, 0.60, m_stool_s)
        cyl(f"SS{sx}", (sx, -hd + 1.05, 0.62), 0.16, 0.05, m_stool_c)
        cyl(f"SF{sx}", (sx, -hd + 1.05, 0.18), 0.12, 0.015, m_stool_s)

    m_table = mat("Table", (0.42, 0.30, 0.20, 1), 0.35)
    m_chair_s = mat("ChairS", (0.45, 0.33, 0.22, 1), 0.4)
    m_chair_c = mat("ChairC", (0.70, 0.50, 0.35, 1), 0.6)

    # Table details
    m_cup_cream = mat("CupCream", (0.95, 0.90, 0.82, 1), 0.45)
    m_cup_brown = mat("CupBrown", (0.55, 0.38, 0.25, 1), 0.55)
    m_napkin = mat("Napkin", (0.85, 0.82, 0.78, 1), 0.5, 0.2)
    m_menu = mat("MenuCard", (0.96, 0.90, 0.82, 1), 0.6)
    m_sugar = mat("Sugar", (0.92, 0.88, 0.82, 1), 0.4)

    def add_chair(prefix, cx, cy):
        for lx, ly in [(-0.08, -0.08), (0.08, -0.08), (-0.08, 0.08), (0.08, 0.08)]:
            box(f"{prefix}_L{lx}{ly}", (cx + lx, cy + ly, 0.20), (0.02, 0.02, 0.40), m_chair_s)
        rbox(f"{prefix}_Seat", (cx, cy, 0.42), (0.28, 0.25, 0.04), m_chair_c, 0.015)
        rbox(f"{prefix}_Back", (cx, cy - 0.12, 0.65), (0.26, 0.03, 0.30), m_chair_c, 0.01)

    def add_table(name, tx, ty, chairs=2):
        # Table
        cyl(f"{name}_Top", (tx, ty, 0.72), 0.30, 0.03, m_table)
        cyl(f"{name}_Leg", (tx, ty, 0.36), 0.03, 0.72, m_table)
        cyl(f"{name}_Base", (tx, ty, 0.02), 0.16, 0.03, m_table)

        # Table details
        cyl(f"{name}_CupA", (tx + 0.05, ty - 0.05, 0.76), 0.045, 0.09, m_cup_cream)
        cyl(f"{name}_CupB", (tx - 0.05, ty + 0.05, 0.76), 0.045, 0.09, m_cup_brown)
        rbox(f"{name}_Nap", (tx + 0.08, ty + 0.06, 0.76), (0.07, 0.05, 0.05), m_napkin, 0.01)
        rbox(f"{name}_Menu", (tx - 0.10, ty - 0.02, 0.80), (0.06, 0.01, 0.12), m_menu, 0.003)
        cyl(f"{name}_Sugar", (tx + 0.00, ty + 0.10, 0.76), 0.05, 0.06, m_sugar)

        # Chairs
        if chairs == 4:
            for i, (cx, cy) in enumerate([(tx - 0.35, ty), (tx + 0.35, ty), (tx, ty - 0.35), (tx, ty + 0.35)]):
                add_chair(f"{name}_C{i}", cx, cy)
        else:
            for i, (cx, cy) in enumerate([(tx - 0.35, ty), (tx + 0.35, ty)]):
                add_chair(f"{name}_C{i}", cx, cy)

    # Tables pushed to edges (center clear)
    add_table("T1", -1.8, 1.4, chairs=2)
    add_table("T2", 1.8, 1.4, chairs=2)
    add_table("T3", -1.8, -0.4, chairs=2)
    add_table("T4", 1.8, -0.4, chairs=2)
    add_table("T5", 0.0, 2.0, chairs=2)

    # Cozy bench booth on left wall
    m_bench_f = mat("BenchF", (0.40, 0.28, 0.18, 1), 0.4)
    m_cushion = mat("Cushion", (0.85, 0.60, 0.50, 1), 0.85)
    rbox("Bench", (-hw + 0.45, 1.6, 0.25), (0.55, 0.90, 0.50), m_bench_f, 0.02)
    rbox("BenchCush", (-hw + 0.48, 1.6, 0.52), (0.50, 0.85, 0.06), m_cushion, 0.02)
    rbox("BenchBack", (-hw + 0.20, 1.6, 0.65), (0.06, 0.80, 0.30), m_cushion, 0.015)

    m_pillow = mat("Pillow", (0.90, 0.70, 0.55, 1), 0.9)
    rbox("Pillow", (-hw + 0.30, 1.3, 0.58), (0.14, 0.14, 0.10), m_pillow, 0.03)


# ------------------------------------------------------------
# Decorations / Lights / Window / Door / Plants
# ------------------------------------------------------------

def build_decorations():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    # ── Pendant lights over tables ──
    m_cord = mat("Cord", (0.20, 0.18, 0.15, 1), 0.4)
    m_canopy = mat("Canopy", (0.25, 0.22, 0.20, 1), 0.4)
    m_shade = mat("Shade", (0.85, 0.78, 0.65, 1), 0.6)
    m_bulb = emit_mat("Bulb", (1.0, 0.88, 0.60, 1), 20.0)

    pendant_positions = [
        (-1.8, 1.4), (1.8, 1.4), (-1.8, -0.4), (1.8, -0.4), (0.0, 2.0),
        (0.0, -hd + 0.8),
    ]
    for i, (lx, ly) in enumerate(pendant_positions):
        cyl(f"PTop{i}", (lx, ly, STAGE_H - 0.01), 0.05, 0.02, m_canopy)
        cyl(f"PC{i}", (lx, ly, STAGE_H - 0.35), 0.005, 0.70, m_cord)
        bpy.ops.mesh.primitive_cone_add(radius1=0.16, radius2=0.05, depth=0.14,
                                         location=(lx, ly, STAGE_H - 0.74))
        sh = bpy.context.active_object
        sh.name = f"PS{i}"
        sh.data.materials.append(m_shade)
        sphere(f"PB{i}", (lx, ly, STAGE_H - 0.82), 0.05, m_bulb)

    # Extra pendant near bench
    cyl("PTopBench", (-hw + 0.6, 1.6, STAGE_H - 0.01), 0.05, 0.02, m_canopy)
    cyl("PCBench", (-hw + 0.6, 1.6, STAGE_H - 0.35), 0.005, 0.70, m_cord)
    bpy.ops.mesh.primitive_cone_add(radius1=0.16, radius2=0.05, depth=0.14,
                                     location=(-hw + 0.6, 1.6, STAGE_H - 0.74))
    shb = bpy.context.active_object
    shb.name = "PSBench"
    shb.data.materials.append(m_shade)
    sphere("PBBench", (-hw + 0.6, 1.6, STAGE_H - 0.82), 0.05, m_bulb)

    # ── Large window on right wall ──
    m_wf = mat("WinF", (0.42, 0.30, 0.20, 1), 0.3)
    m_wg = glass_mat("WinGlass", (0.80, 0.90, 1.00, 1), 0.05, 0.9)
    m_sky_top = emit_mat("SkyTop", (0.20, 0.35, 0.65, 1), 4.0)
    m_sky_bot = emit_mat("SkyBot", (0.90, 0.70, 0.45, 1), 3.5)

    wx = hw - 0.03
    wy = -0.2
    wz = 1.6
    ww, wh = 2.4, 1.5
    # Glass pane
    box("WinGlass", (wx, wy, wz), (0.01, ww, wh), m_wg)
    # Exterior emissive view (outside)
    box("SkyTop", (wx + 0.08, wy, wz + 0.35), (0.01, ww, wh * 0.55), m_sky_top)
    box("SkyBot", (wx + 0.08, wy, wz - 0.40), (0.01, ww, wh * 0.45), m_sky_bot)

    # Window frame
    for n, l, d in [
        ("T", (wx, wy, wz + wh / 2), (0.04, ww + 0.06, 0.04)),
        ("B", (wx, wy, wz - wh / 2), (0.04, ww + 0.06, 0.04)),
        ("L", (wx, wy - ww / 2, wz), (0.04, 0.04, wh)),
        ("R", (wx, wy + ww / 2, wz), (0.04, 0.04, wh)),
        ("M", (wx, wy, wz), (0.04, 0.03, wh)),
    ]:
        box(f"WF{n}", l, d, m_wf)

    # Tree silhouette outside window
    m_tree = mat("Tree", (0.08, 0.10, 0.08, 1), 0.9)
    cyl("TreeTrunk", (wx + 0.04, wy + 0.4, 0.9), 0.05, 1.2, m_tree)
    sphere("TreeLeaf", (wx + 0.04, wy + 0.4, 1.45), 0.35, m_tree)

    # ── Door on right wall ──
    m_df = mat("DoorF", (0.40, 0.30, 0.22, 1), 0.3)
    m_dg = glass_mat("DoorGlass", (0.85, 0.92, 1.0, 1), 0.06, 0.9)
    dx, dy, dz = hw - 0.03, 1.8, 1.0
    dw, dh = 0.9, 2.0
    box("DoorGlass", (dx, dy, dz), (0.01, dw, dh), m_dg)
    for n, l, d in [
        ("DT", (dx, dy, dz + dh / 2), (0.04, dw + 0.06, 0.05)),
        ("DB", (dx, dy, dz - dh / 2), (0.04, dw + 0.06, 0.05)),
        ("DL", (dx, dy - dw / 2, dz), (0.04, 0.05, dh)),
        ("DR", (dx, dy + dw / 2, dz), (0.04, 0.05, dh)),
    ]:
        box(f"D{n}", l, d, m_df)
    # Exterior glow behind door
    m_dglow = emit_mat("DoorGlow", (0.95, 0.80, 0.55, 1), 3.5)
    box("DoorGlow", (dx + 0.08, dy, dz), (0.01, dw, dh), m_dglow)

    # ── Menu chalkboard on back wall ──
    m_chalk = mat("Chalk", (0.12, 0.16, 0.12, 1), 0.9)
    m_chalk_f = mat("ChalkF", (0.40, 0.30, 0.20, 1), 0.4)
    rbox("ChalkF", (0.0, -hd + 0.04, 2.1), (1.8, 0.02, 0.90), m_chalk_f, 0.02)
    box("ChalkB", (0.0, -hd + 0.05, 2.1), (1.7, 0.01, 0.80), m_chalk)
    m_chalk_t = emit_mat("ChalkT", (0.95, 0.92, 0.82, 1), 4.0)
    for i, cy in enumerate([2.35, 2.22, 2.09, 1.96, 1.83]):
        w = 0.9 + (i % 2) * 0.3
        box(f"CT{i}", (0, -hd + 0.055, cy), (w, 0.005, 0.02), m_chalk_t)

    # ── Artwork frames ──
    m_pf = mat("PicF", (0.40, 0.30, 0.20, 1), 0.3)
    m_pf_dark = mat("PicFD", (0.25, 0.20, 0.15, 1), 0.3)
    pics = [
        (-2.2, 2.2, 0.35, 0.25, m_pf),
        (-1.4, 2.0, 0.22, 0.30, m_pf_dark),
        (2.2, 2.05, 0.28, 0.40, m_pf),
    ]
    pic_colors = [(0.80, 0.70, 0.55, 1), (0.60, 0.50, 0.40, 1), (0.75, 0.65, 0.50, 1)]
    for i, (px, pz, pw, ph, mf) in enumerate(pics):
        rbox(f"PF{i}", (px, -hd + 0.04, pz), (pw, 0.02, ph), mf, 0.008)
        box(f"PI{i}", (px, -hd + 0.05, pz), (pw - 0.04, 0.01, ph - 0.04), mat(f"P{i}", pic_colors[i], 0.8))

    # ── Wall shelf with coffee jars (right wall) ──
    m_shelf = mat("WShelf", (0.38, 0.26, 0.17, 1), 0.4)
    rbox("WShelf", (hw - 0.08, -1.3, 1.35), (0.14, 1.0, 0.02), m_shelf, 0.005)
    jar_colors = [
        (0.65, 0.40, 0.22, 1), (0.55, 0.32, 0.18, 1), (0.35, 0.25, 0.18, 1),
        (0.45, 0.30, 0.20, 1), (0.60, 0.45, 0.30, 1)
    ]
    for i, jc in enumerate(jar_colors):
        cyl(f"WallJar{i}", (hw - 0.08, -1.0 + i * 0.2, 1.45), 0.04, 0.14, mat(f"WJ{i}", jc, 0.4))

    # ── String lights along back wall top ──
    m_sl = emit_mat("SLight", (1.0, 0.92, 0.70, 1), 15.0)
    m_slp = emit_mat("SLightP", (1.0, 0.80, 0.85, 1), 12.0)
    m_wire = mat("SWire", (0.20, 0.18, 0.15, 1), 0.5)
    for i in range(18):
        sx = -hw + 0.3 + i * (STAGE_W - 0.6) / 17
        sz = STAGE_H - 0.12 + math.sin(i * 0.7) * 0.05
        m = m_sl if i % 3 != 0 else m_slp
        sphere(f"SL{i}", (sx, -hd + 0.08, sz), 0.018, m)
    box("SWire", (0, -hd + 0.08, STAGE_H - 0.10), (STAGE_W - 0.4, 0.003, 0.003), m_wire)

    # ── Open sign near door ──
    m_sign = emit_mat("Sign", (1.0, 0.85, 0.50, 1), 4.0)
    m_sign_bg = mat("SignBg", (0.25, 0.20, 0.15, 1), 0.5)
    rbox("SignBg", (hw - 0.04, 1.2, 1.8), (0.03, 0.40, 0.15), m_sign_bg, 0.008)
    box("SignT", (hw - 0.05, 1.2, 1.8), (0.01, 0.35, 0.10), m_sign)

    # ── Potted plant by window ──
    m_pot = mat("Pot", (0.65, 0.40, 0.30, 1), 0.5)
    m_plant = mat("Plant", (0.30, 0.55, 0.25, 1), 0.7)
    cyl("PotBig", (hw - 0.45, 0.6, 0.18), 0.18, 0.30, m_pot)
    sphere("PlantL1", (hw - 0.45, 0.6, 0.50), 0.30, m_plant, (1.2, 1.2, 0.9))
    sphere("PlantL2", (hw - 0.55, 0.6, 0.55), 0.22, m_plant, (1.0, 1.0, 0.8))

    # ── Hanging ivy near window ──
    m_ivy = mat("Ivy", (0.25, 0.50, 0.22, 1), 0.7)
    for i in range(6):
        sphere(f"Ivy{i}", (hw - 0.06, 0.7 + i * 0.1, 2.2 - i * 0.12), 0.04, m_ivy)


# ------------------------------------------------------------
# Lighting (Blender Lights)
# ------------------------------------------------------------

def build_lighting():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    # Key light
    bpy.ops.object.light_add(type='SUN', location=(2, 2, 4))
    s = bpy.context.active_object
    s.name = "Key"
    s.data.energy = 1.2
    s.data.color = (1.0, 0.92, 0.78)
    s.rotation_euler = (math.radians(50), math.radians(-20), math.radians(15))
    s.data.angle = math.radians(10)

    # Pendant spots (warm)
    pendant_targets = [
        (-1.8, 1.4, "TableL"), (1.8, 1.4, "TableR"), (0, 2.0, "TableC"),
        (-1.8, -0.4, "TableBL"), (1.8, -0.4, "TableBR"), (0, -hd + 0.8, "Counter")
    ]
    for lx, ly, nm in pendant_targets:
        bpy.ops.object.light_add(type='SPOT', location=(lx, ly, STAGE_H - 0.4))
        sp = bpy.context.active_object
        sp.name = f"Pend_{nm}"
        sp.data.energy = 1200
        sp.data.color = (1.0, 0.80, 0.45)
        sp.data.spot_size = math.radians(35)
        sp.data.spot_blend = 0.2
        sp.rotation_euler = (math.radians(90), 0, 0)

    # Window light
    bpy.ops.object.light_add(type='AREA', location=(hw - 0.3, -0.2, 1.6))
    w = bpy.context.active_object
    w.name = "WinLight"
    w.data.energy = 8
    w.data.color = (0.90, 0.95, 1.0)
    w.data.size = 1.2
    w.data.size_y = 1.4
    w.rotation_euler = (0, 0, math.radians(-90))

    # Counter back light
    bpy.ops.object.light_add(type='AREA', location=(0, -hd + 0.2, 1.6))
    cl = bpy.context.active_object
    cl.name = "CounterL"
    cl.data.energy = 4
    cl.data.color = (1.0, 0.90, 0.72)
    cl.data.size = STAGE_W * 0.6
    cl.data.size_y = 0.6
    cl.rotation_euler = (math.radians(90), 0, 0)

    # Front fill
    bpy.ops.object.light_add(type='AREA', location=(0, hd + 2, 2.0))
    ff = bpy.context.active_object
    ff.name = "FrontFill"
    ff.data.energy = 8
    ff.data.color = (1.0, 0.95, 0.88)
    ff.data.size = 3.5
    ff.data.size_y = 2.5
    ff.rotation_euler = (math.radians(110), 0, 0)

    # Floor bounce
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.05))
    fb = bpy.context.active_object
    fb.name = "FloorB"
    fb.data.energy = 25
    fb.data.color = (0.90, 0.75, 0.55)
    fb.data.size = STAGE_W * 0.7
    fb.data.size_y = STAGE_D * 0.7

    # Ambient fill
    bpy.ops.object.light_add(type='AREA', location=(0, 0, STAGE_H - 0.2))
    af = bpy.context.active_object
    af.name = "AmbFill"
    af.data.energy = 70
    af.data.color = (1.0, 0.88, 0.65)
    af.data.size = STAGE_W * 0.9
    af.data.size_y = STAGE_D * 0.9

    # Brick wall wash
    bpy.ops.object.light_add(type='AREA', location=(0, -hd + 0.5, 2.5))
    bw = bpy.context.active_object
    bw.name = "BrickWash"
    bw.data.energy = 35
    bw.data.color = (1.0, 0.85, 0.60)
    bw.data.size = STAGE_W * 0.6
    bw.data.size_y = 1.6
    bw.rotation_euler = (math.radians(90), 0, 0)

    # World
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.14, 0.10, 0.07, 1)
        bg.inputs["Strength"].default_value = 0.18


# ------------------------------------------------------------
# Export
# ------------------------------------------------------------

def export_glb():
    g = os.path.join(OUTPUT_DIR, "cafe.glb")
    bpy.ops.export_scene.gltf(
        filepath=g,
        export_format='GLB',
        use_selection=False,
        export_cameras=False,
        export_lights=True,
        export_apply=True
    )
    print(f"  ✓ GLB → {os.path.getsize(g) / 1024 / 1024:.1f} MB")


def main():
    print("=" * 50)
    print("  Café v5 — Major Upgrade")
    print("=" * 50)
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
