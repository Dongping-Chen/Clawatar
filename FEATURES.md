# FEATURES.md — Clawatar Feature Backlog

## Feature #35: Modular 3D Scene Generation Pipeline

**Status:** 📋 Proposal
**Priority:** 🟡 HIGH (post-meeting-demo, pre-product-launch)
**Requested:** 2026-02-12 by Dongping

### Problem
当前 `room-scene.ts` 是 1772 行的单一文件，所有家具、灯光、动画、主题全部硬编码。每次新建场景（健身房、咖啡厅、图书馆）都要：
1. 手写几百行 Three.js 几何体代码
2. 跑 review agent 审查
3. 反复修改调整
4. 效率极低，不可扩展

### 方案：两层架构（glTF资产 + 场景描述JSON）

#### 核心思路
**不再用代码画家具了。** 改为：
- **家具/物品** → 用现成的 glTF/GLB 3D 模型（Sketchfab、poly.pizza 等免费资源）
- **场景布局** → 用 JSON 描述文件定义（什么物品、放在哪、多大、什么颜色）
- **AI生成** → 自然语言 → JSON → 场景自动渲染

#### 架构

```
用户说 "我想要一个健身房"
         │
         ▼
┌──────────────────┐
│  Scene Generator │  ← AI (OpenClaw) 根据描述生成 scene JSON
│  (AI → JSON)     │
└────────┬─────────┘
         │ scene.json
         ▼
┌──────────────────┐     ┌──────────────────┐
│  Scene Loader    │────▶│  Asset Registry   │
│  (读JSON/摆放)   │     │  (glTF资产库)     │
└────────┬─────────┘     └──────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐
│  Scene Renderer  │     │  public/assets/   │
│  (Three.js渲染)  │     │  ├─ furniture/    │
│  + 灯光/后处理   │     │  ├─ decoration/   │
│  + VRM放置       │     │  ├─ lighting/     │
│  + 碰撞边界      │     │  └─ scenes/       │
└──────────────────┘     └──────────────────┘
```

#### 第一层：Asset Registry（资产注册表）

```typescript
// asset-registry.ts
interface AssetEntry {
  id: string              // "desk-modern-01"
  name: string            // "Modern Wooden Desk"
  category: 'furniture' | 'decoration' | 'appliance' | 'structure' | 'nature'
  path: string            // "assets/furniture/desk-modern-01.glb"
  source: string          // "sketchfab:uid" | "poly.pizza:id" | "procedural"
  license: string         // "CC-BY-4.0" | "CC0" | "custom"
  defaultScale: [number, number, number]  // 归一化后的默认尺寸
  boundingBox: { w: number, h: number, d: number }  // 碰撞盒
  tags: string[]          // ["desk", "work", "study", "modern"]
  interactable?: {        // 角色可以和它互动
    type: 'sit' | 'stand' | 'use'
    position: [number, number, number]  // 互动位置偏移
    animation?: string    // 互动时播放的动画
  }
}
```

所有资产在 `public/assets/registry.json` 中注册。新加一个物品 = 放 GLB 文件 + 加一行 JSON。

#### 第二层：Scene Description（场景描述）

```json
{
  "id": "gym",
  "name": "Home Gym",
  "type": "room",
  "dimensions": { "width": 6, "height": 3, "depth": 5 },
  "floor": { "material": "rubber", "color": "#2a2a2a" },
  "walls": { "material": "concrete", "color": "#d0d0d0" },
  "ceiling": { "material": "standard", "color": "#f0f0f0" },
  "objects": [
    { "asset": "treadmill-01", "position": [-1.5, 0, -1], "rotation": [0, 90, 0], "scale": 1.0 },
    { "asset": "dumbbell-rack-01", "position": [1.5, 0, -1.5], "rotation": [0, 0, 0] },
    { "asset": "yoga-mat-01", "position": [0, 0.01, 1], "rotation": [0, 45, 0], "color": "#ff6b9d" },
    { "asset": "mirror-wall-01", "position": [-2.9, 1.5, 0], "rotation": [0, 90, 0], "scale": [1, 1.5, 1] },
    { "asset": "water-bottle-01", "position": [1.5, 0.8, -1.5] },
    { "asset": "speaker-bluetooth-01", "position": [2, 0.5, -2] }
  ],
  "lighting": {
    "preset": "bright-indoor",
    "overrides": [
      { "type": "spot", "position": [0, 2.8, 0], "intensity": 1.5, "color": "#ffffff" }
    ]
  },
  "camera": {
    "defaultPreset": "full-body",
    "orbitLimits": { "azimuthRange": 270, "minDist": 1.5, "maxDist": 5.0 }
  },
  "character": {
    "spawnPosition": [0, 0, 0.5],
    "walkBounds": { "minX": -2.5, "maxX": 2.5, "minZ": -2, "maxZ": 2 },
    "defaultActivity": "exercise"
  },
  "themes": {
    "day": { "ambientColor": "#ffeedd", "windowLight": true },
    "night": { "ambientColor": "#1a1a2e", "windowLight": false, "bloom": 0.4 }
  }
}
```

