/**
 * Meeting Mode Camera Calibration UI
 * Floating controls to adjust camera height, distance, horizontal offset.
 * Saves to localStorage and auto-loads on next visit.
 */

import { adjustPresetOffset } from './camera-presets'

const STORAGE_KEY = 'clawatar-meeting-calibration'

interface MeetingCalibration {
  height: number    // Y offset adjustment (-0.3 to 0.3)
  distance: number  // Z multiplier (0.5 to 2.0)
  horizontal: number // X offset (-0.3 to 0.3)
}

const defaults: MeetingCalibration = { height: 0, distance: 1.0, horizontal: 0 }
let current: MeetingCalibration = { ...defaults }
let panel: HTMLDivElement | null = null

function load(): MeetingCalibration {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...defaults, ...JSON.parse(saved) }
  } catch {}
  return { ...defaults }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
}

function apply() {
  // Update the meeting preset offsets via camera-presets API
  adjustPresetOffset('meeting', current.distance, current.height)
  // Horizontal needs direct offset — we store it and camera-presets reads it
  ;(window as any).__meetingHorizontal = current.horizontal
}

function createSlider(
  label: string, min: number, max: number, step: number, value: number,
  onChange: (v: number) => void
): HTMLDivElement {
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:4px 0'

  const lbl = document.createElement('span')
  lbl.textContent = label
  lbl.style.cssText = 'width:28px;font-size:11px;color:#ccc;flex-shrink:0'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(min)
  slider.max = String(max)
  slider.step = String(step)
  slider.value = String(value)
  slider.style.cssText = 'flex:1;height:4px;accent-color:#ff6b9d;cursor:pointer'

  const val = document.createElement('span')
  val.textContent = value.toFixed(2)
  val.style.cssText = 'width:36px;font-size:10px;color:#999;text-align:right'

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value)
    val.textContent = v.toFixed(2)
    onChange(v)
    apply()
    save()
  })

  row.append(lbl, slider, val)
  return row
}

export function initMeetingCalibration() {
  current = load()
  apply()

  // Create floating panel
  panel = document.createElement('div')
  panel.id = 'meeting-calibration'
  panel.style.cssText = `
    position:fixed;bottom:12px;right:12px;z-index:9999;
    background:rgba(20,15,25,0.85);border:1px solid rgba(255,107,157,0.3);
    border-radius:10px;padding:10px 14px;min-width:200px;
    font-family:-apple-system,sans-serif;backdrop-filter:blur(8px);
    cursor:move;user-select:none;
  `

  // Title bar with collapse toggle
  const title = document.createElement('div')
  title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'
  const titleText = document.createElement('span')
  titleText.textContent = 'Camera'
  titleText.style.cssText = 'font-size:11px;color:#ff6b9d;font-weight:600;letter-spacing:0.5px'
  const toggleBtn = document.createElement('span')
  toggleBtn.textContent = '−'
  toggleBtn.style.cssText = 'font-size:14px;color:#999;cursor:pointer;padding:0 4px'
  title.append(titleText, toggleBtn)

  const body = document.createElement('div')
  body.append(
    createSlider('H', -0.3, 0.3, 0.01, current.height, v => { current.height = v }),
    createSlider('D', 0.5, 2.0, 0.05, current.distance, v => { current.distance = v }),
    createSlider('X', -0.3, 0.3, 0.01, current.horizontal, v => { current.horizontal = v }),
  )

  // Reset button
  const resetBtn = document.createElement('button')
  resetBtn.textContent = 'Reset'
  resetBtn.style.cssText = `
    margin-top:6px;width:100%;padding:3px;font-size:10px;
    background:rgba(255,107,157,0.15);color:#ff6b9d;border:1px solid rgba(255,107,157,0.3);
    border-radius:5px;cursor:pointer;
  `
  resetBtn.addEventListener('click', () => {
    current = { ...defaults }
    save()
    apply()
    // Rebuild panel to reset sliders
    panel?.remove()
    initMeetingCalibration()
  })
  body.appendChild(resetBtn)

  // Collapse toggle
  let collapsed = false
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    collapsed = !collapsed
    body.style.display = collapsed ? 'none' : 'block'
    toggleBtn.textContent = collapsed ? '+' : '−'
  })

  panel.append(title, body)
  document.body.appendChild(panel)

  // Draggable
  let dragging = false, dx = 0, dy = 0
  panel.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') return
    dragging = true
    dx = e.clientX - panel!.getBoundingClientRect().left
    dy = e.clientY - panel!.getBoundingClientRect().top
  })
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !panel) return
    panel.style.left = (e.clientX - dx) + 'px'
    panel.style.top = (e.clientY - dy) + 'px'
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  })
  window.addEventListener('mouseup', () => { dragging = false })
}
