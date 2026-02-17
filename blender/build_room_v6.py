"""
v6 — Cycles + Bloom Compositing + BRIGHTER pastel colors
Key fixes:
- Cycles renderer (64 samples, GPU Metal, denoiser)
- Compositor bloom node (Cycles doesn't have built-in bloom)
- MUCH brighter material colors — force pastel
- Pink blanket with saturated color
- More small items filling space
- Warmer world color
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

def sphere(nm, loc, rad, mt, sc=(1,1,1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, location=loc, segments=24, ring_count=16)
    o = bpy.context.active_object; o.name = nm; o.scale = sc
    if mt: o.data.materials.append(mt)
    return o

def cyl(nm, loc, rad, dep, mt, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=rad, depth=dep, location=loc)
    o = bpy.context.active_object; o.name = nm; o.rotation_euler = rot
    if mt: o.data.materials.append(mt)
    return o

def glb(fn, loc=(0,0,0), rot=(0,0,0), sc=1.0):
    fp = os.path.join(ASSET_DIR, fn)
    if not os.path.exists(fp): return None
    ex = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=fp)
    nw = [bpy.data.objects[n] for n in bpy.data.objects.keys() if n not in ex]
    if not nw: return None
    p = bpy.data.objects.new(f"A_{fn}", None)
    bpy.context.collection.objects.link(p)
    p.location = loc; p.rotation_euler = rot; p.scale = (sc,sc,sc)
    for o in nw: o.parent = p
    return p


# ═══════ BUILD SCENE ═══════
def build_all():
    hw, hd = STAGE_W/2, STAGE_D/2

    # ── STAGE SHELL — BRIGHT pastel ──
    m_fl = mat("Floor", (0.88, 0.78, 0.63, 1), 0.35)  # warm light wood
    m_wl = mat("Wall", (1.0, 0.98, 0.96, 1), 0.8)
    m_ac = mat("Accent", (1.0, 0.92, 0.95, 1), 0.8)  # SATURATED pink wall

    box("Floor", (0,0,-0.025), (STAGE_W+0.3, STAGE_D+0.3, 0.05), m_fl)
    box("WBack", (0,-hd,STAGE_H/2), (STAGE_W, 0.08, STAGE_H), m_ac)
    # Only back wall + left wall — no right wall to prevent camera clipping
    box("WLeft", (-hw,0,STAGE_H/2), (0.08, STAGE_D, STAGE_H), m_wl)

    m_bb = mat("BB", (0.75, 0.63, 0.48, 1), 0.4)
    box("BB_B", (0,-hd+0.045,0.04), (STAGE_W, 0.02, 0.08), m_bb)
    box("BB_L", (-hw+0.045,0,0.04), (0.02, STAGE_D, 0.08), m_bb)
    m_cr = mat("Cr", (0.98, 0.96, 0.93, 1), 0.5)
    box("CR_B", (0,-hd+0.045,STAGE_H-0.03), (STAGE_W, 0.03, 0.06), m_cr)

    # ── WINDOW ──
    m_wf = mat("WF", (0.88, 0.82, 0.72, 1), 0.3)
    m_wg = emit_mat("WG", (1.0, 0.97, 0.88, 1), 8.0)
    wx,wy,wz = 1.3, -hd+0.03, 1.5
    ww,wh = 1.1, 1.4
    box("WG", (wx,wy,wz), (ww, 0.02, wh), m_wg)
    for n,l,d in [("T",(wx,wy,wz+wh/2),(ww+.1,.04,.045)),("B",(wx,wy,wz-wh/2),(ww+.1,.04,.045)),
                   ("L",(wx-ww/2,wy,wz),(.045,.04,wh)),("R",(wx+ww/2,wy,wz),(.045,.04,wh)),
                   ("CH",(wx,wy,wz),(ww,.04,.025)),("CV",(wx,wy,wz),(.025,.04,wh))]:
        box(f"WF{n}", l, d, m_wf)
    m_cu = mat("Curt", (0.97, 0.85, 0.89, 1), 0.95)
    box("CuL", (wx-ww/2-.2,wy+.04,wz+.15), (.3,.03,wh+.35), m_cu)
    box("CuR", (wx+ww/2+.2,wy+.04,wz+.15), (.3,.03,wh+.35), m_cu)

    # ── BED — SATURATED PINK blanket ──
    m_bf = mat("BedF", (0.78, 0.65, 0.50, 1), 0.4)
    m_mt = mat("Matt", (0.98, 0.96, 0.94, 1), 0.8)
    m_bl = mat("Blanket", (1.0, 0.65, 0.75, 1), 0.85)  # BRIGHT PINK!
    m_bl2 = mat("BlFold", (0.95, 0.55, 0.68, 1), 0.85)  # darker pink fold

    bx, by = -0.8, -hd+1.0
    rbox("BBase", (bx,by,0.15), (1.05,2.0,0.30), m_bf, 0.02)
    rbox("HBoard", (bx,by-0.95,0.60), (1.1,0.08,0.90), m_bf, 0.04)
    rbox("FBoard", (bx,by+0.95,0.30), (1.05,0.06,0.35), m_bf, 0.02)
    rbox("Mattress", (bx,by+0.05,0.36), (0.95,1.82,0.14), m_mt, 0.05)
    rbox("Blanket", (bx,by+0.20,0.46), (0.92,1.3,0.14), m_bl, 0.05)  # THICKER
    rbox("BlFold", (bx,by+0.88,0.44), (0.90,0.14,0.18), m_bl2, 0.04)  # BIGGER fold

    # Pillows — rectangular, soft
    m_pw = mat("PW", (1.0, 0.97, 0.95, 1), 0.9)
    m_pb = mat("PB", (0.85, 0.90, 0.98, 1), 0.9)
    m_pp = mat("PP", (0.98, 0.82, 0.88, 1), 0.9)
    rbox("P1", (bx-0.25,by-0.65,0.50), (0.35,0.25,0.10), m_pw, 0.04)
    rbox("P2", (bx+0.20,by-0.60,0.49), (0.30,0.22,0.09), m_pb, 0.04, rot=(0,0,math.radians(8)))
    rbox("PC", (bx+0.0,by-0.40,0.48), (0.18,0.18,0.08), m_pp, 0.035)

    # ── DESK ──
    m_dt = mat("DT", (0.93, 0.88, 0.82, 1), 0.35)
    m_dl = mat("DL", (0.80, 0.72, 0.62, 1), 0.3, 0.1)
    dx, dy = hw-1.0, -hd+0.4
    rbox("DT", (dx,dy,0.72), (1.15,0.55,0.04), m_dt, 0.015)
    for lx,ly in [(-0.52,-0.22),(0.52,-0.22),(-0.52,0.22),(0.52,0.22)]:
        rbox("DLg", (dx+lx,dy+ly,0.36), (0.04,0.04,0.72), m_dl, 0.008)

    m_cs = mat("CS", (0.96, 0.82, 0.86, 1), 0.85)
    rbox("CS", (dx,dy+0.75,0.42), (0.38,0.38,0.08), m_cs, 0.04)
    for lx,ly in [(-0.14,-0.14),(0.14,-0.14),(-0.14,0.14),(0.14,0.14)]:
        box("CL", (dx+lx,dy+0.75+ly,0.20), (0.025,0.025,0.40), m_dl)
    rbox("CB", (dx,dy+0.55,0.65), (0.36,0.04,0.30), m_cs, 0.02)

    glb("laptop.glb", loc=(dx-0.2,dy-0.02,0.74), sc=1.8)
    glb("books.glb", loc=(dx+0.35,dy-0.05,0.74), sc=1.8)
    # Pink mug
    cyl("Mug", (dx+0.4,dy+0.15,0.78), 0.03, 0.08, mat("Mug", (0.96,0.82,0.86,1), 0.4, 0.05))
    # Desk lamp glow
    m_lg = emit_mat("DLG", (1.0,0.95,0.82,1), 10.0)
    cyl("DLB", (dx-0.45,dy-0.05,0.76), 0.03, 0.04, m_dl)
    cyl("DLA", (dx-0.45,dy-0.05,0.92), 0.008, 0.28, mat("DLS",(0.90,0.85,0.78,1),0.6))
    sphere("DLG", (dx-0.45,dy-0.05,1.08), 0.05, m_lg, (1.2,1.2,0.8))

    # ── BOOKSHELF ──
    sx, sy = -hw+0.20, -0.3
    m_sh = mat("Sh", (0.75, 0.62, 0.48, 1), 0.4)
    sw, sd, sh = 0.75, 0.25, 1.5
    rbox("SL", (sx,sy-sw/2,sh/2), (sd,0.025,sh), m_sh, 0.008, rot=(0,0,math.radians(90)))
    rbox("SR", (sx,sy+sw/2,sh/2), (sd,0.025,sh), m_sh, 0.008, rot=(0,0,math.radians(90)))
    box("SBk", (sx-sd/2+0.01,sy,sh/2), (0.02,sw,sh), m_sh)
    for sz in [0.0,0.38,0.75,1.12,1.50]:
        rbox(f"SB{sz}", (sx,sy,sz), (sd,sw,0.02), m_sh, 0.005)
    colors = [(0.90,0.40,0.50,1),(0.40,0.60,0.85,1),(0.50,0.80,0.55,1),
              (0.95,0.80,0.40,1),(0.75,0.50,0.80,1),(0.40,0.75,0.75,1),
              (0.95,0.60,0.45,1),(0.60,0.55,0.85,1),(0.85,0.70,0.55,1)]
    for si,sz in enumerate([0.02,0.40,0.77]):
        for j in range(6):
            c = colors[(j+si*3)%len(colors)]
            rbox(f"Bk{si}{j}", (sx,sy-sw/2+0.06+j*0.10,sz+0.14), (0.025+(j%3)*0.008, 0.17, 0.22+(j%4)*0.04), mat(f"B{si}{j}",c,0.7), 0.004)
    glb("pottedPlant.glb", loc=(sx,sy+0.1,1.52), sc=1.0)

    # ── CENTER ──
    m_rg = mat("Rug", (0.96, 0.86, 0.90, 1), 0.95)
    bpy.ops.mesh.primitive_cylinder_add(radius=1.4, depth=0.015, location=(0.2,0.4,0.008))
    r = bpy.context.active_object; r.name = "Rug"; r.scale = (1.0,0.8,1.0)
    r.data.materials.append(m_rg)

    m_ct = mat("CT", (0.85,0.75,0.60,1), 0.35)
    rbox("CT", (0.2,0.4,0.22), (0.55,0.40,0.04), m_ct, 0.015)
    for lx,ly in [(-0.22,-0.15),(0.22,-0.15),(-0.22,0.15),(0.22,0.15)]:
        rbox("CTL", (0.2+lx,0.4+ly,0.10), (0.03,0.03,0.20), m_ct, 0.008)

    cyl("Cup", (0.30,0.35,0.27), 0.025, 0.05, mat("Cup",(0.97,0.97,0.95,1),0.3,0.05))
    cyl("Sauc", (0.30,0.35,0.245), 0.04, 0.008, mat("Sauc",(0.97,0.97,0.95,1),0.3))

    glb("bear.glb", loc=(0.55,0.7,0.01), rot=(0,0,math.radians(-25)), sc=1.8)

    m_sl = mat("Sl", (0.97,0.80,0.85,1), 0.9)
    rbox("SL1", (-0.3,0.2,0.02), (0.08,0.18,0.04), m_sl, 0.015, rot=(0,0,math.radians(15)))
    rbox("SL2", (-0.15,0.18,0.02), (0.08,0.18,0.04), m_sl, 0.015, rot=(0,0,math.radians(5)))

    # ── DECORATIONS ──
    m_fr = mat("PF", (0.85,0.78,0.68,1), 0.3)
    for i,(loc,dim,col) in enumerate([
        ((-0.8,-hd+0.04,1.8),(0.40,0.02,0.30),(0.78,0.88,0.96,1)),
        ((-0.25,-hd+0.04,1.9),(0.28,0.02,0.38),(0.96,0.88,0.85,1)),
        ((0.3,-hd+0.04,1.75),(0.22,0.02,0.22),(0.90,0.94,0.82,1))]):
        rbox(f"Fr{i}", loc, dim, m_fr, 0.008)
        box(f"Pi{i}", (loc[0],loc[1]+0.015,loc[2]), (dim[0]-0.06,0.01,dim[2]-0.06), mat(f"P{i}",col,0.8))

    # Fairy lights — STRONG emission
    m_fb = emit_mat("FB", (1.0,0.92,0.70,1), 25.0)
    m_fp = emit_mat("FP", (1.0,0.80,0.85,1), 20.0)
    for i in range(20):
        x = -hw+0.3+i*(STAGE_W-0.6)/19
        z = STAGE_H-0.12+math.sin(i*0.7)*0.06
        sphere(f"F{i}", (x,-hd+0.08,z), 0.02, m_fb if i%3!=0 else m_fp)

    # Floor lamp
    m_lb = mat("FLB",(0.72,0.64,0.52,1),0.3,0.2)
    cyl("FLP", (hw-0.4,0.9,0.65), 0.015, 1.3, m_lb)
    cyl("FLBs", (hw-0.4,0.9,0.02), 0.10, 0.03, m_lb)
    cyl("FLS", (hw-0.4,0.9,1.35), 0.12, 0.20, mat("FLSh",(0.97,0.93,0.87,1),0.7))
    sphere("FLG", (hw-0.4,0.9,1.35), 0.09, emit_mat("FLE",(1.0,0.92,0.75,1),12.0))

    # Nightstand
    rbox("NS", (-hw+0.35,-hd+0.35,0.22), (0.35,0.35,0.44), mat("NS",(0.78,0.68,0.55,1),0.4), 0.02)
    glb("lampRoundTable.glb", loc=(-hw+0.35,-hd+0.35,0.46), sc=1.6)
    sphere("NLG", (-hw+0.35,-hd+0.35,0.62), 0.07, emit_mat("NLG",(1.0,0.85,0.60,1),15.0))
    rbox("Clk", (-hw+0.50,-hd+0.30,0.47), (0.06,0.04,0.05), mat("Clk",(0.88,0.88,0.90,1),0.3,0.1), 0.008)

    glb("pottedPlant.glb", loc=(hw-0.3,-hd+0.3,0), sc=1.8)

    # Moon on left wall
    cyl("Moon", (-hw+0.04,-0.5,2.0), 0.10, 0.01, emit_mat("Moon",(0.95,0.92,0.80,1),5.0), rot=(0,math.radians(90),0))
    for i,(dy,dz) in enumerate([(-0.2,2.2),(0.1,2.3),(-0.6,2.1),(0.3,1.9)]):
        sphere(f"St{i}", (-hw+0.04,dy,dz), 0.02, emit_mat(f"St{i}",(1.0,0.95,0.80,1),6.0))

    # ── EXTRA items to fill space ──
    # Small basket near bookshelf
    m_bsk = mat("Bask", (0.82,0.72,0.58,1), 0.6)
    cyl("Bask", (-hw+0.5,0.5,0.08), 0.12, 0.16, m_bsk)

    # Extra cushion on floor near rug
    m_fc = mat("FlCush", (0.92,0.75,0.80,1), 0.9)
    rbox("FlCush", (0.6,0.1,0.04), (0.25,0.25,0.08), m_fc, 0.04, rot=(0,0,math.radians(20)))

    # Small photo stand on coffee table
    m_ps = mat("PhoSt", (0.80,0.72,0.60,1), 0.3, 0.1)
    rbox("PhoSt", (0.05,0.45,0.27), (0.08,0.01,0.10), m_ps, 0.005)
    box("PhoImg", (0.05,0.455,0.27), (0.065,0.005,0.085), mat("PI",(0.90,0.82,0.85,1),0.8))


# ═══════ LIGHTING ═══════
def build_lighting():
    hw, hd = STAGE_W/2, STAGE_D/2

    # Key sun — MUCH brighter for visibility
    bpy.ops.object.light_add(type='SUN', location=(4,2,5))
    s = bpy.context.active_object; s.name = "Key"
    s.data.energy = 6.0; s.data.color = (1.0,0.94,0.82)
    s.rotation_euler = (math.radians(50),math.radians(-20),math.radians(30))
    s.data.angle = math.radians(12)

    # Window area light — MUCH brighter (hero light source)
    bpy.ops.object.light_add(type='AREA', location=(1.3,-hd+0.3,1.5))
    w = bpy.context.active_object; w.name = "WinA"
    w.data.energy = 350; w.data.color = (1.0,0.95,0.82)
    w.data.size = 1.1; w.data.size_y = 1.4
    w.rotation_euler = (math.radians(90),0,0)

    # Nightstand lamp — warm glow
    bpy.ops.object.light_add(type='POINT', location=(-hw+0.35,-hd+0.35,0.80))
    n = bpy.context.active_object; n.name = "NP"
    n.data.energy = 120; n.data.color = (1.0,0.82,0.55); n.data.shadow_soft_size = 0.5

    # Floor lamp
    bpy.ops.object.light_add(type='POINT', location=(hw-0.4,0.9,1.4))
    f = bpy.context.active_object; f.name = "FP"
    f.data.energy = 90; f.data.color = (1.0,0.90,0.70); f.data.shadow_soft_size = 0.3

    # Desk spot — brighter
    bpy.ops.object.light_add(type='SPOT', location=(hw-1.45,-hd+0.35,1.15))
    d = bpy.context.active_object; d.name = "DS"
    d.data.energy = 120; d.data.color = (1.0,0.95,0.85)
    d.data.spot_size = math.radians(50); d.data.spot_blend = 0.6
    d.rotation_euler = (math.radians(70),0,math.radians(10))

    # Front fill — big area for even illumination
    bpy.ops.object.light_add(type='AREA', location=(2,4,2.5))
    ff = bpy.context.active_object; ff.name = "FF"
    ff.data.energy = 150; ff.data.color = (1.0,0.97,0.94)
    ff.data.size = 3.0; ff.data.size_y = 2.0
    ff.rotation_euler = (math.radians(120),0,math.radians(-15))

    # Fairy light glow from ceiling
    bpy.ops.object.light_add(type='AREA', location=(0,-hd+0.3,STAGE_H-0.15))
    fg = bpy.context.active_object; fg.name = "FG"
    fg.data.energy = 60; fg.data.color = (1.0,0.92,0.75)
    fg.data.size = STAGE_W*0.7; fg.data.size_y = 0.3
    fg.rotation_euler = (math.radians(90),0,0)

    # Floor bounce — warm uplight
    bpy.ops.object.light_add(type='AREA', location=(0,0,0.05))
    fb = bpy.context.active_object; fb.name = "FBounce"
    fb.data.energy = 40; fb.data.color = (1.0,0.93,0.80)
    fb.data.size = STAGE_W*0.6; fb.data.size_y = STAGE_D*0.6

    # Warmer, brighter world ambient
    world = bpy.data.worlds["World"]
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.25,0.20,0.28,1)
        bg.inputs["Strength"].default_value = 0.8


# ═══════ COMPOSITOR BLOOM ═══════
def setup_compositor_bloom():
    """Add bloom via compositor nodes (since Cycles has no built-in bloom)."""
    scene = bpy.context.scene
    scene.use_nodes = True
    # In Blender 5.0, compositor nodes may use different API
    if not hasattr(scene, 'node_tree') or scene.node_tree is None:
        print("  ⚠ Compositor node_tree not available, skipping bloom")
        return
    tree = scene.node_tree
    links = tree.links

    # Clear default
    for n in tree.nodes: tree.nodes.remove(n)

    # Input/Output
    rl = tree.nodes.new("CompositorNodeRLayers")
    comp = tree.nodes.new("CompositorNodeComposite")
    viewer = tree.nodes.new("CompositorNodeViewer")

    # Glare for bloom
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = 'FOG_GLOW'
    glare.threshold = 0.5
    glare.quality = 'HIGH'
    glare.size = 7

    # Mix (add bloom on top)
    mix = tree.nodes.new("CompositorNodeMixRGB")
    mix.blend_type = 'ADD'
    mix.inputs["Fac"].default_value = 0.3

    links.new(rl.outputs["Image"], glare.inputs["Image"])
    links.new(rl.outputs["Image"], mix.inputs[1])
    links.new(glare.outputs["Image"], mix.inputs[2])
    links.new(mix.outputs["Image"], comp.inputs["Image"])
    links.new(mix.outputs["Image"], viewer.inputs["Image"])


# ═══════ RENDER ═══════
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

    setup_compositor_bloom()

    hw, hd = STAGE_W/2, STAGE_D/2
    angles = {
        "main": ((1.2,hd+2.8,1.7), (math.radians(76),0,math.radians(168)), 32),
        "wide": ((0,hd+3.5,2.5), (math.radians(65),0,math.radians(180)), 28),
        "bed": ((-0.8,0.8,1.1), (math.radians(82),0,math.radians(200)), 35),
        "desk": ((hw+0.3,0,1.2), (math.radians(82),0,math.radians(110)), 35),
    }

    # Skip renders — just export GLB

    g = os.path.join(OUTPUT_DIR, "cozy-bedroom-v6.glb")
    bpy.ops.export_scene.gltf(filepath=g, export_format='GLB',
                               use_selection=False, export_cameras=False,
                               export_lights=True, export_apply=True)
    print(f"  ✓ GLB → {os.path.getsize(g)/1024/1024:.1f} MB")


def main():
    print("="*50)
    print("  v6 — Cycles + Bloom + Bright Pastel")
    print("="*50)
    clear_scene()
    build_all()
    build_lighting()
    render()
    print("DONE ✓")


if __name__ == "__main__":
    main()
