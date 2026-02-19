export type MusicMood = 'chill' | 'melancholy' | 'night' | 'romantic' | 'energetic'

interface TrackInfo {
  id: string
  title: string
  path: string
}

interface MusicState {
  playing: boolean
  mood: MusicMood
  volume: number
  currentTrack: string | null
}

const TRACKS_BY_MOOD: Record<MusicMood, TrackInfo[]> = {
  chill: [
    { id: 'french_mellow', title: 'French Mellow', path: '/music/french_mellow.mp3' },
    { id: 'so_far', title: 'So Far', path: '/music/so_far.mp3' },
    { id: 'lush_life', title: 'Lush Life', path: '/music/lush_life.mp3' },
    { id: 'paradise', title: 'Paradise', path: '/music/paradise.mp3' },
    { id: 'eazy_livin', title: "Eazy Livin'", path: '/music/eazy_livin.mp3' },
  ],
  melancholy: [
    { id: 'dark_city', title: 'Dark City', path: '/music/dark_city.mp3' },
    { id: 'remember_me', title: 'Remember Me', path: '/music/remember_me.mp3' },
    { id: 'heartbreakers', title: 'Heartbreakers', path: '/music/heartbreakers.mp3' },
  ],
  night: [
    { id: 'statues', title: 'Statues', path: '/music/statues.mp3' },
    { id: 'sacred_mushroom', title: 'Sacred Mushroom', path: '/music/sacred_mushroom.mp3' },
    { id: 'memoirs', title: 'Memoirs', path: '/music/memoirs.mp3' },
  ],
  romantic: [
    { id: 'guide_me', title: 'Guide Me', path: '/music/guide_me.mp3' },
    { id: 'dream_on', title: 'Dream On', path: '/music/dream_on.mp3' },
    { id: 'pacific', title: 'Pacific', path: '/music/pacific.mp3' },
  ],
  energetic: [
    { id: 'cheetah_chase', title: 'Cheetah Chase', path: '/music/cheetah_chase.mp3' },
  ],
}

const THEME_TO_MOOD: Record<string, MusicMood> = {
  sakura: 'chill',
  sunset: 'melancholy',
  ocean: 'chill',
  night: 'night',
  forest: 'chill',
  lavender: 'romantic',
  minimal: 'chill',
}

const DEFAULT_VOLUME = 0.15
const FADE_MS = 2000
const FADE_STEPS = 40

let initialized = false
let requestedPlaying = false
let activeSlot = 0
let currentMood: MusicMood = 'chill'
let currentTrack: TrackInfo | null = null
let lastTrackIdByMood: Partial<Record<MusicMood, string>> = {}
let volume = DEFAULT_VOLUME
let transitionToken = 0
let fadeInterval: number | null = null

let audioSlots: [HTMLAudioElement, HTMLAudioElement] | null = null