#### 第三层：AI Scene Generator

```typescript
// scene-generator.ts
async function generateScene(description: string): Promise<SceneDescription> {
  // 1. 从 asset-registry 拿到所有可用资产列表
  // 2. 把资产列表 + 用户描述发给 OpenClaw
  // 3. GPT 返回符合 SceneDescription schema 的 JSON
  // 4. 验证 + 返回
}
```

用户说"我要一个温馨的书房"→ AI 从资产库里挑合适的家具 → 自动摆放 → 渲染。

### 3D资产来源

| 来源 | 格式 | 许可 | 特点 |
|------|------|------|------|
| **Sketchfab** | glTF/GLB | CC-BY/CC0 | 最大免费库，7M+模型，API可用 |
| **Poly Pizza** (Google Poly继承) | glTF | CC-BY | 低多边形风格，适合动漫 |
| **Kenney.nl** | glTF | CC0 | 游戏资产包，家具/场景/道具 |
| **Quaternius** | glTF/FBX | CC0 | 免费低多边形包 |
| **Three.js examples** | 内置 | MIT | 基础几何体 |
| **AI生成** (Meshy.ai, Tripo3D) | glTF | 付费 | 从文字/图片生成3D模型 |

**推荐起步方案：**
1. Kenney.nl 的 Furniture Kit（CC0，免费，风格统一）
2. Quaternius 的 Ultimate Buildings/Furniture packs（CC0）
3. Sketchfab API 按需下载单品

### 实现计划

#### Phase 1: 基础框架（2-3小时）
- [ ] 创建 `src/scene-system/` 目录
  - `asset-registry.ts` — 资产注册表 + GLB加载器
  - `scene-loader.ts` — 读JSON → 摆放物品 → 渲染
  - `scene-renderer.ts` — 灯光预设、后处理、碰撞系统
  - `procedural-room.ts` — 程序化墙壁/地板/天花板（保留现有能力）
- [ ] 定义 `SceneDescription` TypeScript 类型 + JSON Schema
- [ ] 把现有 `room-scene.ts` 的房间壳（墙壁、地板、窗户）抽成 `procedural-room.ts`
- [ ] WS 命令: `load_scene`, `modify_scene`, `list_scenes`

#### Phase 2: 资产库（1-2小时）
- [ ] 下载 Kenney Furniture Kit → `public/assets/furniture/`
- [ ] 下载 Quaternius 低多边形家具 → `public/assets/furniture/`
- [ ] 创建 `public/assets/registry.json` 注册所有资产
- [ ] GLB 加载器 + 自动缩放/定位

#### Phase 3: 预设场景（1小时）
- [ ] `public/scenes/bedroom.json` — 现有卧室（从 room-scene.ts 迁移）
- [ ] `public/scenes/gym.json` — 健身房
- [ ] `public/scenes/cafe.json` — 咖啡厅
- [ ] `public/scenes/study.json` — 书房
- [ ] `public/scenes/living-room.json` — 客厅

#### Phase 4: AI 生成器（1小时）
- [ ] `scene-generator.ts` — 自然语言 → scene JSON
- [ ] WS 命令: `generate_scene` (用户输入描述 → AI生成 → 自动加载)
- [ ] 支持增量修改: "把书桌换成红色的" "加一个落地灯在角落"

### 关键设计原则

1. **新场景 = 一个 JSON 文件** — 不需要写任何 TypeScript
2. **新物品 = 一个 GLB + registry 一行** — 不需要改任何代码
3. **AI 可以生成/修改** — 场景 JSON 对 LLM 友好
4. **渲染标准统一** — toon 材质、灯光预设、碰撞系统全部复用
5. **保留程序化能力** — 墙壁/地板/特效仍然程序生成（不需要建模）
6. **向下兼容** — 现有 room-scene.ts 可以作为 "legacy" 模式继续工作

### 不做什么
- ❌ 不做 runtime 3D 模型生成（Meshy.ai 等需要付费 + 延迟高）
- ❌ 不做复杂物理引擎（只做简单碰撞盒）
- ❌ 不重写现有房间（保留为 legacy，新场景用新系统）
