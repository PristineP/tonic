import './styles.css'
import { FunctionKey } from './core/device/device'
import { PlayMode } from './core/device/deviceSettings'
import { JoyDirection } from './core/theory/joystick'
import { NoteNames, Scale } from './core/theory/music'
import { AppModel } from './app/model'
import { DEVICE_ASPECT, DeviceView } from './app/ui/device'
import { capitalized, h, iconButton, icons, toast } from './app/ui/dom'
import { JoystickView } from './app/ui/joystick'
import { LooperView } from './app/ui/looper'
import { createOLEDCanvas, drawOLED } from './app/ui/oled'
import { openHelp, openSettings } from './app/ui/sheets'

const model = new AppModel()
if (import.meta.env.DEV) (window as unknown as { tonic: AppModel }).tonic = model
const app = document.getElementById('app')!

// Top bar
const modeText = h('div', { class: 'mode' })
const detailText = h('div', { class: 'detail' })
const midiBadge = h('span', { class: 'badge', title: 'MIDI output on' }, 'MIDI')
const topbar = h(
  'div',
  { class: 'topbar' },
  h('div', { class: 'title' }, modeText, detailText),
  midiBadge,
  iconButton(icons.help, 'Guide', () => openHelp(model)),
  iconButton(icons.sliders, 'Settings', () => openSettings(model)),
)

const bigCanvas = createOLEDCanvas()
const big = h('div', { class: 'bigdisplay', role: 'img', 'aria-label': 'Large display', title: 'Tap to hide the large display' }, bigCanvas)
const toggleBig = () => model.setPrefs({ bigDisplay: !model.prefs.bigDisplay })
big.addEventListener('click', toggleBig)

const device = new DeviceView(model, toggleBig)
const joystick = new JoystickView(model)
const looper = new LooperView(model)
const stage = h('div', { class: 'stage' })
const controls = h('div', { class: 'controls' })
const live = h('div', { class: 'sr-only', 'aria-live': 'polite' })
app.append(topbar, stage, live)

function layout(): void {
  const r = app.getBoundingClientRect()
  const W = r.width - 24
  const H = r.height - topbar.offsetHeight - 16
  const landscape = W > H * 1.05
  stage.className = `stage ${landscape ? 'landscape' : 'portrait'}`
  if (landscape) {
    const byWidth = (W - 400) / DEVICE_ASPECT
    const dh = Math.max(160, Math.min(H - 10, byWidth))
    const dw = dh * DEVICE_ASPECT
    const side = Math.max(140, Math.min(230, (W - dw) / 2 - 20))
    Object.assign(device.el.style, { width: `${dw}px`, height: '' })
    Object.assign(joystick.el.style, { width: `${side}px`, height: `${side}px` })
    looper.el.style.width = `${side}px`
    looper.el.style.maxWidth = ''
    stage.replaceChildren(joystick.el, device.el, looper.el)
  } else {
    const width = Math.min(W, 860)
    const joy = Math.min(Math.min(width * 0.42, Math.max(120, H * 0.22)), 240)
    const deviceH = width / DEVICE_ASPECT
    const controlsH = Math.max(joy, 290)
    const spare = H - deviceH - controlsH - 40
    const dispH = Math.min(spare, width * 0.32)
    const showBig = model.prefs.bigDisplay && dispH >= 70
    Object.assign(device.el.style, { width: `${width}px` })
    Object.assign(joystick.el.style, { width: `${joy}px`, height: `${joy}px` })
    looper.el.style.width = ''
    looper.el.style.maxWidth = `${Math.max(180, width - joy - 14)}px`
    Object.assign(big.style, { width: `${dispH * 2.2}px`, height: `${dispH}px` })
    controls.replaceChildren(joystick.el, looper.el)
    stage.replaceChildren(...(showBig ? [big] : []), device.el, controls)
  }
}

