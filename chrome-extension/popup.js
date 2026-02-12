const WS_URL = 'ws://localhost:8765'
const CHUNK_MS = 5000

let mediaStream = null
let recorder = null
let ws = null
let capturing = false

const statusEl = document.getElementById('status')
const startBtn = document.getElementById('startBtn')
const stopBtn = document.getElementById('stopBtn')

function setStatus(text, active = false) {
  statusEl.textContent = text
  statusEl.className = active ? 'status active' : 'status'
}

function connectWS() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL)
    socket.binaryType = 'arraybuffer'
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: 'register_device',
        device_type: 'chrome-audio-capture',
        device_name: 'Meeting Tab Audio',
      }))
      resolve(socket)
    }
    socket.onerror = () => reject(new Error('WS connection failed'))
    socket.onclose = () => {
      if (capturing) {
        setStatus('WS disconnected, reconnecting...')
        setTimeout(() => {
          connectWS().then(s => { ws = s }).catch(() => {})
        }, 3000)
      }
    }
  })
}

startBtn.addEventListener('click', async () => {
  try {
    setStatus('Connecting to Clawatar...')
    ws = await connectWS()
    setStatus('Requesting tab audio...')

    // Get current tab ID
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) {
      setStatus('Error: no active tab')
      return
    }

    // MV3 tabCapture: get a MediaStreamId, then use getUserMedia
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tab.id },
        (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
          else resolve(id)
        }
      )
    })

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    })

    if (!mediaStream) {
      setStatus('Failed — no audio stream')
      return
    }

    recorder = new MediaRecorder(mediaStream, {
      mimeType: 'audio/webm;codecs=opus',
    })

    recorder.ondataavailable = async (event) => {
      if (event.data.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) return
      const buffer = await event.data.arrayBuffer()
      ws.send(JSON.stringify({
        type: 'audio_chunk',
        size: buffer.byteLength,
        mimeType: 'audio/webm',
        timestamp: Date.now(),
      }))
      ws.send(buffer)
    }

    recorder.start(CHUNK_MS)
    capturing = true
    setStatus('Capturing meeting audio...', true)
    startBtn.style.display = 'none'
    stopBtn.style.display = 'block'

  } catch (err) {
    setStatus('Error: ' + err.message)
    console.error(err)
  }
})

stopBtn.addEventListener('click', () => {
  capturing = false
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop())
  if (ws) ws.close()
  mediaStream = null
  recorder = null
  ws = null
  setStatus('Stopped')
  startBtn.style.display = 'block'
  stopBtn.style.display = 'none'
})
