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
│  AI Response     │◀───│  Whisper STT │◀────│  BlackHole-2ch  │
│  (GPT-4o stream) │     │  (transcribe)│     │  (virtual audio)│
│  + TTS + anim    │     └──────────────┘     └─────────────────┘
└────────┬────────┘
         │ speak_audio + animation
         ▼
┌─────────────────┐
│  VRM Viewer      │ ← lip sync + expression + animation
│  (updates live)  │ ← OBS captures updated frame
└─────────────────┘
```

## Pipeline Versions

### v1 (`meeting-bridge.ts`) — Basic
- Fixed-length sox recording → Whisper → OpenClaw CLI → TTS
- Simple but high latency (~12-15s)

### v2 (`meeting-bridge-v2.ts`) — Smart Triggers
- Continuous 3s chunks via sox
- Rolling 2-minute transcript for context
- Smart trigger detection (20+ name variants, question patterns)
- `meeting_response` WS type (pre-generated AI text → TTS, no double AI call)
- 8s response cooldown
- **Latency: ~8-14s total**

### v3 (`meeting-bridge-v3.ts`) — Streaming ⚡
- **VAD recording**: sox `silence` effect auto-detects speech start/end
- **Streaming GPT-4o**: Direct OpenAI API, `stream: true`, first token ~0.5s
- **Sentence splitter**: Yields complete sentences as they arrive
- **Streaming ElevenLabs TTS**: WebSocket API, starts TTS before AI finishes
- **Pipelined**: AI generates → sentences split → TTS streams → audio broadcasts
- **Latency: ~2.6s post-speech** (VAD 3.3s + STT 1.1s + AI 0.46s + TTS 1.45s)

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
Trigger check → GPT-4o (streaming) → sentences → ElevenLabs TTS (streaming)
                                                     ↓
WS broadcast → VRM lip sync + animation + expression
```

## Quick Start

### Prerequisites
```bash
# OBS Studio
brew install --cask obs

# BlackHole virtual audio (needs sudo — run manually, then REBOOT)
brew install --cask blackhole-2ch

# sox for audio recording
brew install sox

# Verify
ls /Library/Audio/Plug-Ins/HAL/ | grep BlackHole
which rec  # should show /opt/homebrew/bin/rec
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
npm run meeting:v3      # Streaming meeting bridge (recommended)
# or
npm run meeting         # v2 meeting bridge (simpler, higher latency)
```

## Environment Variables

```bash
OPENAI_API_KEY=sk-...        # Required for Whisper STT + GPT-4o
ELEVENLABS_API_KEY=sk_...    # Required for TTS
```

These are read from `~/.openclaw/openclaw.json` skill configs automatically.

## Files
| File | Description |
|------|-------------|
| `meeting-bridge.ts` | v1 — basic sox + Whisper loop |
| `meeting-bridge-v2.ts` | v2 — continuous listen + smart triggers + rolling transcript |
| `meeting-bridge-v3.ts` | v3 — streaming VAD + GPT-4o + ElevenLabs WebSocket |
| `test-pipeline.ts` | End-to-end latency benchmark tool |
| `README.md` | This file |

## Known Issues
- Whisper transcribes "Reze" inconsistently — mitigated with prompt param + expanded trigger list
- `eleven_turbo_v2_5` TTS model may not support Chinese — verify and fall back to `eleven_multilingual_v2`
- TTS audio currently plays through VRM viewer only — routing back to BlackHole as virtual mic for meeting participants is TODO
- OBS scene needs manual configuration (browser source → virtual camera)
