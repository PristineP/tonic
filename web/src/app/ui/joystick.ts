// The eight-way clickable joystick: drag to bend chords, tap to click.
import { JoyDirection, JoystickMap } from '../../core/theory/joystick'
import type { AppModel } from '../model'
import { capture, h } from './dom'

export class JoystickView {
  readonly el: HTMLDivElement
  private cap: HTMLDivElement
  private legends = new Map<JoyDirection, HTMLDivElement>()
  private lastMap: JoystickMap | null = null

  constructor(private model: AppModel) {
    this.el = h('div', {
      class: 'joystick',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Joystick',
      'aria-description': 'Drag to change the chord, tap to click. Arrow keys also move it.',
    })
    this.el.append(h('div', { class: 'plate' }))
    for (const dir of JoyDirection.allCases) {
      if (dir === JoyDirection.center) continue
      const v = JoyDirection.vector(dir)
      const l = h('div', { class: 'legend', style: { left: `${50 + v.x * 38}%`, top: `${50 - v.y * 38}%` } })
      this.legends.set(dir, l)
      this.el.append(l)
    }
    this.el.append(h('div', { class: 'well' }))
    this.cap = h('div', { class: 'cap' })
    this.el.append(this.cap)
    this.bind()
    this.update()
  }

  private bind(): void {
    let pointer: number | null = null
    let origin = { x: 0, y: 0 }
    let downAt = 0
    let travelled = 0
    this.el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return
      e.preventDefault()
      pointer = e.pointerId
      capture(this.el, e.pointerId)
      origin = { x: e.clientX, y: e.clientY }
      downAt = performance.now()
      travelled = 0
      this.cap.classList.remove('spring')
    })
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return
      const radius = this.el.getBoundingClientRect().width * 0.3
      let tx = e.clientX - origin.x
      let ty = e.clientY - origin.y
      const mag = Math.hypot(tx, ty)
      travelled = Math.max(travelled, mag)
      if (mag > radius) {
        tx = (tx / mag) * radius
        ty = (ty / mag) * radius
      }
      this.cap.style.transform = `translate(${tx}px, ${ty}px)`
      this.model.setJoystick(JoyDirection.from(tx / radius, -ty / radius, 0.45))
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      pointer = null
      const radius = this.el.getBoundingClientRect().width * 0.3
      const quickTap = travelled < radius * 0.3 && performance.now() - downAt < 350
      this.cap.classList.add('spring')
      this.cap.style.transform = ''
      this.model.setJoystick(JoyDirection.center)
      if (quickTap && e.type === 'pointerup') this.model.clickJoystick()
    }
    this.el.addEventListener('pointerup', end)
    this.el.addEventListener('pointercancel', end)
    this.el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /// Moves the cap to show a direction set from the keyboard.
  showDirection(dir: JoyDirection): void {
    const v = JoyDirection.vector(dir)
    const r = this.el.getBoundingClientRect().width * 0.22
    this.cap.classList.add('spring')
    this.cap.style.transform = dir === JoyDirection.center ? '' : `translate(${v.x * r}px, ${-v.y * r}px)`
  }

  update(): void {
    const map = this.model.settings.harmony.joystickMap
    if (map !== this.lastMap) {
      this.lastMap = map
      for (const [dir, l] of this.legends) l.textContent = JoystickMap.legend(map, dir)
    }
    for (const [dir, l] of this.legends) l.classList.toggle('on', dir === this.model.joystick)
  }
}
