# Scene Generation Pipeline — Design Doc

## Problem
Current approach is manual: hand-write JSON → render → screenshot → fix → repeat. This doesn't scale and produces inconsistent quality. The 4 background themes (Sakura Garden, Night Sky, Cozy Café, Sunset) exist only as color gradients, not real 3D scenes.

## Goal
A pipeline where an AI agent can generate, render, review, and iterate on 3D scenes **autonomously** — producing a complete, polished scene from a text description.

## Pipeline Architecture

```
[1. DESCRIBE] → [2. GENERATE] → [3. RENDER] → [4. REVIEW] → [5. FIX] → loop until pass
```

### Stage 0: ASSET ENRICHMENT (Pre-requisite)
Before generating any scene, the asset library must be sufficient.
- **Current**: 140 Kenney CC0 GLBs (basic furniture, no detail props)
- **Target**: 300+ assets covering detail props (cups, books, frames, curtains, food, flowers, etc.)
- **Sources**:
  1. Quaternius (120+ CC0 models — houses, nature, furniture)
  2. Sketchfab (filter: anime/isometric/cute, free license)
  3. Meshy API ($0.01-0.10/model) for custom anime-style objects when nothing exists
- **Process**: Download → convert to GLB → register in asset-registry.ts with categories/tags
- **Run once, then all scenes benefit**

### Stage 1: DESCRIBE (Input)
- **Input** (any combination of):
  - Text description: "Cozy café where Reze works, warm wood, counter, coffee machines"
  - Reference images: user-provided OR web-searched (e.g. "Reze café チェンソーマン")
  - Theme name from preset list
- **Process**:
  1. If reference image provided → vision model extracts: color palette, key objects, layout style, mood
  2. If text only → LLM expands into structured requirements
  3. Web search for inspiration if needed (e.g. "anime café interior reference")
- **Output**: Structured requirements (room dimensions, mood, key objects, color palette, lighting mood, reference images)
- **Agent**: Vision + Text → Requirements parser

### Stage 2: GENERATE (Scene JSON)
- **Input**: Requirements from Stage 1
- **Process**:
  1. Query asset registry for matching assets (by category, tags)
  2. Select 8-15 objects that fit the theme
  3. Generate positions using layout rules:
     - Furniture against walls (±width/2, ±depth/2)
     - Small items on top of furniture (y = surface height)
     - No overlapping bounding boxes
     - Character clear zone at center (±0.5m radius)
  4. Choose lighting preset + color overrides
  5. Set room dimensions, wall/floor colors
- **Output**: Complete scene JSON (same format as existing `public/scenes/*.json`)
- **Agent**: LLM with asset catalog context + layout constraint rules

### Stage 3: RENDER (Screenshots)
- **Input**: Scene JSON path
- **Process**:
  1. Load scene via `loadSceneFromJSON(path)`
  2. Take 8+ screenshots from preset camera angles:
     - Front / Back / Left / Right (4 cardinal)
     - Front-Left / Front-Right / Back-Left / Back-Right (4 diagonal)
     - Top-down overview
     - Character portrait close-up
  3. Compare against reference image if provided (Stage 1)
- **Output**: 10 PNG files per scene
- **Tool**: Browser CDP → scene load → camera set → screenshot

### Stage 4: REVIEW (Quality Check)
- **Input**: Screenshots + Scene JSON + asset list
- **Process**: Vision model evaluates against 7 criteria:
  1. Layout realism (no floating, no clipping, logical placement)
  2. Lighting quality (no blown-out/dark spots, warm feel)
  3. Color harmony (wall/floor/furniture palette coherence)
  4. Visual distinctiveness (unique vs other scenes)
  5. Character integration (VRM visible, not obscured, well-lit)
  6. Completeness (enough objects, room feels furnished not empty)
  7. Overall aesthetic (anime/cozy feel, not game-generic)
- **Output**: Score (1-10 per criterion) + specific issues list with fix instructions
- **Agent**: Vision model (Opus) with strict review prompt

### Stage 5: FIX (Iterate)
- **Input**: Issues from review + current JSON
- **Process**: 
  1. Parse specific fixes (move object X to Y, change color, add/remove object)
  2. Apply JSON patches
  3. Return to Stage 3 (re-render)
- **Exit condition**: All 7 criteria ≥ 7/10, no critical issues (floating/clipping)
- **Safety valve**: If 2 consecutive rounds show no score improvement → flag for human review (not silently give up)
- **No hard iteration cap** — keep going until quality passes or human intervenes

## Implementation Plan

### Phase A: Scene Generator Agent (the "brain")
Single spawned sub-agent that:
1. Receives a theme description
2. Reads asset registry (140 Kenney assets with categories/tags)
3. Generates scene JSON following the schema
4. Writes JSON to `public/scenes/`
5. Triggers render pipeline
6. Reviews screenshots
7. Iterates until quality passes

### Phase B: Render + Screenshot Automation
- Script/function that:
  1. Sends `load_scene` WS command
  2. Sets 4-5 camera positions via CDP
  3. Takes screenshots via browser tool
  4. Returns file paths

### Phase C: Batch Generation
- Generate ALL missing scenes in one batch:
  - Sakura Garden (outdoor, cherry blossoms, Japanese aesthetic)
  - Night Sky (nighttime room, city window, warm lamp)
  - Cozy Café (café interior, counter, stools, warm wood)
  - Sunset (warm room, orange lighting, relaxed vibe)
  - Plus the existing 5 (bedroom, office, living room, kitchen, bathroom) re-generated to higher quality

## Asset Library Strategy
- **Current**: 140 Kenney CC0 GLBs — basic furniture only, no detail props
- **Target**: 300+ assets before running pipeline
- **Gap analysis**: Missing categories — wall art, curtains, windows, food/drinks, books, towels, rugs (variety), flowers, clocks, mirrors (decorative), cushions, blankets
- **Sources (priority order)**:
  1. Quaternius CC0 packs (free, bulk download, 120+ models)
  2. Sketchfab filtered search (anime/low-poly/cute, CC license)
  3. Meshy API for custom generation when nothing matches
- **Process**: Download → GLB convert (if needed) → add to `public/assets/` → register in `asset-registry.ts`
- **The pipeline is only as good as the assets it has to work with**

## File Structure
```
public/scenes/
  index.json          — list of all available scenes
  cozy-bedroom.json   — existing
  study-office.json   — existing
  living-room.json    — existing
  kitchen.json        — existing
  bathroom.json       — existing
  sakura-garden.json  — NEW
  night-sky.json      — NEW
  cozy-cafe.json      — NEW
  sunset-room.json    — NEW
```

## Key Principles
1. **Design → Generate → Review → Fix → Deliver.** Not: Code → Fix → Fix → Fix → Ship.
2. **Assets first, scenes second.** A great pipeline with bad assets produces bad scenes.
3. **Reference-driven.** Every scene should start from a real visual reference, not abstract descriptions.
4. **No quality ceiling.** Don't cap iterations — keep going until it's actually good, or flag for human help.