function render(): void {
  const s = model.settings
  modeText.textContent = PlayMode.displayName(s.mode)
  detailText.textContent = `${NoteNames.keyName(s.harmony.key)} ${capitalized(Scale.displayName(s.harmony.scale))} · ${capitalized(s.soundName)}`
  midiBadge.style.display = model.prefs.midiEnabled ? '' : 'none'
  device.update()
  joystick.update()
  looper.update()
  const wantBig = stage.classList.contains('portrait') && model.prefs.bigDisplay
  if (wantBig !== stage.contains(big)) layout()
}

let lastSpoken = ''
let speakTimer = 0
model.subscribe(render)
model.subscribeFrame(() => {
  device.drawFrame()
  if (stage.contains(big)) drawOLED(bigCanvas, model.frame)
  if (model.displayText !== lastSpoken) {
    clearTimeout(speakTimer)
    speakTimer = window.setTimeout(() => {
      lastSpoken = model.displayText
      live.textContent = lastSpoken
    }, 600)
  }
})

let lastMicDenied = false
model.subscribe(() => {
  if (model.micDenied && !lastMicDenied && PlayMode.usesMicrophone(model.settings.mode)) {
    toast('Microphone access is off. Allow it in your browser’s site settings for the tuner, sampler and vocoder.')
    model.setMode(PlayMode.play)
  }
  lastMicDenied = model.micDenied
})

new ResizeObserver(layout).observe(app)
layout()
render()
model.startLoop()

// Computer keyboard
const chordKeys: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyG: 4, KeyH: 5, KeyJ: 6 }
const fnKeys: Record<string, FunctionKey> = { KeyQ: FunctionKey.key, KeyW: FunctionKey.sound, KeyE: FunctionKey.mode }
const arrows = new Set<string>()
function arrowDirection(): JoyDirection {
  const x = (arrows.has('ArrowRight') ? 1 : 0) - (arrows.has('ArrowLeft') ? 1 : 0)
  const y = (arrows.has('ArrowUp') ? 1 : 0) - (arrows.has('ArrowDown') ? 1 : 0)
  return JoyDirection.from(x, y, 0.5)
}
function editable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName))
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return
  if (e.code in chordKeys) {
    e.preventDefault()
    if (!e.repeat) model.pressButton(chordKeys[e.code])
  } else if (e.code in fnKeys) {
    e.preventDefault()
    if (!e.repeat) model.pressFunction(fnKeys[e.code])
  } else if (e.key.startsWith('Arrow')) {
    if ((e.target as HTMLElement)?.classList?.contains('wheel')) return
    e.preventDefault()
    arrows.add(e.key)
    const d = arrowDirection()
    model.setJoystick(d)
    joystick.showDirection(d)
  } else if (e.code === 'Space' || e.code === 'Enter') {
    if (e.target instanceof HTMLButtonElement && e.target !== document.body) return
    e.preventDefault()
    if (!e.repeat) model.clickJoystick()
  }
})
document.addEventListener('keyup', (e) => {
  if (e.code in chordKeys) model.releaseButton(chordKeys[e.code])
  else if (e.code in fnKeys) model.releaseFunction(fnKeys[e.code])
  else if (e.key.startsWith('Arrow')) {
    arrows.delete(e.key)
    const d = arrowDirection()
    model.setJoystick(d)
    joystick.showDirection(d)
  }
})
// Release everything if the window loses focus mid-press.
window.addEventListener('blur', () => {
  for (const b of [...model.pressedButtons]) model.releaseButton(b)
  for (const f of [...model.pressedFunctions]) model.releaseFunction(f)
  arrows.clear()
  model.setJoystick(JoyDirection.center)
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    model.saveNow()
    const s = model.status
    if (!(s.transportPlaying || s.beatOn || s.seqPlaying || s.activeVoices > 0)) model.audio.suspend()
  } else if (model.audio.ctx) {
    model.unlock()
  }
})
// The first touch anywhere starts audio.
document.addEventListener('pointerdown', () => model.unlock(), { once: true, capture: true })

if (!model.prefs.seenWelcome) openHelp(model, () => model.setPrefs({ seenWelcome: true }))
