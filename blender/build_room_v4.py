"""
Blender Scene Builder v4 — Stage Concept POLISHED
Fixes from v3 review:
- Balance left/right density (bed center-left, desk right, shelf back-left)
- Fill the center — bigger rug, coffee table, more small items
- More lived-in details: mugs, frames, slippers, string lights
- Floor lamp actually emitting light
- Warmer overall, less empty floor
- Wall decorations
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
    o.name = name
    o.scale = dim
    o.rotation_euler = rot
    if material: o.data.materials.append(material)
    return o


def rbox(name, loc, dim, material, radius=0.03, rot=(0, 0, 0)):
    """Rounded box."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = dim
    o.rotation_euler = rot
    bpy.ops.object.transform_apply(scale=True)
    bev = o.modifiers.new("Bevel", 'BEVEL')
    bev.width = radius
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="Bevel")
    if material: o.data.materials.append(material)
    return o


def sphere(name, loc, radius, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    if material: o.data.materials.append(material)
    return o


def cylinder(name, loc, radius, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = rot
    if material: o.data.materials.append(material)
    return o


def import_glb(filename, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    fp = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(fp): return None
    existing = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=fp)
    new_objs = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in existing]
    if not new_objs: return None
    parent = bpy.data.objects.new(f"Asset_{filename}", None)
    bpy.context.collection.objects.link(parent)
    parent.location = loc
    parent.rotation_euler = rot
    parent.scale = (scale, scale, scale)
    for o in new_objs: o.parent = parent
    return parent


# ═══════════════════════════════════════════════════════
# STAGE SHELL
# ═══════════════════════════════════════════════════════
def build_stage():
    hw, hd = STAGE_W / 2, STAGE_D / 2
    m_floor = mat("Floor", (0.78, 0.63, 0.45, 1.0), 0.35)
    m_wall = mat("Wall", (1.0, 0.96, 0.93, 1.0), 0.8)
    m_accent = mat("AccentWall", (0.97, 0.87, 0.90, 1.0), 0.8)

    # Floor with slight extension
    box("Floor", (0, 0, -0.025), (STAGE_W + 0.3, STAGE_D + 0.3, 0.05), m_floor)
    # Back wall — sakura accent
    box("WallBack", (0, -hd, STAGE_H / 2), (STAGE_W, 0.08, STAGE_H), m_accent)
    # Left wall
    box("WallLeft", (-hw, 0, STAGE_H / 2), (0.08, STAGE_D, STAGE_H), m_wall)

    # Baseboard — rich dark wood
    m_bb = mat("Baseboard", (0.55, 0.40, 0.28, 1.0), 0.4)
    box("BB_Back", (0, -hd + 0.045, 0.04), (STAGE_W, 0.02, 0.08), m_bb)
    box("BB_Left", (-hw + 0.045, 0, 0.04), (0.02, STAGE_D, 0.08), m_bb)

    # Crown molding
    m_crown = mat("Crown", (0.95, 0.92, 0.88, 1.0), 0.5)
    box("Crown_Back", (0, -hd + 0.045, STAGE_H - 0.03), (STAGE_W, 0.03, 0.06), m_crown)
    box("Crown_Left", (-hw + 0.045, 0, STAGE_H - 0.03), (0.03, STAGE_D, 0.06), m_crown)


def build_window():
    hw, hd = STAGE_W / 2, STAGE_D / 2
    m_frame = mat("WFrame", (0.82, 0.75, 0.62, 1.0), 0.3)
    m_glass = emit_mat("WGlass", (1.0, 0.96, 0.85, 1.0), 6.0)

    # Window on back wall, right section
    wx, wy, wz = 1.3, -hd + 0.03, 1.5
    ww, wh = 1.1, 1.4

    box("WGlass", (wx, wy, wz), (ww, 0.02, wh), m_glass)
    ft = 0.045
    box("WF_T", (wx, wy, wz + wh/2), (ww + 0.1, 0.04, ft), m_frame)
    box("WF_B", (wx, wy, wz - wh/2), (ww + 0.1, 0.04, ft), m_frame)
    box("WF_L", (wx - ww/2, wy, wz), (ft, 0.04, wh), m_frame)
    box("WF_R", (wx + ww/2, wy, wz), (ft, 0.04, wh), m_frame)
    box("WF_CH", (wx, wy, wz), (ww, 0.04, 0.025), m_frame)
    box("WF_CV", (wx, wy, wz), (0.025, 0.04, wh), m_frame)

    # Curtains — soft drape
    m_curt = mat("Curtain", (0.95, 0.83, 0.87, 1.0), 0.95)
    box("CurtL", (wx - ww/2 - 0.2, wy + 0.04, wz + 0.15), (0.30, 0.03, wh + 0.35), m_curt)
    box("CurtR", (wx + ww/2 + 0.2, wy + 0.04, wz + 0.15), (0.30, 0.03, wh + 0.35), m_curt)
    # Rod
    m_rod = mat("Rod", (0.65, 0.55, 0.42, 1.0), 0.2, 0.3)
    box("CurtRod", (wx, wy + 0.04, wz + wh/2 + 0.22), (ww + 0.7, 0.02, 0.02), m_rod)


# ═══════════════════════════════════════════════════════
# FURNITURE — Procedural, Soft, Warm
# ═══════════════════════════════════════════════════════
def build_bed():
    """Bed — center-left, head against back wall."""
    hw, hd = STAGE_W / 2, STAGE_D / 2
    bx, by = -0.8, -hd + 1.0  # center-left, head near back wall

    m_frame = mat("BedFrame", (0.62, 0.44, 0.30, 1.0), 0.4)
    m_mattress = mat("Mattress", (0.96, 0.94, 0.91, 1.0), 0.8)
    m_blanket = mat("Blanket", (0.95, 0.78, 0.82, 1.0), 0.9)
    m_pillow_w = mat("PillowW", (1.0, 0.96, 0.93, 1.0), 0.85)
    m_pillow_b = mat("PillowB", (0.82, 0.88, 0.95, 1.0), 0.85)

    # Frame
    rbox("BedBase", (bx, by, 0.15), (1.05, 2.0, 0.30), m_frame, 0.02)
    # Headboard
    rbox("Headboard", (bx, by - 0.95, 0.60), (1.1, 0.08, 0.90), m_frame, 0.04)
    # Footboard (shorter)
    rbox("Footboard", (bx, by + 0.95, 0.30), (1.05, 0.06, 0.35), m_frame, 0.02)

    # Mattress
    rbox("Mattress", (bx, by + 0.05, 0.36), (0.95, 1.82, 0.14), m_mattress, 0.05)
    # Blanket — covers lower 2/3
    rbox("Blanket", (bx, by + 0.30, 0.44), (0.90, 1.2, 0.08), m_blanket, 0.04)
    # Blanket fold at edge
    rbox("BlanketFold", (bx, by + 0.90, 0.40), (0.88, 0.10, 0.12), m_blanket, 0.03)

    # Pillows
    sphere("Pillow1", (bx - 0.25, by - 0.65, 0.50), 0.18, m_pillow_w, (1.0, 0.7, 0.45))
    sphere("Pillow2", (bx + 0.20, by - 0.60, 0.49), 0.16, m_pillow_b, (1.0, 0.7, 0.45))
    # Small decorative cushion
    m_cushion = mat("Cushion", (0.90, 0.70, 0.75, 1.0), 0.9)
    sphere("Cushion", (bx + 0.0, by - 0.40, 0.47), 0.10, m_cushion, (1.0, 1.0, 0.6))


def build_desk_area():
    """Desk + chair — right side, against back wall."""
    hw, hd = STAGE_W / 2, STAGE_D / 2
    dx, dy = hw - 1.0, -hd + 0.4

    m_top = mat("DeskTop", (0.88, 0.82, 0.74, 1.0), 0.35)
    m_leg = mat("DeskLeg", (0.68, 0.58, 0.48, 1.0), 0.3, 0.1)

    # Desk
    rbox("DeskTop", (dx, dy, 0.72), (1.15, 0.55, 0.04), m_top, 0.015)
    for lx, ly in [(-0.52, -0.22), (0.52, -0.22), (-0.52, 0.22), (0.52, 0.22)]:
        rbox(f"DLeg", (dx + lx, dy + ly, 0.36), (0.04, 0.04, 0.72), m_leg, 0.008)
    # Shelf
    rbox("DeskShelf", (dx + 0.1, dy, 0.25), (0.6, 0.35, 0.02), m_top, 0.008)

    # Chair — pink cushion
    m_seat = mat("ChairSeat", (0.93, 0.80, 0.83, 1.0), 0.85)
    sphere("ChairSeat", (dx, dy + 0.75, 0.42), 0.20, m_seat, (1.0, 1.0, 0.35))
    for lx, ly in [(-0.14, -0.14), (0.14, -0.14), (-0.14, 0.14), (0.14, 0.14)]:
        box(f"CLeg", (dx + lx, dy + 0.75 + ly, 0.18), (0.025, 0.025, 0.36), m_leg)
    rbox("ChairBack", (dx, dy + 0.55, 0.62), (0.35, 0.04, 0.28), m_seat, 0.02)

    # Desk items
    import_glb("laptop.glb", loc=(dx - 0.2, dy - 0.02, 0.74), scale=1.8)
    import_glb("books.glb", loc=(dx + 0.35, dy - 0.05, 0.74), scale=1.8)

    # Mug on desk
    m_mug = mat("Mug", (0.95, 0.85, 0.88, 1.0), 0.4, 0.05)
    cylinder("Mug", (dx + 0.4, dy + 0.15, 0.78), 0.03, 0.08, m_mug)
    # Mug handle
    bpy.ops.mesh.primitive_torus_add(major_radius=0.025, minor_radius=0.006,
                                      location=(dx + 0.43, dy + 0.15, 0.78))
    handle = bpy.context.active_object
    handle.name = "MugHandle"
    handle.data.materials.append(m_mug)

    # Desk lamp — small emissive sphere
    m_lamp_shade = mat("DeskLampShade", (0.85, 0.80, 0.72, 1.0), 0.6)
    m_lamp_glow = emit_mat("DeskLampGlow", (1.0, 0.95, 0.80, 1.0), 3.0)
    cylinder("DLampBase", (dx - 0.45, dy - 0.05, 0.76), 0.03, 0.04, m_leg)
    cylinder("DLampArm", (dx - 0.45, dy - 0.05, 0.92), 0.008, 0.28, m_lamp_shade)
    sphere("DLampBulb", (dx - 0.45, dy - 0.05, 1.08), 0.04, m_lamp_glow, (1.2, 1.2, 0.8))


def build_bookshelf():
    """Bookshelf — against left wall."""
    hw, hd = STAGE_W / 2, STAGE_D / 2
    sx, sy = -hw + 0.20, -0.3

    m_shelf = mat("ShelfWood", (0.60, 0.46, 0.30, 1.0), 0.4)

    sw, sd, sh = 0.75, 0.25, 1.5
    # Sides
    rbox("ShelfL", (sx, sy - sw/2, sh/2), (sd, 0.025, sh), m_shelf, 0.008,
         rot=(0, 0, math.radians(90)))
    rbox("ShelfR", (sx, sy + sw/2, sh/2), (sd, 0.025, sh), m_shelf, 0.008,
         rot=(0, 0, math.radians(90)))
    box("ShelfBack", (sx - sd/2 + 0.01, sy, sh/2), (0.02, sw, sh), m_shelf)

    # 5 shelf boards
    for sz in [0.0, 0.38, 0.75, 1.12, 1.50]:
        rbox(f"ShB_{sz}", (sx, sy, sz), (sd, sw, 0.02), m_shelf, 0.005)

    # Books — colorful
    colors = [
        (0.85, 0.30, 0.35, 1), (0.30, 0.55, 0.80, 1), (0.40, 0.72, 0.42, 1),
        (0.92, 0.75, 0.30, 1), (0.70, 0.40, 0.72, 1), (0.30, 0.68, 0.68, 1),
        (0.90, 0.50, 0.30, 1), (0.55, 0.50, 0.80, 1), (0.80, 0.65, 0.50, 1),
    ]
    for si, sz in enumerate([0.02, 0.40, 0.77]):
        bk_x = sx
        for j in range(6):
            c = colors[(j + si * 3) % len(colors)]
            m_bk = mat(f"Bk_{si}_{j}", c, 0.7)
            bw = 0.025 + (j % 3) * 0.008
            bh = 0.22 + (j % 4) * 0.04
            rbox(f"Bk_{si}_{j}", (bk_x, sy - sw/2 + 0.06 + j * 0.10, sz + bh/2 + 0.01),
                 (bw, 0.17, bh), m_bk, 0.004)

    # Small plant on top shelf
    import_glb("pottedPlant.glb", loc=(sx, sy + 0.1, 1.52), scale=1.0)


def build_center():
    """Center of room — rug, coffee table, cozy items."""
    # Big warm rug
    m_rug = mat("Rug", (0.93, 0.80, 0.82, 1.0), 0.95)
    bpy.ops.mesh.primitive_cylinder_add(radius=1.3, depth=0.015, location=(0.2, 0.4, 0.008))
    rug = bpy.context.active_object
    rug.name = "Rug"
    rug.scale = (1.0, 0.8, 1.0)
    rug.data.materials.append(m_rug)

    # Rug border ring
    m_rb = mat("RugBorder", (0.85, 0.65, 0.70, 1.0), 0.9)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.3, minor_radius=0.015,
                                      location=(0.2, 0.4, 0.015))
    rb = bpy.context.active_object
    rb.name = "RugBorder"
    rb.scale = (1.0, 0.8, 1.0)
    rb.data.materials.append(m_rb)

    # Low coffee table
    m_table = mat("CoffeeTable", (0.68, 0.55, 0.40, 1.0), 0.35)
    rbox("CTable", (0.2, 0.4, 0.22), (0.55, 0.40, 0.04), m_table, 0.015)
    for lx, ly in [(-0.22, -0.15), (0.22, -0.15), (-0.22, 0.15), (0.22, 0.15)]:
        rbox(f"CTLeg", (0.2 + lx, 0.4 + ly, 0.10), (0.03, 0.03, 0.20), m_table, 0.008)

    # Tea cup on table
    m_cup = mat("TeaCup", (0.95, 0.95, 0.92, 1.0), 0.3, 0.05)
    cylinder("TeaCup", (0.30, 0.35, 0.27), 0.025, 0.05, m_cup)

    # Bear plushie on rug
    import_glb("bear.glb", loc=(0.55, 0.7, 0.01), rot=(0, 0, math.radians(-25)), scale=1.8)

    # Slippers near bed
    m_slipper = mat("Slipper", (0.95, 0.75, 0.80, 1.0), 0.9)
    rbox("SlipperL", (-0.3, 0.2, 0.02), (0.08, 0.18, 0.04), m_slipper, 0.015,
         rot=(0, 0, math.radians(15)))
    rbox("SlipperR", (-0.15, 0.18, 0.02), (0.08, 0.18, 0.04), m_slipper, 0.015,
         rot=(0, 0, math.radians(5)))


