"""
Blender Scene Builder — Cozy Anime Bedroom
Run: blender --background --python build_room.py
Output: renders to /tmp/blender-room/ and exports GLB
"""

import bpy
import math
import os
import sys

# ─── Config ───────────────────────────────────────────────────────
ASSET_DIR = "/Users/dongpingchen/.openclaw/workspace/vrm-viewer/public/assets/furniture/kenney"
OUTPUT_DIR = "/tmp/blender-room"
EXPORT_GLB = os.path.join(OUTPUT_DIR, "cozy-bedroom.glb")
RENDER_DIR = OUTPUT_DIR

# Room dimensions (meters)
ROOM_W = 4.0   # X axis
ROOM_D = 4.5   # Y axis
ROOM_H = 2.8   # Z axis

# Color palette — warm anime style
COL_FLOOR = (0.76, 0.60, 0.42, 1.0)      # warm wood
COL_WALL = (1.0, 0.95, 0.90, 1.0)        # cream
COL_ACCENT_WALL = (0.98, 0.85, 0.88, 1.0) # light sakura pink
COL_CEILING = (0.98, 0.96, 0.93, 1.0)     # off-white
COL_BASEBOARD = (0.85, 0.78, 0.68, 1.0)   # darker wood

os.makedirs(OUTPUT_DIR, exist_ok=True)


