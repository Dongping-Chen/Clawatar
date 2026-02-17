# AI-Driven 3D Scene Generation: State of the Art (2024–2026)

*Research Report — February 2026*

---

## Executive Summary

AI-driven 3D scene generation has matured rapidly since 2023. The field has converged on a dominant paradigm: **LLMs as scene architects** that output structured descriptions (scene graphs, JSON, or code), combined with **large 3D asset databases** (primarily Objaverse with 10M+ objects) and **constraint solvers** for layout optimization. Key findings:

1. **Holodeck** (Allen AI, CVPR 2024) is the most complete open-source system: GPT-4 generates spatial constraints → DFS solver places Objaverse assets in AI2-THOR.
2. **SceneCraft** (2024) takes the code-generation approach: LLM writes Blender Python scripts with up to 100 assets, using scene graphs and iterative VLM refinement.
3. **The JSON scene description + pre-made assets approach is the practical winner** for web/real-time use cases. All major systems essentially do this.
4. **glTF/GLB is the de facto standard** for web 3D. USD is gaining in production pipelines but has poor web support.
5. **The anime/stylized asset gap is real** — Objaverse has some stylized content, but curated asset packs or AI-generated stylized models (Meshy, Tripo) are needed.
6. **For our VRM + Three.js project**: a hybrid approach of curated GLB asset library + LLM-generated JSON layouts is the most practical path.

---

## 1. How AI Agents Generate 3D Scenes

### 1.1 LLM-Based Scene Layout (The Dominant Paradigm)

The core pattern across nearly all recent work:

```
Text Prompt → LLM (GPT-4/Claude) → Structured Scene Description → Layout Solver → 3D Rendering
```

| System | LLM Output | Layout Method | Renderer | Year |
|--------|-----------|---------------|----------|------|
| **Holodeck** | Spatial constraints (JSON) | DFS/MILP solver | AI2-THOR (Unity) | 2024 |
| **SceneCraft** | Blender Python scripts | Scene graph → numeric constraints | Blender | 2024 |
| **RoboGen** | Task + scene descriptions | Procedural placement | Isaac Gym | 2023 |
| **ProcTHOR** | N/A (procedural rules) | Sampling-based | AI2-THOR (Unity) | 2022 |
| **SceneDiffuser** | N/A (diffusion model) | Diffusion-based optimization | 3D scan scenes | 2023 |

#### Holodeck (Allen AI, CVPR 2024)
The most mature open system. Pipeline:
1. GPT-4 selects a **floor plan** (room types, sizes, doorways)
2. GPT-4 selects **objects** from Objaverse with semantic search
3. GPT-4 generates **spatial relational constraints** ("desk against wall", "chair in front of desk")
4. DFS solver optimizes layout satisfying all constraints
5. Scene rendered in AI2-THOR

Key insight: LLMs have strong commonsense about room layouts. The constraint-based approach handles the "where to place things" problem elegantly.

- Paper: https://arxiv.org/abs/2312.09067
- Code: https://github.com/allenai/Holodeck

#### SceneCraft (2024)
LLM agent that writes Blender Python code:
1. Generates a **scene graph** blueprint with spatial relationships
2. Translates to Python scripts with numerical constraints
3. Uses GPT-V to **visually inspect** renders and iteratively refine
4. **Library learning**: accumulates reusable script functions over time

Handles up to 100 assets per scene. More flexible than constraint-based approaches but requires Blender (not real-time).

- Paper: https://arxiv.org/abs/2403.01248

#### RoboGen (2023)
Focused on robotics training:
1. LLM **proposes tasks** ("pick up the cup from the table")
2. LLM generates scene descriptions with relevant objects
3. Populates simulation (Isaac Gym) with assets
4. Decomposes tasks into sub-tasks, selects learning method (RL, motion planning, trajectory optimization)

- Paper: https://arxiv.org/abs/2311.01455

### 1.2 Procedural Generation with AI Guidance

#### ProcTHOR (Allen AI, NeurIPS 2022 — Outstanding Paper)
Pure procedural generation (no LLM):
- Sampling-based house generation compatible with AI2-THOR
- Generates diverse, interactive 3D houses
- Used to train embodied AI agents at scale
- `pip install procthor` — simple Python API

Key lesson: procedural + randomization alone can produce huge diversity for training, but lacks semantic control.

- Code: https://github.com/allenai/procthor

### 1.3 Diffusion-Based Approaches

#### SceneDiffuser (CVPR 2023)
Uses conditional diffusion models for:
- Scene-conditioned human pose generation
- Path planning in 3D environments
- Goal-oriented motion synthesis

