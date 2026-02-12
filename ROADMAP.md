# Roadmap 💣

## Phase 1: Foundation ✅ (Done — Feb 11, 2026)
- [x] VRM model loading + Three.js rendering
- [x] VRMA animation playback (163 animations)
- [x] Facial expressions (happy, sad, angry, surprised, relaxed)
- [x] Auto-blink + idle eye saccades
- [x] Mouse-follow look-at
- [x] WebSocket control API
- [x] Action state machine (Idle → Action → Speaking)
- [x] Idle micro-actions (random looking around, stretching, etc.)
- [x] Smooth crossfade between animations
- [x] Auto-load model on startup
- [x] UI control panel

## Phase 2: Voice & Chat ✅ (Done — Feb 11, 2026)
- [x] ElevenLabs TTS integration (server-side)
- [x] Audio-driven lip sync (Web Audio API AnalyserNode)
- [x] Voice input via Web Speech API
- [x] Chat UI overlay
- [x] OpenClaw agent integration (AI conversation)
- [x] Action/expression auto-selection based on response

## Phase 3: UI & Interaction ✅ (Done — Feb 11, 2026)
- [x] **Sakura/anime UI theme** — cute glassmorphism, pink palette, bubbly chat
- [x] **Modern chat bubbles** — user/avatar alignment, timestamps, 💣 avatar icon
- [x] **Cute controls** — emoji section headers, rounded pills, soft animations
- [x] **Beautiful drop prompt** — sparkle animation, kawaii styling

## Phase 4: Companion Features 🔄 (Next — v0.2)
### High Priority
- [ ] **Touch reactions** — click/tap avatar for responses (headpat → happy, poke → surprised, etc.)
- [ ] **Quick emotion bar** — row of emoji buttons (😊😢😠😮😌) that trigger expression + animation combos
- [ ] **Background scenes** — selectable environments (sakura garden, cozy café, night sky, starlit, warm sunset)
- [ ] **Camera presets** — quick buttons for face close-up, full body, portrait framing

### Medium Priority
- [ ] **Day/night cycle** — lighting & background shift based on real time (sunrise → golden hour → moonlit)
- [ ] **Photo mode** — screenshot button with cute frame/border, save as PNG
- [ ] **Greeting on load** — avatar waves and says "Welcome back~" with TTS on page open
- [ ] **Notification badge** — bouncing 💣 when avatar has something to say
- [ ] **Animation queue** — string together dance routines or action sequences

### Polish
- [ ] **Responsive/mobile layout** — touch-friendly for phones
- [ ] **Hide controls by default** — show on hover/tap, keep chat always visible
- [ ] **Idle breathing** — subtle body sway so avatar never looks frozen
- [ ] **Better animation filtering** — tag stationary vs root-motion animations

## Phase 4.5: iOS + Multimodal 🔥 (In Progress — v0.3)
### 1. Native iOS App (Capacitor)
- [ ] Install Capacitor, add iOS platform
- [ ] Build + sync web bundle to native iOS project
- [ ] Same experience as desktop — shared WS server for state sync
- [ ] Touch-optimized mobile layout
- [ ] Deploy to iPhone via Xcode

### 2. Online VRM Asset Shop
- [ ] Browse open-source VRM models (VRoid Hub, Booth.pm, etc.)
- [ ] In-app model browser UI — preview + one-click load
- [ ] Download and cache models locally

### 3. Streaming ASR + TTS + Multimodal Vision
- [ ] Real-time speech recognition (streaming ASR)
- [ ] Streaming TTS — start lip sync before full audio generated
- [ ] iPhone front camera integration — avatar can "see" the user
- [ ] Vision API analysis of camera frames (expressions, context)
- [ ] FaceTime-like experience: you see avatar, avatar sees you

### 4. Animation Refinement
- [ ] Fix root motion drift on Mixamo animations
- [ ] Smoother crossfade blending between actions
- [ ] Idle breathing / subtle body sway
- [ ] Tag stationary vs root-motion animations in catalog

## Phase 5: Platform & Advanced 📋 (Planned — v0.4+)
- [ ] **PWA support** — manifest.json, service worker, installable on phone
- [ ] **OBS overlay mode** — transparent background + compact layout for streaming
- [ ] **Streaming TTS** — start lip sync before full audio generated
- [ ] **Spatial audio** — voice positioned at avatar in 3D space
- [ ] **Emotion detection** — analyze chat sentiment for smarter expression/action picking
- [ ] **Camera input** — face tracking via MediaPipe, mirror user's expressions
- [ ] **Multi-language** — Chinese/Japanese voice input + TTS
- [ ] **Screenshot & video export** — capture poses and record animation clips

## Phase 6: Dream 🌟
- [ ] **Native mobile app** via Capacitor
- [ ] **Desktop companion** — transparent overlay (like Tamagotchi)
- [ ] **VR/AR mode** — WebXR support
- [ ] **Live streaming** — OBS/VTuber integration
- [ ] **Multi-character** — multiple VRM avatars in one scene
- [ ] **Tailscale access** — secure remote viewing from anywhere

## Design Principles
1. **Web-first** — runs in any modern browser, no install needed
2. **Offline-capable** — core rendering works without internet
3. **API-driven** — everything controllable via WebSocket
4. **Beautiful by default** — sakura aesthetic out of the box 🌸
5. **Companion, not tool** — this is a home, not a dashboard 💣
