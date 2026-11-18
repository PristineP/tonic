// Settings and guide sheets.
import { PlayMode, type DeviceSettings } from '../../core/device/deviceSettings'
import { DrumKit } from '../../core/dsp/drums'
import { DelayTime, DriveType, LofiType, ModType, ReverbType, TremoloRate } from '../../core/dsp/effects'
import { ArpPattern, NoteRate } from '../../core/dsp/engineTypes'
import { BassMode } from '../../core/theory/harmony'
import { JoystickMap } from '../../core/theory/joystick'
import { NoteNames, Scale } from '../../core/theory/music'
import type { AppModel } from '../model'
import { capitalized, h } from './dom'

type Refresher = () => void

function openSheet(title: string, doneLabel: string, build: (refreshers: Refresher[], close: () => void) => HTMLElement, onClose?: () => void, model?: AppModel): void {
  document.querySelector('.sheet-backdrop')?.remove()
  const refreshers: Refresher[] = []
  let unsub: (() => void) | null = null
  const close = () => {
    backdrop.remove()
    unsub?.()
    document.removeEventListener('keydown', onKey, true)
    onClose?.()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
    e.stopPropagation()
  }
  const body = build(refreshers, close)
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('span', { class: 'spacer' }), h('h2', {}, title), h('button', { onclick: close }, doneLabel)),
    body,
  )
  const backdrop = h('div', { class: 'sheet-backdrop' }, sheet)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close()
  })
  document.addEventListener('keydown', onKey, true)
  document.body.append(backdrop)
  if (model) unsub = model.subscribe(() => refreshers.forEach((r) => r()))
  ;(sheet.querySelector('header button') as HTMLButtonElement).focus()
}

// ---- Settings ----

export function openSettings(model: AppModel): void {
  openSheet('Settings', 'Done', (R) => buildSettings(model, R), undefined, model)
}

function section(title: string, rows: (HTMLElement | null)[], foot?: string): HTMLElement[] {
  return [h('h3', {}, title), h('div', { class: 'group' }, ...rows), foot ? h('p', { class: 'foot' }, foot) : (null as unknown as HTMLElement)].filter(Boolean)
}

