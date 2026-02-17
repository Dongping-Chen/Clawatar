"""
Swimming Pool v5 — MAJOR REBUILD
- Pool moved to negative Y (in front of character)
- Clear pool visibility, deck tiles, loungers, towels, umbrella
- Emissive pool + edge lights + brighter party globes
- Palm tree + bar cart
- Night sky retained
- GLB export only
"""

import bpy
import math
import os
import random

OUTPUT_DIR = "/tmp/blender-room"
STAGE_W = 12.0
STAGE_D = 12.0
STAGE_H = 5.0

os.makedirs(OUTPUT_DIR, exist_ok=True)
random.seed(42)


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


def emit_mat(name, color, strength=5.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def tile_mat(name, color1, color2, scale=8.0, roughness=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = roughness
    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    checker = nodes.new("ShaderNodeTexChecker")
    checker.inputs["Color1"].default_value = color1
    checker.inputs["Color2"].default_value = color2
    links.new(texcoord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], checker.inputs["Vector"])
    links.new(checker.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def stripe_mat(name, color1, color2, scale=12.0, roughness=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = roughness
    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    checker = nodes.new("ShaderNodeTexChecker")
    checker.inputs["Color1"].default_value = color1
    checker.inputs["Color2"].default_value = color2
    links.new(texcoord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], checker.inputs["Vector"])
    links.new(checker.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
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


def build_pool_area():
    deck_color1 = (0.63, 0.45, 0.34, 1)
    deck_color2 = (0.58, 0.40, 0.30, 1)
    m_deck = tile_mat("DeckTile", deck_color1, deck_color2, scale=10.0, roughness=0.9)

    deck_thk = 0.06
    z_deck = -deck_thk / 2

    pool_w, pool_d, pool_depth = 6.0, 3.0, 1.2
    pool_cx, pool_cy = 0.0, -3.5
    p_left = pool_cx - pool_w / 2
    p_right = pool_cx + pool_w / 2
    p_front = pool_cy - pool_d / 2
    p_back = pool_cy + pool_d / 2

    # Deck pieces (frame around pool)
    # Front strip
    box("Deck_Front", (0, -5.5, z_deck), (STAGE_W, 1.0, deck_thk), m_deck)
    # Back strip
    box("Deck_Back", (0, 2.0, z_deck), (STAGE_W, 8.0, deck_thk), m_deck)
    # Left strip
    box("Deck_Left", (-4.5, pool_cy, z_deck), (3.0, pool_d, deck_thk), m_deck)
    # Right strip
    box("Deck_Right", (4.5, pool_cy, z_deck), (3.0, pool_d, deck_thk), m_deck)

    # Pool interior
    m_tile = mat("PoolTile", (0.18, 0.55, 0.78, 1), 0.25)
    m_tile_floor = mat("PoolTileFloor", (0.12, 0.45, 0.70, 1), 0.25)

    box("PoolFloor", (pool_cx, pool_cy, -pool_depth), (pool_w, pool_d, 0.05), m_tile_floor)
    box("PoolWall_Front", (pool_cx, p_front, -pool_depth / 2), (pool_w, 0.08, pool_depth), m_tile)
    box("PoolWall_Back", (pool_cx, p_back, -pool_depth / 2), (pool_w, 0.08, pool_depth), m_tile)
    box("PoolWall_Left", (p_left, pool_cy, -pool_depth / 2), (0.08, pool_d, pool_depth), m_tile)
    box("PoolWall_Right", (p_right, pool_cy, -pool_depth / 2), (0.08, pool_d, pool_depth), m_tile)

    # Coping / edge
    m_cop = mat("Coping", (0.92, 0.88, 0.82, 1), 0.4)
    ew = 0.15
    box("Coping_F", (pool_cx, p_front - ew / 2, 0.02), (pool_w + ew * 2, ew, 0.06), m_cop)
    box("Coping_B", (pool_cx, p_back + ew / 2, 0.02), (pool_w + ew * 2, ew, 0.06), m_cop)
    box("Coping_L", (p_left - ew / 2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)
    box("Coping_R", (p_right + ew / 2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)

    # Water surface (emissive turquoise)
    m_water = emit_mat("WaterGlow", (0.08, 0.78, 0.88, 1), 15.0)
    box("Water", (pool_cx, pool_cy, -0.05), (pool_w - 0.2, pool_d - 0.2, 0.04), m_water)

    # Pool edge lights (emissive cubes)
    m_edge = emit_mat("EdgeLight", (0.15, 0.85, 0.95, 1), 20.0)
    light_positions = [
        (p_left + 0.3, p_front + 0.2),
        (p_right - 0.3, p_front + 0.2),
        (p_left + 0.3, p_back - 0.2),
        (p_right - 0.3, p_back - 0.2),
        (p_left + 0.2, pool_cy),
        (p_right - 0.2, pool_cy),
    ]
    for i, (lx, ly) in enumerate(light_positions):
        box(f"EdgeLight{i}", (lx, ly, 0.08), (0.08, 0.08, 0.08), m_edge)



def build_loungers():
    m_lounger = mat("Lounger", (0.95, 0.93, 0.90, 1), 0.6)
    m_towel_blue = mat("TowelBlue", (0.60, 0.80, 0.95, 1), 0.9)
    m_towel_pink = mat("TowelPink", (0.95, 0.70, 0.80, 1), 0.9)

    tilt = math.radians(-15)
    for i, (lx, ly) in enumerate([(-2.0, -3.0), (2.0, -3.0)]):
        # Base lounger
        rbox(f"Lounger{i}", (lx, ly, 0.30), (0.70, 1.80, 0.08), m_lounger, 0.02, rot=(tilt, 0, 0))
        # Back rest
        rbox(
            f"LoungerBack{i}",
            (lx, ly + 0.65, 0.55),
            (0.70, 0.25, 0.12),
            m_lounger,
            0.02,
            rot=(tilt, 0, 0),
        )

        # Towel
        tmat = m_towel_blue if i == 0 else m_towel_pink
        rbox(f"Towel{i}", (lx, ly - 0.3, 0.40), (0.45, 0.35, 0.02), tmat, 0.01)



def build_umbrella():
    m_pole = mat("UmbrellaPole", (0.75, 0.72, 0.68, 1), 0.4, 0.2)
    m_canopy = stripe_mat("UmbrellaCanopy", (0.95, 0.30, 0.35, 1), (0.98, 0.98, 0.98, 1), scale=14.0)
    ux, uy = 2.5, -4.0

    cyl("UmbrellaPole", (ux, uy, 1.2), 0.03, 2.4, m_pole)
    bpy.ops.mesh.primitive_cone_add(radius1=1.1, radius2=0.05, depth=0.35, location=(ux, uy, 2.45))
    c = bpy.context.active_object
    c.name = "UmbrellaCanopy"
    c.data.materials.append(m_canopy)



def build_palm_tree():
    m_trunk = mat("PalmTrunk", (0.18, 0.12, 0.08, 1), 0.8)
    m_leaf = mat("PalmLeaf", (0.10, 0.35, 0.15, 1), 0.8)
    tx, ty = -5.2, -5.2

    cyl("PalmTrunk", (tx, ty, 1.4), 0.10, 2.8, m_trunk)
    for i, (dx, dy, dz, sc) in enumerate([
        (0.0, 0.0, 2.8, (1.3, 1.0, 0.4)),
        (0.3, -0.2, 2.6, (1.0, 1.2, 0.4)),
        (-0.3, 0.2, 2.7, (1.1, 1.0, 0.4)),
    ]):
        sphere(f"PalmLeaf{i}", (tx + dx, ty + dy, dz), 0.6, m_leaf, sc)



def build_bar_cart():
    m_wood = mat("CartWood", (0.45, 0.28, 0.18, 1), 0.8)
    m_bottle_g = mat("BottleG", (0.12, 0.55, 0.25, 1), 0.3, 0.1)
    m_bottle_b = mat("BottleB", (0.15, 0.25, 0.65, 1), 0.3, 0.1)
    m_glass = mat("Glass", (0.90, 0.95, 0.98, 1), 0.1, 0.0)

    cx, cy = -4.5, -1.3
    # Table top
    rbox("CartTop", (cx, cy, 0.75), (0.8, 0.4, 0.05), m_wood, 0.02)
    # Legs
    for dx in [-0.35, 0.35]:
        for dy in [-0.15, 0.15]:
            rbox("CartLeg", (cx + dx, cy + dy, 0.38), (0.05, 0.05, 0.7), m_wood, 0.01)
    # Bottles
    cyl("Bottle1", (cx - 0.15, cy + 0.05, 0.88), 0.06, 0.28, m_bottle_g)
    cyl("Bottle2", (cx + 0.15, cy - 0.05, 0.88), 0.05, 0.26, m_bottle_b)
    cyl("GlassCup", (cx, cy + 0.15, 0.86), 0.04, 0.16, m_glass)



def build_party_globes():
    orb_colors = [
        (1.00, 0.60, 0.20, 1),  # orange
        (0.98, 0.45, 0.70, 1),  # pink
        (1.00, 0.85, 0.25, 1),  # yellow
        (0.98, 0.98, 0.98, 1),  # white
        (1.00, 0.70, 0.45, 1),  # warm peach
    ]
    orb_positions = [
        (-3.0, -2.6, 2.2),
        (3.0, -2.6, 2.2),
        (-2.0, -4.7, 2.2),
        (2.0, -4.7, 2.2),
        (0.0, -3.6, 2.6),
    ]
    for i, (ox, oy, oz) in enumerate(orb_positions):
        m_orb = emit_mat(f"PartyOrbMat{i}", orb_colors[i % len(orb_colors)], 45.0)
        sphere(f"PartyOrb{i}", (ox, oy, oz), 0.25, m_orb)


def build_sky():
    # Night sky panel
    m_sky = mat("Sky", (0.02, 0.03, 0.08, 1), 1.0)
    box("Sky", (0, 6.5, 2.5), (STAGE_W + 6, 0.02, 5.0), m_sky)

    # Moon
    m_moon = emit_mat("Moon", (0.95, 0.95, 0.88, 1), 24.0)
    sphere("Moon", (2.0, 6.2, 3.8), 0.35, m_moon)
    # Moon halo
    m_halo = emit_mat("Halo", (0.65, 0.70, 0.85, 1), 4.0)
    sphere("Halo", (2.0, 6.1, 3.8), 0.70, m_halo, (1.0, 0.3, 1.0))

    # Stars
    m_star = emit_mat("Star", (0.95, 0.95, 1.0, 1), 12.0)
    for i in range(35):
        sx = random.uniform(-STAGE_W / 2 - 1.5, STAGE_W / 2 + 1.5)
        sz = random.uniform(2.0, 4.5)
        sphere(f"Star{i}", (sx, 6.0, sz), random.uniform(0.01, 0.025), m_star)


def build_lighting():
    # Moonlight
    bpy.ops.object.light_add(type='SUN', location=(3, 5, 6))
    s = bpy.context.active_object
    s.name = "MoonLight"
    s.data.energy = 1.4
    s.data.color = (0.60, 0.70, 1.0)
    s.rotation_euler = (math.radians(55), math.radians(15), math.radians(-20))
    s.data.angle = math.radians(8)

    # Pool glow (subtle)
    bpy.ops.object.light_add(type='POINT', location=(0, -3.5, -0.4))
    p = bpy.context.active_object
    p.name = "PoolGlow"
    p.data.energy = 60
    p.data.color = (0.12, 0.75, 0.90)
    p.data.shadow_soft_size = 1.0

    # Party orb lights
    orb_lights = [
        (-3.0, -2.6, 2.2),
        (3.0, -2.6, 2.2),
        (-2.0, -4.7, 2.2),
        (2.0, -4.7, 2.2),
        (0.0, -3.6, 2.6),
    ]
    for i, (lx, ly, lz) in enumerate(orb_lights):
        bpy.ops.object.light_add(type='POINT', location=(lx, ly, lz))
        o = bpy.context.active_object
        o.name = f"PartyLight{i}"
        o.data.energy = 80
        o.data.color = (1.0, 0.85, 0.75)
        o.data.shadow_soft_size = 1.2

    # Soft front fill
    bpy.ops.object.light_add(type='POINT', location=(0, 3.5, 2.0))
    f = bpy.context.active_object
    f.name = "FrontFill"
    f.data.energy = 20
    f.data.color = (0.70, 0.80, 1.0)
    f.data.shadow_soft_size = 2.0

    # World background
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.03, 0.04, 0.08, 1)
        bg.inputs["Strength"].default_value = 0.25



def export_glb():
    g = os.path.join(OUTPUT_DIR, "swimming-pool.glb")
    bpy.ops.export_scene.gltf(
        filepath=g,
        export_format='GLB',
        use_selection=False,
        export_cameras=False,
        export_lights=True,
        export_apply=True,
    )
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("=" * 50)
    print("  Swimming Pool v5 — MAJOR REBUILD")
    print("=" * 50)
    clear_scene()
    build_pool_area()
    build_loungers()
    build_umbrella()
    build_palm_tree()
    build_bar_cart()
    build_party_globes()
    build_sky()
    build_lighting()
    export_glb()
    print("DONE ✓")


if __name__ == "__main__":
    main()
