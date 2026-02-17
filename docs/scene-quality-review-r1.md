# Scene Quality Review — Round 1 (Pre-Pipeline)
Grand Average: 4.7/10

## System-Level Fixes Applied
1. Toon gradient: 3-step [80,160,255] → 5-step [40,80,140,200,255] for visible cel-shading
2. Floor material: MeshStandardMaterial → MeshToonMaterial (consistent with walls)
3. Bright preset: clinical white → warm-bright (#fff8ee, #fff5e0)
4. Camera: pulled forward, look at center not back wall
5. CSS overlays: particles-canvas + animated-bg hidden in scene mode

## Per-Scene Issues (to be fixed by pipeline)
- Bedroom: 5.0 — sparse, flat lighting, front cam empty
- Study: 4.9 — rug blends with floor, dark floor, Minecraft feel
- Living Room: 5.3 — best layout, particle artifacts, flat lighting
- Kitchen: 4.6 — bar blocks character, clinical lighting
- Bathroom: 3.7 — overexposed, too small, cold palette, washer doesn't belong

## Next: Pipeline will regenerate all scenes with these fixes in the renderer
