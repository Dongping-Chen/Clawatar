type SpeechCallback = (text: string) => void

const FALLBACK_LANGS = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'fr-FR',
  'de-DE',
  'es-ES',
  'it-IT',
  'pt-BR',
  'ru-RU',
  'ar-SA',
  'hi-IN',
]

const DEFAULT_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ar: 'ar-SA',
  hi: 'hi-IN',
}

const LATIN_HINTS: Array<{ lang: string; pattern: RegExp }> = [
  { lang: 'es-ES', pattern: /\b(hola|gracias|por favor|buenos|buenas|qué|como|estás|usted|mañana|dónde)\b/i },
  { lang: 'fr-FR', pattern: /\b(bonjour|merci|s'il|vous|êtes|ça|avec|pourquoi|demain|où)\b/i },
  { lang: 'de-DE', pattern: /\b(hallo|danke|bitte|ich|nicht|und|morgen|wie|geht|dir)\b/i },
  { lang: 'it-IT', pattern: /\b(ciao|grazie|per favore|come stai|domani|dove|perché|sono|sei)\b/i },
  { lang: 'pt-BR', pattern: /\b(olá|obrigado|obrigada|por favor|você|amanhã|onde|porque|tudo bem)\b/i },
]

let recognition: any = null
let isListening = false
let onResultCallback: SpeechCallback | null = null
let micButton: HTMLButtonElement | null = null
let languageQueue = buildLanguageQueue()
let preferredLang = languageQueue[0] ?? 'en-US'

export function initVoiceInput(onResult: SpeechCallback) {
  onResultCallback = onResult

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognition) {
    console.warn('Speech Recognition API not supported')
    return
  }

  recognition = new SpeechRecognition()
  recognition.continuous = false
  recognition.interimResults = false
  recognition.lang = preferredLang

  recognition.onresult = (event: any) => {
    const text = event.results[0][0].transcript
    const detected = detectLangFromText(text)
    if (detected) {
      promoteLanguage(detected)
    }
    if (text && onResultCallback) onResultCallback(text)
  }

  recognition.onend = () => {
    setListening(false)
  }

  recognition.onerror = (e: any) => {
    console.warn('Speech recognition error:', e.error)
    if (e?.error === 'no-speech' || e?.error === 'nomatch') {
      cycleLanguage()
    }
    setListening(false)
  }
}

export function toggleListening() {
  if (!recognition) return
  if (isListening) {
    recognition.stop()
    setListening(false)
  } else {
    recognition.lang = preferredLang
    recognition.start()
    setListening(true)
  }
}

export function setMicButton(btn: HTMLButtonElement) {
  micButton = btn
}

function setListening(val: boolean) {
  isListening = val
  if (micButton) {
    micButton.classList.toggle('recording', val)
  }
}

function buildLanguageQueue(): string[] {
  const queue: string[] = []
  const seen = new Set<string>()

  const append = (lang: string | null | undefined) => {
    const normalized = normalizeSupportedLang(lang)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    queue.push(normalized)
  }

  const browserLanguages = [...(navigator.languages ?? []), navigator.language]
  browserLanguages.forEach(append)
  FALLBACK_LANGS.forEach(append)

  if (!queue.length) {
    queue.push('en-US')
  }

  return queue
}

function promoteLanguage(lang: string) {
  const normalized = normalizeSupportedLang(lang)
  if (!normalized) return

  languageQueue = [normalized, ...languageQueue.filter((item) => item !== normalized)]
  preferredLang = languageQueue[0]
}

function cycleLanguage() {
  if (languageQueue.length < 2) return

  const first = languageQueue.shift()
  if (!first) return
  languageQueue.push(first)
  preferredLang = languageQueue[0]
}

function normalizeSupportedLang(lang: string | null | undefined): string | null {
  if (!lang) return null

  const normalized = lang.replace('_', '-').trim().toLowerCase()
  if (!normalized) return null

  if (normalized.startsWith('zh-hant') || normalized.includes('-tw') || normalized.includes('-hk') || normalized.includes('-mo')) {
    return 'zh-TW'
  }
  if (normalized.startsWith('zh-hans')) {
    return 'zh-CN'
  }

  const [languageCode, region] = normalized.split('-')
  if (DEFAULT_BY_LANGUAGE[languageCode]) {
    if (languageCode === 'zh' && region === 'tw') return 'zh-TW'
    return DEFAULT_BY_LANGUAGE[languageCode]
  }

  if (!languageCode) return null
  if (region && region.length >= 2 && region.length <= 3) {
    return `${languageCode}-${region.toUpperCase()}`
  }

  return null
}

function detectLangFromText(text: string): string | null {
  if (!text) return null

  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP'
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text)) return 'ko-KR'
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN'
  if (/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/.test(text)) return 'ar-SA'
  if (/[\u0900-\u097f]/.test(text)) return 'hi-IN'
  if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU'

  const latinGuess = detectLatinLanguage(text)
  if (latinGuess) return latinGuess

  return /[A-Za-z]/.test(text) ? 'en-US' : null
}

function detectLatinLanguage(text: string): string | null {
  for (const hint of LATIN_HINTS) {
    if (hint.pattern.test(text)) {
      return hint.lang
    }
  }

  return null
}
