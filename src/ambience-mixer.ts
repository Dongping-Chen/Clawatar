export type AmbienceCategory = 'rain' | 'water' | 'weather' | 'nature' | 'cozy' | 'urban' | 'asmr' | 'noise'

export interface AmbienceSound {
  id: string
  label: string
  icon: string
  path: string
  category: AmbienceCategory
}

interface AmbienceChannel {
  audio: HTMLAudioElement
  enabled: boolean
  volume: number
}

interface AmbiencePreset {
  id: string
  label: string
  sounds: Array<{ id: string, volume?: number }>
}

interface AmbienceState {
  masterVolume: number
  sounds: Array<{ id: string, enabled: boolean, volume: number }>
}

export const AMBIENCE_SOUNDS: AmbienceSound[] = [
  { id: 'rain', label: 'Light Rain', icon: '🌧️', path: '/ambience/rain.mp3', category: 'rain' },
  { id: 'rain_heavy', label: 'Heavy Rain', icon: '🌧️', path: '/ambience/rain_heavy.mp3', category: 'rain' },
  { id: 'rain_window', label: 'Rain on Window', icon: '🪟', path: '/ambience/rain_window.mp3', category: 'rain' },
  { id: 'rain_gentle', label: 'Gentle Rain', icon: '🌦️', path: '/ambience/rain_gentle.mp3', category: 'rain' },
  { id: 'rain_tent', label: 'Rain on Tent', icon: '⛺', path: '/ambience/rain_tent.mp3', category: 'rain' },

  { id: 'ocean', label: 'Ocean Waves', icon: '🌊', path: '/ambience/ocean.mp3', category: 'water' },
  { id: 'waves_shore', label: 'Waves on Shore', icon: '🏖️', path: '/ambience/waves_shore.mp3', category: 'water' },
  { id: 'stream', label: 'Stream', icon: '🏞️', path: '/ambience/stream.mp3', category: 'water' },
  { id: 'waterfall', label: 'Waterfall', icon: '💧', path: '/ambience/waterfall.mp3', category: 'water' },
  { id: 'water_drip', label: 'Water Drops', icon: '💦', path: '/ambience/water_drip.mp3', category: 'water' },
  { id: 'fountain', label: 'Fountain', icon: '⛲', path: '/ambience/fountain.mp3', category: 'water' },
  { id: 'underwater', label: 'Underwater', icon: '🫧', path: '/ambience/underwater.mp3', category: 'water' },

  { id: 'wind', label: 'Gentle Wind', icon: '🌬️', path: '/ambience/wind.mp3', category: 'weather' },
  { id: 'wind_strong', label: 'Strong Wind', icon: '💨', path: '/ambience/wind_strong.mp3', category: 'weather' },
  { id: 'breeze', label: 'Breeze', icon: '🍃', path: '/ambience/breeze.mp3', category: 'weather' },
  { id: 'thunder', label: 'Thunder', icon: '⛈️', path: '/ambience/thunder.mp3', category: 'weather' },
  { id: 'snow_wind', label: 'Snowy Wind', icon: '❄️', path: '/ambience/snow_wind.mp3', category: 'weather' },

  { id: 'birds', label: 'Birds', icon: '🐦', path: '/ambience/birds.mp3', category: 'nature' },
  { id: 'birds_morning', label: 'Morning Birds', icon: '🌅', path: '/ambience/birds_morning.mp3', category: 'nature' },
  { id: 'seagulls', label: 'Seagulls', icon: '🦅', path: '/ambience/seagulls.mp3', category: 'nature' },
  { id: 'owl', label: 'Owl', icon: '🦉', path: '/ambience/owl.mp3', category: 'nature' },
  { id: 'crickets', label: 'Crickets', icon: '🦗', path: '/ambience/crickets.mp3', category: 'nature' },
  { id: 'cicadas', label: 'Cicadas', icon: '🪲', path: '/ambience/cicadas.mp3', category: 'nature' },
  { id: 'frogs', label: 'Frogs', icon: '🐸', path: '/ambience/frogs.mp3', category: 'nature' },
  { id: 'cat_purr', label: 'Cat Purring', icon: '🐱', path: '/ambience/cat_purr.mp3', category: 'nature' },
  { id: 'forest', label: 'Forest', icon: '🌲', path: '/ambience/forest.mp3', category: 'nature' },
  { id: 'night_ambience', label: 'Night Ambience', icon: '🌙', path: '/ambience/night_ambience.mp3', category: 'nature' },

  { id: 'fire', label: 'Fireplace', icon: '🔥', path: '/ambience/fire.mp3', category: 'cozy' },
  { id: 'campfire', label: 'Campfire', icon: '🏕️', path: '/ambience/campfire.mp3', category: 'cozy' },
  { id: 'cafe', label: 'Cafe', icon: '☕', path: '/ambience/cafe.mp3', category: 'cozy' },
  { id: 'crowd_murmur', label: 'Crowd Murmur', icon: '👥', path: '/ambience/crowd_murmur.mp3', category: 'cozy' },
  { id: 'church_bells', label: 'Church Bells', icon: '🔔', path: '/ambience/church_bells.mp3', category: 'cozy' },
  { id: 'windchimes', label: 'Wind Chimes', icon: '🎐', path: '/ambience/windchimes.mp3', category: 'cozy' },
  { id: 'singing_bowl', label: 'Singing Bowl', icon: '🔔', path: '/ambience/singing_bowl.mp3', category: 'cozy' },
  { id: 'heartbeat', label: 'Heartbeat', icon: '💓', path: '/ambience/heartbeat.mp3', category: 'cozy' },

  { id: 'city_traffic', label: 'City Traffic', icon: '🚗', path: '/ambience/city_traffic.mp3', category: 'urban' },
  { id: 'train', label: 'Train', icon: '🚂', path: '/ambience/train.mp3', category: 'urban' },
  { id: 'fan', label: 'Fan', icon: '🌀', path: '/ambience/fan.mp3', category: 'urban' },
  { id: 'washing', label: 'Washing Machine', icon: '🫧', path: '/ambience/washing.mp3', category: 'urban' },
  { id: 'clock_tick', label: 'Clock Ticking', icon: '🕐', path: '/ambience/clock_tick.mp3', category: 'urban' },

  { id: 'typing', label: 'Keyboard Typing', icon: '⌨️', path: '/ambience/typing.mp3', category: 'asmr' },
  { id: 'page_turn', label: 'Page Turning', icon: '📖', path: '/ambience/page_turn.mp3', category: 'asmr' },
  { id: 'pen_writing', label: 'Pen Writing', icon: '✏️', path: '/ambience/pen_writing.mp3', category: 'asmr' },

  { id: 'whitenoise', label: 'White Noise', icon: '📻', path: '/ambience/whitenoise.mp3', category: 'noise' },
  { id: 'brownnoise', label: 'Brown Noise', icon: '🎛️', path: '/ambience/brownnoise.mp3', category: 'noise' },
]