Not really scene *generation* — more about generating agent behavior *within* scenes. But represents the diffusion approach to spatial reasoning.

- Code: https://github.com/scenediffuser/Scene-Diffuser

### 1.4 Text-to-3D Object Generation (Single Objects)
For individual objects rather than full scenes:
- **Score Distillation Sampling** (DreamFusion, 2022) — optimize NeRF using 2D diffusion
- **Multi-view diffusion** (Zero123, ViewDiff, 2023-2024) — generate consistent multi-view images → reconstruct 3D
- **Feed-forward models** (2024-2025) — single-pass 3D generation in seconds (what Meshy/Tripo use)

---

## 2. Tools & Frameworks

### 2.1 Simulation Platforms

| Platform | Organization | Format | Web Support | Key Feature |
|----------|-------------|--------|-------------|-------------|
| **AI2-THOR** | Allen AI | Unity | No | Interactive household objects, physics |
| **Habitat** | Meta | Custom | No | Fast rendering, real scanned scenes |
| **iGibson** | Stanford | Custom | No | Photorealistic, deformable objects |
| **Isaac Sim** | NVIDIA | USD | No | Physics-accurate robotics sim |
| **Three.js** | Community | glTF/GLB | **Yes** | Web-native, huge ecosystem |
| **Babylon.js** | Microsoft | glTF/GLB | **Yes** | Web-native, editor tools |

### 2.2 Web-Based 3D Scene Tools

For our Three.js use case, relevant tools:
- **Three.js Editor** — built-in scene editor, exports JSON scene format
- **react-three-fiber (R3F)** — React wrapper for Three.js, declarative scene composition
- **Drei** — R3F helpers (Environment, Stage, etc.)
- **three-stdlib** — extended Three.js utilities
- **Spline** — visual 3D design tool that exports to web
- **PlayCanvas** — web-first game engine with editor

### 2.3 Key Observation
No existing framework combines "LLM scene generation" with "web-based Three.js rendering" out of the box. This is a gap we'd fill.

---

## 3. Asset Sourcing

### 3.1 Major 3D Asset Libraries

| Library | Size | Format | License | Style | Quality |
|---------|------|--------|---------|-------|---------|
| **Objaverse-XL** | 10M+ | GLB | Mixed (CC) | Mixed | Variable (many low-quality) |
| **Objaverse 1.0** | 800K | GLB | CC-BY | Mixed | Better curated |
| **ShapeNet** | 51K | OBJ | Research | Neutral/CAD | Clean topology |
| **3D-FRONT** | 18K rooms | Custom | Research | Interior design | High (professional) |
| **Google Scanned Objects** | 1K | GLB | CC-BY | Photorealistic | Very high |
| **Sketchfab** | Millions | GLB/FBX | Mixed | All styles | Variable |
| **Poly Haven** | 1K+ | GLB/FBX | CC0 | Photorealistic | Very high |

### 3.2 Asset Standardization Challenges
All systems face these issues:
- **Scale inconsistency**: A "chair" might be 0.01m or 100m in raw assets
- **Orientation**: No standard for forward/up direction
- **Origin point**: Some centered, some at base, some random
- **Quality variance**: Objaverse ranges from AAA to broken meshes

**How Holodeck handles it**: They use `objathor` to process Objaverse assets — normalizing scale, adding annotations, computing bounding boxes. Heavy pre-processing pipeline.

### 3.3 Format Wars: glTF/GLB Wins for Web

| Format | Web Support | Ecosystem | Animation | Status |
|--------|------------|-----------|-----------|--------|
| **glTF/GLB** | ✅ Native Three.js | Huge | ✅ Skeletal + morph | **Web standard** |
| **USD** | ❌ Poor | Growing (NVIDIA) | ✅ | Production/VFX standard |
| **FBX** | ⚠️ Via loaders | Legacy | ✅ | Declining |
| **OBJ** | ⚠️ Basic | Legacy | ❌ | Static meshes only |
| **VRM** | ✅ Via @pixiv/three-vrm | Niche | ✅ Humanoid | Avatar standard |

**Verdict**: glTF/GLB is the clear winner for web. VRM (which is glTF-based) fits perfectly.

---

## 4. Commercial & Startup Landscape

### 4.1 Text/Image → 3D Model (Single Object)

