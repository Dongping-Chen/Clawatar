"""
Blender Scene Builder v5 — WARM & BRIGHT
v4 issues: too dark/brown, pillows like stones, fairy lights invisible,
no anime personality, center too dark

v5 fixes:
- MUCH brighter overall — warm afternoon light, not nighttime
- Pastel color palette (pink, lavender, cream, sky blue)
- Rectangular soft pillows (not spheres)
- Visible fairy lights with strong bloom
- Thicker blanket in pink
- Anime personality items (poster placeholder, cat plushie colors)
- Floor lamp + desk lamp both emitting
- Lighter wood tones
"""

import bpy
import math
import os

ASSET_DIR = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/assets/furniture/kenney"
OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 5.5
STAGE_D = 4.0
STAGE_H = 2.8

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
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes): nodes.remove(n)
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = strength
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return m


def box(name, loc, dim, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name; o.scale = dim; o.rotation_euler = rot
    if material: o.data.materials.append(material)
    return o


def rbox(name, loc, dim, material, radius=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name; o.scale = dim; o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    bev = o.modifiers.new("Bevel", 'BEVEL')
    bev.width = radius; bev.segments = 3; bev.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="Bevel")
    if material: o.data.materials.append(material)
    return o


def sphere(name, loc, radius, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = name; o.scale = scale
    if material: o.data.materials.append(material)
    return o


def cylinder(name, loc, radius, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name; o.rotation_euler = rot
    if material: o.data.materials.append(material)
    return o


def import_glb(filename, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    fp = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(fp): return None
    existing = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=fp)
    new_objs = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in existing]
    if not new_objs: return None
    parent = bpy.data.objects.new(f"A_{filename}", None)
    bpy.context.collection.objects.link(parent)
    parent.location = loc; parent.rotation_euler = rot
    parent.scale = (scale, scale, scale)
    for o in new_objs: o.parent = parent
    return parent


# ═══════ STAGE SHELL ═══════
def build_stage():
    hw, hd = STAGE_W/2, STAGE_D/2
    # LIGHTER colors — cream/pastel, not brown
    m_floor = mat("Floor", (0.85, 0.75, 0.60, 1.0), 0.35)  # light honey
    m_wall = mat("Wall", (1.0, 0.97, 0.95, 1.0), 0.8)  # warm white
    m_accent = mat("Accent", (0.98, 0.90, 0.93, 1.0), 0.8)  # light pink

    box("Floor", (0, 0, -0.025), (STAGE_W+0.3, STAGE_D+0.3, 0.05), m_floor)
    box("WallBack", (0, -hd, STAGE_H/2), (STAGE_W, 0.08, STAGE_H), m_accent)
    box("WallLeft", (-hw, 0, STAGE_H/2), (0.08, STAGE_D, STAGE_H), m_wall)

    m_bb = mat("BB", (0.72, 0.60, 0.45, 1.0), 0.4)
    box("BB_B", (0, -hd+0.045, 0.04), (STAGE_W, 0.02, 0.08), m_bb)
    box("BB_L", (-hw+0.045, 0, 0.04), (0.02, STAGE_D, 0.08), m_bb)

    m_cr = mat("Crown", (0.97, 0.94, 0.91, 1.0), 0.5)
    box("CR_B", (0, -hd+0.045, STAGE_H-0.03), (STAGE_W, 0.03, 0.06), m_cr)
    box("CR_L", (-hw+0.045, 0, STAGE_H-0.03), (0.03, STAGE_D, 0.06), m_cr)


def build_window():
    hd = STAGE_D/2
    m_frame = mat("WF", (0.88, 0.82, 0.72, 1.0), 0.3)
    # BRIGHTER window — afternoon sun
    m_glass = emit_mat("WG", (1.0, 0.97, 0.88, 1.0), 10.0)

    wx, wy, wz = 1.3, -hd+0.03, 1.5
    ww, wh = 1.1, 1.4
    box("WG", (wx, wy, wz), (ww, 0.02, wh), m_glass)
    ft = 0.045
    for n, l, d in [("T",(wx,wy,wz+wh/2),(ww+0.1,0.04,ft)),
                     ("B",(wx,wy,wz-wh/2),(ww+0.1,0.04,ft)),
                     ("L",(wx-ww/2,wy,wz),(ft,0.04,wh)),
                     ("R",(wx+ww/2,wy,wz),(ft,0.04,wh)),
                     ("CH",(wx,wy,wz),(ww,0.04,0.025)),
                     ("CV",(wx,wy,wz),(0.025,0.04,wh))]:
        box(f"WF_{n}", l, d, m_frame)

    # Sheer pink curtains
    m_curt = mat("Curt", (0.97, 0.85, 0.89, 1.0), 0.95)
    box("CL", (wx-ww/2-0.20, wy+0.04, wz+0.15), (0.30, 0.03, wh+0.35), m_curt)
    box("CR", (wx+ww/2+0.20, wy+0.04, wz+0.15), (0.30, 0.03, wh+0.35), m_curt)
    m_rod = mat("Rod", (0.75, 0.68, 0.58, 1.0), 0.2, 0.3)
    box("CRod", (wx, wy+0.04, wz+wh/2+0.22), (ww+0.7, 0.02, 0.02), m_rod)


# ═══════ BED ═══════
def build_bed():
    hw, hd = STAGE_W/2, STAGE_D/2
    bx, by = -0.8, -hd+1.0

    # LIGHTER wood frame
    m_frame = mat("BedFr", (0.75, 0.62, 0.48, 1.0), 0.4)
    m_mattress = mat("Matt", (0.97, 0.95, 0.93, 1.0), 0.8)
    # PINK blanket — anime signature color
    m_blanket = mat("Blanket", (0.96, 0.75, 0.80, 1.0), 0.85)
    m_blanket2 = mat("BlanketEdge", (0.92, 0.68, 0.75, 1.0), 0.85)

    rbox("BedBase", (bx, by, 0.15), (1.05, 2.0, 0.30), m_frame, 0.02)
    rbox("Headboard", (bx, by-0.95, 0.60), (1.1, 0.08, 0.90), m_frame, 0.04)
    rbox("Footboard", (bx, by+0.95, 0.30), (1.05, 0.06, 0.35), m_frame, 0.02)
    rbox("Mattress", (bx, by+0.05, 0.36), (0.95, 1.82, 0.14), m_mattress, 0.05)

    # THICK pink blanket — very visible
    rbox("Blanket", (bx, by+0.20, 0.46), (0.92, 1.3, 0.12), m_blanket, 0.05)
    # Fold at edge
    rbox("BlanketFold", (bx, by+0.88, 0.42), (0.90, 0.12, 0.15), m_blanket2, 0.04)

    # RECTANGULAR pillows — not spheres!
    m_pw = mat("PillowW", (1.0, 0.97, 0.95, 1.0), 0.9)
    m_pb = mat("PillowB", (0.85, 0.90, 0.96, 1.0), 0.9)
    m_pp = mat("PillowP", (0.95, 0.82, 0.87, 1.0), 0.9)

    # Pillow = wide rounded box, NOT sphere
    rbox("Pillow1", (bx-0.25, by-0.65, 0.50), (0.35, 0.25, 0.10), m_pw, 0.04)
    rbox("Pillow2", (bx+0.20, by-0.60, 0.49), (0.30, 0.22, 0.09), m_pb, 0.04,
         rot=(0, 0, math.radians(8)))
    # Small decorative pink cushion
    rbox("Cushion", (bx+0.0, by-0.40, 0.48), (0.18, 0.18, 0.08), m_pp, 0.035)


# ═══════ DESK AREA ═══════
def build_desk():
    hw, hd = STAGE_W/2, STAGE_D/2
    dx, dy = hw-1.0, -hd+0.4

    # Lighter desk
    m_top = mat("DTop", (0.92, 0.87, 0.80, 1.0), 0.35)
    m_leg = mat("DLeg", (0.78, 0.70, 0.60, 1.0), 0.3, 0.1)

    rbox("DTop", (dx, dy, 0.72), (1.15, 0.55, 0.04), m_top, 0.015)
    for lx, ly in [(-0.52,-0.22),(0.52,-0.22),(-0.52,0.22),(0.52,0.22)]:
        rbox(f"DL", (dx+lx, dy+ly, 0.36), (0.04, 0.04, 0.72), m_leg, 0.008)

    # Pink chair
    m_seat = mat("CSeat", (0.95, 0.80, 0.84, 1.0), 0.85)
    rbox("CSeat", (dx, dy+0.75, 0.42), (0.38, 0.38, 0.08), m_seat, 0.04)
    for lx, ly in [(-0.14,-0.14),(0.14,-0.14),(-0.14,0.14),(0.14,0.14)]:
        box(f"CL", (dx+lx, dy+0.75+ly, 0.20), (0.025, 0.025, 0.40), m_leg)
    rbox("CBack", (dx, dy+0.55, 0.65), (0.36, 0.04, 0.30), m_seat, 0.02)

    import_glb("laptop.glb", loc=(dx-0.2, dy-0.02, 0.74), scale=1.8)
    import_glb("books.glb", loc=(dx+0.35, dy-0.05, 0.74), scale=1.8)

    # Pink mug
    m_mug = mat("Mug", (0.95, 0.82, 0.86, 1.0), 0.4, 0.05)
    cylinder("Mug", (dx+0.4, dy+0.15, 0.78), 0.03, 0.08, m_mug)

    # Desk lamp with VISIBLE GLOW
    m_ls = mat("DLShade", (0.90, 0.85, 0.78, 1.0), 0.6)
    m_lg = emit_mat("DLGlow", (1.0, 0.95, 0.82, 1.0), 8.0)
    cylinder("DLBase", (dx-0.45, dy-0.05, 0.76), 0.03, 0.04, m_leg)
    cylinder("DLArm", (dx-0.45, dy-0.05, 0.92), 0.008, 0.28, m_ls)
    sphere("DLBulb", (dx-0.45, dy-0.05, 1.08), 0.05, m_lg, (1.2, 1.2, 0.8))


# ═══════ BOOKSHELF ═══════
def build_bookshelf():
    hw, hd = STAGE_W/2, STAGE_D/2
    sx, sy = -hw+0.20, -0.3
    m_shelf = mat("Shelf", (0.72, 0.60, 0.45, 1.0), 0.4)

    sw, sd, sh = 0.75, 0.25, 1.5
    rbox("SL", (sx, sy-sw/2, sh/2), (sd, 0.025, sh), m_shelf, 0.008, rot=(0,0,math.radians(90)))
    rbox("SR", (sx, sy+sw/2, sh/2), (sd, 0.025, sh), m_shelf, 0.008, rot=(0,0,math.radians(90)))
    box("SBack", (sx-sd/2+0.01, sy, sh/2), (0.02, sw, sh), m_shelf)

    for sz in [0.0, 0.38, 0.75, 1.12, 1.50]:
        rbox(f"SB_{sz}", (sx, sy, sz), (sd, sw, 0.02), m_shelf, 0.005)

    # COLORFUL books — anime palette
    colors = [
        (0.90, 0.40, 0.50, 1), (0.40, 0.60, 0.85, 1), (0.50, 0.80, 0.55, 1),
        (0.95, 0.80, 0.40, 1), (0.75, 0.50, 0.80, 1), (0.40, 0.75, 0.75, 1),
        (0.95, 0.60, 0.45, 1), (0.60, 0.55, 0.85, 1), (0.85, 0.70, 0.55, 1),
    ]
    for si, sz in enumerate([0.02, 0.40, 0.77]):
        for j in range(6):
            c = colors[(j+si*3) % len(colors)]
            m_bk = mat(f"Bk_{si}_{j}", c, 0.7)
            bw = 0.025+(j%3)*0.008
            bh = 0.22+(j%4)*0.04
            rbox(f"Bk_{si}_{j}", (sx, sy-sw/2+0.06+j*0.10, sz+bh/2+0.01),
                 (bw, 0.17, bh), m_bk, 0.004)

    import_glb("pottedPlant.glb", loc=(sx, sy+0.1, 1.52), scale=1.0)


# ═══════ CENTER ═══════
def build_center():
    # LARGER pastel rug
    m_rug = mat("Rug", (0.95, 0.85, 0.88, 1.0), 0.95)
    bpy.ops.mesh.primitive_cylinder_add(radius=1.4, depth=0.015, location=(0.2, 0.4, 0.008))
    r = bpy.context.active_object; r.name = "Rug"; r.scale = (1.0, 0.8, 1.0)
    r.data.materials.append(m_rug)

    m_rb = mat("RugB", (0.90, 0.72, 0.78, 1.0), 0.9)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.4, minor_radius=0.018, location=(0.2, 0.4, 0.015))
    rb = bpy.context.active_object; rb.name = "RugB"; rb.scale = (1.0, 0.8, 1.0)
    rb.data.materials.append(m_rb)

    # LIGHT wood coffee table
    m_ct = mat("CT", (0.82, 0.72, 0.58, 1.0), 0.35)
    rbox("CT", (0.2, 0.4, 0.22), (0.55, 0.40, 0.04), m_ct, 0.015)
    for lx, ly in [(-0.22,-0.15),(0.22,-0.15),(-0.22,0.15),(0.22,0.15)]:
        rbox(f"CTL", (0.2+lx, 0.4+ly, 0.10), (0.03, 0.03, 0.20), m_ct, 0.008)

    # Tea set on table
    m_cup = mat("Cup", (0.97, 0.97, 0.95, 1.0), 0.3, 0.05)
    cylinder("Cup", (0.30, 0.35, 0.27), 0.025, 0.05, m_cup)
    # Saucer
    cylinder("Saucer", (0.30, 0.35, 0.245), 0.04, 0.008, m_cup)

    # Bear plushie — Kenney
    import_glb("bear.glb", loc=(0.55, 0.7, 0.01), rot=(0,0,math.radians(-25)), scale=1.8)

    # Pink slippers
    m_sl = mat("Slipper", (0.96, 0.78, 0.83, 1.0), 0.9)
    rbox("SlL", (-0.3, 0.2, 0.02), (0.08, 0.18, 0.04), m_sl, 0.015, rot=(0,0,math.radians(15)))
    rbox("SlR", (-0.15, 0.18, 0.02), (0.08, 0.18, 0.04), m_sl, 0.015, rot=(0,0,math.radians(5)))


# ═══════ DECORATIONS ═══════
def build_decorations():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── Picture frames with COLORFUL fills ──
    m_fr = mat("PF", (0.82, 0.74, 0.62, 1.0), 0.3)
    pics = [
        ((-0.8, -hd+0.04, 1.8), (0.40, 0.02, 0.30), (0.75, 0.85, 0.95, 1.0)),  # sky blue
        ((-0.25, -hd+0.04, 1.9), (0.28, 0.02, 0.38), (0.95, 0.85, 0.82, 1.0)),  # warm peach
        ((0.3, -hd+0.04, 1.75), (0.22, 0.02, 0.22), (0.88, 0.92, 0.80, 1.0)),   # sage green
    ]
    for i, (loc, dim, col) in enumerate(pics):
        rbox(f"Fr{i}", loc, dim, m_fr, 0.008)
        box(f"Pic{i}", (loc[0], loc[1]+0.015, loc[2]), (dim[0]-0.06, 0.01, dim[2]-0.06), mat(f"P{i}", col, 0.8))

    # ── BRIGHT fairy lights along top of back wall ──
    m_bulb = emit_mat("Fairy", (1.0, 0.92, 0.70, 1.0), 20.0)  # MUCH stronger!
    m_bulb_pink = emit_mat("FairyP", (1.0, 0.80, 0.85, 1.0), 15.0)
    y_w = -hd+0.08
    for i in range(18):
        x = -hw+0.3 + i*(STAGE_W-0.6)/17
        z = STAGE_H-0.12 + math.sin(i*0.7)*0.06
        m = m_bulb if i % 3 != 0 else m_bulb_pink
        sphere(f"F{i}", (x, y_w, z), 0.018, m)

    # ── Floor lamp — RIGHT SIDE with GLOW ──
    m_lb = mat("FLBase", (0.70, 0.62, 0.50, 1.0), 0.3, 0.2)
    m_ls = mat("FLShade", (0.97, 0.93, 0.87, 1.0), 0.7)
    m_le = emit_mat("FLEmit", (1.0, 0.92, 0.75, 1.0), 10.0)

    fx = hw-0.4
    cylinder("FLPole", (fx, 0.9, 0.65), 0.015, 1.3, m_lb)
    cylinder("FLBase", (fx, 0.9, 0.02), 0.10, 0.03, m_lb)
    cylinder("FLShade", (fx, 0.9, 1.35), 0.12, 0.20, m_ls)
    sphere("FLGlow", (fx, 0.9, 1.35), 0.09, m_le)

    # ── Nightstand + lamp ──
    m_ns = mat("NS", (0.75, 0.65, 0.50, 1.0), 0.4)
    rbox("NS", (-hw+0.35, -hd+0.35, 0.22), (0.35, 0.35, 0.44), m_ns, 0.02)

    import_glb("lampRoundTable.glb", loc=(-hw+0.35, -hd+0.35, 0.46), scale=1.6)
    # Nightstand lamp GLOW — strong!
    sphere("NLG", (-hw+0.35, -hd+0.35, 0.62), 0.07, emit_mat("NLG", (1.0, 0.85, 0.60, 1.0), 12.0))

    # Alarm clock
    m_ck = mat("Clock", (0.88, 0.88, 0.90, 1.0), 0.3, 0.1)
    rbox("Clock", (-hw+0.50, -hd+0.30, 0.47), (0.06, 0.04, 0.05), m_ck, 0.008)

    # ── Potted plant near open side ──
    import_glb("pottedPlant.glb", loc=(hw-0.3, -hd+0.3, 0), scale=1.8)

    # ── Star/moon wall decoration (on left wall) ──
    m_star = emit_mat("Star", (1.0, 0.95, 0.80, 1.0), 5.0)
    m_moon = emit_mat("Moon", (0.95, 0.92, 0.80, 1.0), 4.0)
    # Simple circle for moon
    cylinder("Moon", (-hw+0.04, -0.5, 2.0), 0.10, 0.01, m_moon, rot=(0, math.radians(90), 0))
    # Small star shapes = small spheres
    for i, (dy, dz) in enumerate([(-0.2, 2.2), (0.1, 2.3), (-0.6, 2.1), (0.3, 1.9)]):
        sphere(f"Star{i}", (-hw+0.04, dy, dz), 0.02, m_star)


# ═══════ LIGHTING — WARM AFTERNOON ═══════
def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # 1. Key sun — WARM, stronger
    bpy.ops.object.light_add(type='SUN', location=(4, 2, 5))
    s = bpy.context.active_object; s.name = "Key"
    s.data.energy = 3.5  # stronger!
    s.data.color = (1.0, 0.94, 0.80)
    s.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))
    s.data.angle = math.radians(12)

    # 2. Window area — bright warm
    bpy.ops.object.light_add(type='AREA', location=(1.3, -hd+0.3, 1.5))
    w = bpy.context.active_object; w.name = "WinArea"
    w.data.energy = 150
    w.data.color = (1.0, 0.95, 0.82)
    w.data.size = 1.1; w.data.size_y = 1.4
    w.rotation_euler = (math.radians(90), 0, 0)

    # 3. Nightstand point — warm orange
    bpy.ops.object.light_add(type='POINT', location=(-hw+0.35, -hd+0.35, 0.80))
    n = bpy.context.active_object; n.name = "NightPt"
    n.data.energy = 50  # stronger
    n.data.color = (1.0, 0.82, 0.55)
    n.data.shadow_soft_size = 0.5

    # 4. Floor lamp point — warm
    bpy.ops.object.light_add(type='POINT', location=(hw-0.4, 0.9, 1.4))
    f = bpy.context.active_object; f.name = "FloorPt"
    f.data.energy = 40  # stronger
    f.data.color = (1.0, 0.90, 0.70)
    f.data.shadow_soft_size = 0.3

    # 5. Desk spot
    bpy.ops.object.light_add(type='SPOT', location=(hw-1.45, -hd+0.35, 1.15))
    d = bpy.context.active_object; d.name = "DeskSpot"
    d.data.energy = 50
    d.data.color = (1.0, 0.95, 0.85)
    d.data.spot_size = math.radians(50); d.data.spot_blend = 0.6
    d.rotation_euler = (math.radians(70), 0, math.radians(10))

    # 6. Front fill — STRONGER, warm
    bpy.ops.object.light_add(type='AREA', location=(2, 4, 2.5))
    ff = bpy.context.active_object; ff.name = "FrontFill"
    ff.data.energy = 50  # stronger!
    ff.data.color = (1.0, 0.96, 0.92)  # warm, not cool
    ff.data.size = 3.0; ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(120), 0, math.radians(-15))

    # 7. Fairy glow wash
    bpy.ops.object.light_add(type='AREA', location=(0, -hd+0.3, STAGE_H-0.15))
    fg = bpy.context.active_object; fg.name = "FairyG"
    fg.data.energy = 20
    fg.data.color = (1.0, 0.92, 0.75)
    fg.data.size = STAGE_W*0.7; fg.data.size_y = 0.3
    fg.rotation_euler = (math.radians(90), 0, 0)

    # 8. Floor bounce — warm
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.05))
    fb = bpy.context.active_object; fb.name = "FloorBounce"
    fb.data.energy = 12
    fb.data.color = (1.0, 0.92, 0.78)
    fb.data.size = STAGE_W*0.6; fb.data.size_y = STAGE_D*0.6

    # World — warmer, less dark
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.12, 0.10, 0.14, 1.0)
        bg.inputs["Strength"].default_value = 0.4