export const AMBIENCE_PRESETS: AmbiencePreset[] = [
  { id: 'rainy_day', label: 'Rainy Day', sounds: [{ id: 'rain' }, { id: 'thunder', volume: 0.3 }, { id: 'fire', volume: 0.5 }] },
  { id: 'forest_morning', label: 'Forest Morning', sounds: [{ id: 'birds_morning' }, { id: 'stream' }, { id: 'breeze', volume: 0.3 }] },
  { id: 'night_calm', label: 'Night Calm', sounds: [{ id: 'crickets' }, { id: 'wind', volume: 0.2 }, { id: 'brownnoise', volume: 0.3 }, { id: 'owl', volume: 0.2 }] },
  { id: 'cafe_study', label: 'Cafe Study', sounds: [{ id: 'cafe' }, { id: 'rain', volume: 0.3 }, { id: 'typing', volume: 0.4 }] },
  { id: 'ocean_breeze', label: 'Ocean Breeze', sounds: [{ id: 'ocean' }, { id: 'wind', volume: 0.4 }, { id: 'seagulls', volume: 0.2 }] },
  { id: 'cozy_cabin', label: 'Cozy Cabin', sounds: [{ id: 'fire' }, { id: 'rain_window', volume: 0.6 }, { id: 'wind', volume: 0.2 }, { id: 'clock_tick', volume: 0.3 }] },
  { id: 'zen_garden', label: 'Zen Garden', sounds: [{ id: 'fountain' }, { id: 'windchimes', volume: 0.4 }, { id: 'birds', volume: 0.3 }, { id: 'breeze', volume: 0.2 }] },
  { id: 'deep_focus', label: 'Deep Focus', sounds: [{ id: 'brownnoise', volume: 0.5 }, { id: 'rain_gentle', volume: 0.3 }] },
  { id: 'campfire_night', label: 'Campfire Night', sounds: [{ id: 'campfire' }, { id: 'crickets', volume: 0.4 }, { id: 'owl', volume: 0.2 }, { id: 'night_ambience', volume: 0.3 }] },
  { id: 'train_journey', label: 'Train Journey', sounds: [{ id: 'train' }, { id: 'rain_window', volume: 0.3 }, { id: 'crowd_murmur', volume: 0.2 }] },
  { id: 'cat_nap', label: 'Cat Nap', sounds: [{ id: 'cat_purr' }, { id: 'fire', volume: 0.3 }, { id: 'rain_gentle', volume: 0.2 }] },
  { id: 'library', label: 'Library', sounds: [{ id: 'clock_tick', volume: 0.3 }, { id: 'page_turn', volume: 0.2 }, { id: 'pen_writing', volume: 0.3 }, { id: 'brownnoise', volume: 0.15 }] },
]

