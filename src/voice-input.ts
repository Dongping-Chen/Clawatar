type SpeechCallback = (text: string) => void

let recognition: any = null
let isListening = false
let onResultCallback: SpeechCallback | null = null
let micButton: HTMLButtonElement | null = null

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
  recognition.lang = 'en-US'

  recognition.onresult = (event: any) => {
    const text = event.results[0][0].transcript
    if (text && onResultCallback) onResultCallback(text)
  }

  recognition.onend = () => {
    setListening(false)
  }

  recognition.onerror = (e: any) => {
    console.warn('Speech recognition error:', e.error)
    setListening(false)
  }
}

export function toggleListening() {
  if (!recognition) return
  if (isListening) {
    recognition.stop()
    setListening(false)
  } else {
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