export function getAudioContext(): AudioContext | null {
  return null
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function getRandomTrack(mood: MusicMood, avoidTrackId?: string): TrackInfo {
  const tracks = TRACKS_BY_MOOD[mood]
  if (!tracks.length) {
    throw new Error(`No music tracks configured for mood: ${mood}`)
  }

  if (tracks.length === 1) {
    return tracks[0]
  }

  const forbidden = avoidTrackId ?? lastTrackIdByMood[mood]
  const candidates = forbidden ? tracks.filter((t) => t.id !== forbidden) : tracks
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function ensureAudioSlots(): boolean {
  if (typeof window === 'undefined') return false
  if (audioSlots) return true

  const makeAudio = (): HTMLAudioElement => {
    const audio = new Audio()
    audio.preload = 'auto'
    audio.loop = false
    // crossOrigin removed — same-origin in WKWebView
    return audio
  }

  const a0 = makeAudio()
  const a1 = makeAudio()

  a0.addEventListener('ended', () => {
    if (activeSlot === 0 && requestedPlaying) {
      void playNextTrackInMood('track-ended')
    }
  })

  a1.addEventListener('ended', () => {
    if (activeSlot === 1 && requestedPlaying) {
      void playNextTrackInMood('track-ended')
    }
  })

  audioSlots = [a0, a1]
  return true
}

function stopFadeInterval(): void {
  if (fadeInterval !== null) {
    window.clearInterval(fadeInterval)
    fadeInterval = null
  }
}

async function crossfadeToTrack(track: TrackInfo): Promise<void> {
  if (!audioSlots) return

  stopFadeInterval()

  const token = ++transitionToken
  const nextSlot = activeSlot === 0 ? 1 : 0
  const outAudio = audioSlots[activeSlot]
  const inAudio = audioSlots[nextSlot]

  inAudio.src = track.path
  inAudio.currentTime = 0
  inAudio.volume = 0

  try {
    await inAudio.play()
  } catch (error) {
    console.warn('[ambient-music] failed to start incoming track:', error)
    return
  }

  const outStart = outAudio.volume
  const stepMs = FADE_MS / FADE_STEPS
  let step = 0

  console.log('[ambient-music] crossfade start', {
    from: currentTrack?.id ?? null,
    to: track.id,
    mood: currentMood,
  })

  fadeInterval = window.setInterval(() => {
    if (transitionToken !== token) {
      stopFadeInterval()
      return
    }

    step += 1
    const t = step / FADE_STEPS
    outAudio.volume = Math.max(0, outStart * (1 - t))
    inAudio.volume = volume * t

    if (step >= FADE_STEPS) {
      stopFadeInterval()
      outAudio.pause()
      outAudio.removeAttribute('src')
      inAudio.volume = volume
      console.log('[ambient-music] crossfade complete', { currentTrack: track.id })
    }
  }, stepMs)

  currentTrack = track
  lastTrackIdByMood[currentMood] = track.id
  activeSlot = nextSlot
}

async function playNextTrackInMood(_reason: 'track-ended' | 'skip' | 'mood-change' | 'resume'): Promise<void> {
  if (!requestedPlaying) return
  if (!ensureAudioSlots()) return

  const nextTrack = getRandomTrack(currentMood, currentTrack?.id)
  await crossfadeToTrack(nextTrack)
}

export function getMusicMoodForTheme(theme: string): MusicMood {
  return THEME_TO_MOOD[theme] ?? 'chill'
}

export function initAmbientMusic(): void {
  if (initialized) return
  initialized = true

  try {
    ensureAudioSlots()
  } catch (err) {
    console.warn('[ambient-music] init failed:', err)
  }
}

export async function setMusicMood(mood: string): Promise<void> {
  const normalized = (mood in TRACKS_BY_MOOD ? mood : 'chill') as MusicMood
  currentMood = normalized

  // Do NOT auto-start playback on mood change
  // Only play if already playing
  if (requestedPlaying) {
    await playNextTrackInMood('mood-change')
  }
}

export function setMusicVolume(nextVolume: number): void {
  volume = clamp01(nextVolume)
  const activeAudio = audioSlots?.[activeSlot]
  if (activeAudio && !activeAudio.paused) {
    activeAudio.volume = volume
  }
}

export async function toggleMusic(enabled: boolean): Promise<void> {
  requestedPlaying = enabled

  if (!audioSlots && !ensureAudioSlots()) return

  if (!enabled) {
    stopFadeInterval()
    audioSlots?.forEach((audio) => {
      audio.pause()
      audio.currentTime = 0
      audio.volume = 0
    })
    console.log('[ambient-music] stopped')
    return
  }

  if (!currentTrack) {
    await playNextTrackInMood('resume')
    console.log('[ambient-music] started', { track: null, mood: currentMood })
    return
  }

  const activeAudio = audioSlots?.[activeSlot]
  if (!activeAudio) return

  const trackId = currentTrack.id
  activeAudio.volume = volume
  try {
    await activeAudio.play()
    console.log('[ambient-music] resumed', { track: trackId, mood: currentMood })
  } catch (error) {
    console.warn('[ambient-music] resume failed, picking another track:', error)
    await playNextTrackInMood('resume')
  }
}

export async function skipTrack(): Promise<void> {
  if (!requestedPlaying) return
  await playNextTrackInMood('skip')
}

export function getMusicState(): MusicState {
  const playing = requestedPlaying && Boolean(audioSlots?.[activeSlot] && !audioSlots[activeSlot].paused)
  return {
    playing,
    mood: currentMood,
    volume,
    currentTrack: currentTrack?.id ?? null,
  }
}