function buildSettings(model: AppModel, R: Refresher[]): HTMLElement {
  const s = () => model.settings
  const upd = (fn: (s: DeviceSettings) => void) => model.update(fn)

  let uid = 0
  const picker = <T extends string | number>(label: string, options: () => [T, string][], get: () => T, set: (v: T) => void) => {
    const id = `f${uid++}`
    const sel = h('select', { id })
    const fill = () => {
      const opts = options()
      const key = opts.map((o) => o[1]).join('|')
      if (sel.dataset.key !== key) {
        sel.dataset.key = key
        sel.replaceChildren(...opts.map(([v, t]) => h('option', { value: String(v) }, t)))
      }
      sel.value = String(get())
    }
    sel.addEventListener('change', () => {
      const opt = options().find(([v]) => String(v) === sel.value)
      if (opt) set(opt[0])
    })
    fill()
    R.push(fill)
    return h('div', { class: 'srow' }, h('label', { for: id }, label), sel)
  }
  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const id = `f${uid++}`
    const input = h('input', { type: 'checkbox', id, role: 'switch' })
    input.checked = get()
    input.addEventListener('change', () => set(input.checked))
    R.push(() => (input.checked = get()))
    return h('div', { class: 'srow' }, h('label', { for: id }, label), h('span', { class: 'toggle' }, input, h('span')))
  }
  const slider = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, opts: { log?: boolean; fmt?: (v: number) => string; step?: number } = {}) => {
    const id = `f${uid++}`
    const fmt = opts.fmt ?? ((v: number) => `${Math.round(v * 100)}%`)
    const toPos = (v: number) => (opts.log ? Math.log2(v) : v)
    const fromPos = (p: number) => (opts.log ? 2 ** p : p)
    const input = h('input', { type: 'range', id, min: String(toPos(min)), max: String(toPos(max)), step: String(opts.step ?? (toPos(max) - toPos(min)) / 200) })
    const val = h('span', { class: 'val' })
    const sync = () => {
      if (document.activeElement !== input) input.value = String(toPos(get()))
      val.textContent = fmt(get())
    }
    input.addEventListener('input', () => {
      set(fromPos(Number(input.value)))
      val.textContent = fmt(get())
    })
    sync()
    R.push(sync)
    return h('div', { class: 'srow slider' }, h('div', { class: 'top' }, h('label', { for: id }, label), val), input)
  }
  const stepper = (label: () => string, get: () => number, set: (v: number) => void, min: number, max: number, step = 1) => {
    const lab = h('span', { class: 'lab' })
    const sync = () => (lab.textContent = label())
    sync()
    R.push(sync)
    return h(
      'div',
      { class: 'srow' },
      lab,
      h(
        'div',
        { class: 'stepper' },
        h('button', { 'aria-label': 'Decrease', onclick: () => set(Math.max(min, get() - step)) }, '−'),
        h('button', { 'aria-label': 'Increase', onclick: () => set(Math.min(max, get() + step)) }, '+'),
      ),
    )
  }
  const enumOpts = <E extends number>(all: readonly E[], name: (e: E) => string, cap = true): (() => [E, string][]) => () => all.map((e) => [e, cap ? capitalized(name(e)) : name(e)])

  const ms = (v: number) => `${Math.round(v)} ms`
  const times = (v: number) => `×${v.toFixed(2)}`

  const body = h('div', { class: 'body' })
  body.append(
    ...section('Sound', [
      picker('Sound', () => model.device.sounds.map((p) => [p.name, capitalized(p.name)] as [string, string]), () => s().soundName, (v) => model.selectSound(v)),
      picker('Mode', enumOpts(PlayMode.allCases, PlayMode.displayName), () => s().mode, (v) => model.setMode(v)),
      slider('Attack', () => s().attackScale, (v) => upd((x) => (x.attackScale = v)), 0.125, 16, { log: true, fmt: times }),
      slider('Release', () => s().releaseScale, (v) => upd((x) => (x.releaseScale = v)), 0.125, 16, { log: true, fmt: times }),
      toggle('Wheel controls filter', () => s().filterWheel, (v) => upd((x) => (x.filterWheel = v))),
    ]),
    ...section('Harmony', [
      picker('Key', () => Array.from({ length: 12 }, (_, i) => [i, NoteNames.keyName(i)] as [number, string]), () => s().harmony.key, (v) => upd((x) => (x.harmony.key = v))),
      picker('Scale', enumOpts(Scale.allCases, Scale.displayName), () => s().harmony.scale, (v) => upd((x) => (x.harmony.scale = v))),
      stepper(() => `Octave ${s().harmony.octave >= 0 ? '+' : ''}${s().harmony.octave}`, () => s().harmony.octave, (v) => upd((x) => (x.harmony.octave = v)), -2, 2),
      picker('Joystick map', enumOpts(JoystickMap.allCases, JoystickMap.displayName), () => s().harmony.joystickMap, (v) => upd((x) => (x.harmony.joystickMap = v))),
      picker('Inversion', () => [[0, 'Root'], [1, '1st'], [2, '2nd'], [3, '3rd']], () => s().harmony.inversion, (v) => upd((x) => (x.harmony.inversion = v))),
      toggle('Voice leading', () => s().harmony.voiceLeading, (v) => upd((x) => (x.harmony.voiceLeading = v))),
      picker('Bass', enumOpts(BassMode.allCases, BassMode.displayName), () => s().harmony.bassMode, (v) => upd((x) => (x.harmony.bassMode = v))),
      toggle('Two-key slash chords', () => s().slashChords, (v) => upd((x) => (x.slashChords = v))),
      (() => {
        const b = h('button', { class: 'btn', onclick: () => upd((x) => (x.harmony.buttonOctaves = [0, 0, 0, 0, 0, 0, 0])) }, 'Reset')
        R.push(() => (b.disabled = s().harmony.buttonOctaves.every((o) => o === 0)))
        b.disabled = s().harmony.buttonOctaves.every((o) => o === 0)
        return h('div', { class: 'srow' }, h('span', { class: 'lab' }, 'Per-key octaves'), b)
      })(),
    ]),
    ...section('Effects', [
      picker('Reverb', enumOpts(ReverbType.allCases, ReverbType.displayName), () => s().fx.reverb, (v) => upd((x) => (x.fx.reverb = v))),
      slider('Reverb mix', () => s().fx.reverbMix, (v) => upd((x) => (x.fx.reverbMix = v)), 0, 1),
      picker('Delay', enumOpts(DelayTime.allCases, DelayTime.displayName), () => s().fx.delay, (v) => upd((x) => (x.fx.delay = v))),
      slider('Delay feedback', () => s().fx.delayFeedback, (v) => upd((x) => (x.fx.delayFeedback = v)), 0, 0.9),
      slider('Delay mix', () => s().fx.delayMix, (v) => upd((x) => (x.fx.delayMix = v)), 0, 1),
      picker('Modulation', enumOpts(ModType.allCases, ModType.displayName), () => s().fx.mod, (v) => upd((x) => (x.fx.mod = v))),
      picker('Tremolo', enumOpts(TremoloRate.allCases, TremoloRate.displayName, false), () => s().fx.tremolo, (v) => upd((x) => (x.fx.tremolo = v))),
      picker('Drive', enumOpts(DriveType.allCases, DriveType.displayName), () => s().fx.drive, (v) => upd((x) => (x.fx.drive = v))),
      picker('Lo-fi', enumOpts(LofiType.allCases, LofiType.displayName), () => s().fx.lofi, (v) => upd((x) => (x.fx.lofi = v))),
      slider('Stereo spread', () => s().fx.spread, (v) => upd((x) => (x.fx.spread = v)), 0, 1),
    ]),
    ...section('Rhythm', [
      stepper(() => `Tempo ${Math.round(s().bpm)} BPM`, () => Math.round(s().bpm), (v) => upd((x) => (x.bpm = v)), 40, 300),
      picker('Arp pattern', enumOpts(ArpPattern.allCases, ArpPattern.displayName), () => s().arpPattern, (v) => upd((x) => (x.arpPattern = v))),
      picker('Arp rate', enumOpts(NoteRate.allCases, NoteRate.displayName, false), () => s().arpRate, (v) => upd((x) => (x.arpRate = v))),
      toggle('Arp latch', () => s().arpLatch, (v) => upd((x) => (x.arpLatch = v))),
      picker('Repeat rate', enumOpts(NoteRate.allCases, NoteRate.displayName, false), () => s().repeatRate, (v) => upd((x) => (x.repeatRate = v))),
      slider('Strum speed', () => s().strumMs, (v) => upd((x) => (x.strumMs = v)), 0, 120, { fmt: ms, step: 1 }),
      slider('Lead glide', () => s().leadGlide, (v) => upd((x) => (x.leadGlide = v)), 0, 0.5, { fmt: (v) => ms(v * 1000) }),
      picker('Drum kit', enumOpts(DrumKit.allCases, DrumKit.displayName), () => s().kit, (v) => upd((x) => (x.kit = v))),
      picker('Sequencer step', () => [[0.5, '1/8 note'], [1, '1 beat'], [2, '2 beats'], [4, '1 bar'], [8, '2 bars']], () => s().seqStepBeats, (v) => upd((x) => (x.seqStepBeats = v))),
    ]),
    ...section(
      'Looper',
      [
        picker('Loop length', () => [[0, 'Free'], [1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars']], () => s().loopBars, (v) => model.setLoopBars(v)),
        toggle('Metronome while recording', () => s().metronome, (v) => upd((x) => (x.metronome = v))),
      ],
      'Track 1 sets the loop length. In Free mode recording starts with your first note.',
    ),
    ...midiSection(model, R),
    ...section('Display & feel', [
      toggle('Chord names on keys', () => s().showKeyLabels, (v) => upd((x) => (x.showKeyLabels = v))),
      toggle('Oscilloscope when idle', () => s().showScope, (v) => upd((x) => (x.showScope = v))),
      toggle('Large display', () => model.prefs.bigDisplay, (v) => model.setPrefs({ bigDisplay: v })),
      'vibrate' in navigator ? toggle('Vibration', () => s().haptics, (v) => upd((x) => (x.haptics = v))) : null,
    ]),
    ...section(
      'Presets',
      [0, 1, 2, 3].map((slot) => {
        const info = h('span', { class: 'val', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } })
        const load = h('button', { class: 'btn', onclick: () => model.loadPreset(slot) }, 'Load')
        const sync = () => {
          const p = model.presets[slot]
          info.textContent = p ? `${NoteNames.keyName(p.harmony.key)} · ${capitalized(p.soundName)} · ${capitalized(PlayMode.displayName(p.mode))}` : ''
          load.disabled = !p
        }
        sync()
        R.push(sync)
        return h('div', { class: 'srow' }, h('span', {}, `Preset ${slot + 1}`), info, load, h('button', { class: 'btn primary', onclick: () => model.savePreset(slot) }, 'Save'))
      }),
      'Presets store the key, sound, effects, mode and rhythm settings.',
    ),
    ...section('Reset', [
      h('div', { class: 'srow' }, h('button', {
        class: 'btn danger',
        onclick: (e: Event) => {
          const b = e.currentTarget as HTMLButtonElement
          if (b.dataset.armed) {
            model.resetSettings()
            b.textContent = 'Settings reset'
            delete b.dataset.armed
          } else {
            b.dataset.armed = '1'
            b.textContent = 'Tap again to reset all settings'
          }
        },
      }, 'Reset all settings')),
    ], 'Presets and loops are kept. Tonic web 1.0'),
  )
  return body
}

function midiSection(model: AppModel, R: Refresher[]): HTMLElement[] {
  if (!model.midi.supported) {
    return section('MIDI', [h('div', { class: 'srow' }, h('span', { class: 'lab val' }, 'This browser has no Web MIDI. Try Chrome, Edge or Firefox on a computer.'))])
  }
  const id = 'midi-on'
  const input = h('input', { type: 'checkbox', id, role: 'switch' })
  input.checked = model.prefs.midiEnabled
  input.addEventListener('change', () => void model.setMidiEnabled(input.checked))
  const sel = h('select', { id: 'midi-port', onchange: () => model.setMidiPort(sel.value) })
  const portRow = h('div', { class: 'srow' }, h('label', { for: 'midi-port' }, 'Output'), sel)
  const sync = () => {
    input.checked = model.prefs.midiEnabled
    const outs = model.midi.outputs
    portRow.style.display = model.prefs.midiEnabled ? '' : 'none'
    sel.replaceChildren(...(outs.length ? outs.map((o) => h('option', { value: o.id }, o.name)) : [h('option', { value: '' }, 'No MIDI outputs found')]))
    sel.value = model.midi.portId && outs.some((o) => o.id === model.midi.portId) ? model.midi.portId : outs[0]?.id ?? ''
  }
  sync()
  R.push(sync)
  return section(
    'MIDI',
    [h('div', { class: 'srow' }, h('label', { for: id }, 'Send MIDI'), h('span', { class: 'toggle' }, input, h('span'))), portRow],
    'Loop tracks send on channels 1–6, live playing on the channel of the next free track, drums on channel 10.',
  )
}

// ---- Guide ----

export function describeMode(mode: PlayMode): string {
  switch (mode) {
    case PlayMode.play: return 'Full chords.'
    case PlayMode.strum: return 'Chords rolled across six strings, like a guitar or harp. Strum speed is in Mode setup.'
    case PlayMode.lead: return 'One scale note per key, for melodies and bass lines. Joystick ↑↓ shifts octave, ←→ by a semitone.'
    case PlayMode.drone: return 'Chords sustain after you let go. Press another key to move the drone, or the same key to stop.'
    case PlayMode.arp: return 'Tempo-synced arpeggios of the held chord. Pattern, rate and latch are in Mode setup.'
    case PlayMode.repeatGate: return 'The held chord retriggers in time, for rhythmic stabs.'
    case PlayMode.sequencer: return 'Tap chords to add up to 16 steps, then click the joystick to play. Joystick ← undoes a step, ↓ clears.'
    case PlayMode.drums: return 'Seven drum pads. Hold a pad and push the joystick for note repeat.'
    case PlayMode.beat: return 'Seven beat styles (rock, break, dub, funk, house, dembow, swing). Joystick ←→ picks one of eight variations.'
    case PlayMode.chordRush: return 'A rhythm game: chords scroll to the line in time with a beat; press each on the downbeat. Joystick ←→ picks a song, click starts.'
    case PlayMode.vocoder: return 'Hold chords and sing or talk into the mic: the chord takes the shape of your voice. In setup the source can be loop track 1 instead of the mic.'
    case PlayMode.earTrainer: return 'Tonic plays the key’s tonic, then a mystery note or chord. Answer with its key. Joystick ↑↓ changes level, → skips.'
    case PlayMode.tuner: return 'Chromatic tuner using the microphone. Keys play reference notes.'
    case PlayMode.mic: return 'Press a key and make a sound: Tonic samples it and you can play it as chords.'
    case PlayMode.mixer: return 'Keys 1–6 mute loop tracks; hold one and push ↑↓ for its level. Key 7 starts and stops the loops.'
  }
  return ''
}

export function openHelp(model: AppModel, onClose?: () => void): void {
  openSheet('Tonic Guide', 'Close', (_R, close) => {
    const row = (lead: HTMLElement, title: string, text: string | (Node | string)[]) =>
      h('div', { class: 'hrow' }, lead, h('div', {}, h('b', {}, title), h('span', {}, ...(typeof text === 'string' ? [text] : text))))
    const ic = (c: string) => h('span', { class: 'ic', 'aria-hidden': 'true' }, c)
    const sw = (v: string) => h('span', { class: 'sw', style: { background: `var(${v})` }, 'aria-hidden': 'true' })
    const k = (t: string) => h('span', { class: 'kbd' }, t)
    const body = h('div', { class: 'body help' })
    body.append(
      h('div', { class: 'lead' }, h('h1', {}, 'Every key is a chord.'), h('p', {}, 'The seven white keys play the seven chords of the current key, I to VII. The bottom row is I–IV and the top row is V–VII. Try I · V · VI · IV.')),
      h('button', { class: 'startbtn', onclick: () => (model.unlock(), close()) }, 'Start playing'),
      ...section('Playing', [
        row(ic('●'), 'Press a key', 'Plays its chord. Hold several for legato changes.'),
        row(ic('✣'), 'Bend with the joystick', 'While holding a key, push the joystick to turn the chord into a 7th, 9th, sus, minor, diminished… The labels around it show what each direction does.'),
        row(ic('↗'), 'Or swipe on the key', 'Slide your finger off-centre on a held key to bend just that chord, no second hand needed.'),
        row(ic('◉'), 'Click the joystick', 'Tap it to record the next loop track, or to finish the one recording. In some modes it plays or stops.'),
        row(ic('◐'), 'Wheel', 'Volume, or the low-pass filter if you switch the wheel to Filter. Drag, scroll or use arrow keys.'),
      ]),
      ...section('The function keys', [
        row(sw('--teal'), 'Key (teal)', 'Joystick ←→ changes key, ↑↓ changes octave, click for scale, joystick map, inversion, voice leading and bass. Hold Key + a chord key to shift that key’s octave.'),
        row(sw('--amber'), 'Sound (amber)', 'Joystick ←→ browses sounds, ↑ opens effects and envelope. Hold Sound + a chord key for quick sounds.'),
        row(sw('--coral'), 'Mode (coral)', 'Joystick ←→ changes play mode, ↑ opens tempo, arp, drum and looper settings. In the BPM row, tap Mode to tap the tempo. Hold Mode + a chord key to jump to a mode.'),
      ], 'In menus: ↑↓ picks a row, ←→ changes it, click or press the key again to go back.'),
      ...section('Computer keyboard', [
        row(ic('⌨'), 'Chord keys', [k('1'), ' – ', k('7'), ' or ', k('A'), ' ', k('S'), ' ', k('D'), ' ', k('F'), ' ', k('G'), ' ', k('H'), ' ', k('J'), ' play I–VII.']),
        row(ic('⌨'), 'Function keys', [k('Q'), ' Key  ', k('W'), ' Sound  ', k('E'), ' Mode']),
        row(ic('⌨'), 'Joystick', ['Arrow keys (combine for diagonals); ', k('Space'), ' or ', k('Enter'), ' clicks.']),
      ]),
      ...section('Modes', PlayMode.allCases.map((m) => row(ic('·'), capitalized(PlayMode.displayName(m)), describeMode(m)))),
      ...section('Looper', [
        row(ic('1'), 'Track 1 sets the length', 'Choose 1–8 bars (with a one-bar count-in) or Free, where recording starts with your first note and stops when you tap again.'),
        row(ic('≡'), 'Layer up to six parts', 'Each new track records one full loop. Change sound or mode between takes: chords, bass in Lead, an arp, drums…'),
        row(ic('×'), 'Mute, re-record, clear', 'Tap a playing track to mute it. Right-click or long-press a track for more. Mixer mode sets levels.'),
      ]),
      ...section('MIDI', [
        row(ic('♪'), 'Play other instruments', 'In Settings, turn on MIDI and pick an output. Loop tracks send on channels 1–6 and drums on channel 10, so a multitimbral synth can voice every layer.'),
      ]),
    )
    return body
  }, onClose)
}
