export type AmbienceCategory = 'noise' | 'water' | 'wind' | 'nature' | 'city' | 'home'

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
  sounds: Array<{ id: string, volume: number }>
}

interface AmbienceState {
  masterVolume: number
  sounds: Array<{ id: string, enabled: boolean, volume: number }>
}

export const AMBIENCE_SOUNDS: AmbienceSound[] = [
  { id: 'PinkNoise', label: 'Pink', icon: 'wave', path: '/ambience/PinkNoise.mp3', category: 'noise' },
  { id: 'RoomNoise', label: 'Room', icon: 'room', path: '/ambience/RoomNoise.mp3', category: 'noise' },
  { id: 'RadioNoise', label: 'Radio', icon: 'radio', path: '/ambience/RadioNoise.mp3', category: 'noise' },
  { id: 'RecordNoise', label: 'Vinyl', icon: 'vinyl', path: '/ambience/RecordNoise.mp3', category: 'noise' },

  { id: 'LightRain', label: 'Light Rain', icon: 'rain', path: '/ambience/LightRain.mp3', category: 'water' },
  { id: 'HeavyRain', label: 'Heavy Rain', icon: 'rain-heavy', path: '/ambience/HeavyRain.mp3', category: 'water' },
  { id: 'Rainthunder', label: 'Rain+Thunder', icon: 'thunder', path: '/ambience/Rainthunder.mp3', category: 'water' },
  { id: 'Sea', label: 'Sea', icon: 'sea', path: '/ambience/Sea.mp3', category: 'water' },
  { id: 'Underwater', label: 'Underwater', icon: 'underwater', path: '/ambience/Underwater.mp3', category: 'water' },
  { id: 'Onsen', label: 'Onsen', icon: 'onsen', path: '/ambience/Onsen.mp3', category: 'water' },
  { id: 'Jellyfish', label: 'Jellyfish', icon: 'jelly', path: '/ambience/Jellyfish.mp3', category: 'water' },

  { id: 'Wind', label: 'Wind', icon: 'wind', path: '/ambience/Wind.mp3', category: 'wind' },
  { id: 'WindBell', label: 'Wind Bell', icon: 'bell', path: '/ambience/WindBell.mp3', category: 'wind' },

  { id: 'BirdChorus', label: 'Bird Chorus', icon: 'bird', path: '/ambience/BirdChorus.mp3', category: 'nature' },
  { id: 'TurtleDove', label: 'Turtle Dove', icon: 'dove', path: '/ambience/TurtleDove.mp3', category: 'nature' },
  { id: 'Chicada', label: 'Chicada', icon: 'cicada', path: '/ambience/Chicada.mp3', category: 'nature' },
  { id: 'Crickets', label: 'Crickets', icon: 'crickets', path: '/ambience/Crickets.mp3', category: 'nature' },
  { id: 'Higurashi', label: 'Higurashi', icon: 'summer', path: '/ambience/Higurashi.mp3', category: 'nature' },
  { id: 'Whale', label: 'Whale', icon: 'whale', path: '/ambience/Whale.mp3', category: 'nature' },

  { id: 'City', label: 'City', icon: 'city', path: '/ambience/City.mp3', category: 'city' },
  { id: 'Train', label: 'Train', icon: 'train', path: '/ambience/Train.mp3', category: 'city' },
  { id: 'Flog1', label: 'Flog 1', icon: 'car', path: '/ambience/Flog1.mp3', category: 'city' },
  { id: 'Flog2', label: 'Flog 2', icon: 'car', path: '/ambience/Flog2.mp3', category: 'city' },

  { id: 'Fireplace', label: 'Fireplace', icon: 'fire', path: '/ambience/Fireplace.mp3', category: 'home' },
  { id: 'CookSimmer', label: 'Cook Simmer', icon: 'cook', path: '/ambience/CookSimmer.mp3', category: 'home' },
  { id: 'CookTypeB', label: 'Cook Type B', icon: 'cook', path: '/ambience/CookTypeB.mp3', category: 'home' },
  { id: 'KeyboardTyping', label: 'Keyboard', icon: 'keyboard', path: '/ambience/KeyboardTyping.mp3', category: 'home' },
  { id: 'KitchenWashingCup_1', label: 'Washing Cup', icon: 'cup', path: '/ambience/KitchenWashingCup_1.mp3', category: 'home' },
  { id: 'KitchenWaterOnly_1', label: 'Kitchen Water', icon: 'water', path: '/ambience/KitchenWaterOnly_1.mp3', category: 'home' },
  { id: 'WritePen', label: 'Write Pen', icon: 'pen', path: '/ambience/WritePen.mp3', category: 'home' },
]

