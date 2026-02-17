# Clawatar 🎭

**From Agent Intelligence to Interactive Intelligence. Give your AI agent a body.**

A web-based 3D VRM avatar viewer with real-time animations, voice chat, and lip sync — built for [OpenClaw](https://github.com/openclaw/openclaw).

## Screenshots

<p align="center">
  <img src="docs/images/default-view.jpg" width="48%" alt="Default sakura theme" />
  <img src="docs/images/night-sky-face.jpg" width="48%" alt="Night sky with face close-up" />
</p>
<p align="center">
  <img src="docs/images/sakura-garden.jpg" width="48%" alt="Sakura garden with petals" />
  <img src="docs/images/sunset-fullbody.jpg" width="48%" alt="Sunset full body view" />
</p>

> *Cute sakura UI, multiple background scenes, camera presets, emotion bar, and 162 animations. VRM model not included — bring your own!*

## Quick Start

```bash
git clone https://github.com/Dongping-Chen/Clawatar.git
cd Clawatar
npm install
npm run start
```

Open `http://localhost:3000` and drop your `.vrm` model onto the page.

## Features

### 🎭 Avatar & Animation
- **162 animations** — wave, dance, think, laugh, shrug, and more (Mixamo VRMA)
- **Facial expressions** — happy, sad, angry, surprised, relaxed
- **Idle behavior** — avatar looks around, stretches, yawns when waiting
- **Touch reactions** — click the avatar for headpats, pokes, and silly reactions ✨

### 🌸 Beautiful UI
- **Sakura/anime theme** — cute pink glassmorphism panels
- **Background scenes** — Sakura Garden 🌸, Night Sky 🌙, Cozy Café ☕, Sunset 🌅
- **Camera presets** — Face, Portrait, Full Body, Cinematic with smooth transitions
- **Quick emotion bar** — 😊😢😠😮😌💃 one-tap expression + animation combos

### 🎤 Voice & Chat
- **Audio-driven lip sync** — mouth moves to actual speech audio
- **Voice input** — speak via your browser's microphone
- **Voice output** — ElevenLabs TTS (optional, requires API key)
- **AI conversation** — powered by [OpenClaw](https://github.com/openclaw/openclaw) (optional)

### 🏠 3D Scene System (Blender Pipeline)
- **6 scenes** — Cozy Bedroom 🛏️, Izakaya 🏮, Café ☕, Phone Booth 📞, Sunset Balcony 🌇, Swimming Pool 🏊
- **Blender procedural pipeline** — Python scripts generate geometry + materials + lights → Cycles render → GLB export
- **Emissive-only materials** — all scenes use Emission shaders for reliable rendering in Three.js
- **Auto emissive lights** — brightest emissive meshes automatically spawn PointLights
- **Camera freedom** — orbit ±135° inside scenes, configurable per-scene camera + exposure
- **Activity modes** — Study, Exercise, Chill with themed camera angles + animations
- **Scene loader** — `loadRoomGLB()` loads single GLB as entire environment with character lighting

### 📹 Virtual Meeting Avatar
- **Join Google Meet / Zoom** — avatar appears via OBS Virtual Camera
- **Listen & respond** — captures meeting audio via BlackHole → Whisper STT → OpenClaw AI → TTS
- **Smart triggers** — responds when called by name or asked a question
- **Streaming pipeline (v3)** — VAD + OpenClaw orchestrated model + streaming ElevenLabs TTS
- **No direct LLM calls** — all AI routes through OpenClaw Gateway (model selection, context, persona handled automatically)
- **Rolling context** — maintains 2-minute transcript window for coherent responses

### 🔌 Developer-Friendly
- **WebSocket API** — control everything programmatically
- **Drag & drop** — load any VRM model
- **Standalone mode** — works without OpenClaw or ElevenLabs
- **OpenClaw skill** — install as an agent skill for AI-driven avatars

## Bring Your Own Model

No VRM model is bundled. You can:
1. **Drag & drop** a `.vrm` file onto the viewer
2. **Set a URL** in `clawatar.config.json` → `model.url`
3. **Enter a URL** in the Model panel in the UI

## Configuration

Edit `clawatar.config.json`:

```json
{
  "model": { "url": "", "autoLoad": true },
  "voice": {
    "elevenlabsVoiceId": "your-voice-id",
    "elevenlabsModel": "eleven_turbo_v2_5"
  },
  "server": { "vitePort": 3000, "wsPort": 8765, "audioPort": 8866 },
  "openclaw": { "gatewayPort": 18789, "sessionId": "vrm-chat" }
}
```

## WebSocket Protocol

```json
{"type": "play_action", "action_id": "161_Waving"}
{"type": "set_expression", "name": "happy", "weight": 0.8}
{"type": "speak", "text": "Hello!", "action_id": "161_Waving", "expression": "happy"}
{"type": "reset"}
```

## Architecture

```
Browser (localhost:3000)
├── Three.js + @pixiv/three-vrm
├── VRMA animation playback
├── Audio-driven lip sync
└── Chat UI + Emotion Bar
    │
    │ WebSocket (ws://localhost:8765)
    ▼
WS Server (server/ws-server.ts)
├── Command relay & routing
├── ElevenLabs TTS
├── OpenClaw Gateway bridge (all AI routing)
└── Meeting speech → Gateway API → orchestrated model
    │
    ▼
OpenClaw Gateway (localhost:18789)
├── Model orchestration (Opus/Sonnet/Codex)
├── Session & context management
└── Persona & memory
```

## OpenClaw Skill

Clawatar includes an [OpenClaw](https://github.com/openclaw/openclaw) skill at `skill/SKILL.md`. Install it to let your AI agent control the avatar with animations, expressions, and voice.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Start dev server + WebSocket server |
| `npm run dev` | Vite dev server only |
| `npm run ws-server` | WebSocket server only |
| `npm run build` | Production build |
| `npm run catalog` | Regenerate animation catalog |
| `npm run meeting` | Virtual meeting bridge v2 (continuous listen + smart trigger) |
| `npm run meeting:v3` | Virtual meeting bridge v3 (streaming VAD + streaming TTS) |

## Building Scenes (Blender Pipeline)

Each scene is a Blender Python script that generates procedural geometry → exports GLB.

```bash
# Build a scene
/Applications/Blender.app/Contents/MacOS/Blender --background --python blender/build_izakaya_v4.py

# Copy to public
cp /tmp/izakaya.glb public/scenes/izakaya.glb

# Load in viewer
open http://localhost:3000?room=izakaya
```

### Scene scripts (in `blender/`)
| Script | Scene | GLB Size |
|--------|-------|----------|
| `build_room_v9.py` | Cozy Bedroom | 3.7 MB |
| `build_izakaya_v4.py` | Izakaya Bar | 5.9 MB |
| `build_cafe_v6.py` | Coffee Café | 4.6 MB |
| `build_phone_booth_v6.py` | Rainy Phone Booth | 1.6 MB |
| `build_balcony_v8.py` | Sunset Balcony | 7.7 MB |
| `build_pool_v8.py` | Swimming Pool | 7.1 MB |

### Key rules for scene scripts
- **All emission strengths ≥ 3.0** — sub-1.0 gets baked dark by glTF exporter
- **Use Emission shader only** (not Principled BSDF) for reliable Three.js rendering
- **Cycles renderer** — 64 samples + denoiser
- **Center stage clear** — character stands at origin (0,0,0)
- **Background elements at Blender -Y** — they end up behind the character in Three.js
- **GLB under 8 MB** — optimize mesh complexity
- See `SCENES.md` for detailed scene configs and review scores

## Virtual Meeting Setup

1. Install [OBS Studio](https://obsproject.com/) and [BlackHole 2ch](https://existential.audio/blackhole/)
2. Create a Multi-Output Device (Audio MIDI Setup) → your speakers + BlackHole 2ch
3. Set system output to the Multi-Output Device
4. OBS: Add Browser Source → `http://localhost:3000?embed` → Start Virtual Camera
5. Start the avatar: `npm run start`
6. Start the meeting bridge: `npm run meeting:v3`
7. In Google Meet: select OBS Virtual Camera (video) and BlackHole 2ch (mic)

See `virtual-meeting/README.md` for detailed architecture docs.

## Credits

- **Animations:** [Mixamo](https://www.mixamo.com/) — non-commercial use, credit required
- **VRM rendering:** [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- **Inspired by:** [moeru-ai/airi](https://github.com/moeru-ai/airi)

## License

MIT — see [LICENSE](LICENSE)
