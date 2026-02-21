import { state } from './app-state'
import type { VRM } from '@pixiv/three-vrm'

let speaking = false
let speakStart = 0
let speakDuration = 0

// Audio-driven lip sync
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let audioSource: AudioBufferSourceNode | null = null
let audioPlaying = false
let onAudioEndCallback: (() => void) | null = null
const missingMouthExpressionWarnings = new Set<string>()

function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext()
  return audioContext
}

function setExpressionIfAvailable(vrm: VRM, name: string, value: number) {
  const manager = vrm.expressionManager
  if (!manager) return
  if (manager.getExpression(name) != null) {
    manager.setValue(name, value)
    return
  }

  if (!missingMouthExpressionWarnings.has(name)) {
    missingMouthExpressionWarnings.add(name)
    console.warn(`[lip-sync] Model does not define mouth expression "${name}", skipping.`)
  }
}

/**
 * Allow the streaming-audio module to drive lip sync by injecting
 * its own AnalyserNode.  When playing=false the state is cleared.
 */
export function setStreamingAnalyser(playing: boolean, ext: AnalyserNode | null): void {
  audioPlaying = playing
  if (ext) {
    analyser = ext
  } else if (!playing) {
    analyser = null
  }
}

/**
 * Play audio from URL and drive lip sync from actual audio data.
 * Returns a promise that resolves when audio finishes.
 */
export async function playAudioLipSync(audioUrl: string): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume()

  // Fetch and decode audio
  const resp = await fetch(audioUrl)
  const arrayBuffer = await resp.arrayBuffer()
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

  // Stop any existing audio
  stopAudioLipSync()

  // Create analyser
  analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.5

  // Create source
  audioSource = ctx.createBufferSource()
  audioSource.buffer = audioBuffer

  audioSource.connect(analyser)
  analyser.connect(ctx.destination)

  audioPlaying = true

  return new Promise<void>((resolve) => {
    onAudioEndCallback = () => {
      audioPlaying = false
      analyser = null
      audioSource = null
      resolve()
    }
    audioSource!.onended = onAudioEndCallback
    audioSource!.start(0)
  })
}

export function stopAudioLipSync() {
  if (audioSource) {
    try { audioSource.stop() } catch {}
    audioSource = null
  }
  audioPlaying = false
  analyser = null
  onAudioEndCallback = null
}

export function isAudioPlaying(): boolean {
  return audioPlaying
}

/** Fallback: text-based sine wave lip sync */
export function triggerSpeak(text: string) {
  speaking = true
  speakStart = performance.now() / 1000
  speakDuration = Math.max(1, text.length * 0.08)
}

export function updateLipSync() {
  const vrm = state.vrm
  if (!vrm?.expressionManager) return

  // Audio-driven lip sync
  if (audioPlaying && analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(dataArray)

    // Get volume from different frequency bands
    const len = dataArray.length
    const low = avg(dataArray, 0, Math.floor(len * 0.15))      // low freq
    const midLow = avg(dataArray, Math.floor(len * 0.15), Math.floor(len * 0.3))
    const mid = avg(dataArray, Math.floor(len * 0.3), Math.floor(len * 0.5))
    const high = avg(dataArray, Math.floor(len * 0.5), Math.floor(len * 0.8))

    // Map frequency bands to vowel shapes
    const volume = avg(dataArray, 0, len) / 255
    const aa = clamp(volume * 2.5 * (low / 255))       // open mouth - low frequencies
    const oh = clamp((midLow / 255) * 1.5 * volume)     // rounded - mid-low
    const ih = clamp((mid / 255) * 1.2 * volume)        // spread - mid
    const ee = clamp((high / 255) * 1.0 * volume)       // tight spread - high
    const ou = clamp((midLow / 255) * 0.8 * volume)     // pursed - mid-low

    setExpressionIfAvailable(vrm, 'aa', aa)
    setExpressionIfAvailable(vrm, 'oh', oh)
    setExpressionIfAvailable(vrm, 'ih', ih)
    setExpressionIfAvailable(vrm, 'ee', ee)
    setExpressionIfAvailable(vrm, 'ou', ou)
    return
  }

  // Reset audio-driven values when not playing
  if (!speaking) {
    // Only reset if we were recently playing
    return
  }

  // Fallback sine-wave lip sync
  const elapsed = performance.now() / 1000 - speakStart
  if (elapsed > speakDuration) {
    speaking = false
    setExpressionIfAvailable(vrm, 'aa', 0)
    setExpressionIfAvailable(vrm, 'oh', 0)
    setExpressionIfAvailable(vrm, 'ih', 0)
    setExpressionIfAvailable(vrm, 'ee', 0)
    setExpressionIfAvailable(vrm, 'ou', 0)
    return
  }

  const t = elapsed * 8
  const aa = Math.max(0, Math.sin(t) * 0.6 + Math.sin(t * 1.7) * 0.3)
  const oh = Math.max(0, Math.cos(t * 0.7) * 0.3)
  setExpressionIfAvailable(vrm, 'aa', aa)
  setExpressionIfAvailable(vrm, 'oh', oh)
}

function avg(arr: Uint8Array, from: number, to: number): number {
  let sum = 0
  const count = to - from
  if (count <= 0) return 0
  for (let i = from; i < to; i++) sum += arr[i]
  return sum / count
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v))
}

export function resetLipSync() {
  speaking = false
  stopAudioLipSync()
  const vrm = state.vrm
  if (vrm?.expressionManager) {
    setExpressionIfAvailable(vrm, 'aa', 0)
    setExpressionIfAvailable(vrm, 'oh', 0)
    setExpressionIfAvailable(vrm, 'ih', 0)
    setExpressionIfAvailable(vrm, 'ee', 0)
    setExpressionIfAvailable(vrm, 'ou', 0)
  }
}