export const AMBIENCE_PRESETS: AmbiencePreset[] = [
  {
    id: 'rain_focus',
    label: 'Rain Focus',
    sounds: [
      { id: 'LightRain', volume: 0.58 },
      { id: 'PinkNoise', volume: 0.28 },
      { id: 'KeyboardTyping', volume: 0.20 },
    ],
  },
  {
    id: 'storm_room',
    label: 'Storm Room',
    sounds: [
      { id: 'Rainthunder', volume: 0.42 },
      { id: 'RoomNoise', volume: 0.26 },
      { id: 'Fireplace', volume: 0.16 },
    ],
  },
  {
    id: 'ocean_sleep',
    label: 'Ocean Sleep',
    sounds: [
      { id: 'Sea', volume: 0.60 },
      { id: 'Wind', volume: 0.26 },
      { id: 'Whale', volume: 0.22 },
      { id: 'PinkNoise', volume: 0.16 },
    ],
  },
  {
    id: 'cozy_home',
    label: 'Cozy Home',
    sounds: [
      { id: 'Fireplace', volume: 0.55 },
      { id: 'CookSimmer', volume: 0.34 },
      { id: 'KitchenWaterOnly_1', volume: 0.18 },
      { id: 'WritePen', volume: 0.20 },
    ],
  },
  {
    id: 'city_night',
    label: 'City Night',
    sounds: [
      { id: 'City', volume: 0.50 },
      { id: 'Train', volume: 0.24 },
      { id: 'RadioNoise', volume: 0.18 },
      { id: 'RoomNoise', volume: 0.16 },
    ],
  },
  {
    id: 'summer_dusk',
    label: 'Summer Dusk',
    sounds: [
      { id: 'BirdChorus', volume: 0.34 },
      { id: 'Chicada', volume: 0.38 },
      { id: 'Higurashi', volume: 0.24 },
      { id: 'Wind', volume: 0.20 },
    ],
  },
  {
    id: 'deep_focus',
    label: 'Deep Focus',
    sounds: [
      { id: 'PinkNoise', volume: 0.44 },
      { id: 'RoomNoise', volume: 0.34 },
      { id: 'KeyboardTyping', volume: 0.24 },
      { id: 'WritePen', volume: 0.20 },
    ],
  },
]

const DEFAULT_SOUND_VOLUME = 0.52
const MASTER_OUTPUT_SCALE = 0.5

let initialized = false
let masterVolume = 1
const channels = new Map<string, AmbienceChannel>()
const canonicalLookup = new Map<string, string>()

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function canonicalID(rawID: string): string | null {
  const trimmed = rawID.trim()
  if (!trimmed) return null
  return canonicalLookup.get(trimmed.toLowerCase()) ?? null
}

function applyChannelVolume(id: string): void {
  const channel = channels.get(id)
  if (!channel) return
  channel.audio.volume = channel.enabled ? channel.volume * masterVolume * MASTER_OUTPUT_SCALE : 0
}

export function initAmbienceMixer(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  for (const sound of AMBIENCE_SOUNDS) {
    canonicalLookup.set(sound.id.toLowerCase(), sound.id)

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
  const resolvedID = canonicalID(soundId)
  if (!resolvedID) return
  const channel = channels.get(resolvedID)
  if (!channel) return

  channel.enabled = enabled
  applyChannelVolume(resolvedID)

  if (enabled) {
    try {
      await channel.audio.play()
    } catch (error) {
      console.warn('[ambience-mixer] failed to play sound:', resolvedID, error)
    }
    return
  }

  channel.audio.pause()
  channel.audio.currentTime = 0
}

export function setSoundVolume(soundId: string, volume: number): void {
  const resolvedID = canonicalID(soundId)
  if (!resolvedID) return
  const channel = channels.get(resolvedID)
  if (!channel) return

  channel.volume = clamp01(volume)
  applyChannelVolume(resolvedID)
}

export function setMasterVolume(volume: number): void {
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

  const byID = new Map(preset.sounds.map((sound) => [sound.id, sound]))

  for (const sound of AMBIENCE_SOUNDS) {
    const presetSound = byID.get(sound.id)
    if (!presetSound) {
      await toggleSound(sound.id, false)
      continue
    }
    setSoundVolume(sound.id, presetSound.volume)
    await toggleSound(sound.id, true)
  }
}

export async function setAmbience(sounds: Array<{ id: string, volume: number }>): Promise<void> {
  const normalized = sounds
    .map((sound) => {
      const id = canonicalID(sound.id)
      if (!id) return null
      return { id, volume: clamp01(sound.volume) }
    })
    .filter((sound): sound is { id: string, volume: number } => sound !== null)

  const targetIDs = new Set(normalized.map((sound) => sound.id))

  for (const sound of AMBIENCE_SOUNDS) {
    if (!targetIDs.has(sound.id)) {
      await toggleSound(sound.id, false)
    }
  }

  for (const sound of normalized) {
    setSoundVolume(sound.id, sound.volume)
    await toggleSound(sound.id, true)
  }
}