| Company | Product | Speed | Quality | API | Anime Style? | Pricing |
|---------|---------|-------|---------|-----|-------------|---------|
| **Meshy.ai** | Text/Image→3D | ~30s | Good | ✅ REST API | ⚠️ Possible | Free tier + paid |
| **Tripo3D** | Text/Image→3D | ~10s | Good | ✅ | ⚠️ Limited | Free tier + paid |
| **CSM.ai** | Image→3D | ~1min | High | ✅ | ❌ Realistic focus | Paid |
| **Luma AI** | Primarily video now | N/A | High | ✅ | ❌ | Paid |
| **Rodin (Microsoft)** | Text→3D | ~30s | High | Limited | ⚠️ | Research |

### 4.2 Environment / Skybox Generation

| Company | Product | Output | Web Integration |
|---------|---------|--------|----------------|
| **Blockade Labs** | Skybox AI | 360° HDRI/skybox | Yes, Three.js compatible |
| **Kaedim** | Image→3D mesh | GLB | API available |

### 4.3 "Natural Language → Full 3D Scene" Startups
This space is still early. No dominant commercial player yet:
- **Holodeck** (open-source, research) is the closest
- **World Labs** (Fei-Fei Li's startup, 2024) — building "Large World Models" for spatial intelligence, but not publicly available yet
- **Odyssey** — AI world generation, focused on games
- Various game studios using internal LLM-based level design tools

### 4.4 Key Trend
The market is split: **single-object generation** is commoditized (Meshy, Tripo work well). **Full scene generation** remains a research problem without strong commercial solutions. This is an opportunity.

---

## 5. Recommendations for VRM Avatar + Three.js Project

### 5.1 Recommended Architecture

```
User Request ("cozy bedroom")
        ↓
   LLM (Claude/GPT)
        ↓
   JSON Scene Description
   {
     "room": { "width": 5, "depth": 4, "height": 2.8 },
     "walls": { "color": "#f5e6d3" },
     "floor": { "material": "wood" },
     "objects": [
       { "id": "bed", "asset": "anime_bed_01", "position": [2.5, 0, 3], "rotation": [0, 0, 0] },
       { "id": "desk", "asset": "anime_desk_01", "position": [0.5, 0, 1], "rotation": [0, 90, 0] },
       ...
     ],
     "lighting": { "ambient": 0.3, "mainLight": { "position": [2, 3, 2], "intensity": 0.8 } }
   }
        ↓
   Three.js Scene Loader
   (loads GLB assets, positions them, sets up lighting)
        ↓
   Rendered Scene with VRM Avatar
```

### 5.2 Why JSON + Pre-made Assets is the Best Approach

1. **Performance**: Pre-made GLB assets are optimized. AI-generated meshes are often heavy/broken.
2. **Style consistency**: You control the aesthetic. AI generation produces inconsistent styles.
3. **Reliability**: No API calls needed at render time. Scene loads instantly from cached assets.
4. **LLM strength**: LLMs are great at *selecting and arranging* objects, less great at *creating* 3D geometry.
5. **Proven pattern**: This is exactly what Holodeck does (LLM selects + arranges from asset library).

### 5.3 Handling the Anime/Stylized Asset Gap

This is the biggest challenge. Options ranked by practicality:

1. **Curate from existing sources** (BEST SHORT-TERM)
   - Sketchfab: filter by "anime" or "stylized" + CC license
   - Objaverse: search for anime-style furniture (exists but sparse)
   - Booth.pm: Japanese VRM/3D market (anime style native, but licensing varies)
   - Unity Asset Store: anime interior packs exist, convert to GLB

2. **Use Meshy/Tripo with style prompts** (GOOD FOR EXPANDING LIBRARY)
   - Generate with prompts like "anime style wooden desk, cel shaded, low poly"
   - Quality varies — needs manual QA and cleanup
   - Good for filling gaps in your curated library
   - Cost: ~$0.01-0.10 per model via API

3. **Commission/create a base asset pack** (BEST LONG-TERM)
   - 30-50 core furniture pieces in consistent anime style
   - Consistent scale, origin, materials
   - One-time cost, reusable forever
   - Consider: Fiverr 3D artists, or use Blender + AI-assisted texturing

4. **Hybrid: simple geometry + anime textures** (CREATIVE SHORTCUT)
   - Basic box/cylinder geometry for furniture shapes
   - Apply anime-style textures/materials (toon shading, outlines)
   - Three.js `MeshToonMaterial` + custom textures
   - Fast to implement, surprisingly effective for anime aesthetic

### 5.4 Practical Implementation Plan

**Phase 1: Minimum Viable Rooms (1-2 weeks)**
- Create 5 room templates (bedroom, living room, kitchen, office, café)
- 20-30 curated GLB assets (furniture, decorations)
- Simple JSON format for scene description
- Three.js loader that reads JSON → places assets
- LLM prompt that generates valid JSON for these rooms

**Phase 2: LLM-Powered Generation (1-2 weeks)**
- Claude/GPT function calling to generate room JSON
- Constraint validation (no overlapping objects, objects on floor, against walls)
- Multiple room styles/moods (cozy, modern, messy, clean)
- Dynamic lighting based on time of day

**Phase 3: Asset Expansion (Ongoing)**
- Expand asset library via Meshy API for missing items
- User-uploaded assets
- Community asset sharing

### 5.5 Scene Description Schema (Proposed)

```typescript
interface SceneDescription {
  meta: {
    name: string;
    mood: string;        // "cozy" | "modern" | "cluttered" | etc.
    timeOfDay: string;   // affects lighting
  };
  room: {
    shape: "rectangular" | "l-shaped";
    dimensions: { width: number; depth: number; height: number };
    walls: { color: string; material?: string };
    floor: { material: string; color?: string };
    ceiling: { material: string; color?: string };
  };
  windows: Array<{
    wall: "north" | "south" | "east" | "west";
    position: [number, number]; // x, y on wall
    size: [number, number];
  }>;
  objects: Array<{
    assetId: string;          // maps to GLB file
    category: string;         // "furniture" | "decoration" | "appliance"
    position: [number, number, number];
    rotation: [number, number, number]; // euler degrees
    scale?: number;           // uniform scale multiplier
  }>;
  lighting: {
    ambient: { color: string; intensity: number };
    directional?: { position: [number, number, number]; intensity: number; color: string };
    points?: Array<{ position: [number, number, number]; color: string; intensity: number }>;
  };
  skybox?: string;            // Blockade Labs skybox or HDRI
  avatarSpawn: {
    position: [number, number, number];
    facing: [number, number, number];
  };
}
```

---

## 6. Comparison Table: Approaches for Our Use Case

| Approach | Effort | Quality | Style Control | Performance | Recommendation |
|----------|--------|---------|--------------|-------------|----------------|
| **JSON + curated GLB assets** | Medium | High | Full | ✅ Fast | **✅ PRIMARY** |
| **LLM generates Three.js code** | High | Variable | Partial | ✅ Fast | ⚠️ Fragile |
| **AI-generate all assets on-the-fly** | Low | Low-Medium | Poor | ❌ Slow | ❌ Not yet ready |
| **Port Holodeck to web** | Very High | High | Limited | ❌ Heavy | ❌ Overkill |
| **Gaussian splat scenes** | Medium | Photorealistic | None (anime?) | ⚠️ | ❌ Wrong aesthetic |
| **Skybox-only (360° image)** | Low | Good | Partial | ✅ Fast | ⚠️ Supplementary only |

---

## 7. Key Links & Resources

### Papers
- Holodeck: https://arxiv.org/abs/2312.09067
- SceneCraft: https://arxiv.org/abs/2403.01248
- ProcTHOR: https://procthor.allenai.org/
- RoboGen: https://arxiv.org/abs/2311.01455
- SceneDiffuser: https://arxiv.org/abs/2301.06015

### Code Repos
- Holodeck: https://github.com/allenai/Holodeck
- ProcTHOR: https://github.com/allenai/procthor
- Objaverse: https://github.com/allenai/objaverse-xl
- SceneDiffuser: https://github.com/scenediffuser/Scene-Diffuser

### Asset Libraries
- Objaverse-XL (10M+): https://objaverse.allenai.org/
- ShapeNet: https://shapenet.org/
- 3D-FRONT: https://tianchi.aliyun.com/specials/promotion/alibaba-3d-scene-dataset
- Poly Haven (free HDRI/models): https://polyhaven.com/
- Sketchfab (searchable): https://sketchfab.com/
- Booth.pm (anime 3D): https://booth.pm/

### Commercial APIs
- Meshy: https://meshy.ai (API docs: https://docs.meshy.ai)
- Tripo3D: https://www.tripo3d.ai/
- Blockade Labs Skybox: https://skybox.blockadelabs.com/
- Luma AI: https://lumalabs.ai/

### Three.js Ecosystem
- Three.js: https://threejs.org/
- @pixiv/three-vrm: https://github.com/pixiv/three-vrm
- react-three-fiber: https://github.com/pmndrs/react-three-fiber
- drei (R3F helpers): https://github.com/pmndrs/drei

---

*Report compiled February 2026. The field moves fast — revisit in 3-6 months.*
