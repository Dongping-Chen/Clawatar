"""
Swimming Pool v6 — DETAIL + TEXTURE + TREES + BETTER LIGHTING
- Wavy water surface (displace)
- Checkerboard deck tiles (real geometry)
- Multiple palm trees
- Pool fence + infrastructure
- Deck lights + edge lights (no floating globes)
- Background building + more stars + larger moon
- Umbrella striped wedges
- Lounger cushions + side table + towel drape
- GLB export only
"""

import bpy
import math
import mathutils
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


def mat_alpha(name, color, alpha=0.3, roughness=0.4, metallic=0.0):
    m = mat(name, color, roughness, metallic)
    b = m.node_tree.nodes.get("Principled BSDF")
    if b:
        b.inputs["Alpha"].default_value = alpha
    # Blender 5.0+: use surface_render_method if available, else blend_method
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'BLENDED'
    elif hasattr(m, 'blend_method'):
        m.blend_method = 'BLEND'
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


def wavy_water_plane(name, loc, size_x, size_y, mt, strength=0.04):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size_x, size_y, 1)
    bpy.ops.object.transform_apply(scale=True)

    sub = o.modifiers.new("Subsurf", 'SUBSURF')
    sub.levels = 4
    sub.render_levels = 4

    tex = bpy.data.textures.new("WaterNoise", type='CLOUDS')
    tex.noise_scale = 0.6
    disp = o.modifiers.new("Displace", 'DISPLACE')
    disp.texture = tex
    disp.strength = strength

    bpy.ops.object.modifier_apply(modifier="Subsurf")
    bpy.ops.object.modifier_apply(modifier="Displace")

    if mt:
        o.data.materials.append(mt)
    return o


def build_pool_area():
    # Deck tiles (checkerboard geometry)
    tile_a = (0.824, 0.412, 0.118, 1)  # terracotta #D2691E
    tile_b = (0.871, 0.722, 0.529, 1)  # sandstone #DEB887
    m_tile_a = mat("DeckTileA", tile_a, 0.9)
    m_tile_b = mat("DeckTileB", tile_b, 0.9)

    deck_thk = 0.06
    z_deck = -deck_thk / 2

    pool_w, pool_d, pool_depth = 6.0, 3.0, 1.2
    pool_cx, pool_cy = 0.0, -3.5
    p_left = pool_cx - pool_w / 2
    p_right = pool_cx + pool_w / 2
    p_front = pool_cy - pool_d / 2
    p_back = pool_cy + pool_d / 2

    tile_size = 0.3
    x_start = -STAGE_W / 2 + tile_size / 2
    y_start = -STAGE_D / 2 + tile_size / 2
    tiles_x = int(STAGE_W / tile_size)
    tiles_y = int(STAGE_D / tile_size)
    margin = 0.3

    for i in range(tiles_x):
        for j in range(tiles_y):
            x = x_start + i * tile_size
            y = y_start + j * tile_size
            if (abs(x - pool_cx) < pool_w / 2 + margin) and (abs(y - pool_cy) < pool_d / 2 + margin):
                continue
            m_use = m_tile_a if (i + j) % 2 == 0 else m_tile_b
            box(f"DeckTile_{i}_{j}", (x, y, z_deck), (tile_size, tile_size, deck_thk), m_use)

    # Pool interior
    m_pool_wall = mat("PoolTile", (0.18, 0.55, 0.78, 1), 0.25)
    m_pool_floor = mat("PoolTileFloor", (0.12, 0.45, 0.70, 1), 0.25)

    box("PoolFloor", (pool_cx, pool_cy, -pool_depth), (pool_w, pool_d, 0.05), m_pool_floor)
    box("PoolWall_Front", (pool_cx, p_front, -pool_depth / 2), (pool_w, 0.08, pool_depth), m_pool_wall)
    box("PoolWall_Back", (pool_cx, p_back, -pool_depth / 2), (pool_w, 0.08, pool_depth), m_pool_wall)
    box("PoolWall_Left", (p_left, pool_cy, -pool_depth / 2), (0.08, pool_d, pool_depth), m_pool_wall)
    box("PoolWall_Right", (p_right, pool_cy, -pool_depth / 2), (0.08, pool_d, pool_depth), m_pool_wall)

    # Coping / edge
    m_cop = mat("Coping", (0.92, 0.88, 0.82, 1), 0.4)
    ew = 0.15
    box("Coping_F", (pool_cx, p_front - ew / 2, 0.02), (pool_w + ew * 2, ew, 0.06), m_cop)
    box("Coping_B", (pool_cx, p_back + ew / 2, 0.02), (pool_w + ew * 2, ew, 0.06), m_cop)
    box("Coping_L", (p_left - ew / 2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)
    box("Coping_R", (p_right + ew / 2, pool_cy, 0.02), (ew, pool_d, 0.06), m_cop)

    # Water surface (wavy emissive)
    m_water = emit_mat("WaterGlow", (0.08, 0.78, 0.88, 1), 8.0)
    wavy_water_plane("Water", (pool_cx, pool_cy, -0.05), pool_w - 0.2, pool_d - 0.2, m_water, strength=0.04)

    # Pool edge lights (emissive cubes)
    m_edge = emit_mat("EdgeLight", (0.15, 0.85, 0.95, 1), 12.0)
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
    m_cushion = mat("LoungerCushion", (0.90, 0.88, 0.85, 1), 0.55)
    m_towel_blue = mat("TowelBlue", (0.60, 0.80, 0.95, 1), 0.9)
    m_table = mat("SideTable", (0.65, 0.62, 0.58, 1), 0.4, 0.1)

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
        # Cushion
        rbox(
            f"LoungerCushion{i}",
            (lx, ly, 0.36),
            (0.66, 1.65, 0.06),
            m_cushion,
            0.02,
            rot=(tilt, 0, 0),
        )

        # Towel (one lounger, draped end)
        if i == 0:
            rbox("TowelMain", (lx, ly - 0.30, 0.42), (0.45, 0.35, 0.02), m_towel_blue, 0.01, rot=(tilt, 0, 0))
            rbox(
                "TowelDrape",
                (lx, ly - 0.50, 0.38),
                (0.45, 0.18, 0.02),
                m_towel_blue,
                0.01,
                rot=(tilt - math.radians(8), 0, 0),
            )

    # Side table between loungers
    cyl("SideTableStem", (0.0, -3.0, 0.35), 0.05, 0.70, m_table)
    cyl("SideTableTop", (0.0, -3.0, 0.72), 0.35, 0.04, m_table)


def build_umbrella():
    m_pole = mat("UmbrellaPole", (0.75, 0.72, 0.68, 1), 0.4, 0.2)
    m_seg_a = mat("UmbrellaSegA", (0.98, 0.98, 0.98, 1), 0.6)
    m_seg_b = mat("UmbrellaSegB", (0.25, 0.45, 0.85, 1), 0.6)
    ux, uy = 2.5, -4.0

    cyl("UmbrellaPole", (ux, uy, 1.2), 0.03, 2.4, m_pole)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=1.1, radius2=0.05, depth=0.35, location=(ux, uy, 2.45))
    c = bpy.context.active_object
    c.name = "UmbrellaCanopy"
    c.data.materials.append(m_seg_a)
    c.data.materials.append(m_seg_b)
    side_i = 0
    for poly in c.data.polygons:
        if poly.normal.z < -0.5:
            poly.material_index = 0
        else:
            poly.material_index = side_i % 2
            side_i += 1


