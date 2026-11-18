// The Tonic device: OLED, three function keys, seven chord keys, speaker grille and wheel.
import { FunctionKey } from '../../core/device/device'
import { PlayMode } from '../../core/device/deviceSettings'
import { BeatStyle, DrumKit } from '../../core/dsp/drums'
import { ChordBuilder, ChordSpec, HarmonySettings } from '../../core/theory/harmony'
import { JoyDirection } from '../../core/theory/joystick'
import { NoteNames, Scale } from '../../core/theory/music'
import type { AppModel } from '../model'
import { h, svg } from './dom'
import { createOLEDCanvas, drawOLED } from './oled'

export const DEVICE_ASPECT = 470 / 335

const FN_ICONS: Record<FunctionKey, string> = {
  // A key
  [FunctionKey.key]: '<circle cx="7.5" cy="16.5" r="4.5" stroke-width="2.2"/><path d="M10.7 13.3 21 3M17 7l2.6 2.6M19.4 4.6 21.6 6.8" stroke-width="2.2"/>',
  // A pulse wave
  [FunctionKey.sound]: '<path d="M2 12h4V4h7v16h7v-8h2" stroke-width="2.2"/>',
  // A clock
  [FunctionKey.mode]: '<circle cx="12" cy="12" r="9.5" stroke-width="2.2"/><path d="M12 12V6.5M12 12h4.5" stroke-width="2.2"/>',
}

/// Pointer handling shared by keys: press on down, release on up/cancel, swipe directions while held.
export function keyTouch(
  el: HTMLElement,
  onPress: () => void,
  onRelease: () => void,
  onSwipe?: (d: JoyDirection) => void,
): void {
  let pointer: number | null = null
  let start = { x: 0, y: 0 }
  let last: JoyDirection = JoyDirection.center
  el.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return
    e.preventDefault()
    pointer = e.pointerId
    el.setPointerCapture(e.pointerId)
    start = { x: e.clientX, y: e.clientY }
    last = JoyDirection.center
    onPress()
  })
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer || !onSwipe) return
    const unit = Math.max(22, el.getBoundingClientRect().width * 0.32)
    const dir = JoyDirection.from((e.clientX - start.x) / unit, -(e.clientY - start.y) / unit, 1)
    if (dir !== last) {
      last = dir
      onSwipe(dir)
    }
  })
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return
    pointer = null
    onRelease()
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('lostpointercapture', end)
  el.addEventListener('contextmenu', (e) => e.preventDefault())
}

export class DeviceView {
  readonly el: HTMLDivElement
  private oled: HTMLCanvasElement
  private chordKeys: HTMLButtonElement[] = []
  private fnKeys = new Map<FunctionKey, HTMLButtonElement>()
  private wheelNeedle!: HTMLDivElement
  private wheelLabel!: HTMLDivElement
  private wheel!: HTMLDivElement
  private oledModule: HTMLDivElement

  constructor(private model: AppModel, onToggleBig: () => void) {
    this.el = h('div', { class: 'device', role: 'group', 'aria-label': 'Tonic' })
    this.el.append(h('div', { class: 'chassis' }))
    this.el.append(h('div', { class: 'logo', 'aria-hidden': 'true' }, 'TONI', h('span', {}, 'C')))
    const grille = h('div', { class: 'grille', 'aria-hidden': 'true' })
    for (let i = 0; i < 9; i++) grille.append(h('i', { style: { top: `${(i / 8) * 92}%` } }))
    this.el.append(grille)
    this.el.append(this.buildWheel())
    this.el.append(h('div', { class: 'tag', 'aria-hidden': 'true' }, 'SEVEN-KEY CHORD SYNTH'))

    // Right panel geometry (fractions of width / height), same grid as the app.
    const W = 100
    const left = 35.1
    const right = 97.0
    const gap = 1.1
    const colW = (right - left - 3 * gap) / 4
    const H = 100
    const topY = 4.5
    const topH = 19.5
    const midY = topY + topH + 2.4
    const midH = 20.5
    const botY = midY + midH + 1.6
    const botH = 95.5 - botY
    const x = (col: number) => left + col * (colW + gap)
    const place = (el: HTMLElement, l: number, t: number, w: number, hh: number) =>
      Object.assign(el.style, { left: `${(l / W) * 100}%`, top: `${(t / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(hh / H) * 100}%` })

    this.oled = createOLEDCanvas()
    this.oledModule = h('div', { class: 'oledmod', role: 'img', 'aria-label': 'Display', title: 'Tap to show or hide the large display', onclick: onToggleBig }, this.oled)
    place(this.oledModule, x(0) + colW * 0.02, topY, colW * 0.96, topH)
    this.el.append(this.oledModule)

    const fns: [FunctionKey, string, string][] = [
      [FunctionKey.key, 'k', 'KEY'],
      [FunctionKey.sound, 's', 'SOUND'],
      [FunctionKey.mode, 'm', 'MODE'],
    ]
    fns.forEach(([f, cls, name], i) => {
      const b = h('button', { class: `key fn ${cls}`, 'aria-label': `${name[0]}${name.slice(1).toLowerCase()} key` })
      const icon = svg(FN_ICONS[f])
      b.append(icon, h('span', { class: 'fname' }, name))
      keyTouch(b, () => model.pressFunction(f), () => model.releaseFunction(f))
      place(b, x(i + 1), topY, colW, topH)
      this.fnKeys.set(f, b)
      this.el.append(b)
    })

    const midWide = colW * 1.5 + gap * 0.5
    const rects: [number, number, number, number][] = [
      [x(0), botY, colW, botH],
      [x(1), botY, colW, botH],
      [x(2), botY, colW, botH],
      [x(3), botY, colW, botH],
      [x(0), midY, midWide, midH],
      [x(0) + midWide + gap, midY, colW, midH],
      [x(0) + midWide + gap + colW + gap, midY, right - (x(0) + midWide + gap + colW + gap), midH],
    ]
    rects.forEach((r, b) => {
      const k = h('button', { class: 'key chord' }, h('span', { class: 'lbl' }, h('span', { class: 'name' }), h('span', { class: 'num' })), h('span', { class: 'pip' }))
      keyTouch(
        k,
        () => model.pressButton(b),
        () => model.releaseButton(b),
        (d) => model.swipeButton(b, d),
      )
      place(k, ...r)
      this.chordKeys.push(k)
      this.el.append(k)
    })
    this.update()
  }

