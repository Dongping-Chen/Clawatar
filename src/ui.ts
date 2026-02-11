import { loadVRM } from './vrm-loader'
import { loadAndPlay } from './animation'
import { setExpression, getExpressionOverrides } from './expressions'
import { setTransparentBackground } from './scene'
import { state } from './main'
import { requestAction, onStateChange, idleConfig } from './action-state-machine'
import { crossfadeConfig } from './animation'

// Actions loaded from catalog
let ALL_ACTIONS: string[] = []

async function loadCatalog() {
  try {
    const resp = await fetch('/animations/catalog.json')
    if (resp.ok) {
      const catalog = await resp.json()
      ALL_ACTIONS = catalog.animations.map((a: any) => a.id)
    }
  } catch (e) {
    console.warn('Failed to load animation catalog:', e)
  }
  if (ALL_ACTIONS.length === 0) {
    // Fallback
    ALL_ACTIONS = ['119_Idle', '161_Waving', '86_Talking']
  }
}

const EXPRESSIONS = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral']

export async function initUI() {
  await loadCatalog()
  // State indicator
  const stateEl = document.getElementById('state-indicator')
  if (stateEl) {
    onStateChange((s) => {
      stateEl.textContent = s.charAt(0).toUpperCase() + s.slice(1)
      stateEl.className = `state-badge state-${s}`
    })
  }

  // Load model button
  document.getElementById('load-model-btn')?.addEventListener('click', () => {
    const input = document.getElementById('model-url') as HTMLInputElement
    if (input.value) loadVRM(input.value).catch(console.error)
  })

  // Action search/select
  const actionSelect = document.getElementById('action-select') as HTMLSelectElement
  const actionSearch = document.getElementById('action-search') as HTMLInputElement
  if (actionSelect) {
    populateActions(actionSelect, ALL_ACTIONS)
  }
  if (actionSearch && actionSelect) {
    actionSearch.addEventListener('input', () => {
      const q = actionSearch.value.toLowerCase()
      const filtered = ALL_ACTIONS.filter(a => a.toLowerCase().includes(q))
      populateActions(actionSelect, filtered)
    })
  }
  document.getElementById('play-action-btn')?.addEventListener('click', () => {
    if (actionSelect?.value) requestAction(actionSelect.value).catch(console.error)
  })

  // Expression sliders
  const exprContainer = document.getElementById('expression-sliders')
  if (exprContainer) {
    for (const expr of EXPRESSIONS.filter(e => e !== 'neutral')) {
      const row = document.createElement('div')
      row.className = 'expr-row'
      row.innerHTML = `<label>${expr}</label><input type="range" min="0" max="100" value="0" data-expr-slider="${expr}"><span class="expr-val">0</span>`
      exprContainer.appendChild(row)
      const slider = row.querySelector('input') as HTMLInputElement
      const valSpan = row.querySelector('.expr-val') as HTMLSpanElement
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value) / 100
        valSpan.textContent = slider.value
        setExpression(expr, v)
      })
    }
  }

  // Sync expression sliders with programmatic changes
  setInterval(() => {
    const overrides = getExpressionOverrides()
    for (const expr of EXPRESSIONS.filter(e => e !== 'neutral')) {
      const slider = document.querySelector(`[data-expr-slider="${expr}"]`) as HTMLInputElement
      const valSpan = slider?.parentElement?.querySelector('.expr-val') as HTMLSpanElement
      if (slider && valSpan) {
        const currentVal = Math.round((overrides.get(expr) ?? 0) * 100)
        if (parseInt(slider.value) !== currentVal) {
          slider.value = String(currentVal)
          valSpan.textContent = String(currentVal)
        }
      }
    }
  }, 100)

  // Idle settings
  setupNumberInput('idle-interval', idleConfig, 'idleActionInterval')
  setupNumberInput('idle-chance', idleConfig, 'idleActionChance')
  setupNumberInput('idle-min-hold', idleConfig, 'idleMinHoldSeconds')
  setupNumberInput('idle-max-hold', idleConfig, 'idleMaxHoldSeconds')

  // Toggles
  document.getElementById('auto-blink')?.addEventListener('change', (e) => {
    state.autoBlinkEnabled = (e.target as HTMLInputElement).checked
  })
  document.getElementById('mouse-look')?.addEventListener('change', (e) => {
    state.mouseLookEnabled = (e.target as HTMLInputElement).checked
  })
  document.getElementById('transparent-bg')?.addEventListener('change', (e) => {
    setTransparentBackground((e.target as HTMLInputElement).checked)
  })

  // Collapsible sections
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.parentElement!
      section.classList.toggle('collapsed')
    })
  })

  // Drag and drop
  const overlay = document.getElementById('drop-overlay')!
  const body = document.body
  body.addEventListener('dragover', (e) => { e.preventDefault(); overlay.classList.add('active') })
  body.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) overlay.classList.remove('active')
  })
  body.addEventListener('drop', async (e) => {
    e.preventDefault()
    overlay.classList.remove('active')
    const file = e.dataTransfer?.files[0]
    if (!file) return
    if (file.name.endsWith('.vrm')) {
      await loadVRM(file).catch(console.error)
    } else if (file.name.endsWith('.vrma')) {
      await loadAndPlay(URL.createObjectURL(file)).catch(console.error)
    }
  })
}

function populateActions(select: HTMLSelectElement, actions: string[]) {
  select.innerHTML = actions.map(a => `<option value="${a}">${a.replace(/_/g, ' ')}</option>`).join('')
}

function setupNumberInput(id: string, obj: any, key: string) {
  const el = document.getElementById(id) as HTMLInputElement
  if (!el) return
  el.value = String(obj[key])
  el.addEventListener('change', () => {
    obj[key] = parseFloat(el.value)
  })
}
