// Six-track looper controls with state LEDs, transport and loop length.
import { TrackState } from '../../core/dsp/engineTypes'
import type { AppModel } from '../model'
import { h, icons, svg } from './dom'

const STATE_CLASS: Record<number, string> = {
  [TrackState.empty]: 'empty',
  [TrackState.armed]: 'armed',
  [TrackState.recording]: 'recording',
  [TrackState.playing]: 'playing',
  [TrackState.muted]: 'muted',
}
const STATE_NAME: Record<number, string> = {
  [TrackState.empty]: 'Empty',
  [TrackState.armed]: 'Waiting to record',
  [TrackState.recording]: 'Recording',
  [TrackState.playing]: 'Playing',
  [TrackState.muted]: 'Muted',
}

export class LooperView {
  readonly el: HTMLDivElement
  private headRight: HTMLSpanElement
  private progress: HTMLDivElement
  private tracks: HTMLButtonElement[] = []
  private transport: HTMLButtonElement
  private bars: HTMLButtonElement
  private barsText: HTMLSpanElement
  private barsSelect: HTMLSelectElement
  private metro: HTMLButtonElement

  constructor(private model: AppModel) {
    this.el = h('div', { class: 'looper', role: 'group', 'aria-label': 'Looper' })
    this.headRight = h('span')
    this.el.append(h('div', { class: 'head' }, h('span', {}, 'LOOPER'), this.headRight))
    this.progress = h('div')
    this.el.append(h('div', { class: 'progress', 'aria-hidden': 'true' }, this.progress))
    const grid = h('div', { class: 'tracks' })
    for (let t = 0; t < 6; t++) {
      const b = h('button', { class: 'track' }, h('span', { class: 'led' }), h('span', {}, String(t + 1)))
      b.addEventListener('click', () => model.loopTap(t))
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        this.trackMenu(t, e.clientX, e.clientY)
      })
      let pressTimer = 0
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return
        pressTimer = window.setTimeout(() => {
          const r = b.getBoundingClientRect()
          this.trackMenu(t, r.left, r.bottom)
          b.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true })
        }, 500)
      })
      const cancel = () => clearTimeout(pressTimer)
      b.addEventListener('pointerup', cancel)
      b.addEventListener('pointercancel', cancel)
      b.addEventListener('pointerleave', cancel)
      this.tracks.push(b)
      grid.append(b)
    }
    this.el.append(grid)

    this.transport = h('button', { class: 'pbtn', onclick: () => model.toggleTransport() })
    this.barsText = h('span')
    this.barsSelect = h(
      'select',
      { 'aria-label': 'Loop length', onchange: () => model.setLoopBars(Number(this.barsSelect.value)) },
      ...[
        [0, 'Free'],
        [1, '1 bar'],
        [2, '2 bars'],
        [4, '4 bars'],
        [8, '8 bars'],
      ].map(([v, t]) => h('option', { value: String(v) }, String(t))),
    )
    this.bars = h('button', { class: 'pbtn bars', tabindex: '-1' }, this.barsText, this.barsSelect)
    this.metro = h('button', { class: 'pbtn', 'aria-label': 'Metronome', title: 'Metronome', onclick: () => model.toggleMetronome() }, svg(icons.metronome))
    const clear = h('button', { class: 'pbtn dim', 'aria-label': 'Clear all loops', title: 'Clear all loops', onclick: () => model.loopClear(-1) }, svg(icons.trash))
    this.el.append(h('div', { class: 'row' }, this.transport, this.bars, this.metro, clear))
    this.update()
  }

  private trackMenu(t: number, x: number, y: number): void {
    document.querySelector('.menu')?.remove()
    const st = this.model.status.tracks[t] as TrackState
    const close = () => {
      menu.remove()
      document.removeEventListener('pointerdown', outside, true)
    }
    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) close()
    }
    const item = (label: string, fn: () => void, cls = '') =>
      h('button', { class: cls, onclick: () => (fn(), close()) }, label)
    const menu = h(
      'div',
      { class: 'menu', role: 'menu' },
      item('Record again', () => this.model.loopRerecord(t)),
      st === TrackState.playing || st === TrackState.muted ? item(st === TrackState.muted ? 'Unmute' : 'Mute', () => this.model.loopTap(t)) : null,
      item('Clear track', () => this.model.loopClear(t), 'danger'),
    )
    document.body.append(menu)
    const r = menu.getBoundingClientRect()
    menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`
    menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
  }

  update(): void {
    const s = this.model.status
    if (s.countIn > 0) {
      this.headRight.textContent = `COUNT-IN ${Math.ceil(s.countIn)}`
      this.headRight.className = 'countin'
    } else if (s.loopLength > 0) {
      const bars = s.loopLength / 4
      this.headRight.textContent = Number.isInteger(bars) ? `${bars} BAR${bars === 1 ? '' : 'S'}` : `${Math.floor(s.loopLength)} BEATS`
      this.headRight.className = ''
    } else {
      this.headRight.textContent = ''
    }
    const pos = s.loopLength > 0 && s.transportPlaying ? s.loopPosition / s.loopLength : 0
    this.progress.style.width = `${Math.max(0, Math.min(1, pos)) * 100}%`
    this.tracks.forEach((b, t) => {
      const st = s.tracks[t] as TrackState
      b.className = `track ${STATE_CLASS[st] ?? 'empty'}`
      b.setAttribute('aria-label', `Loop track ${t + 1}: ${STATE_NAME[st] ?? 'Empty'}`)
    })
    this.transport.replaceChildren(svg(s.transportPlaying ? icons.stop : icons.play))
    this.transport.className = `pbtn ${s.transportPlaying ? 'on-green' : ''}`
    this.transport.setAttribute('aria-label', s.transportPlaying ? 'Stop loops' : 'Play loops')
    const lb = this.model.settings.loopBars
    this.barsText.textContent = lb === 0 ? 'FREE' : `${lb} BAR`
    this.barsSelect.value = String(lb)
    this.metro.className = `pbtn ${this.model.settings.metronome ? 'on-yellow' : 'dim'}`
    this.metro.setAttribute('aria-pressed', String(this.model.settings.metronome))
  }
}
