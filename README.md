# Clawatar 🎭

**From Agent Intelligence to Interactive Intelligence. Give your AI agent a body.**

A web-based 3D VRM avatar viewer with real-time animations, voice chat, and lip sync — built for [OpenClaw](https://github.com/openclaw/openclaw).

## Quick Start

```bash
npx clawatar@latest
```

This installs the OpenClaw skill, copies the project, and runs `npm install`.

### Manual Install

```bash
git clone https://github.com/user/clawatar
cd clawatar
npm install
npm run start
```

Open `http://localhost:3000` and drop your `.vrm` model onto the page.

## Features

- 🎭 **163 animations** — wave, dance, think, laugh, shrug, and more (Mixamo-based VRMA)
- 😊 **Facial expressions** — happy, sad, angry, surprised, relaxed
- 👄 **Audio-driven lip sync** — mouth moves to actual speech audio
- 🎤 **Voice input** — speak via your browser's microphone
- 🔊 **Voice output** — ElevenLabs TTS (optional, requires API key)
- 🤖 **AI conversation** — powered by [OpenClaw](https://github.com/nichochar/openclaw) (optional)
- 🎬 **Idle behavior** — avatar looks around, stretches, yawns when waiting
- 📦 **Drag & drop** — load any VRM model by dropping it on the page

## Bring Your Own Model

No VRM model is bundled. You can:
1. **Drag & drop** a `.vrm` file onto the viewer
2. **Set a URL** in `clawatar.config.json` → `model.url`
3. **Enter a URL** in the Model panel in the UI

The model URL is saved to localStorage and auto-loaded on refresh.

## Configuration

Edit `clawatar.config.json`:

```json
{
  "model": {
    "url": "",
    "autoLoad": true
  },
  "voice": {
    "elevenlabsVoiceId": "your-voice-id",
    "elevenlabsModel": "eleven_turbo_v2_5"
  },
  "server": {
    "vitePort": 3000,
    "wsPort": 8765,
    "audioPort": 8866
  },
  "openclaw": {
    "gatewayPort": 18789,
    "sessionId": "vrm-chat"
  }
}
```

## Architecture

```
Browser (localhost:3000)
├── Three.js + @pixiv/three-vrm
├── VRMA animation playback
├── Audio-driven lip sync
└── Chat UI overlay
    │
    │ WebSocket (ws://localhost:8765)
    ▼
WS Server (server/ws-server.ts)
├── Command relay & routing
├── ElevenLabs TTS (optional)
└── OpenClaw agent bridge (optional)
```

## Standalone Mode

The viewer works fully standalone — animations, expressions, drag-drop model loading — without OpenClaw or ElevenLabs. AI chat and voice are optional features that gracefully degrade when unavailable.

## WebSocket Protocol

```json
// Play animation
{"type": "play_action", "action_id": "161_Waving"}

// Set expression
{"type": "set_expression", "name": "happy", "weight": 0.8}

// Speak (triggers TTS + animation + lip sync)
{"type": "speak", "text": "Hello!", "action_id": "116_Happy Hand Gesture", "expression": "happy"}

// User speech (triggers AI response)
{"type": "user_speech", "text": "Hey, how are you?"}

// Reset to idle
{"type": "reset"}
```

## Animation Catalog

All 163 VRMA animations are in `public/animations/`. Run `npm run catalog` to regenerate `public/animations/catalog.json` after adding/removing animations.

Categories: emotion, gesture, dance, idle, movement, action, communication.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Start dev server + WebSocket server |
| `npm run dev` | Vite dev server only |
| `npm run ws-server` | WebSocket server only |
| `npm run build` | Production build |
| `npm run catalog` | Regenerate animation catalog |

## Credits

- **Animations:** Converted from [Mixamo](https://www.mixamo.com/) — non-commercial use only, credit Mixamo
- **VRM rendering:** [@pixiv/three-vrm](https://github.com/pixiv/three-vrm)
- **Architecture inspired by:** [moeru-ai/airi](https://github.com/moeru-ai/airi)

## License

MIT — see [LICENSE](LICENSE)
