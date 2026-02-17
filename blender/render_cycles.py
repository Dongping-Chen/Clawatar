"""
Quick Cycles render of v5 scene — just swap renderer and re-render main angle.
Cycles has MUCH better lighting (global illumination, proper emission, etc.)
"""
import bpy
import math
import os
import sys

# First run v5 to build the scene
exec(open("/Users/dongpingchen/.openclaw/workspace/vrm-viewer/blender/build_room_v5.py").read().replace(
    "render()\n    print(\"DONE", "# skip render\n    print(\"SCENE BUILT"
))

# Now override with Cycles
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'GPU'
scene.cycles.samples = 64  # low for speed
scene.cycles.use_denoising = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080

# Enable Metal GPU
prefs = bpy.context.preferences.addons.get('cycles')
if prefs:
    try:
        prefs.preferences.compute_device_type = 'METAL'
        prefs.preferences.get_devices()
        for device in prefs.preferences.devices:
            device.use = True
        print(f"GPU devices: {[d.name for d in prefs.preferences.devices]}")
    except:
        print("GPU setup failed, using CPU")

hw, hd = 5.5/2, 4.0/2

# Render main angle
cd = bpy.data.cameras.new("CyclesCam")
cd.lens = 32
co = bpy.data.objects.new("CyclesCam", cd)
bpy.context.collection.objects.link(co)
co.location = (1.2, hd+2.8, 1.7)
co.rotation_euler = (math.radians(76), 0, math.radians(168))
scene.camera = co

scene.render.filepath = "/tmp/blender-room/v5_cycles_main.png"
bpy.ops.render.render(write_still=True)
print("✓ Cycles render done!")