def build_decorations():
    """Wall art, string lights, and personal touches."""
    hw, hd = STAGE_W / 2, STAGE_D / 2

    # Picture frames on back wall
    m_frame = mat("PicFrame", (0.78, 0.68, 0.55, 1.0), 0.3)
    pics = [
        ((-0.6, -hd + 0.04, 1.8), (0.40, 0.02, 0.30), (0.70, 0.82, 0.90, 1.0)),
        ((-0.05, -hd + 0.04, 1.9), (0.28, 0.02, 0.38), (0.90, 0.82, 0.78, 1.0)),
        ((0.4, -hd + 0.04, 1.75), (0.22, 0.02, 0.22), (0.85, 0.88, 0.75, 1.0)),
    ]
    for i, (loc, dim, col) in enumerate(pics):
        rbox(f"Frame{i}", loc, dim, m_frame, 0.008)
        m_pic = mat(f"Pic{i}", col, 0.8)
        box(f"PicInner{i}", (loc[0], loc[1] + 0.015, loc[2]),
            (dim[0] - 0.06, 0.01, dim[2] - 0.06), m_pic)

    # String lights along top of back wall — fairy light effect
    m_wire = mat("Wire", (0.3, 0.3, 0.3, 1.0), 0.5)
    m_bulb = emit_mat("FairyBulb", (1.0, 0.92, 0.70, 1.0), 8.0)

    y_wire = -hd + 0.08
    for i in range(16):
        x = -hw + 0.4 + i * (STAGE_W - 0.8) / 15
        z = STAGE_H - 0.15 + math.sin(i * 0.8) * 0.08  # gentle sag
        sphere(f"Fairy{i}", (x, y_wire, z), 0.015, m_bulb)

    # Floor lamp — right side with emissive shade
    hw2 = STAGE_W / 2
    m_lamp_base = mat("FLampBase", (0.55, 0.45, 0.35, 1.0), 0.3, 0.2)
    m_lamp_shade = mat("FLampShade", (0.95, 0.90, 0.82, 1.0), 0.7)
    m_lamp_emit = emit_mat("FLampEmit", (1.0, 0.90, 0.70, 1.0), 4.0)

    cylinder("FLampPole", (hw2 - 0.4, 0.9, 0.65), 0.015, 1.3, m_lamp_base)
    cylinder("FLampBase", (hw2 - 0.4, 0.9, 0.02), 0.10, 0.03, m_lamp_base)
    # Shade — cylinder with emission inside
    cylinder("FLampShade", (hw2 - 0.4, 0.9, 1.35), 0.12, 0.20, m_lamp_shade)
    sphere("FLampGlow", (hw2 - 0.4, 0.9, 1.35), 0.08, m_lamp_emit)

    # Nightstand next to bed
    m_ns = mat("Nightstand", (0.62, 0.48, 0.32, 1.0), 0.4)
    rbox("Nightstand", (-hw + 0.35, -hd + 0.35, 0.22), (0.35, 0.35, 0.44), m_ns, 0.02)

    # Nightstand lamp — kenney + glow
    import_glb("lampRoundTable.glb", loc=(-hw + 0.35, -hd + 0.35, 0.46), scale=1.6)
    sphere("NLampGlow", (-hw + 0.35, -hd + 0.35, 0.60), 0.06,
           emit_mat("NLGlow", (1.0, 0.85, 0.60, 1.0), 6.0))

    # Alarm clock on nightstand
    m_clock = mat("Clock", (0.85, 0.85, 0.88, 1.0), 0.3, 0.1)
    rbox("Clock", (-hw + 0.50, -hd + 0.30, 0.47), (0.06, 0.04, 0.05), m_clock, 0.008)

    # Second potted plant — near open right side
    import_glb("pottedPlant.glb", loc=(hw2 - 0.3, -hd + 0.3, 0), scale=1.8)