def palm_tree_at(tx, ty):
    m_trunk = mat("PalmTrunk", (0.20, 0.12, 0.07, 1), 0.8)
    m_leaf = mat("PalmLeaf", (0.10, 0.35, 0.15, 1), 0.8)
    m_coconut = mat("Coconut", (0.25, 0.15, 0.08, 1), 0.8)

    trunk_h = 2.5
    cyl("PalmTrunk", (tx, ty, trunk_h / 2), 0.08, trunk_h, m_trunk)

    top_z = trunk_h
    for i in range(6):
        ang = i * (math.tau / 6.0)
        rot = (math.radians(60), 0, ang)
        leaf = box(
            f"PalmLeaf_{tx:.1f}_{ty:.1f}_{i}",
            (tx, ty, top_z + 0.2),
            (0.05, 0.9, 0.02),
            m_leaf,
            rot=rot,
        )
        leaf.location.x += math.cos(ang) * 0.25
        leaf.location.y += math.sin(ang) * 0.25

    for i, (dx, dy) in enumerate([(0.06, 0.02), (-0.06, -0.02), (0.0, 0.08)]):
        sphere(f"Coconut_{tx:.1f}_{ty:.1f}_{i}", (tx + dx, ty + dy, top_z + 0.05), 0.08, m_coconut)


def build_palm_trees():
    palm_positions = [(-5.0, -5.0), (5.0, -5.0), (-5.0, 1.0)]
    for tx, ty in palm_positions:
        palm_tree_at(tx, ty)


def build_fence():
    m_post = mat("FencePost", (0.35, 0.35, 0.38, 1), 0.4, 0.2)
    m_glass = mat_alpha("FenceGlass", (0.85, 0.88, 0.92, 1), alpha=0.3, roughness=0.1)

    y_fence = 2.6
    x_start = -5.5
    x_end = 5.5
    spacing = 0.8
    post_h = 1.0

    x = x_start
    idx = 0
    while x <= x_end + 0.001:
        cyl(f"FencePost{idx}", (x, y_fence, post_h / 2), 0.02, post_h, m_post)
        idx += 1
        x += spacing

    # Rails
    rail_len = x_end - x_start
    box("FenceRailLow", ((x_start + x_end) / 2, y_fence, 0.30), (rail_len, 0.03, 0.03), m_post)
    box("FenceRailHigh", ((x_start + x_end) / 2, y_fence, 0.90), (rail_len, 0.03, 0.03), m_post)

    # Glass panels between posts
    x = x_start + spacing / 2
    panel_w = spacing - 0.05
    for i in range(int(rail_len / spacing)):
        box(f"FencePanel{i}", (x, y_fence + 0.01, 0.55), (panel_w, 0.01, 0.5), m_glass)
        x += spacing


