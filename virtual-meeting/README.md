# Virtual Meeting Avatar — Setup Guide

> Use your VRM avatar as a virtual camera + microphone in Google Meet, 腾讯会议, Zoom, etc.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  VRM Viewer      │────▶│  OBS Studio  │────▶│  Meeting App    │
│  (localhost:3000)│     │  (capture)   │     │  (Google Meet)  │
│  Three.js render │     │  Virtual Cam │     │                 │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                       │ audio out
                                                       ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  OpenClaw        │◀───│  Whisper STT │◀────│  BlackHole-2ch  │
│  (orchestrated)  │     │  (transcribe)│     │  (virtual audio)│
│  + TTS + anim    │     └──────────────┘     └─────────────────┘
└────────┬────────┘
         │ speak_audio + animation
         ▼
┌─────────────────┐
│  VRM Viewer      │ ← lip sync + expression + animation
│  (updates live)  │ ← OBS captures updated frame
└─────────────────┘
```

## Pipeline

**Meeting Bridge v3** (`meeting-bridge-v3.ts`) — the only active bridge.

All AI responses route through **OpenClaw Gateway** — no direct LLM API calls.
The Gateway handles model selection (Sonnet for meeting speed, Opus for reasoning),
session management, persona, and conversation context.

```
VAD recording (sox) → Whisper STT → WS meeting_speech → OpenClaw Gateway → TTS → WS broadcast
```

- **VAD recording**: sox `silence` effect auto-detects speech start/end
- **Whisper STT**: OpenAI API (only external API call in the bridge)
- **OpenClaw Gateway**: Orchestrates model, maintains meeting session context
- **ElevenLabs TTS**: WebSocket streaming, starts TTS as response arrives
- **Latency: ~2.6s post-speech**

## Trigger Detection

The bridge responds when:
1. **Name called** — "Reze", "雷泽", "蕾泽", "东平" (+ 20 Whisper misheard variants like "Riz", "Ruiz", "Razor", etc.)
2. **Question directed** — Contains question markers (吗/呢/嘛/what/how) AND contains "你" or a trigger name
3. **Cooldown** — 8s between responses to avoid rapid-fire

Whisper `prompt` parameter: `"Reze, Dongping, 东平, 雷泽"` improves proper noun recognition.

## Audio Pipeline

**IMPORTANT**: ffmpeg avfoundation drops ~72% of audio frames from BlackHole. We use `sox/rec` (CoreAudio) instead — perfect 1:1 recording with zero data loss.

```
Meeting audio → System Output → Multi-Output Device → BlackHole 2ch
                                                     ↓
sox/rec (CoreAudio) → 16kHz mono WAV → Whisper API → transcript
                                                     ↓
Trigger check → WS meeting_speech → OpenClaw Gateway → AI response
                                                     ↓
ElevenLabs TTS (streaming) → WS broadcast → VRM lip sync + animation
```

## Quick Start

### Prerequisites
```bash
brew install --cask obs
brew install --cask blackhole-2ch  # needs sudo, then REBOOT
brew install sox
```

### Audio Routing (one-time setup)
1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
2. Click **+** → **Create Multi-Output Device**
   - ✅ Built-in Output (your speakers/headphones)
   - ✅ BlackHole 2ch
3. Set **System Output** → Multi-Output Device

### OBS Setup
1. Open OBS Studio
2. Add Source → **Browser** → URL: `http://localhost:3000?embed`
   - Width: 1920, Height: 1080
3. Click **Start Virtual Camera**

### Meeting Setup
1. Open Google Meet / Zoom
2. Camera → **OBS Virtual Camera**
3. Microphone → **BlackHole 2ch**
4. Speaker → **Multi-Output Device** (so you still hear)

### Run
```bash
npm run start           # VRM viewer + WS server + audio server
npm run meeting:v3      # Meeting bridge
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...        # Required for Whisper STT only
ELEVENLABS_API_KEY=sk_...    # Required for TTS (read from openclaw.json automatically)
```

## Files
| File | Description |
|------|-------------|
| `meeting-bridge-v3.ts` | VAD + Whisper STT + OpenClaw Gateway routing + ElevenLabs TTS |
| `setup-obs.sh` | OBS scene configuration helper |
| `README.md` | This file |

## Known Issues
- Whisper transcribes "Reze" inconsistently — mitigated with prompt param + expanded trigger list
- `eleven_turbo_v2_5` TTS model may not support Chinese — verify and fall back to `eleven_multilingual_v2`
- OBS scene needs manual configuration (browser source → virtual camera)