def clear_scene():
    """Remove all default objects."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    # Clear orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        if block.users == 0:
            bpy.data.materials.remove(block)


def make_material(name, color, roughness=0.7, metallic=0.0):
    """Create a simple PBR material."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def add_box(name, location, dimensions, material, rotation=(0, 0, 0)):
    """Add a box (cube) with given dimensions and material."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (dimensions[0], dimensions[1], dimensions[2])
    obj.rotation_euler = rotation
    if material:
        obj.data.materials.append(material)
    return obj


def build_room_shell():
    """Build floor, walls, ceiling."""
    mat_floor = make_material("Floor_Wood", COL_FLOOR, roughness=0.4)
    mat_wall = make_material("Wall_Cream", COL_WALL, roughness=0.8)
    mat_accent = make_material("Wall_Sakura", COL_ACCENT_WALL, roughness=0.8)
    mat_ceiling = make_material("Ceiling", COL_CEILING, roughness=0.9)
    mat_baseboard = make_material("Baseboard", COL_BASEBOARD, roughness=0.5)

    # Floor
    add_box("Floor", (0, 0, -0.025), (ROOM_W, ROOM_D, 0.05), mat_floor)

    # Back wall (Y = -ROOM_D/2)
    add_box("Wall_Back", (0, -ROOM_D/2, ROOM_H/2), (ROOM_W, 0.08, ROOM_H), mat_accent)

    # Left wall (X = -ROOM_W/2)
    add_box("Wall_Left", (-ROOM_W/2, 0, ROOM_H/2), (0.08, ROOM_D, ROOM_H), mat_wall)

    # Right wall (X = ROOM_W/2) — with window cutout (we'll add window separately)
    add_box("Wall_Right", (ROOM_W/2, 0, ROOM_H/2), (0.08, ROOM_D, ROOM_H), mat_wall)

    # Ceiling
    add_box("Ceiling", (0, 0, ROOM_H + 0.025), (ROOM_W, ROOM_D, 0.05), mat_ceiling)

    # Baseboards
    baseboard_h = 0.08
    add_box("Baseboard_Back", (0, -ROOM_D/2 + 0.045, baseboard_h/2),
            (ROOM_W, 0.02, baseboard_h), mat_baseboard)
    add_box("Baseboard_Left", (-ROOM_W/2 + 0.045, 0, baseboard_h/2),
            (0.02, ROOM_D, baseboard_h), mat_baseboard)
    add_box("Baseboard_Right", (ROOM_W/2 - 0.045, 0, baseboard_h/2),
            (0.02, ROOM_D, baseboard_h), mat_baseboard)


def build_window():
    """Add a window on the right wall with golden light."""
    # Window frame
    mat_frame = make_material("Window_Frame", (0.9, 0.85, 0.75, 1.0), roughness=0.3)

    # Window pane (emissive for light effect)
    mat_glass = bpy.data.materials.new("Window_Glass")
    mat_glass.use_nodes = True
    nodes = mat_glass.node_tree.nodes
    links = mat_glass.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.95, 0.92, 0.80, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.1
        bsdf.inputs["Alpha"].default_value = 0.3
        # Add emission for glow
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = (1.0, 0.95, 0.75, 1.0)
        emission.inputs["Strength"].default_value = 3.0
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = 0.4
        output = nodes.get("Material Output")
        links.new(bsdf.outputs["BSDF"], mix.inputs[1])
        links.new(emission.outputs["Emission"], mix.inputs[2])
        links.new(mix.outputs["Shader"], output.inputs["Surface"])
    mat_glass.blend_method = 'BLEND' if hasattr(mat_glass, 'blend_method') else None

    win_w, win_h = 1.2, 1.4
    win_y = 0.0
    win_z = 1.6
    win_x = ROOM_W / 2 - 0.03

    # Glass pane
    add_box("Window_Glass", (win_x, win_y, win_z), (0.02, win_w, win_h), mat_glass)

    # Frame pieces (top, bottom, left, right, center cross)
    frame_t = 0.05
    add_box("WinFrame_Top", (win_x, win_y, win_z + win_h/2), (0.04, win_w + 0.1, frame_t), mat_frame)
    add_box("WinFrame_Bot", (win_x, win_y, win_z - win_h/2), (0.04, win_w + 0.1, frame_t), mat_frame)
    add_box("WinFrame_L", (win_x, win_y - win_w/2, win_z), (0.04, frame_t, win_h), mat_frame)
    add_box("WinFrame_R", (win_x, win_y + win_w/2, win_z), (0.04, frame_t, win_h), mat_frame)
    # Cross dividers
    add_box("WinFrame_H", (win_x, win_y, win_z), (0.04, win_w, 0.03), mat_frame)
    add_box("WinFrame_V", (win_x, win_y, win_z), (0.04, 0.03, win_h), mat_frame)

    # Curtains
    mat_curtain = make_material("Curtain", (0.95, 0.80, 0.85, 1.0), roughness=0.9)
    add_box("Curtain_L", (win_x - 0.05, win_y - win_w/2 - 0.15, win_z + 0.1),
            (0.02, 0.25, win_h + 0.3), mat_curtain)
    add_box("Curtain_R", (win_x - 0.05, win_y + win_w/2 + 0.15, win_z + 0.1),
            (0.02, 0.25, win_h + 0.3), mat_curtain)


def import_glb(filename, location=(0, 0, 0), rotation=(0, 0, 0), scale=1.0):
    """Import a GLB file and position it."""
    filepath = os.path.join(ASSET_DIR, filename)
    if not os.path.exists(filepath):
        print(f"WARNING: {filename} not found, skipping")
        return None

    # Track existing objects
    existing = set(bpy.data.objects.keys())

    bpy.ops.import_scene.gltf(filepath=filepath)

    # Find newly imported objects
    new_objs = [bpy.data.objects[name] for name in bpy.data.objects.keys() if name not in existing]

    if not new_objs:
        print(f"WARNING: No objects imported from {filename}")
        return None

    # Create empty parent for grouping
    parent = bpy.data.objects.new(f"Asset_{filename}", None)
    bpy.context.collection.objects.link(parent)
    parent.location = location
    parent.rotation_euler = rotation
    parent.scale = (scale, scale, scale)

    for obj in new_objs:
        obj.parent = parent

    print(f"  ✓ Imported {filename} → {len(new_objs)} objects at {location}")
    return parent


def build_furniture():
    """Import and place furniture from Kenney GLBs."""
    # Scale factor — Kenney models are quite small
    S = 2.0

    # ─── Bed (back-left area) ───
    import_glb("bedDouble.glb",
               location=(-ROOM_W/2 + 0.8, -ROOM_D/2 + 0.6, 0),
               rotation=(0, 0, 0), scale=S)

    # ─── Pillows on bed ───
    import_glb("pillow.glb",
               location=(-ROOM_W/2 + 0.8, -ROOM_D/2 + 0.35, 0.55),
               rotation=(0, 0, 0), scale=S * 0.8)

    # ─── Nightstand next to bed ───
    import_glb("cabinetBedDrawerTable.glb",
               location=(-ROOM_W/2 + 0.3, -ROOM_D/2 + 1.3, 0),
               rotation=(0, 0, 0), scale=S)

    # ─── Desk lamp on nightstand ───
    import_glb("lampRoundTable.glb",
               location=(-ROOM_W/2 + 0.3, -ROOM_D/2 + 1.3, 0.5),
               rotation=(0, 0, 0), scale=S)

    # ─── Desk against back wall (right side) ───
    import_glb("desk.glb",
               location=(ROOM_W/2 - 0.8, -ROOM_D/2 + 0.4, 0),
               rotation=(0, 0, 0), scale=S)

    # ─── Chair at desk ───
    import_glb("chairCushion.glb",
               location=(ROOM_W/2 - 0.8, -ROOM_D/2 + 0.9, 0),
               rotation=(0, 0, math.radians(180)), scale=S)

    # ─── Books on desk ───
    import_glb("books.glb",
               location=(ROOM_W/2 - 0.5, -ROOM_D/2 + 0.35, 0.75),
               rotation=(0, 0, 0), scale=S)

    # ─── Laptop on desk ───
    import_glb("laptop.glb",
               location=(ROOM_W/2 - 0.9, -ROOM_D/2 + 0.4, 0.75),
               rotation=(0, 0, 0), scale=S)

    # ─── Bookcase on left wall ───
    import_glb("bookcaseOpen.glb",
               location=(-ROOM_W/2 + 0.3, 0.5, 0),
               rotation=(0, 0, math.radians(90)), scale=S)

    # ─── Rug in center ───
    import_glb("rugRound.glb",
               location=(0, 0, 0.01),
               rotation=(0, 0, 0), scale=S * 1.3)

    # ─── Bear plushie on floor ───
    import_glb("bear.glb",
               location=(0.3, 0.5, 0),
               rotation=(0, 0, math.radians(-30)), scale=S * 0.8)

    # ─── Floor lamp corner ───
    import_glb("lampRoundFloor.glb",
               location=(-ROOM_W/2 + 0.3, ROOM_D/2 - 0.3, 0),
               rotation=(0, 0, 0), scale=S)

    # ─── Plant ───
    import_glb("pottedPlant.glb",
               location=(ROOM_W/2 - 0.3, ROOM_D/2 - 0.3, 0),
               rotation=(0, 0, 0), scale=S)

    # ─── Couch / bench with cushion ───
    import_glb("benchCushion.glb",
               location=(0, ROOM_D/2 - 0.5, 0),
               rotation=(0, 0, math.radians(180)), scale=S)


def setup_lighting():
    """Set up warm, anime-style lighting."""
    # Key light — warm sunlight through window
    bpy.ops.object.light_add(type='SUN', location=(3, 0, 4))
    sun = bpy.context.active_object
    sun.name = "Sun_Key"
    sun.data.energy = 3.0
    sun.data.color = (1.0, 0.95, 0.8)
    sun.rotation_euler = (math.radians(50), math.radians(20), math.radians(-30))
    sun.data.angle = math.radians(5)  # Soft shadows

    # Fill light — cool bounce from left
    bpy.ops.object.light_add(type='AREA', location=(-2, 1, 2))
    fill = bpy.context.active_object
    fill.name = "Fill_Left"
    fill.data.energy = 50
    fill.data.color = (0.9, 0.92, 1.0)
    fill.data.size = 2.0
    fill.rotation_euler = (math.radians(60), 0, math.radians(45))

    # Window area light — warm golden glow from right
    bpy.ops.object.light_add(type='AREA',
                              location=(ROOM_W/2 - 0.1, 0, 1.6))
    win_light = bpy.context.active_object
    win_light.name = "Window_AreaLight"
    win_light.data.energy = 150
    win_light.data.color = (1.0, 0.93, 0.75)
    win_light.data.size = 1.2
    win_light.data.size_y = 1.4
    win_light.rotation_euler = (0, math.radians(-90), 0)

    # Warm ambient / bounce from floor
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.1))
    bounce = bpy.context.active_object
    bounce.name = "Floor_Bounce"
    bounce.data.energy = 20
    bounce.data.color = (1.0, 0.9, 0.7)
    bounce.data.size = ROOM_W
    bounce.data.size_y = ROOM_D
    bounce.rotation_euler = (0, 0, 0)

    # Desk lamp point light
    bpy.ops.object.light_add(type='POINT',
                              location=(ROOM_W/2 - 0.8, -ROOM_D/2 + 0.4, 1.2))
    desk_light = bpy.context.active_object
    desk_light.name = "DeskLamp_Point"
    desk_light.data.energy = 30
    desk_light.data.color = (1.0, 0.95, 0.85)
    desk_light.data.shadow_soft_size = 0.3

    # Nightstand lamp warm glow
    bpy.ops.object.light_add(type='POINT',
                              location=(-ROOM_W/2 + 0.3, -ROOM_D/2 + 1.3, 0.8))
    night_light = bpy.context.active_object
    night_light.name = "NightLamp_Point"
    night_light.data.energy = 15
    night_light.data.color = (1.0, 0.85, 0.6)
    night_light.data.shadow_soft_size = 0.2

    # Set world background to warm gradient
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.05, 0.04, 0.06, 1.0)
        bg.inputs["Strength"].default_value = 0.5


def setup_camera(angle_name="front", idx=0):
    """Set up camera for a specific angle."""
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 28  # Wide-angle for room interior
    cam_obj = bpy.data.objects.new(f"Camera_{angle_name}", cam_data)
    bpy.context.collection.objects.link(cam_obj)

    angles = {
        "front": {
            "loc": (0, ROOM_D/2 + 0.5, 1.6),
            "rot": (math.radians(80), 0, math.radians(180))
        },
        "corner": {
            "loc": (ROOM_W/2 - 0.3, ROOM_D/2 - 0.3, 2.0),
            "rot": (math.radians(65), 0, math.radians(135))
        },
        "desk": {
            "loc": (ROOM_W/2 - 0.2, -ROOM_D/2 + 1.5, 1.4),
            "rot": (math.radians(75), 0, math.radians(120))
        },
        "bed": {
            "loc": (-ROOM_W/2 + 1.5, -ROOM_D/2 + 2.0, 1.3),
            "rot": (math.radians(80), 0, math.radians(-150))
        },
        "top_down": {
            "loc": (0, 0, 4.5),
            "rot": (0, 0, 0)
        }
    }

    cfg = angles.get(angle_name, angles["front"])
    cam_obj.location = cfg["loc"]
    cam_obj.rotation_euler = cfg["rot"]

    return cam_obj


def setup_render():
    """Configure render settings — EEVEE for fast preview, Cycles for final."""
    scene = bpy.context.scene

    # Use EEVEE for fast iteration (switch to CYCLES for final bake)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.film_transparent = False

    # EEVEE settings for better quality
    if hasattr(scene, 'eevee'):
        eevee = scene.eevee
        # Shadows
        if hasattr(eevee, 'use_soft_shadows'):
            eevee.use_soft_shadows = True
        # Screen Space Reflections
        if hasattr(eevee, 'use_ssr'):
            eevee.use_ssr = True
        # Ambient Occlusion
        if hasattr(eevee, 'use_gtao'):
            eevee.use_gtao = True
        # Bloom
        if hasattr(eevee, 'use_bloom'):
            eevee.use_bloom = True
            eevee.bloom_threshold = 0.8
            eevee.bloom_intensity = 0.3


def render_angle(angle_name):
    """Render from a specific angle."""
    cam = setup_camera(angle_name)
    bpy.context.scene.camera = cam
    output_path = os.path.join(RENDER_DIR, f"room_{angle_name}.png")
    bpy.context.scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
    print(f"  ✓ Rendered {angle_name} → {output_path}")
    return output_path


def export_glb():
    """Export scene as GLB for Three.js."""
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_GLB,
        export_format='GLB',
        use_selection=False,
        export_cameras=False,
        export_lights=True,
        export_apply=True,
    )
    size_mb = os.path.getsize(EXPORT_GLB) / (1024 * 1024)
    print(f"  ✓ Exported GLB → {EXPORT_GLB} ({size_mb:.1f} MB)")


# ─── Main ─────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  Blender Scene Builder — Cozy Anime Bedroom")
    print("=" * 60)

    print("\n[1/6] Clearing scene...")
    clear_scene()

    print("\n[2/6] Building room shell...")
    build_room_shell()
    build_window()

    print("\n[3/6] Importing furniture...")
    build_furniture()

    print("\n[4/6] Setting up lighting...")
    setup_lighting()

    print("\n[5/6] Configuring render...")
    setup_render()

    print("\n[6/6] Rendering previews...")
    for angle in ["front", "corner", "desk", "bed", "top_down"]:
        render_angle(angle)

    print("\n[BONUS] Exporting GLB...")
    export_glb()

    print("\n" + "=" * 60)
    print("  DONE! Check /tmp/blender-room/")
    print("=" * 60)


if __name__ == "__main__":
    main()
