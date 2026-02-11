---
name: clawatar
description: Control a 3D VRM avatar with animations, expressions, voice chat, and lip sync via a web-based viewer.
allowed-tools: Bash(npm:*) Bash(npx:*) Bash(node:*) Read Write WebFetch
---

# Clawatar — 3D VRM Avatar Viewer

Clawatar is a web-based VRM avatar viewer you can control in real time. You can play animations, set facial expressions, and make the avatar speak with TTS and lip sync — all via WebSocket commands.

## Starting the Viewer

```bash
cd ~/.openclaw/workspace/clawatar && npm run start
```

This starts the Vite dev server (http://localhost:3000) and the WebSocket server (ws://localhost:8765).

## VRM Model

Users must provide their own VRM model. They can:
- Drag & drop a `.vrm` file onto the page
- Set `model.url` in `clawatar.config.json`
- Enter a URL in the UI Model panel

## WebSocket Protocol

All commands are JSON messages sent to `ws://localhost:8765`.

### play_action

Play an animation by ID (filename without `.vrma` extension):

```json
{"type": "play_action", "action_id": "161_Waving"}
{"type": "play_action", "action_id": "125_Laughing"}
{"type": "play_action", "action_id": "40_Happy Idle"}
```

### set_expression

Set a facial expression (weight 0.0–1.0, default 0.8):

```json
{"type": "set_expression", "name": "happy", "weight": 0.8}
{"type": "set_expression", "name": "sad", "weight": 0.6}
{"type": "set_expression", "name": "angry", "weight": 0.7}
{"type": "set_expression", "name": "surprised", "weight": 0.9}
{"type": "set_expression", "name": "relaxed", "weight": 0.5}
```

### speak

Make the avatar speak with TTS, animation, and expression all at once (requires ElevenLabs API key):

```json
{"type": "speak", "text": "Hello! Nice to meet you!", "action_id": "161_Waving", "expression": "happy"}
{"type": "speak", "text": "Hmm, let me think about that...", "action_id": "88_Thinking", "expression": "relaxed"}
{"type": "speak", "text": "That's so funny!", "action_id": "125_Laughing", "expression": "happy"}
```

### reset

Reset avatar to idle state (clears expressions, plays idle animation):

```json
{"type": "reset"}
```

### get_state

Get current avatar state:

```json
{"type": "get_state"}
```

## Animation Mood Mapping

Pick animations based on the conversation mood:

| Mood | Action ID | Notes |
|------|-----------|-------|
| Greeting | `161_Waving` | Wave hello/goodbye |
| Happy/Excited | `116_Happy Hand Gesture` or `40_Happy Idle` | Cheerful gestures |
| Thinking | `88_Thinking` | Chin-stroke thinking pose |
| Agreeing | `118_Head Nod Yes` | Nodding head |
| Disagreeing | `144_Shaking Head No` | Shaking head no |
| Laughing | `125_Laughing` | Laughter animation |
| Sad | `142_Sad Idle` | Sad/down posture |
| Dancing | `71_Hip Hop Dancing`, `15_Bellydancing`, `151_Swing Dancing`, etc. | Pick a random dance for fun |
| Shrugging | `150_Shrugging` | "I don't know" gesture |
| Pointing | `135_Pointing Forward` | Directing attention |
| Waving | `161_Waving` | Hello/goodbye |
| Clapping | `26_Clapping` | Applause |
| Thumbs Up | `154_Standing Thumbs Up` | Approval |
| Default/Idle | `119_Idle` | Neutral standing |

## Sending Commands from the Agent

Use Node.js with the `ws` package (already installed in the clawatar directory):

```bash
cd ~/.openclaw/workspace/clawatar && node -e "const W=require('ws');const s=new W('ws://localhost:8765');s.on('open',()=>{s.send(JSON.stringify({type:'speak',text:'Hello!',action_id:'161_Waving',expression:'happy'}));setTimeout(()=>s.close(),1000)})"
```

Or for a simple animation:

```bash
cd ~/.openclaw/workspace/clawatar && node -e "const W=require('ws');const s=new W('ws://localhost:8765');s.on('open',()=>{s.send(JSON.stringify({type:'play_action',action_id:'125_Laughing'}));setTimeout(()=>s.close(),500)})"
```

## Notes

- **163 animations** are available — see `public/animations/catalog.json` for the full list
- Animations are converted from [Mixamo](https://www.mixamo.com/) — **non-commercial use only**, credit Mixamo
- The viewer works standalone (animations, expressions, drag-drop) without OpenClaw or ElevenLabs
- TTS/voice features require an ElevenLabs API key (set via installer or in `openclaw.json`)
