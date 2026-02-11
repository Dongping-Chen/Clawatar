type SendCallback = (text: string) => void

let chatMessages: HTMLDivElement | null = null
let sendCallback: SendCallback | null = null

export function initChatUI(onSend: SendCallback) {
  sendCallback = onSend

  const container = document.getElementById('chat-container')!
  chatMessages = document.getElementById('chat-messages') as HTMLDivElement
  const input = document.getElementById('chat-input') as HTMLInputElement
  const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement

  const doSend = () => {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    addMessage('user', text)
    if (sendCallback) sendCallback(text)
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend()
  })
  sendBtn.addEventListener('click', doSend)

  // Toggle chat visibility
  const toggleBtn = document.getElementById('chat-header')
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      container.classList.toggle('collapsed')
    })
  }
}

export function addMessage(role: 'user' | 'avatar' | 'system', text: string) {
  if (!chatMessages) return
  const row = document.createElement('div')

  if (role === 'system') {
    row.className = 'chat-msg system'
    const bubble = document.createElement('div')
    bubble.className = 'chat-bubble'
    bubble.textContent = text
    row.appendChild(bubble)
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    row.className = `chat-msg ${role === 'user' ? 'mine' : 'theirs'} chat-${role}`

    if (role === 'avatar') {
      const icon = document.createElement('span')
      icon.className = 'chat-avatar-icon'
      icon.textContent = '💣'
      row.appendChild(icon)
    }

    const bubble = document.createElement('div')
    bubble.className = 'chat-bubble'

    const meta = document.createElement('div')
    meta.className = 'chat-meta'

    const name = document.createElement('span')
    name.className = 'chat-name'
    name.textContent = role === 'user' ? 'You' : 'Clawatar'

    const stamp = document.createElement('span')
    stamp.className = 'chat-time'
    stamp.textContent = time

    const message = document.createElement('div')
    message.className = 'chat-text'
    message.textContent = text

    meta.appendChild(name)
    meta.appendChild(stamp)
    bubble.appendChild(meta)
    bubble.appendChild(message)
    row.appendChild(bubble)
  }

  chatMessages.appendChild(row)
  chatMessages.scrollTop = chatMessages.scrollHeight
}