# ═══════════════════════════════════════════════════════
# LIGHTING
# ═══════════════════════════════════════════════════════
def build_lighting():
    hw, hd = STAGE_W / 2, STAGE_D / 2

    # Key sun — warm golden, from upper right
    bpy.ops.object.light_add(type='SUN', location=(4, 2, 5))
    s = bpy.context.active_object
    s.name = "Key"
    s.data.energy = 2.0
    s.data.color = (1.0, 0.93, 0.78)
    s.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))
    s.data.angle = math.radians(12)

    # Window area light
    bpy.ops.object.light_add(type='AREA', location=(1.3, -hd + 0.3, 1.5))
    w = bpy.context.active_object
    w.name = "WindowArea"
    w.data.energy = 100
    w.data.color = (1.0, 0.95, 0.80)
    w.data.size = 1.1
    w.data.size_y = 1.4
    w.rotation_euler = (math.radians(90), 0, 0)

    # Nightstand point light
    bpy.ops.object.light_add(type='POINT', location=(-hw + 0.35, -hd + 0.35, 0.75))
    n = bpy.context.active_object
    n.name = "NightPt"
    n.data.energy = 35
    n.data.color = (1.0, 0.82, 0.55)
    n.data.shadow_soft_size = 0.4

    # Floor lamp point light
    bpy.ops.object.light_add(type='POINT', location=(hw - 0.4, 0.9, 1.4))
    f = bpy.context.active_object
    f.name = "FloorPt"
    f.data.energy = 25
    f.data.color = (1.0, 0.88, 0.68)
    f.data.shadow_soft_size = 0.3

    # Desk lamp spot
    bpy.ops.object.light_add(type='SPOT', location=(hw - 1.45, -hd + 0.35, 1.15))
    d = bpy.context.active_object
    d.name = "DeskSpot"
    d.data.energy = 40
    d.data.color = (1.0, 0.95, 0.85)
    d.data.spot_size = math.radians(50)
    d.data.spot_blend = 0.6
    d.rotation_euler = (math.radians(70), 0, math.radians(10))

    # Front fill — soft, from audience position
    bpy.ops.object.light_add(type='AREA', location=(2, 4, 2))
    ff = bpy.context.active_object
    ff.name = "FrontFill"
    ff.data.energy = 30
    ff.data.color = (0.96, 0.94, 1.0)
    ff.data.size = 3.0
    ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(120), 0, math.radians(-15))

    # Fairy light glow — subtle warm wash on back wall
    bpy.ops.object.light_add(type='AREA', location=(0, -hd + 0.3, STAGE_H - 0.2))
    fg = bpy.context.active_object
    fg.name = "FairyGlow"
    fg.data.energy = 15
    fg.data.color = (1.0, 0.92, 0.72)
    fg.data.size = STAGE_W * 0.7
    fg.data.size_y = 0.3
    fg.rotation_euler = (math.radians(90), 0, 0)

    # World — slightly warmer than before
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.08, 0.06, 0.10, 1.0)
        bg.inputs["Strength"].default_value = 0.3


