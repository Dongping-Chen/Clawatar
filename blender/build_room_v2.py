"""
Blender Scene Builder v2 — Cozy Anime Bedroom
Fixes from v1 review:
- Wider room, better furniture spacing
- Pillow ON bed not floating on wall
- Warm lighting with lamp glow
- Working top-down camera
- Better material colors
Run: blender --background --python blender/build_room_v2.py
"""

import bpy
import math
import os

ASSET_DIR = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/assets/furniture/kenney"
OUTPUT_DIR = "/tmp/blender-room"
EXPORT_GLB = os.path.join(OUTPUT_DIR, "cozy-bedroom-v2.glb")

# Bigger room for breathing space
ROOM_W = 5.0
ROOM_D = 5.5
ROOM_H = 2.8

# Warm anime color palette
COL_FLOOR = (0.78, 0.62, 0.44, 1.0)        # warm honey wood
COL_WALL = (1.0, 0.96, 0.92, 1.0)          # warm cream
COL_ACCENT = (0.98, 0.87, 0.90, 1.0)       # sakura accent wall
COL_CEILING = (0.99, 0.97, 0.94, 1.0)      # warm white
COL_BASEBOARD = (0.65, 0.50, 0.35, 1.0)    # rich wood

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
    """Emissive material for lamp glow, fairy lights etc."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    # Remove default
    for n in nodes:
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
    print(f"  ✓ {filename} at {loc}")
    return parent


def build_room():
    mf = mat("Floor", COL_FLOOR, 0.35)
    mw = mat("Wall", COL_WALL, 0.8)
    ma = mat("Accent", COL_ACCENT, 0.8)
    mc = mat("Ceiling", COL_CEILING, 0.9)
    mb = mat("Baseboard", COL_BASEBOARD, 0.4)

    hw, hd = ROOM_W / 2, ROOM_D / 2

    # Floor
    box("Floor", (0, 0, -0.025), (ROOM_W, ROOM_D, 0.05), mf)
    # Ceiling
    box("Ceiling", (0, 0, ROOM_H + 0.025), (ROOM_W, ROOM_D, 0.05), mc)
    # Back wall (accent pink)
    box("Wall_Back", (0, -hd, ROOM_H / 2), (ROOM_W, 0.08, ROOM_H), ma)
    # Left wall
    box("Wall_Left", (-hw, 0, ROOM_H / 2), (0.08, ROOM_D, ROOM_H), mw)
    # Right wall (window wall)
    box("Wall_Right", (hw, 0, ROOM_H / 2), (0.08, ROOM_D, ROOM_H), mw)
    # Front wall (partial, for door feel — leave opening)
    # No front wall — open for camera

    # Baseboards (3 walls)
    bh = 0.07
    box("BB_Back", (0, -hd + 0.045, bh / 2), (ROOM_W, 0.02, bh), mb)
    box("BB_Left", (-hw + 0.045, 0, bh / 2), (0.02, ROOM_D, bh), mb)
    box("BB_Right", (hw - 0.045, 0, bh / 2), (0.02, ROOM_D, bh), mb)


def build_window():
    mframe = mat("WFrame", (0.85, 0.78, 0.65, 1.0), 0.3)
    mglass = emit_mat("WGlass", (1.0, 0.96, 0.82, 1.0), 4.0)

    wx = ROOM_W / 2 - 0.03
    wy = -0.5  # slightly off-center
    wz = 1.6
    ww, wh = 1.3, 1.5

    # Glass
    box("WGlass", (wx, wy, wz), (0.02, ww, wh), mglass)
    # Frame
    ft = 0.05
    box("WF_T", (wx, wy, wz + wh / 2), (0.04, ww + 0.1, ft), mframe)
    box("WF_B", (wx, wy, wz - wh / 2), (0.04, ww + 0.1, ft), mframe)
    box("WF_L", (wx, wy - ww / 2, wz), (0.04, ft, wh), mframe)
    box("WF_R", (wx, wy + ww / 2, wz), (0.04, ft, wh), mframe)
    box("WF_H", (wx, wy, wz), (0.04, ww, 0.03), mframe)
    box("WF_V", (wx, wy, wz), (0.04, 0.03, wh), mframe)

    # Curtains — soft pink
    mcurt = mat("Curtain", (0.96, 0.82, 0.86, 1.0), 0.95)
    box("Curt_L", (wx - 0.06, wy - ww / 2 - 0.2, wz + 0.15),
        (0.03, 0.3, wh + 0.35), mcurt)
    box("Curt_R", (wx - 0.06, wy + ww / 2 + 0.2, wz + 0.15),
        (0.03, 0.3, wh + 0.35), mcurt)
    # Curtain rod
    mrod = mat("Rod", (0.7, 0.65, 0.55, 1.0), 0.2, 0.3)
    box("CurtRod", (wx - 0.06, wy, wz + wh / 2 + 0.25),
        (0.02, ww + 0.7, 0.02), mrod)


def build_furniture():
    S = 2.0  # Kenney scale
    hw, hd = ROOM_W / 2, ROOM_D / 2

    # ─── BED — back-left corner ───
    import_glb("bedDouble.glb",
               loc=(-hw + 1.0, -hd + 0.5, 0),
               rot=(0, 0, math.radians(90)), scale=S)
    # Pillow ON the bed (z matches bed surface height)
    import_glb("pillow.glb",
               loc=(-hw + 0.5, -hd + 0.5, 0.45),
               rot=(0, 0, 0), scale=S * 0.7)
    import_glb("pillowBlue.glb",
               loc=(-hw + 0.7, -hd + 0.7, 0.45),
               rot=(0, 0, math.radians(15)), scale=S * 0.6)

    # ─── NIGHTSTAND — next to bed ───
    import_glb("cabinetBedDrawerTable.glb",
               loc=(-hw + 0.35, -hd + 1.5, 0),
               rot=(0, 0, 0), scale=S)
    # Lamp on nightstand
    import_glb("lampRoundTable.glb",
               loc=(-hw + 0.35, -hd + 1.5, 0.5),
               rot=(0, 0, 0), scale=S)

    # ─── DESK — right side against back wall ───
    import_glb("desk.glb",
               loc=(hw - 1.0, -hd + 0.5, 0),
               rot=(0, 0, 0), scale=S)
    # Chair facing desk
    import_glb("chairCushion.glb",
               loc=(hw - 1.0, -hd + 1.3, 0),
               rot=(0, 0, math.radians(180)), scale=S)
    # Books & laptop on desk
    import_glb("books.glb",
               loc=(hw - 0.6, -hd + 0.4, 0.72),
               rot=(0, 0, 0), scale=S)
    import_glb("laptop.glb",
               loc=(hw - 1.2, -hd + 0.45, 0.72),
               rot=(0, 0, 0), scale=S)

    # ─── BOOKCASE — left wall, mid ───
    import_glb("bookcaseClosedWide.glb",
               loc=(-hw + 0.35, 0.3, 0),
               rot=(0, 0, math.radians(90)), scale=S)

    # ─── RUG — center of room ───
    import_glb("rugRound.glb",
               loc=(0.2, 0.3, 0.01),
               rot=(0, 0, 0), scale=S * 1.5)

    # ─── COZY ITEMS ───
    # Bear on the rug
    import_glb("bear.glb",
               loc=(0.5, 0.6, 0.01),
               rot=(0, 0, math.radians(-25)), scale=S * 0.9)

    # Floor lamp — back-right near window
    import_glb("lampRoundFloor.glb",
               loc=(hw - 0.35, 0.8, 0),
               rot=(0, 0, 0), scale=S)

    # Potted plant — front-left corner
    import_glb("pottedPlant.glb",
               loc=(-hw + 0.4, hd - 0.4, 0),
               rot=(0, 0, 0), scale=S)

    # Second plant — near window
    import_glb("pottedPlant.glb",
               loc=(hw - 0.35, -hd + 2.2, 0),
               rot=(0, 0, math.radians(45)), scale=S * 0.8)

    # Low bench with cushion near window
    import_glb("benchCushionLow.glb",
               loc=(hw - 0.8, 1.0, 0),
               rot=(0, 0, math.radians(-90)), scale=S)

    # Small table for tea/display
    import_glb("tableSmall.glb",
               loc=(0.2, 0.0, 0),
               rot=(0, 0, 0), scale=S) if os.path.exists(os.path.join(ASSET_DIR, "tableSmall.glb")) else None

    # Dresser on left wall
    import_glb("drawersCupboard.glb",
               loc=(-hw + 0.35, -hd + 2.5, 0),
               rot=(0, 0, math.radians(90)), scale=S) if os.path.exists(os.path.join(ASSET_DIR, "drawersCupboard.glb")) else None


def build_lighting():
    """Warm, layered lighting — the key to a cozy room."""

    # 1. Sun — warm golden light through window
    bpy.ops.object.light_add(type='SUN', location=(3, 0, 4))
    sun = bpy.context.active_object
    sun.name = "Sun_Window"
    sun.data.energy = 2.5
    sun.data.color = (1.0, 0.92, 0.75)
    sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-25))
    sun.data.angle = math.radians(8)

    # 2. Window area light — strong warm glow streaming in
    bpy.ops.object.light_add(type='AREA',
                              location=(ROOM_W / 2 - 0.15, -0.5, 1.6))
    wl = bpy.context.active_object
    wl.name = "Window_Area"
    wl.data.energy = 200
    wl.data.color = (1.0, 0.94, 0.78)
    wl.data.size = 1.3
    wl.data.size_y = 1.5
    wl.rotation_euler = (0, math.radians(-90), 0)

    # 3. Nightstand lamp — warm orange point light
    bpy.ops.object.light_add(type='POINT',
                              location=(-ROOM_W / 2 + 0.35, -ROOM_D / 2 + 1.5, 0.9))
    nl = bpy.context.active_object
    nl.name = "NightLamp"
    nl.data.energy = 40
    nl.data.color = (1.0, 0.82, 0.55)
    nl.data.shadow_soft_size = 0.4

    # 4. Floor lamp — subtle warm
    bpy.ops.object.light_add(type='POINT',
                              location=(ROOM_W / 2 - 0.35, 0.8, 1.5))
    fl = bpy.context.active_object
    fl.name = "FloorLamp"
    fl.data.energy = 25
    fl.data.color = (1.0, 0.90, 0.72)
    fl.data.shadow_soft_size = 0.3

    # 5. Desk lamp — focused white-warm
    bpy.ops.object.light_add(type='SPOT',
                              location=(ROOM_W / 2 - 1.0, -ROOM_D / 2 + 0.5, 1.3))
    dl = bpy.context.active_object
    dl.name = "DeskSpot"
    dl.data.energy = 60
    dl.data.color = (1.0, 0.95, 0.85)
    dl.data.spot_size = math.radians(60)
    dl.data.spot_blend = 0.5
    dl.rotation_euler = (math.radians(90), 0, 0)

    # 6. Fill — warm ambient bounce
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.1))
    af = bpy.context.active_object
    af.name = "FloorBounce"
    af.data.energy = 15
    af.data.color = (1.0, 0.92, 0.78)
    af.data.size = ROOM_W * 0.8
    af.data.size_y = ROOM_D * 0.8

    # 7. Ceiling ambient — very subtle cool
    bpy.ops.object.light_add(type='AREA', location=(0, 0, ROOM_H - 0.1))
    ca = bpy.context.active_object
    ca.name = "CeilingFill"
    ca.data.energy = 8
    ca.data.color = (0.95, 0.95, 1.0)
    ca.data.size = ROOM_W * 0.6
    ca.data.size_y = ROOM_D * 0.6
    ca.rotation_euler = (math.radians(180), 0, 0)

    # World background — warm dark
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.04, 0.03, 0.05, 1.0)
        bg.inputs["Strength"].default_value = 0.3


def setup_cameras():
    """Multiple camera angles for review."""
    hw, hd = ROOM_W / 2, ROOM_D / 2

    angles = {
        "front": ((0, hd + 1.0, 1.5), (math.radians(78), 0, math.radians(180))),
        "corner_high": ((hw - 0.5, hd - 0.5, 2.2), (math.radians(60), 0, math.radians(140))),
        "bed_view": ((-hw + 2.0, 0, 1.3), (math.radians(82), 0, math.radians(-120))),
        "desk_view": ((hw - 0.5, -hd + 2.0, 1.3), (math.radians(80), 0, math.radians(140))),
        "top_iso": ((0, hd + 2.0, 4.0), (math.radians(45), 0, math.radians(180))),
    }

    cams = {}
    for name, (loc, rot) in angles.items():
        cd = bpy.data.cameras.new(f"Cam_{name}")
        cd.lens = 24
        co = bpy.data.objects.new(f"Cam_{name}", cd)
        bpy.context.collection.objects.link(co)
        co.location = loc
        co.rotation_euler = rot
        cams[name] = co

    return cams


def render_all(cameras):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.film_transparent = False

    if hasattr(scene, 'eevee'):
        e = scene.eevee
        for attr, val in [
            ('use_soft_shadows', True),
            ('use_ssr', True),
            ('use_gtao', True),
            ('use_bloom', True),
            ('bloom_threshold', 0.6),
            ('bloom_intensity', 0.4),
        ]:
            if hasattr(e, attr):
                setattr(e, attr, val)

    for name, cam in cameras.items():
        scene.camera = cam
        path = os.path.join(OUTPUT_DIR, f"v2_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  ✓ v2_{name}.png")


def export():
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_GLB,
        export_format='GLB',
        use_selection=False,
        export_cameras=False,
        export_lights=True,
        export_apply=True,
    )
    sz = os.path.getsize(EXPORT_GLB) / (1024 * 1024)
    print(f"  ✓ GLB → {sz:.1f} MB")


def main():
    print("=" * 50)
    print("  Cozy Bedroom v2")
    print("=" * 50)

    clear_scene()
    print("[1] Room shell...")
    build_room()
    build_window()
    print("[2] Furniture...")
    build_furniture()
    print("[3] Lighting...")
    build_lighting()
    print("[4] Cameras + Render...")
    cams = setup_cameras()
    render_all(cams)
    print("[5] Export GLB...")
    export()
    print("DONE ✓")


if __name__ == "__main__":
    main()