def build_deck_lights():
    m_pole = mat("DeckLightPole", (0.18, 0.18, 0.20, 1), 0.4, 0.3)
    m_lamp = emit_mat("DeckLamp", (1.0, 0.90, 0.75, 1), 25.0)

    for i, (lx, ly) in enumerate([(-4.0, 1.2), (0.0, 1.2), (4.0, 1.2)]):
        cyl(f"DeckLightPole{i}", (lx, ly, 0.35), 0.04, 0.7, m_pole)
        sphere(f"DeckLightLamp{i}", (lx, ly, 0.78), 0.10, m_lamp)


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


def build_background():
    # Night sky panel
    m_sky = mat("Sky", (0.02, 0.03, 0.08, 1), 1.0)
    box("Sky", (0, 6.5, 2.5), (STAGE_W + 6, 0.02, 5.0), m_sky)

    # Building silhouette
    m_build = mat("Building", (0.08, 0.08, 0.10, 1), 1.0)
    box("HotelBase", (0.0, 4.8, 1.5), (8.0, 1.0, 3.0), m_build)
    box("HotelTower1", (-3.0, 4.8, 2.5), (2.0, 1.0, 5.0), m_build)
    box("HotelTower2", (3.0, 4.8, 2.0), (2.5, 1.0, 4.0), m_build)

    # Windows
    m_win = emit_mat("Window", (1.0, 0.85, 0.55, 1), 6.0)
    for ix in range(-3, 4, 2):
        for iz in [1.0, 1.6, 2.2]:
            box(f"Win_{ix}_{iz}", (ix, 4.25, iz), (0.4, 0.02, 0.2), m_win)

    # Moon (larger)
    m_moon = emit_mat("Moon", (0.95, 0.95, 0.88, 1), 24.0)
    sphere("Moon", (2.0, 6.2, 3.8), 0.50, m_moon)
    # Moon halo
    m_halo = emit_mat("Halo", (0.65, 0.70, 0.85, 1), 4.0)
    sphere("Halo", (2.0, 6.1, 3.8), 0.85, m_halo, (1.0, 0.3, 1.0))

    # Stars
    m_star = emit_mat("Star", (0.95, 0.95, 1.0, 1), 12.0)
    for i in range(80):
        sx = random.uniform(-STAGE_W / 2 - 1.5, STAGE_W / 2 + 1.5)
        sz = random.uniform(2.0, 4.8)
        sphere(f"Star{i}", (sx, 6.0, sz), random.uniform(0.01, 0.025), m_star)


def build_lighting():
    # Moonlight
    bpy.ops.object.light_add(type='SUN', location=(3, 5, 6))
    s = bpy.context.active_object
    s.name = "MoonLight"
    s.data.energy = 1.2
    s.data.color = (0.60, 0.70, 1.0)
    s.rotation_euler = (math.radians(55), math.radians(15), math.radians(-20))
    s.data.angle = math.radians(8)

    # Pool glow (subtle)
    bpy.ops.object.light_add(type='POINT', location=(0, -3.5, -0.4))
    p = bpy.context.active_object
    p.name = "PoolGlow"
    p.data.energy = 40
    p.data.color = (0.12, 0.75, 0.90)
    p.data.shadow_soft_size = 1.0

    # Spotlights behind camera aimed at pool
    spot_positions = [(-2.5, 6.0, 3.0), (0.0, 6.0, 3.2), (2.5, 6.0, 3.0)]
    target = mathutils.Vector((0.0, -3.5, 1.0))
    for i, pos in enumerate(spot_positions):
        bpy.ops.object.light_add(type='SPOT', location=pos)
        l = bpy.context.active_object
        l.name = f"PoolSpot{i}"
        l.data.energy = 120
        l.data.color = (1.0, 0.95, 0.9)
        l.data.spot_size = math.radians(60)
        l.data.spot_blend = 0.3
        direction = target - mathutils.Vector(pos)
        l.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

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
    print("  Swimming Pool v6 — DETAIL + TEXTURE + TREES")
    print("=" * 50)
    clear_scene()
    build_pool_area()
    build_loungers()
    build_umbrella()
    build_palm_trees()
    build_fence()
    build_deck_lights()
    build_bar_cart()
    build_background()
    build_lighting()
    export_glb()
    print("DONE ✓")


if __name__ == "__main__":
    main()
