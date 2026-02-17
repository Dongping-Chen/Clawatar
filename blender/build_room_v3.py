"""
Blender Scene Builder v3 — STAGE Concept
Key changes from v2:
- STAGE mindset: only 2 walls (back + one side), open for camera
- Fixed camera position (like a TV show set)
- Realistic bed placement (head against wall)
- More breathing space, natural furniture layout
- Better lighting for the camera angle
- Procedural soft furniture to replace some Kenney blocks
"""

import bpy
import bmesh
import math
import os

ASSET_DIR = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/assets/furniture/kenney"
OUTPUT_DIR = "/tmp/blender-room"

# Stage dimensions — wider than deep (for camera)
STAGE_W = 5.5   # X: left-right
STAGE_D = 4.0   # Y: depth (back to front)
STAGE_H = 2.8   # Z: height

os.makedirs(OUTPUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)


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
    for n in list(nodes):
        nodes.remove(n)
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
    if material:
        o.data.materials.append(material)
    return o


def rounded_box(name, loc, dim, material, radius=0.03, rot=(0, 0, 0)):
    """Create a box with beveled/rounded edges — softer look."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = dim
    o.rotation_euler = rot

    # Apply scale first for bevel to work correctly
    bpy.ops.object.transform_apply(scale=True)

    # Add bevel modifier for rounded edges
    bev = o.modifiers.new("Bevel", 'BEVEL')
    bev.width = radius
    bev.segments = 3
    bev.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier="Bevel")

    if material:
        o.data.materials.append(material)
    return o


def make_soft_bed(loc):
    """Procedurally build a soft-looking bed (not Kenney blocks)."""
    x, y, z = loc

    # Bed frame — warm wood
    m_frame = mat("BedFrame", (0.65, 0.45, 0.30, 1.0), 0.4)
    # Frame base
    rounded_box("BedBase", (x, y, z + 0.15), (1.0, 2.0, 0.30), m_frame, radius=0.02)
    # Headboard — taller, against wall
    rounded_box("Headboard", (x, y - 0.95, z + 0.55), (1.05, 0.08, 0.80), m_frame, radius=0.03)
    # Legs
    for dx, dy in [(-0.45, -0.9), (0.45, -0.9), (-0.45, 0.9), (0.45, 0.9)]:
        box(f"BedLeg_{dx}_{dy}", (x + dx, y + dy, z + 0.04), (0.05, 0.05, 0.08), m_frame)

    # Mattress — soft white
    m_mattress = mat("Mattress", (0.95, 0.93, 0.90, 1.0), 0.8)
    rounded_box("Mattress", (x, y + 0.05, z + 0.35), (0.92, 1.8, 0.12), m_mattress, radius=0.04)

    # Blanket/duvet — sakura pink, slightly draped
    m_blanket = mat("Blanket", (0.95, 0.78, 0.82, 1.0), 0.9)
    rounded_box("Blanket", (x, y + 0.25, z + 0.42), (0.88, 1.3, 0.08), m_blanket, radius=0.04)

    # Pillows — soft round shapes
    m_pillow1 = mat("Pillow1", (1.0, 0.95, 0.92, 1.0), 0.85)
    m_pillow2 = mat("Pillow2", (0.85, 0.90, 0.95, 1.0), 0.85)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, location=(x - 0.25, y - 0.65, z + 0.48))
    p1 = bpy.context.active_object
    p1.name = "Pillow1"
    p1.scale = (1.0, 0.7, 0.5)
    p1.data.materials.append(m_pillow1)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.16, location=(x + 0.2, y - 0.6, z + 0.47))
    p2 = bpy.context.active_object
    p2.name = "Pillow2"
    p2.scale = (1.0, 0.7, 0.5)
    p2.rotation_euler = (0, 0, math.radians(10))
    p2.data.materials.append(m_pillow2)


def make_soft_desk(loc):
    """Procedural desk — clean, modern."""
    x, y, z = loc
    m_top = mat("DeskTop", (0.9, 0.85, 0.78, 1.0), 0.35)
    m_leg = mat("DeskLeg", (0.7, 0.62, 0.52, 1.0), 0.3, 0.1)

    # Top surface
    rounded_box("DeskTop", (x, y, z + 0.72), (1.2, 0.55, 0.04), m_top, radius=0.015)

    # Legs — slim
    for dx, dy in [(-0.55, -0.22), (0.55, -0.22), (-0.55, 0.22), (0.55, 0.22)]:
        rounded_box(f"DeskLeg_{dx}", (x + dx, y + dy, z + 0.36), (0.04, 0.04, 0.72), m_leg, radius=0.01)

    # Shelf under desk
    rounded_box("DeskShelf", (x, y, z + 0.30), (0.8, 0.35, 0.02), m_top, radius=0.01)


def make_soft_chair(loc, rot_z=0):
    """Soft cushioned chair."""
    x, y, z = loc
    m_seat = mat("ChairSeat", (0.92, 0.80, 0.83, 1.0), 0.85)  # pink cushion
    m_frame = mat("ChairFrame", (0.7, 0.62, 0.52, 1.0), 0.3)

    # Seat cushion — rounded
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.22, location=(x, y, z + 0.42))
    seat = bpy.context.active_object
    seat.name = "ChairSeat"
    seat.scale = (1.0, 1.0, 0.35)
    seat.rotation_euler = (0, 0, math.radians(rot_z))
    seat.data.materials.append(m_seat)

    # Legs
    for dx, dy in [(-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)]:
        rx = x + dx * math.cos(math.radians(rot_z)) - dy * math.sin(math.radians(rot_z))
        ry = y + dx * math.sin(math.radians(rot_z)) + dy * math.cos(math.radians(rot_z))
        box(f"ChairLeg", (rx, ry, z + 0.18), (0.03, 0.03, 0.36), m_frame)

    # Back
    bx = x - 0.0 * math.cos(math.radians(rot_z)) + 0.2 * math.sin(math.radians(rot_z))
    by = y - 0.0 * math.sin(math.radians(rot_z)) - 0.2 * math.cos(math.radians(rot_z))
    rounded_box("ChairBack", (bx, by, z + 0.65),
                (0.35, 0.04, 0.30), m_seat, radius=0.02,
                rot=(0, 0, math.radians(rot_z)))


def make_bookshelf(loc):
    """Procedural bookshelf with colorful books."""
    x, y, z = loc
    m_shelf = mat("ShelfWood", (0.62, 0.48, 0.32, 1.0), 0.4)

    # Frame
    shelf_w, shelf_d, shelf_h = 0.8, 0.25, 1.6
    # Sides
    rounded_box("ShelfL", (x - shelf_w/2, y, z + shelf_h/2), (0.03, shelf_d, shelf_h), m_shelf, radius=0.008)
    rounded_box("ShelfR", (x + shelf_w/2, y, z + shelf_h/2), (0.03, shelf_d, shelf_h), m_shelf, radius=0.008)
    # Back
    box("ShelfBack", (x, y - shelf_d/2 + 0.01, z + shelf_h/2), (shelf_w, 0.02, shelf_h), m_shelf)

    # 4 shelves
    for i, sz in enumerate([0.0, 0.4, 0.8, 1.2, 1.6]):
        rounded_box(f"Shelf_{i}", (x, y, z + sz), (shelf_w, shelf_d, 0.025), m_shelf, radius=0.005)

    # Books on shelves — colorful
    book_colors = [
        (0.85, 0.3, 0.35, 1), (0.3, 0.55, 0.8, 1), (0.4, 0.75, 0.45, 1),
        (0.9, 0.75, 0.3, 1), (0.7, 0.4, 0.7, 1), (0.3, 0.7, 0.7, 1),
        (0.9, 0.5, 0.3, 1), (0.5, 0.5, 0.8, 1),
    ]
    bx = x - shelf_w/2 + 0.08
    for shelf_z in [0.025, 0.425, 0.825]:
        for j in range(5):
            bc = book_colors[(j + int(shelf_z * 10)) % len(book_colors)]
            m_book = mat(f"Book_{shelf_z}_{j}", bc, 0.7)
            bw = 0.03 + (j % 3) * 0.01
            bh = 0.25 + (j % 4) * 0.03
            rounded_box(f"Book_{shelf_z}_{j}",
                        (bx + j * 0.12, y, z + shelf_z + bh/2 + 0.02),
                        (bw, 0.18, bh), m_book, radius=0.005)


def make_rug(loc, radius=1.2):
    """Soft round rug."""
    x, y, z = loc
    m_rug = mat("Rug", (0.92, 0.78, 0.80, 1.0), 0.95)
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=0.02, location=(x, y, z + 0.01))
    rug = bpy.context.active_object
    rug.name = "Rug"
    rug.data.materials.append(m_rug)

    # Rug border
    m_border = mat("RugBorder", (0.85, 0.65, 0.68, 1.0), 0.9)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=0.02,
        location=(x, y, z + 0.015))
    border = bpy.context.active_object
    border.name = "RugBorder"
    border.data.materials.append(m_border)


def import_glb(filename, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    fp = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(fp):
        print(f"  ⚠ SKIP {filename}")
        return None
    existing = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=fp)
    new_objs = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in existing]
    if not new_objs:
        return None
    parent = bpy.data.objects.new(f"Asset_{filename}", None)
    bpy.context.collection.objects.link(parent)
    parent.location = loc
    parent.rotation_euler = rot
    parent.scale = (scale, scale, scale)
    for o in new_objs:
        o.parent = parent
    print(f"  ✓ {filename}")
    return parent


def build_stage():
    """Build stage set — 2 walls only (back + left), open right + front for camera."""
    hw = STAGE_W / 2
    hd = STAGE_D / 2

    m_floor = mat("Floor", (0.80, 0.65, 0.47, 1.0), 0.35)
    m_wall = mat("Wall", (1.0, 0.96, 0.92, 1.0), 0.8)
    m_accent = mat("AccentWall", (0.97, 0.88, 0.91, 1.0), 0.8)

    # Floor — extends slightly beyond walls for stage feel
    box("Floor", (0, 0, -0.025), (STAGE_W + 0.5, STAGE_D + 0.5, 0.05), m_floor)

    # Back wall (Y = -hd)
    box("Wall_Back", (0, -hd, STAGE_H / 2), (STAGE_W, 0.08, STAGE_H), m_accent)

    # Left wall (X = -hw) — only this one side wall
    box("Wall_Left", (-hw, 0, STAGE_H / 2), (0.08, STAGE_D, STAGE_H), m_wall)

    # NO right wall, NO front wall — open for camera!
    # NO ceiling — open top for lighting


def build_window():
    """Window on the back wall — stage right side."""
    m_frame = mat("WinFrame", (0.85, 0.78, 0.65, 1.0), 0.3)
    m_glass = emit_mat("WinGlass", (1.0, 0.96, 0.82, 1.0), 5.0)

    # Window position — back wall, right half
    wx, wy, wz = 1.2, -STAGE_D / 2 + 0.03, 1.5
    ww, wh = 1.0, 1.3

    box("WGlass", (wx, wy, wz), (ww, 0.02, wh), m_glass)

    ft = 0.04
    box("WF_T", (wx, wy, wz + wh/2), (ww + 0.08, 0.04, ft), m_frame)
    box("WF_B", (wx, wy, wz - wh/2), (ww + 0.08, 0.04, ft), m_frame)
    box("WF_L", (wx - ww/2, wy, wz), (ft, 0.04, wh), m_frame)
    box("WF_R", (wx + ww/2, wy, wz), (ft, 0.04, wh), m_frame)
    box("WF_Cross_H", (wx, wy, wz), (ww, 0.04, 0.025), m_frame)
    box("WF_Cross_V", (wx, wy, wz), (0.025, 0.04, wh), m_frame)

    # Curtains
    m_curt = mat("Curtain", (0.95, 0.82, 0.86, 1.0), 0.95)
    box("Curt_L", (wx - ww/2 - 0.18, wy + 0.03, wz + 0.1),
        (0.28, 0.03, wh + 0.3), m_curt)
    box("Curt_R", (wx + ww/2 + 0.18, wy + 0.03, wz + 0.1),
        (0.28, 0.03, wh + 0.3), m_curt)


def build_scene():
    """Place furniture — STAGE composition."""
    hw = STAGE_W / 2
    hd = STAGE_D / 2

    # ─── BED — left side, head against back wall, side facing camera ───
    # This is the natural way: head at wall, long side visible
    make_soft_bed((-hw + 0.7, -hd + 1.1, 0))

    # ─── DESK — right side, against back wall ───
    make_soft_desk((hw - 0.9, -hd + 0.4, 0))

    # ─── CHAIR — at desk, angled toward camera ───
    make_soft_chair((hw - 0.9, -hd + 1.0, 0), rot_z=160)

    # ─── BOOKSHELF — against left wall, mid-depth ───
    make_bookshelf((-hw + 0.45, 0.2, 0))

    # ─── RUG — center of open area ───
    make_rug((0.3, 0.3, 0), radius=0.9)

    # ─── SMALL ITEMS from Kenney (for detail) ───
    # Bear on the rug
    import_glb("bear.glb", loc=(0.5, 0.5, 0.01),
               rot=(0, 0, math.radians(-20)), scale=1.8)

    # Potted plant — near window
    import_glb("pottedPlant.glb", loc=(hw - 0.3, -hd + 0.3, 0),
               rot=(0, 0, 0), scale=1.8)

    # Floor lamp — right side, visible
    import_glb("lampRoundFloor.glb", loc=(hw - 0.3, 0.8, 0),
               rot=(0, 0, 0), scale=2.0)

    # Nightstand lamp (Kenney) on a small procedural table
    m_table = mat("NightTable", (0.65, 0.50, 0.35, 1.0), 0.4)
    rounded_box("NightTable", (-hw + 0.35, -hd + 0.3, 0.25), (0.35, 0.35, 0.50), m_table, radius=0.02)
    import_glb("lampRoundTable.glb", loc=(-hw + 0.35, -hd + 0.3, 0.52),
               rot=(0, 0, 0), scale=1.8)

    # Books on desk
    import_glb("books.glb", loc=(hw - 0.5, -hd + 0.35, 0.74),
               rot=(0, 0, 0), scale=1.8)

    # Laptop on desk
    import_glb("laptop.glb", loc=(hw - 1.1, -hd + 0.38, 0.74),
               rot=(0, 0, 0), scale=1.8)

    # Picture frames on back wall
    m_pframe = mat("PicFrame", (0.8, 0.7, 0.6, 1.0), 0.3)
    m_pic = mat("Picture", (0.7, 0.82, 0.9, 1.0), 0.8)  # sky blue
    # Frame 1
    rounded_box("Frame1", (-0.5, -hd + 0.04, 1.8), (0.4, 0.02, 0.3), m_pframe, radius=0.01)
    box("Pic1", (-0.5, -hd + 0.05, 1.8), (0.34, 0.01, 0.24), m_pic)
    # Frame 2
    m_pic2 = mat("Picture2", (0.9, 0.82, 0.78, 1.0), 0.8)  # warm
    rounded_box("Frame2", (-0.0, -hd + 0.04, 1.9), (0.25, 0.02, 0.35), m_pframe, radius=0.01)
    box("Pic2", (0.0, -hd + 0.05, 1.9), (0.19, 0.01, 0.29), m_pic2)


def build_lighting():
    """Stage lighting — designed for the camera angle."""
    hw = STAGE_W / 2
    hd = STAGE_D / 2

    # 1. Key light — warm sun from upper-right (through open side)
    bpy.ops.object.light_add(type='SUN', location=(4, 2, 5))
    sun = bpy.context.active_object
    sun.name = "KeySun"
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.93, 0.78)
    sun.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))
    sun.data.angle = math.radians(10)

    # 2. Window light — warm golden area
    bpy.ops.object.light_add(type='AREA', location=(1.2, -hd + 0.3, 1.5))
    wl = bpy.context.active_object
    wl.name = "WindowLight"
    wl.data.energy = 120
    wl.data.color = (1.0, 0.94, 0.78)
    wl.data.size = 1.0
    wl.data.size_y = 1.3
    wl.rotation_euler = (math.radians(90), 0, 0)

    # 3. Nightstand lamp — warm orange
    bpy.ops.object.light_add(type='POINT', location=(-hw + 0.35, -hd + 0.3, 0.8))
    nl = bpy.context.active_object
    nl.name = "NightLamp"
    nl.data.energy = 30
    nl.data.color = (1.0, 0.82, 0.55)
    nl.data.shadow_soft_size = 0.4

    # 4. Floor lamp
    bpy.ops.object.light_add(type='POINT', location=(hw - 0.3, 0.8, 1.5))
    fl = bpy.context.active_object
    fl.name = "FloorLamp"
    fl.data.energy = 20
    fl.data.color = (1.0, 0.88, 0.70)
    fl.data.shadow_soft_size = 0.3

    # 5. Fill light from front-right (audience direction)
    bpy.ops.object.light_add(type='AREA', location=(3, 4, 2.5))
    fill = bpy.context.active_object
    fill.name = "FrontFill"
    fill.data.energy = 40
    fill.data.color = (0.95, 0.93, 1.0)
    fill.data.size = 3.0
    fill.data.size_y = 2.0
    fill.rotation_euler = (math.radians(120), 0, math.radians(-20))

    # 6. Rim/back light from behind — separates scene from background
    bpy.ops.object.light_add(type='SPOT', location=(0, -hd - 1, 3))
    rim = bpy.context.active_object
    rim.name = "RimSpot"
    rim.data.energy = 80
    rim.data.color = (1.0, 0.92, 0.80)
    rim.data.spot_size = math.radians(80)
    rim.data.spot_blend = 0.8
    rim.rotation_euler = (math.radians(30), 0, 0)

    # World
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.15, 0.12, 0.18, 1.0)
        bg.inputs["Strength"].default_value = 0.2


def render():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.film_transparent = False

    if hasattr(scene, 'eevee'):
        e = scene.eevee
        for attr, val in [
            ('use_soft_shadows', True), ('use_ssr', True),
            ('use_gtao', True), ('use_bloom', True),
            ('bloom_threshold', 0.5), ('bloom_intensity', 0.3),
        ]:
            if hasattr(e, attr):
                setattr(e, attr, val)

    # Main camera — audience view (front-right, slightly elevated)
    cam_data = bpy.data.cameras.new("MainCam")
    cam_data.lens = 30
    cam = bpy.data.objects.new("MainCam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.5, STAGE_D / 2 + 2.5, 1.8)
    cam.rotation_euler = (math.radians(75), 0, math.radians(165))

    # Render angles
    angles = {
        "main": (cam.location, cam.rotation_euler),
        "wide": ((0, STAGE_D / 2 + 3.5, 2.5), (math.radians(65), 0, math.radians(180))),
        "close_bed": ((-1.0, 0.5, 1.2), (math.radians(82), 0, math.radians(-140))),
        "close_desk": ((STAGE_W / 2, 0.5, 1.3), (math.radians(80), 0, math.radians(130))),
    }

    for name, (loc, rot) in angles.items():
        if name == "main":
            scene.camera = cam
        else:
            cd = bpy.data.cameras.new(f"Cam_{name}")
            cd.lens = 28
            co = bpy.data.objects.new(f"Cam_{name}", cd)
            bpy.context.collection.objects.link(co)
            co.location = loc
            co.rotation_euler = rot
            scene.camera = co

        path = os.path.join(OUTPUT_DIR, f"v3_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ v3_{name}.png")

    # Export GLB
    glb_path = os.path.join(OUTPUT_DIR, "cozy-bedroom-v3.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path, export_format='GLB',
        use_selection=False, export_cameras=False,
        export_lights=True, export_apply=True)
    sz = os.path.getsize(glb_path) / (1024 * 1024)
    print(f"  ✓ GLB → {sz:.1f} MB")


def main():
    print("=" * 50)
    print("  Cozy Bedroom v3 — STAGE CONCEPT")
    print("=" * 50)
    clear_scene()
    print("[1] Stage shell (2 walls)...")
    build_stage()
    build_window()
    print("[2] Procedural furniture + details...")
    build_scene()
    print("[3] Stage lighting...")
    build_lighting()
    print("[4] Render + Export...")
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