# ═══════ RENDER ═══════
def render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080

    if hasattr(scene, 'eevee'):
        e = scene.eevee
        for a, v in [('use_soft_shadows', True), ('use_ssr', True),
                     ('use_gtao', True), ('use_bloom', True),
                     ('bloom_threshold', 0.3), ('bloom_intensity', 0.5),  # MORE bloom!
                     ('bloom_radius', 6.0)]:
            if hasattr(e, a): setattr(e, a, v)

    hw, hd = STAGE_W/2, STAGE_D/2
    angles = {
        "main": ((1.2, hd+2.8, 1.7), (math.radians(76), 0, math.radians(168)), 32),
        "wide": ((0, hd+3.5, 2.5), (math.radians(65), 0, math.radians(180)), 28),
        "bed_close": ((-0.8, 0.8, 1.1), (math.radians(82), 0, math.radians(200)), 35),
        "desk_close": ((hw+0.3, 0, 1.2), (math.radians(82), 0, math.radians(110)), 35),
    }

    for name, (loc, rot, lens) in angles.items():
        cd = bpy.data.cameras.new(f"C_{name}")
        cd.lens = lens
        co = bpy.data.objects.new(f"C_{name}", cd)
        bpy.context.collection.objects.link(co)
        co.location = loc; co.rotation_euler = rot
        scene.camera = co
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"v5_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ v5_{name}.png")

    glb = os.path.join(OUTPUT_DIR, "cozy-bedroom-v5.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(glb)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  Cozy Bedroom v5 — WARM & BRIGHT")
    print("="*50)
    clear_scene()
    build_stage()
    build_window()
    build_bed()
    build_desk()
    build_bookshelf()
    build_center()
    build_decorations()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
