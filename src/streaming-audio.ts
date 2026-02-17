/**
 * Streaming audio player for voice/chat mode.
 *
 * Uses MediaSource Extensions to play MP3 audio chunks as they arrive
 * from the WS server, achieving near-zero buffering delay.
 * Falls back to Blob-based playback if MSE is unavailable (Safari).
 *
 * Exposes an AnalyserNode for real-time lip-sync in lip-sync.ts.
 */

import { setStreamingAnalyser } from './lip-sync'

const MP3_MIME = 'audio/mpeg'

class StreamingAudioPlayer {
  private mediaSource: MediaSource | null = null
  private sourceBuffer: SourceBuffer | null = null
  private audio: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private elSrc: MediaElementAudioSourceNode | null = null

  private queue: ArrayBuffer[] = []
  private fallbackChunks: ArrayBuffer[] = []
  private streamEnded = false
  private _playing = false
  private useMSE: boolean

  constructor() {
    this.useMSE =
      typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported(MP3_MIME)
  }

  /* ───── public API ───── */

  async startStream(): Promise<void> {
    this.cleanup()
    this.streamEnded = false
    this._playing = true
    this.queue = []
    this.fallbackChunks = []

    this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.5

    if (this.useMSE) {
      await this.initMSE()
    }

    setStreamingAnalyser(true, this.analyser)
  }

  feedChunk(base64: string): void {
    const buf = b64ToBuffer(base64)
    if (this.useMSE && this.sourceBuffer) {
      this.queue.push(buf)
      this.flush()
    } else {
      this.fallbackChunks.push(buf)
    }
  }

  /** Signal that no more chunks are coming. Resolves when audio finishes. */
  endStream(): Promise<void> {
    this.streamEnded = true

    if (this.useMSE) {
      return new Promise<void>((resolve) => {
        this.tryEndOfStream()

        if (!this.audio) { this.finish(); resolve(); return }

        const done = () => { this.finish(); resolve() }

        this.audio.addEventListener('ended', done, { once: true })

        // safety poll (ended event can be missed when duration is tiny)
        const iv = setInterval(() => {
          if (!this._playing) { clearInterval(iv); return }
          if (this.audio && (this.audio.ended || this.audio.paused)) {
            clearInterval(iv)
            done()
          }
        }, 200)
        setTimeout(() => { clearInterval(iv); done() }, 60_000)
      })
    }

    // fallback path — play accumulated blob
    return this.playFallback().then(() => this.finish())
  }

  stopStream(): void {
    this.streamEnded = true
    this.queue = []
    this.fallbackChunks = []
    if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load() }
    this.finish()
    this.cleanup()
  }

  isPlaying(): boolean { return this._playing }

  /* ───── MSE setup ───── */

  private async initMSE(): Promise<void> {
    this.mediaSource = new MediaSource()
    this.audio = new Audio()
    this.audio.src = URL.createObjectURL(this.mediaSource)

    await new Promise<void>((resolve, reject) => {
      this.mediaSource!.addEventListener('sourceopen', () => {
        try {
          this.sourceBuffer = this.mediaSource!.addSourceBuffer(MP3_MIME)
          this.sourceBuffer.addEventListener('updateend', () => {
            this.flush()
            this.tryEndOfStream()
          })
          resolve()
        } catch (e) { reject(e) }
      })
      setTimeout(() => reject(new Error('MSE open timeout')), 5000)
    })

    this.elSrc = this.ctx!.createMediaElementSource(this.audio)
    this.elSrc.connect(this.analyser!)
    this.analyser!.connect(this.ctx!.destination)

    this.audio.play().catch((e) => console.warn('[streaming-audio] play():', e))
  }

  /* ───── chunk queue ───── */

  private flush(): void {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.queue.length === 0) return
    const chunk = this.queue.shift()!
    try {
      this.sourceBuffer.appendBuffer(chunk)
    } catch (e: any) {
      if (e.name === 'QuotaExceededError') {
        const b = this.sourceBuffer.buffered
        if (b.length > 0) try { this.sourceBuffer.remove(0, b.start(b.length - 1)) } catch {}
        this.queue.unshift(chunk)
      } else {
        console.error('[streaming-audio] appendBuffer:', e)
      }
    }
  }

  private tryEndOfStream(): void {
    if (
      this.streamEnded &&
      this.queue.length === 0 &&
      this.sourceBuffer && !this.sourceBuffer.updating &&
      this.mediaSource?.readyState === 'open'
    ) {
      try { this.mediaSource.endOfStream() } catch {}
    }
  }

  /* ───── fallback (no MSE) ───── */

  private async playFallback(): Promise<void> {
    if (this.fallbackChunks.length === 0) return
    const total = this.fallbackChunks.reduce((s, b) => s + b.byteLength, 0)
    const merged = new Uint8Array(total)
    let off = 0
    for (const b of this.fallbackChunks) { merged.set(new Uint8Array(b), off); off += b.byteLength }

    const url = URL.createObjectURL(new Blob([merged], { type: 'audio/mpeg' }))
    this.audio = new Audio(url)
    this.elSrc = this.ctx!.createMediaElementSource(this.audio)
    this.elSrc.connect(this.analyser!)
    this.analyser!.connect(this.ctx!.destination)

    return new Promise<void>((resolve) => {
      this.audio!.addEventListener('ended', () => { URL.revokeObjectURL(url); resolve() }, { once: true })
      this.audio!.play().catch(() => resolve())
    })
  }

  /* ───── lifecycle ───── */

  private finish(): void {
    this._playing = false
    setStreamingAnalyser(false, null)
  }

  private cleanup(): void {
    if (this.audio) {
      this.audio.pause()
      if (this.audio.src?.startsWith('blob:')) URL.revokeObjectURL(this.audio.src)
    }
    this.audio = null
    this.elSrc = null
    this.sourceBuffer = null
    this.mediaSource = null
    if (this.analyser) try { this.analyser.disconnect() } catch {}
    this.analyser = null
    if (this.ctx) try { this.ctx.close() } catch {}
    this.ctx = null
    this.queue = []
    this.fallbackChunks = []
    this._playing = false
  }
}

/* ───── helpers ───── */

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Singleton — import and use directly */
export const streamingPlayer = new StreamingAudioPlayer()
