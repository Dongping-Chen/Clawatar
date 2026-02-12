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
│  (OpenClaw)      │     │  (transcribe)│     │  (virtual audio)│
│  + TTS + anim    │     └──────────────┘     └─────────────────┘
└────────┬────────┘
         │ speak_audio + animation
         ▼
┌─────────────────┐
│  VRM Viewer      │ ← lip sync + expression + animation
│  (updates live)  │ ← OBS captures updated frame
└─────────────────┘
```

## Components

### 1. Video: OBS Virtual Camera
- OBS captures the browser window (localhost:3000) showing the VRM avatar
- "Start Virtual Camera" makes it available as a camera source in any meeting app
- Meeting participants see the VRM avatar instead of your real face

### 2. Audio Input: BlackHole-2ch (Virtual Audio Device)
- Routes meeting audio to our system for transcription
- macOS Audio MIDI Setup: Create "Multi-Output Device" → Built-in Output + BlackHole-2ch
- Set system output to Multi-Output → you hear audio AND it goes to BlackHole

### 3. Speech-to-Text: Whisper API
- Continuously captures audio from BlackHole
- Transcribes speech segments → sends to AI

### 4. AI + TTS: OpenClaw Pipeline
- Receives transcribed meeting audio
- Decides when/if to respond (listening mode by default)
- Generates response → ElevenLabs TTS → plays through VRM lip sync
- VRM animation + expression matches response emotion

### 5. Audio Output: BlackHole as Virtual Mic
- Meeting app uses BlackHole as microphone input
- TTS audio routes to BlackHole → meeting participants hear the avatar speak

## Quick Start

### Prerequisites
```bash
# OBS (already installed)
brew install --cask obs

# BlackHole (needs sudo — run manually)
brew install --cask blackhole-2ch
# Then REBOOT your Mac

# Verify BlackHole is installed
ls /Library/Audio/Plug-Ins/HAL/ | grep BlackHole
```

### Setup Steps

#### 1. Audio Routing (one-time setup)
1. Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup")
2. Click **+** → **Create Multi-Output Device**
   - Check: Built-in Output (your speakers/headphones)
   - Check: BlackHole 2ch
3. Click **+** → **Create Aggregate Device**
   - Check: BlackHole 2ch (this is your virtual mic input)
4. Set **System Output** → Multi-Output Device (so you hear + BlackHole gets audio)

#### 2. OBS Setup
1. Open OBS Studio
2. Add Source → **Window Capture** → select browser showing localhost:3000
3. Crop to just the VRM avatar (remove browser chrome)
4. Click **Start Virtual Camera**

#### 3. Meeting Setup
1. Open Google Meet / 腾讯会议 / Zoom
2. Settings → Camera → **OBS Virtual Camera**
3. Settings → Microphone → **BlackHole 2ch** (or Aggregate Device)
4. Settings → Speaker → **Multi-Output Device** (so you still hear)

#### 4. Start the Pipeline
```bash
cd /path/to/vrm-viewer
npm run start           # Start VRM viewer + WS server
npm run meeting         # Start meeting audio capture + transcription loop
```

## Demo Mode (Simplified)
For the Friday demo, we can simplify:
- Manual trigger: You type what to say, AI responds via avatar
- Skip auto-detection of "when addressed"
- Just show: avatar visible in meeting → avatar speaks with lip sync
- Command: `/meeting say Hello everyone!` in the web chat

## Files
- `virtual-meeting/capture.ts` — Audio capture from BlackHole via Web Audio API
- `virtual-meeting/meeting-bridge.ts` — Bridge between meeting audio and OpenClaw
- `virtual-meeting/README.md` — This file
