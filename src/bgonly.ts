import { initScene, initContactShadow, scene, camera, renderer, controls, clock, setBackgroundTheme } from './scene'
import { initBackgrounds, applyThemeParticles, updateBackgroundEffects } from './backgrounds'
import { initGradientBackground, setGradientTheme, updateGradientBackground } from './gradient-background'

type AnyCommand = Record<string, unknown>

function normalizeCommandPayload(payload: unknown): AnyCommand | null {
  try {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = (parsed as AnyCommand).command && typeof (parsed as AnyCommand).command === 'object'
      ? (parsed as AnyCommand).command as AnyCommand
      : parsed as AnyCommand
    if (!candidate || typeof candidate !== 'object') return null
    return candidate
  } catch {
    return null
  }
}

function applyTheme(theme: string) {
  const appliedTheme = setBackgroundTheme(theme)
  applyThemeParticles(appliedTheme)
  setGradientTheme(appliedTheme)
}

function handleCommand(cmd: AnyCommand) {
  const type = String(cmd.type ?? '')
  if (type === 'set_background_theme' && typeof cmd.theme === 'string') {
    applyTheme(cmd.theme)
    return
  }

  if (type !== 'sync') return

  const category = String(cmd.category ?? '').toLowerCase()
  const payload = (cmd.payload && typeof cmd.payload === 'object')
    ? cmd.payload as Record<string, unknown>
    : {}

  if (category === 'theme' && typeof payload.theme === 'string') {
    applyTheme(payload.theme)
  }
}

function initNativeThemeSyncReceiver() {
  ;(window as any).__clawatar_receive_sync_command = (payload: unknown) => {
    const cmd = normalizeCommandPayload(payload)
    if (cmd) handleCommand(cmd)
  }

  window.addEventListener('message', (event) => {
    const cmd = normalizeCommandPayload(event.data)
    if (cmd) handleCommand(cmd)
  })
}

function animate() {
  requestAnimationFrame(animate)
  const delta = clock.getDelta()
  const elapsed = clock.elapsedTime
  updateBackgroundEffects(elapsed, delta)
  updateGradientBackground(elapsed, delta)
  renderer.render(scene, camera)
}

async function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null
  if (!canvas) {
    throw new Error('Missing #canvas for bgonly renderer')
  }

  const params = new URLSearchParams(window.location.search)
  const initialTheme = params.get('theme') || 'sakura'

  await initScene(canvas, { disableOrbitControls: true })
  initContactShadow(false)
  initGradientBackground(scene, initialTheme)
  initBackgrounds(initialTheme)
  applyTheme(initialTheme)

  // Background-only layer should not spend cycles on user camera controls.
  controls.enabled = false

  initNativeThemeSyncReceiver()
  animate()
}

void init().catch((error) => {
  console.error('[bgonly] init failed:', error)
})