const DEFAULT_SOUND_VOLUME = 0.7

let initialized = false
let masterVolume = 1
const channels = new Map<string, AmbienceChannel>()

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function applyChannelVolume(id: string): void {
  const channel = channels.get(id)
  if (!channel) return
  channel.audio.volume = channel.enabled ? channel.volume * masterVolume : 0
}

export function initAmbienceMixer(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  for (const sound of AMBIENCE_SOUNDS) {
    const audio = new Audio(sound.path)
    audio.preload = 'none'
    audio.loop = true
    audio.volume = 0

    channels.set(sound.id, {
      audio,
      enabled: false,
      volume: DEFAULT_SOUND_VOLUME,
    })
  }
}

export async function toggleSound(soundId: string, enabled: boolean): Promise<void> {
  console.log(`[ambience] toggleSound: ${soundId} → ${enabled}`)

  const channel = channels.get(soundId)
  if (!channel) return

  channel.enabled = enabled
  applyChannelVolume(soundId)

  if (enabled) {
    console.log('[ambience-mixer] sound on', { soundId, volume: channel.audio.volume })
    try {
      await channel.audio.play()
    } catch (error) {
      console.warn('[ambience-mixer] failed to play sound:', soundId, error)
    }
    return
  }

  channel.audio.pause()
  channel.audio.currentTime = 0
  console.log('[ambience-mixer] sound off', { soundId })
}

export function setSoundVolume(soundId: string, volume: number): void {
  console.log(`[ambience] setSoundVolume: ${soundId} → ${volume}`)

  const channel = channels.get(soundId)
  if (!channel) return

  channel.volume = clamp01(volume)
  applyChannelVolume(soundId)
}

export function setMasterVolume(volume: number): void {
  console.log(`[ambience] setMasterVolume: ${volume}`)

  masterVolume = clamp01(volume)
  for (const id of channels.keys()) {
    applyChannelVolume(id)
  }
}

export function getAmbienceState(): AmbienceState {
  return {
    masterVolume,
    sounds: AMBIENCE_SOUNDS.map((sound) => {
      const channel = channels.get(sound.id)
      return {
        id: sound.id,
        enabled: channel?.enabled ?? false,
        volume: channel?.volume ?? DEFAULT_SOUND_VOLUME,
      }
    }),
  }
}

export async function applyPreset(presetId: string): Promise<void> {
  const preset = AMBIENCE_PRESETS.find((p) => p.id === presetId)
  if (!preset) return

  const byId = new Map(preset.sounds.map((s) => [s.id, s]))

  for (const sound of AMBIENCE_SOUNDS) {
    const presetSound = byId.get(sound.id)
    if (!presetSound) {
      await toggleSound(sound.id, false)
      continue
    }

    if (typeof presetSound.volume === 'number') {
      setSoundVolume(sound.id, presetSound.volume)
    }
    await toggleSound(sound.id, true)
  }
}

export async function setAmbience(sounds: Array<{ id: string, volume: number }>): Promise<void> {
  const targetIds = new Set(sounds.map((s) => s.id))

  for (const sound of AMBIENCE_SOUNDS) {
    if (!targetIds.has(sound.id)) {
      await toggleSound(sound.id, false)
    }
  }

  for (const sound of sounds) {
    setSoundVolume(sound.id, sound.volume)
    await toggleSound(sound.id, true)
  }
}