# ═══════════════════════════════════════════════════════
# RENDER
# ═══════════════════════════════════════════════════════
def render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080

    if hasattr(scene, 'eevee'):
        e = scene.eevee
        for a, v in [('use_soft_shadows', True), ('use_ssr', True),
                     ('use_gtao', True), ('use_bloom', True),
                     ('bloom_threshold', 0.4), ('bloom_intensity', 0.35)]:
            if hasattr(e, a): setattr(e, a, v)

    hw, hd = STAGE_W / 2, STAGE_D / 2
    angles = {
        "main": ((1.2, hd + 2.8, 1.7), (math.radians(76), 0, math.radians(168)), 32),
        "wide": ((0, hd + 3.5, 2.5), (math.radians(65), 0, math.radians(180)), 28),
        "bed_close": ((-0.8, 0.8, 1.1), (math.radians(82), 0, math.radians(200)), 35),
        "desk_close": ((hw + 0.3, 0, 1.2), (math.radians(82), 0, math.radians(110)), 35),
    }

    for name, (loc, rot, lens) in angles.items():
        cd = bpy.data.cameras.new(f"Cam_{name}")
        cd.lens = lens
        co = bpy.data.objects.new(f"Cam_{name}", cd)
        bpy.context.collection.objects.link(co)
        co.location = loc
        co.rotation_euler = rot
        scene.camera = co
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"v4_{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ v4_{name}.png")

    # Export GLB
    glb = os.path.join(OUTPUT_DIR, "cozy-bedroom-v4.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(glb)/1024/1024:.1f} MB")


def main():
    print("=" * 50)
    print("  Cozy Bedroom v4 — POLISHED STAGE")
    print("=" * 50)
    clear_scene()
    build_stage()
    build_window()
    build_bed()
    build_desk_area()
    build_bookshelf()
    build_center()
    build_decorations()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