  private buildWheel(): HTMLDivElement {
    const wheel = h('div', { class: 'wheel', role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '100' })
    for (let i = 0; i < 9; i++) {
      const a = ((-225 + i * 33.75) * Math.PI) / 180
      wheel.append(h('div', { class: 'dot', style: { left: `calc(50% + ${Math.cos(a) * 46}% - 0.35cqw)`, top: `calc(50% + ${Math.sin(a) * 46}% - 0.35cqw)` } }))
    }
    const cap = h('div', { class: 'cap' })
    this.wheelNeedle = h('div', { class: 'needle' })
    cap.append(this.wheelNeedle)
    this.wheelLabel = h('div', { class: 'wlabel' })
    wheel.append(cap, this.wheelLabel)
    let startVal: number | null = null
    let start = { x: 0, y: 0 }
    wheel.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      wheel.setPointerCapture(e.pointerId)
      startVal = this.model.device.wheelValue
      start = { x: e.clientX, y: e.clientY }
    })
    wheel.addEventListener('pointermove', (e) => {
      if (startVal === null) return
      const d = wheel.getBoundingClientRect().width
      const delta = (e.clientX - start.x - (e.clientY - start.y)) / (d * 2.2)
      this.model.setWheel(Math.min(1, Math.max(0, startVal + delta)))
    })
    const end = () => (startVal = null)
    wheel.addEventListener('pointerup', end)
    wheel.addEventListener('pointercancel', end)
    wheel.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.model.setWheel(Math.min(1, Math.max(0, this.model.device.wheelValue - e.deltaY / 1000)))
    }, { passive: false })
    wheel.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0
      if (!step) return
      e.preventDefault()
      e.stopPropagation()
      this.model.setWheel(Math.min(1, Math.max(0, this.model.device.wheelValue + step)))
    })
    this.wheel = wheel
    return wheel
  }

  drawFrame(): void {
    drawOLED(this.oled, this.model.frame)
    this.oledModule.setAttribute('aria-label', `Display: ${this.model.displayText}`)
  }

  update(): void {
    const m = this.model
    const s = m.settings
    this.chordKeys.forEach((k, b) => {
      k.classList.toggle('down', m.pressedButtons.has(b))
      const label = s.showKeyLabels ? keyLabel(m, b) : ''
      const num = numeral(s.mode, b)
      ;(k.querySelector('.name') as HTMLElement).textContent = label
      ;(k.querySelector('.num') as HTMLElement).textContent = s.showKeyLabels ? num : ''
      k.setAttribute('aria-label', label ? `Chord ${num}, ${label}` : `Chord button ${b + 1}`)
    })
    for (const [f, el] of this.fnKeys) el.classList.toggle('down', m.pressedFunctions.has(f))
    const v = m.device.wheelValue
    this.wheelNeedle.style.transform = `rotate(${-135 + v * 270 + 180}deg)`
    const name = s.filterWheel ? 'FILTER' : 'VOLUME'
    this.wheelLabel.textContent = name
    this.wheel.setAttribute('aria-label', name[0] + name.slice(1).toLowerCase())
    this.wheel.setAttribute('aria-valuenow', String(Math.round(v * 100)))
  }
}

function numeral(mode: PlayMode, b: number): string {
  if (mode === PlayMode.mixer) return b < 6 ? 'TRACK' : 'PLAY'
  if (mode === PlayMode.drums || mode === PlayMode.beat) return String(b + 1)
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][b]
}

function keyLabel(m: AppModel, b: number): string {
  const s = m.settings
  const hs = s.harmony
  switch (s.mode) {
    case PlayMode.earTrainer:
      return '?'
    case PlayMode.lead:
    case PlayMode.tuner:
      return NoteNames.name(hs.key + Scale.leadOffset(hs.scale, b), HarmonySettings.prefersFlats(hs))
    case PlayMode.drums:
      return DrumKit.padNames[b]
    case PlayMode.beat:
      return b < BeatStyle.allCases.length ? BeatStyle.displayName(b as BeatStyle) : ''
    case PlayMode.mic:
      return 'REC'
    case PlayMode.mixer:
      return b < 6 ? String(b + 1) : '▶■'
    default:
      return ChordSpec.name(ChordBuilder.diatonic(b, hs), HarmonySettings.prefersFlats(hs))
  }
}
