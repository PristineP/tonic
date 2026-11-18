import { NoteNames, Scale, mod12 } from '../theory/music'
import { JoyDirection, JoystickMap } from '../theory/joystick'
import { BassMode, ChordBuilder, ChordSpec, HarmonySettings, Voicing } from '../theory/harmony'
import { EarTrainer } from '../training/earTrainer'
import { ChordRush, RushPhase, Judgement } from '../training/chordRush'
import { OLEDFrame, Align } from '../display/oledFrame'
import { SoundLibrary, SoundPreset, SynthParams, withEnvelope } from '../dsp/synthParams'
import { ReverbType, DelayTime, ModType, TremoloRate, DriveType, LofiType } from '../dsp/effects'
import { VocoderSource } from '../dsp/vocoder'
import { DrumKit, BeatStyle } from '../dsp/drums'
import { ArpPattern, NoteRate, EngineCommand, EngineStatus, TrackState, defaultEngineStatus, noteSet, trackState } from '../dsp/engineTypes'
import { Engine } from '../dsp/engine'
import { DeviceSettings, PlayMode, copyDeviceSettings, deepEqual, defaultDeviceSettings } from './deviceSettings'

/** The three function keys. */
export enum FunctionKey { key, sound, mode }

export namespace FunctionKey {
  export const allCases: FunctionKey[] = [FunctionKey.key, FunctionKey.sound, FunctionKey.mode]
  export function name(f: FunctionKey): string { return ['key', 'sound', 'mode'][f] }
}

export enum HapticKind { press, tick, success, warning }

/** Services the device needs from the app. */
export interface DeviceHost {
  send(command: EngineCommand): void
  haptic(kind: HapticKind): void
  /** Start or stop listening to the microphone (tuner and mic modes). */
  setMicrophoneActive(active: boolean): void
  /** Record a short sample; answer with `Device.sampleCaptured`. */
  captureSample(): void
  settingsDidChange(): void
}

export enum Screen { home, keyMenu, soundMenu, modeMenu, keyList, soundList, modeList }

/** A pitch-detector reading (structurally matches PitchDetector's result). */
export interface TunerReading {
  frequency: number
  confidence: number
}

interface MenuItem {
  title: string
  value: (s: DeviceSettings) => string
  change: (s: DeviceSettings, d: number) => void
}

/** Swift `rounded()`: half away from zero. */
function round(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

function signed(n: number): string {
  return (n >= 0 ? '+' : '') + n
}

function capitalized(s: string): string {
  return s.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, p, c) => p + c.toUpperCase())
}

function cycle<T>(v: T, d: number, all: readonly T[]): T {
  let i = all.indexOf(v)
  if (i < 0) i = 0
  return all[(((i + d) % all.length) + all.length) % all.length]
}

function step(v: number, d: number, s: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, round((v + d * s) / s) * s))
}

function pct(v: number): string {
  return `${round(v * 100)}%`
}

function beatsName(b: number): string {
  switch (b) {
    case 0.5: return '1/8'
    case 1: return '1/4'
    case 2: return '1/2'
    case 4: return '1 BAR'
    default: return '2 BARS'
  }
}

function tunerNearestNote(t: TunerReading): number {
  return round(69 + 12 * Math.log2(t.frequency / 440))
}

function tunerCents(t: TunerReading): number {
  const midi = 69 + 12 * Math.log2(t.frequency / 440)
  return (midi - round(midi)) * 100
}

/** The Tonic "firmware": turns key presses into engine commands and draws the OLED. */
export class Device {
  static readonly numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

  host: DeviceHost | null = null
  private _settings: DeviceSettings
  private _screen: Screen = Screen.home
  private _listIndex = 0
  private _sounds: SoundPreset[] = [...SoundLibrary.factory]
  status: EngineStatus = defaultEngineStatus()
  battery: number | null = null
  scope: number[] = []
  private _now = 0

  // Input state
  private _heldButtons: number[] = [] // in press order
  private _heldFunctions = new Set<FunctionKey>()
  private _joystick: JoyDirection = JoyDirection.center
  private buttonSwipes = new Map<number, JoyDirection>()
  private functionUsedAsModifier = new Set<FunctionKey>()
  private screenBeforeFunction: Screen = Screen.home
  private slashBassButtons = new Set<number>()
  private slashTarget = new Map<number, number>() // bass button -> chord button
  private lastJoyEvent = 0
  private joyHeldSince = 0
  private lastInteraction = 0
  private tapTimes: number[] = []

  // Performance state
  private lastVoicing: Voicing | null = null
  private buttonChords = new Map<number, ChordSpec>()
  private _displayChord: string | null = null
  private displayDegree: number | null = null
  private lastChordTime = -100
  private lastDrumPad: number | null = null
  private message: { title: string; detail: string | null; until: number } | null = null

  // Sequencer
  private _seqNames: string[] = []

  // Ear trainer
  private ear = new EarTrainer()
  private earFeedback: { correct: boolean; text: string; until: number } | null = null
  private earNextAt: number | null = null

  // Tuner / mic
  tuner: TunerReading | null = null
  micLevel = 0
  private capturing = false

  // Chord Rush
  private _rush = new ChordRush()
  private rushFeedbackUntil = 0
  private statusStamp = 0

  // Mixer
  private _trackLevels: number[] = Array(Engine.trackCount).fill(1)

  constructor(settings: DeviceSettings = defaultDeviceSettings()) {
    this._settings = settings
    this.ear.level = settings.earLevel
  }

  get settings(): DeviceSettings { return this._settings }
  get screen(): Screen { return this._screen }
  get listIndex(): number { return this._listIndex }
  get sounds(): readonly SoundPreset[] { return this._sounds }
  get now(): number { return this._now }
  get heldButtons(): readonly number[] { return this._heldButtons }
  get heldFunctions(): ReadonlySet<FunctionKey> { return this._heldFunctions }
  get joystick(): JoyDirection { return this._joystick }
  get displayChord(): string | null { return this._displayChord }
  get seqNames(): readonly string[] { return this._seqNames }
  get rush(): ChordRush { return this._rush }
  get trackLevels(): readonly number[] { return this._trackLevels }

  /** The engine's beat position extrapolated to now. */
  private get beatNow(): number {
    return this.status.beat + (Math.max(0, this._now - this.statusStamp) * this.status.tempo) / 60
  }

  // MARK: Lifecycle

  /** Pushes every setting to the engine (call once the audio engine is running). */
  syncEngine(): void {
    const s = this._settings
    this.send({ type: 'style', style: PlayMode.engineStyle(s.mode) })
    this.sendPatch()
    this.send({ type: 'fx', params: { ...s.fx } })
    this.send({ type: 'tempo', bpm: s.bpm })
    this.send({ type: 'arp', pattern: s.arpPattern, rate: s.arpRate, latch: s.arpLatch })
    this.send({ type: 'repeatRate', rate: s.repeatRate })
    this.send({ type: 'strumSpeed', ms: s.strumMs })
    this.send({ type: 'kit', kit: s.kit })
    this.send({ type: 'seqStepBeats', beats: s.seqStepBeats })
    this.send({ type: 'loopBars', bars: s.loopBars })
    this.send({ type: 'metronome', on: s.metronome })
    this.sendMaster()
    for (let t = 0; t < Engine.trackCount; t++) this.send({ type: 'loopLevel', track: t, level: this._trackLevels[t] })
    this.send({ type: 'vocoder', on: s.mode === PlayMode.vocoder, params: { ...s.vocoder } })
    this.updateMicrophone()
  }

  /** Asks the host for the microphone only when the current mode needs it. */
  private updateMicrophone(): void {
    const s = this._settings
    const needsMic = PlayMode.usesMicrophone(s.mode) && !(s.mode === PlayMode.vocoder && s.vocoder.source === VocoderSource.track1)
    this.host?.setMicrophoneActive(needsMic)
  }

  /** Replaces all settings (e.g. loading a preset). */
  apply(newSettings: DeviceSettings): void {
    this._settings = copyDeviceSettings(newSettings)
    this.ear.level = this._settings.earLevel
    if (!this._sounds.some(p => p.name === this._settings.soundName)) this._settings.soundName = 'PIANO'
    this.syncEngine()
    this.changed()
  }

  /** Registers the microphone sample sound once a sample exists. */
  addSampleSound(name = 'MIC SAMPLE'): void {
    if (!this._sounds.some(p => p.name === name)) this._sounds.push(SoundLibrary.samplePreset(name))
  }

  tick(now: number): void {
    this._now = now
    this.statusStamp = now // the host refreshes `status` right before each tick
    if (this._settings.mode === PlayMode.chordRush) {
      const rush = this._rush
      if (rush.phase === RushPhase.waiting && this.status.beatOn) rush.begin(this.beatNow)
      if (rush.phase === RushPhase.playing) {
        if (rush.advance(this.beatNow) > 0) { this.rushFeedbackUntil = now + 0.6; this.haptic(HapticKind.warning) }
        if ((rush.phase as RushPhase) === RushPhase.done) this.finishRush()
      }
    }
    if (this.message && now > this.message.until) this.message = null
    if (this.earFeedback && now > this.earFeedback.until) this.earFeedback = null
    if (this.earNextAt !== null && now >= this.earNextAt) {
      this.earNextAt = null
      this.askEarQuestion()
    }
    // Joystick auto-repeat in menus.
    if (this._joystick !== JoyDirection.center && this._screen !== Screen.home && now - this.joyHeldSince > 0.45 && now - this.lastJoyEvent > 0.09) {
      this.lastJoyEvent = now
      this.menuJoystick(this._joystick, true)
    }
    // Menus close after a few idle seconds (not while a function key is held).
    if (this._screen !== Screen.home && this._heldFunctions.size === 0 && now - this.lastInteraction > 6) {
      this._screen = Screen.home
    }
  }

  // MARK: Inputs — chord buttons

  pressButton(b: number): void {
    if (!(b >= 0 && b < 7) || this._heldButtons.includes(b)) return
    this.touch()
    this._heldButtons.push(b)
    this.haptic(HapticKind.press)

    // Function-key combinations
    const f = this.firstHeldFunction()
    if (f !== null) {
      this.functionUsedAsModifier.add(f)
      this.combo(f, b)
      return
    }

    const s = this._settings
    switch (s.mode) {
      case PlayMode.play: case PlayMode.strum: case PlayMode.drone: case PlayMode.arp:
      case PlayMode.repeatGate: case PlayMode.vocoder: {
        if (s.slashChords && s.mode !== PlayMode.arp) {
          const other = this._heldButtons.find(x => x !== b && !this.slashBassButtons.has(x))
          if (other !== undefined) {
            // Second button becomes the slash bass of the first.
            this.slashBassButtons.add(b)
            this.slashTarget.set(b, other)
            this.playChord(other, b)
            return
          }
        }
        this.playChord(b)
        break
      }
      case PlayMode.lead:
        this.playLead(b)
        break
      case PlayMode.sequencer:
        if (!this.status.seqPlaying && this._seqNames.length < 16) {
          const spec = this.chordSpec(b)
          const v = this.voicing(spec, b)
          this.send({ type: 'seqStep', index: this._seqNames.length, notes: noteSet([...Voicing.allNotes(v)].sort((x, y) => x - y)) })
          this._seqNames.push(ChordSpec.name(spec, HarmonySettings.prefersFlats(s.harmony)))
          this.send({ type: 'seqLength', length: this._seqNames.length })
          this.flash(`STEP ${this._seqNames.length}`, this._seqNames[this._seqNames.length - 1])
        }
        this.playChord(b)
        break
      case PlayMode.drums:
        this.lastDrumPad = b
        this.send({ type: 'drum', pad: b, velocity: 0.9 })
        if (this._joystick !== JoyDirection.center) this.send({ type: 'drumRepeat', pad: b, on: true })
        break
      case PlayMode.beat: {
        const style: BeatStyle = BeatStyle.allCases.includes(b as BeatStyle) ? (b as BeatStyle) : BeatStyle.rock
        if (this.status.beatOn && s.beatStyle === style) {
          this.send({ type: 'beat', style, variation: s.beatVariation, on: false })
          this.status.beatOn = false
        } else {
          s.beatStyle = style
          this.send({ type: 'beat', style, variation: s.beatVariation, on: true })
          this.status.beatOn = true
          this.changed()
        }
        break
      }
      case PlayMode.earTrainer:
        this.answerEar(b)
        break
      case PlayMode.chordRush: {
        this.playChord(b)
        const j = this._rush.press(b, this.beatNow)
        if (j !== null) {
          this.rushFeedbackUntil = this._now + 0.6
          this.haptic(j === Judgement.miss ? HapticKind.warning : HapticKind.success)
        }
        break
      }
      case PlayMode.tuner: {
        // Reference tone for the scale degree.
        const note = this.leadNote(b, JoyDirection.center)
        this.send({ type: 'preview', notes: noteSet([note]), delay: 0, duration: 1.5 })
        this.flash('REF ' + NoteNames.noteName(note, HarmonySettings.prefersFlats(s.harmony)))
        break
      }
      case PlayMode.mic:
        if (!this.capturing) {
          this.capturing = true
          this.host?.captureSample()
        }
        break
      case PlayMode.mixer:
        if (b < Engine.trackCount) {
          const state = trackState(this.status, b)
          if (state === TrackState.playing || state === TrackState.muted) {
            this.send({ type: 'loopMute', track: b, muted: state === TrackState.playing })
          }
        } else {
          this.send({ type: 'transport', playing: !this.status.transportPlaying })
        }
        break
    }
  }

  releaseButton(b: number): void {
    const idx = this._heldButtons.indexOf(b)
    if (idx < 0) return
    this._heldButtons.splice(idx, 1)
    this.buttonSwipes.delete(b)
    if (this.slashBassButtons.has(b)) {
      this.slashBassButtons.delete(b)
      const target = this.slashTarget.get(b)
      this.slashTarget.delete(b)
      if (target !== undefined && this._heldButtons.includes(target)) {
        this.playChord(target) // back to the plain chord
      }
      return
    }
    switch (this._settings.mode) {
      case PlayMode.play: case PlayMode.strum: case PlayMode.drone: case PlayMode.arp: case PlayMode.repeatGate:
      case PlayMode.sequencer: case PlayMode.lead: case PlayMode.vocoder: case PlayMode.chordRush:
        this.send({ type: 'release', id: b })
        // Releasing the chord button also releases slash basses attached to it.
        for (const [bass, target] of [...this.slashTarget]) {
          if (target === b) { this.slashTarget.delete(bass); this.slashBassButtons.delete(bass) }
        }
        break
      case PlayMode.drums:
        this.send({ type: 'drumRepeat', pad: b, on: false })
        break
      default:
        break
    }
  }

  /** Direction from swiping on a chord key (the touch-screen stand-in for the joystick). */
  swipeButton(b: number, direction: JoyDirection): void {
    if (!this._heldButtons.includes(b) || (this.buttonSwipes.get(b) ?? JoyDirection.center) === direction) return
    this.buttonSwipes.set(b, direction)
    if (this._heldFunctions.size === 0) this.retrigger(b)
  }

  // MARK: Inputs — function keys

  pressFunction(f: FunctionKey): void {
    this.touch()
    this._heldFunctions.add(f)
    this.functionUsedAsModifier.delete(f)
    this.haptic(HapticKind.tick)
    this.screenBeforeFunction = this._screen

    const sc = this._screen
    switch (f) {
      case FunctionKey.key:
        this._screen = sc === Screen.keyMenu || sc === Screen.keyList ? Screen.home : Screen.keyMenu
        break
      case FunctionKey.sound:
        this._screen = sc === Screen.soundMenu || sc === Screen.soundList ? Screen.home : Screen.soundMenu
        break
      case FunctionKey.mode:
        if (sc === Screen.modeList && this._listIndex === 0) {
          this.tapTempo()
          return
        }
        this._screen = sc === Screen.modeMenu || sc === Screen.modeList ? Screen.home : Screen.modeMenu
        break
    }
    this._listIndex = 0
  }

  releaseFunction(f: FunctionKey): void {
    this._heldFunctions.delete(f)
    if (this.functionUsedAsModifier.has(f)) {
      this.functionUsedAsModifier.delete(f)
      this._screen = this.screenBeforeFunction
    }
  }

  /** Swift's `Set.first` order is unspecified; use the lowest raw value for determinism. */
  private firstHeldFunction(): FunctionKey | null {
    for (const f of FunctionKey.allCases) if (this._heldFunctions.has(f)) return f
    return null
  }

  private combo(f: FunctionKey, b: number): void {
    const s = this._settings
    switch (f) {
      case FunctionKey.key: {
        // Cycle this button's octave: 0, +1, +2, -2, -1
        let o = s.harmony.buttonOctaves[b] + 1
        if (o > 2) o = -2
        s.harmony.buttonOctaves[b] = o
        this.flash(`BTN ${b + 1} OCT`, o === 0 ? '0' : signed(o))
        break
      }
      case FunctionKey.sound: {
        const name = SoundLibrary.quickSelect[b]
        this.selectSound(name)
        this.flash(name)
        break
      }
      case FunctionKey.mode: {
        const modes = [PlayMode.play, PlayMode.strum, PlayMode.lead, PlayMode.drone, PlayMode.arp, PlayMode.repeatGate, PlayMode.drums]
        this.setMode(modes[b])
        this.flash(PlayMode.displayName(modes[b]))
        break
      }
    }
    this.changed()
  }

  // MARK: Inputs — joystick & wheel

  setJoystick(dir: JoyDirection): void {
    if (dir === this._joystick) return
    const previous = this._joystick
    this._joystick = dir
    this.touch()
    if (dir !== JoyDirection.center) { this.joyHeldSince = this._now; this.lastJoyEvent = this._now }

    if (this._screen !== Screen.home) {
      if (dir !== JoyDirection.center) this.menuJoystick(dir, false)
      return
    }

    const s = this._settings
    const fromCenter = previous === JoyDirection.center
    switch (s.mode) {
      case PlayMode.play: case PlayMode.strum: case PlayMode.drone: case PlayMode.arp: case PlayMode.repeatGate:
      case PlayMode.sequencer: case PlayMode.lead: case PlayMode.vocoder:
        if (this._heldButtons.length > 0) {
          for (const b of [...this._heldButtons]) {
            if ((this.buttonSwipes.get(b) ?? JoyDirection.center) === JoyDirection.center && !this.slashBassButtons.has(b)) {
              this.retrigger(b)
            }
          }
        } else if (s.mode === PlayMode.sequencer && fromCenter) {
          if (dir === JoyDirection.left && this._seqNames.length > 0) {
            this._seqNames.pop()
            this.send({ type: 'seqLength', length: this._seqNames.length })
            this.flash('UNDO STEP', `${this._seqNames.length}/16`)
          } else if (dir === JoyDirection.down) {
            this._seqNames = []
            this.send({ type: 'seqPlay', on: false })
            this.send({ type: 'seqLength', length: 0 })
            this.flash('SEQ CLEARED')
          }
        }
        break
      case PlayMode.drums:
        for (const b of this._heldButtons) this.send({ type: 'drumRepeat', pad: b, on: dir !== JoyDirection.center })
        break
      case PlayMode.beat:
        if (fromCenter && (dir === JoyDirection.left || dir === JoyDirection.right)) {
          s.beatVariation = (s.beatVariation + (dir === JoyDirection.right ? 1 : 7)) % 8
          if (this.status.beatOn) {
            this.send({ type: 'beat', style: s.beatStyle, variation: s.beatVariation, on: true })
          }
          this.flash('VARIATION', `${s.beatVariation + 1}/8`)
          this.changed()
        }
        break
      case PlayMode.mixer: {
        const t = this._heldButtons[0]
        if (fromCenter && (dir === JoyDirection.up || dir === JoyDirection.down) && t !== undefined && t < Engine.trackCount) {
          this._trackLevels[t] = Math.min(1.5, Math.max(0, this._trackLevels[t] + (dir === JoyDirection.up ? 0.1 : -0.1)))
          this.send({ type: 'loopLevel', track: t, level: this._trackLevels[t] })
          this.flash(`TRACK ${t + 1}`, `${round(this._trackLevels[t] * 100)}%`)
        }
        break
      }
      case PlayMode.chordRush: {
        const phase = this._rush.phase
        if (fromCenter && (dir === JoyDirection.left || dir === JoyDirection.right) &&
            phase !== RushPhase.playing && phase !== RushPhase.waiting) {
          const n = ChordRush.songs.length
          s.rushSong = (s.rushSong + (dir === JoyDirection.right ? 1 : n - 1)) % n
          this._rush.songIndex = s.rushSong
          this._rush.stop()
          this.changed()
        }
        break
      }
      case PlayMode.earTrainer:
        if (fromCenter && dir === JoyDirection.right) this.askEarQuestion()
        if (fromCenter && (dir === JoyDirection.up || dir === JoyDirection.down)) {
          const levels = EarTrainer.Level.allCases
          const i = (levels.indexOf(s.earLevel) + (dir === JoyDirection.up ? 1 : levels.length - 1)) % levels.length
          s.earLevel = levels[i]
          this.ear.level = levels[i]
          this.ear.reset()
          this.askEarQuestion()
          this.changed()
        }
        break
      default:
        break
    }
  }

  clickJoystick(): void {
    this.touch()
    this.haptic(HapticKind.tick)
    switch (this._screen) {
      case Screen.keyMenu: this._screen = Screen.keyList; this._listIndex = 0; return
      case Screen.soundMenu: this._screen = Screen.soundList; this._listIndex = 0; return
      case Screen.modeMenu: this._screen = Screen.modeList; this._listIndex = 0; return
      case Screen.keyList: case Screen.soundList: case Screen.modeList: this._screen = Screen.home; return
      case Screen.home: break
    }
    const s = this._settings
    switch (s.mode) {
      case PlayMode.sequencer:
        if (this._seqNames.length === 0) {
          this.flash('NO STEPS', 'PRESS CHORDS')
        } else {
          this.send({ type: 'seqPlay', on: !this.status.seqPlaying })
          this.status.seqPlaying = !this.status.seqPlaying
        }
        break
      case PlayMode.beat:
        this.send({ type: 'beat', style: s.beatStyle, variation: s.beatVariation, on: !this.status.beatOn })
        this.status.beatOn = !this.status.beatOn
        break
      case PlayMode.chordRush: {
        const rush = this._rush
        if (rush.phase === RushPhase.playing || rush.phase === RushPhase.waiting) {
          rush.stop()
          this.send({ type: 'beat', style: rush.song.style, variation: 0, on: false })
        } else {
          rush.songIndex = s.rushSong
          rush.arm()
          this.send({ type: 'beat', style: rush.song.style, variation: 0, on: true })
        }
        break
      }
      case PlayMode.earTrainer:
        this.replayEar()
        break
      case PlayMode.mic:
        if (!this.capturing) { this.capturing = true; this.host?.captureSample() }
        break
      case PlayMode.mixer:
        this.send({ type: 'transport', playing: !this.status.transportPlaying })
        break
      default:
        this.loopNext()
    }
  }

  /** The wheel: 0 ... 1. */
  setWheel(value: number): void {
    const v = Math.min(Math.max(value, 0), 1)
    if (this._settings.filterWheel) this._settings.filter = v
    else this._settings.volume = v
    this.sendMaster()
    this.changed()
  }

  get wheelValue(): number {
    return this._settings.filterWheel ? this._settings.filter : this._settings.volume
  }

  // MARK: Looper (also driven by the app's looper panel)

  /** Records the next empty track, or finishes the take in progress. */
  loopNext(): void {
    if (this.status.recordingTrack >= 0) {
      this.send({ type: 'loopRecord', track: this.status.recordingTrack })
      return
    }
    for (let t = 0; t < Engine.trackCount; t++) {
      if (trackState(this.status, t) === TrackState.empty) {
        this.loopRecord(t)
        return
      }
    }
    this.flash('LOOPS FULL', 'CLEAR A TRACK')
  }

  loopRecord(t: number): void {
    this.send({ type: 'loopRecord', track: t })
    if (this.status.recordingTrack !== t) {
      const free = this.status.loopLength === 0 && this._settings.loopBars === 0
      this.flash(`REC TRACK ${t + 1}`, free ? 'PLAY TO START' : this.status.loopLength === 0 ? 'COUNT-IN' : null)
    }
    this.haptic(HapticKind.warning)
  }

  loopMute(t: number, muted: boolean): void { this.send({ type: 'loopMute', track: t, muted }) }

  loopClear(t: number): void {
    this.send({ type: 'loopClear', track: t })
    this.flash(t < 0 ? 'LOOPS CLEARED' : `TRACK ${t + 1} CLEARED`)
  }

  setTransport(playing: boolean): void { this.send({ type: 'transport', playing }) }

  setLoopBars(bars: number): void {
    this._settings.loopBars = bars
    this.send({ type: 'loopBars', bars })
    this.changed()
  }

  setMetronome(on: boolean): void {
    this._settings.metronome = on
    this.send({ type: 'metronome', on })
    this.changed()
  }

  setTrackLevel(t: number, level: number): void {
    if (!(t >= 0 && t < Engine.trackCount)) return
    this._trackLevels[t] = Math.min(Math.max(level, 0), 1.5)
    this.send({ type: 'loopLevel', track: t, level: this._trackLevels[t] })
  }

  // MARK: Inputs — microphone

  /** Called by the host after `captureSample`. `rootNote` is the detected pitch (null if unpitched). */
  sampleCaptured(success: boolean, rootNote: number | null): void {
    this.capturing = false
    if (!success) {
      this.flash('NO SOUND', 'TRY AGAIN')
      this.haptic(HapticKind.warning)
      return
    }
    this.addSampleSound()
    this.selectSound('MIC SAMPLE')
    const pitch = rootNote !== null ? NoteNames.noteName(rootNote, HarmonySettings.prefersFlats(this._settings.harmony)) : 'UNPITCHED'
    this.setMode(PlayMode.play)
    this.flash('SAMPLED!', pitch)
    this.haptic(HapticKind.success)
    this.changed()
  }

  get isCapturing(): boolean { return this.capturing }

  // MARK: Settings helpers used by the app UI

  update(change: (s: DeviceSettings) => void): void {
    const s = copyDeviceSettings(this._settings)
    change(s)
    const old = this._settings
    this._settings = s
    if (!deepEqual(old.fx, s.fx)) this.send({ type: 'fx', params: { ...s.fx } })
    if (old.soundName !== s.soundName || old.attackScale !== s.attackScale || old.releaseScale !== s.releaseScale || old.leadGlide !== s.leadGlide) {
      this.sendPatch()
    }
    if (old.mode !== s.mode) {
      // setMode compares against the current mode, so restore the old one first.
      const target = s.mode
      s.mode = old.mode
      this.setMode(target)
    }
    if (old.bpm !== s.bpm) this.send({ type: 'tempo', bpm: s.bpm })
    if (old.volume !== s.volume || old.filter !== s.filter || old.filterWheel !== s.filterWheel) this.sendMaster()
    if (old.kit !== s.kit) this.send({ type: 'kit', kit: s.kit })
    if (old.arpPattern !== s.arpPattern || old.arpRate !== s.arpRate || old.arpLatch !== s.arpLatch) {
      this.send({ type: 'arp', pattern: s.arpPattern, rate: s.arpRate, latch: s.arpLatch })
    }
    if (old.repeatRate !== s.repeatRate) this.send({ type: 'repeatRate', rate: s.repeatRate })
    if (old.strumMs !== s.strumMs) this.send({ type: 'strumSpeed', ms: s.strumMs })
    if (old.seqStepBeats !== s.seqStepBeats) this.send({ type: 'seqStepBeats', beats: s.seqStepBeats })
    if (old.loopBars !== s.loopBars) this.send({ type: 'loopBars', bars: s.loopBars })
    if (old.metronome !== s.metronome) this.send({ type: 'metronome', on: s.metronome })
    if (old.earLevel !== s.earLevel) this.ear.level = s.earLevel
    if (!deepEqual(old.vocoder, s.vocoder)) {
      this.send({ type: 'vocoder', on: s.mode === PlayMode.vocoder, params: { ...s.vocoder } })
      this.updateMicrophone()
    }
    this.changed()
  }

  get currentSound(): SoundPreset {
    return this._sounds.find(p => p.name === this._settings.soundName) ?? this._sounds[0]
  }

  selectSound(name: string): void {
    if (!this._sounds.some(p => p.name === name)) return
    this._settings.soundName = name
    this.sendPatch()
    this.changed()
  }

  setMode(mode: PlayMode): void {
    const old = this._settings.mode
    if (old !== mode) {
      for (const b of [...this._heldButtons]) this.releaseButton(b)
      if (old === PlayMode.sequencer) this.send({ type: 'seqPlay', on: false })
      if (old === PlayMode.earTrainer) { this.send({ type: 'stopPreview' }); this.earNextAt = null }
      if (old === PlayMode.drums) for (let p = 0; p < 7; p++) this.send({ type: 'drumRepeat', pad: p, on: false })
      if (old === PlayMode.chordRush && this._rush.phase !== RushPhase.idle) {
        this._rush.stop()
        this.send({ type: 'beat', style: this._rush.song.style, variation: 0, on: false })
      }
    }
    this._settings.mode = mode
    this.send({ type: 'style', style: PlayMode.engineStyle(mode) })
    this.sendPatch()
    this.send({ type: 'vocoder', on: mode === PlayMode.vocoder, params: { ...this._settings.vocoder } })
    this.updateMicrophone()
    if (mode === PlayMode.earTrainer && old !== PlayMode.earTrainer) {
      this.ear.reset()
      this.askEarQuestion()
    }
    if (mode !== PlayMode.mic) this.capturing = false
    this.changed()
  }

  // MARK: Chords

  private chordSpec(b: number, direction: JoyDirection | null = null): ChordSpec {
    const dir = direction ?? this.effectiveDirection(b)
    return ChordBuilder.chord(b, dir, this._settings.harmony)
  }

  private effectiveDirection(b: number): JoyDirection {
    const swipe = this.buttonSwipes.get(b) ?? JoyDirection.center
    return swipe !== JoyDirection.center ? swipe : this._joystick
  }

  private voicing(spec: ChordSpec, degree: number): Voicing {
    return ChordBuilder.voicing(spec, degree, this._settings.harmony, this.lastVoicing?.notes ?? null)
  }

  private playChord(b: number, bassButton: number | null = null): void {
    const spec: ChordSpec = { ...this.chordSpec(b) }
    if (bassButton !== null) {
      spec.bass = ChordBuilder.diatonic(bassButton, this._settings.harmony).root
    }
    const v = this.voicing(spec, b)
    this.send({ type: 'press', id: b, notes: noteSet([...Voicing.allNotes(v)].sort((x, y) => x - y)), velocity: 0.8 })
    this.lastVoicing = v
    this.buttonChords.set(b, spec)
    this._displayChord = ChordSpec.name(spec, HarmonySettings.prefersFlats(this._settings.harmony))
    this.displayDegree = b
    this.lastChordTime = this._now
  }

  private leadNote(b: number, direction: JoyDirection): number {
    const h = this._settings.harmony
    const keyRoot = 60 + h.key - (h.key > 6 ? 12 : 0)
    let note = keyRoot + Scale.leadOffset(h.scale, b) + 12 * (h.octave + h.buttonOctaves[b])
    switch (direction) {
      case JoyDirection.up: note += 12; break
      case JoyDirection.down: note -= 12; break
      case JoyDirection.right: note += 1; break
      case JoyDirection.left: note -= 1; break
      case JoyDirection.upRight: note += 13; break
      case JoyDirection.upLeft: note += 11; break
      case JoyDirection.downRight: note -= 11; break
      case JoyDirection.downLeft: note -= 13; break
      case JoyDirection.center: break
    }
    return Math.min(Math.max(note, 12), 115)
  }

  private playLead(b: number): void {
    const note = this.leadNote(b, this.effectiveDirection(b))
    this.send({ type: 'press', id: b, notes: noteSet([note]), velocity: 0.8 })
    this._displayChord = NoteNames.noteName(note, HarmonySettings.prefersFlats(this._settings.harmony))
    this.displayDegree = b
    this.lastChordTime = this._now
  }

  /** Re-voices a held button after the joystick moved. */
  private retrigger(b: number): void {
    switch (this._settings.mode) {
      case PlayMode.lead:
        this.playLead(b)
        break
      case PlayMode.play: case PlayMode.strum: case PlayMode.drone: case PlayMode.arp:
      case PlayMode.repeatGate: case PlayMode.sequencer: case PlayMode.vocoder: {
        const spec = this.chordSpec(b)
        if (deepEqual(spec, this.buttonChords.get(b))) return
        this.playChord(b)
        this.haptic(HapticKind.tick)
        break
      }
      default:
        break
    }
  }

  // MARK: Menus

  private get keyItems(): MenuItem[] {
    return [
      { title: 'SCALE', value: s => Scale.displayName(s.harmony.scale), change: (s, d) => { s.harmony.scale = cycle(s.harmony.scale, d, Scale.allCases) } },
      { title: 'JOYSTICK', value: s => JoystickMap.displayName(s.harmony.joystickMap), change: (s, d) => { s.harmony.joystickMap = cycle(s.harmony.joystickMap, d, JoystickMap.allCases) } },
      { title: 'INVERSION', value: s => (s.harmony.inversion === 0 ? 'ROOT' : `INV ${s.harmony.inversion}`),
        change: (s, d) => { s.harmony.inversion = (s.harmony.inversion + d + 4) % 4 } },
      { title: 'VOICE LEAD', value: s => (s.harmony.voiceLeading ? 'ON' : 'OFF'), change: s => { s.harmony.voiceLeading = !s.harmony.voiceLeading } },
      { title: 'BASS', value: s => BassMode.displayName(s.harmony.bassMode), change: (s, d) => { s.harmony.bassMode = cycle(s.harmony.bassMode, d, BassMode.allCases) } },
      { title: 'SLASH 2BTN', value: s => (s.slashChords ? 'ON' : 'OFF'), change: s => { s.slashChords = !s.slashChords } },
      { title: 'BTN OCTAVES', value: s => (s.harmony.buttonOctaves.every(o => o === 0) ? 'FLAT' : 'CUSTOM'),
        change: s => { s.harmony.buttonOctaves = Array(7).fill(0) } },
    ]
  }

  private get soundItems(): MenuItem[] {
    return [
      { title: 'REVERB', value: s => ReverbType.displayName(s.fx.reverb), change: (s, d) => { s.fx.reverb = cycle(s.fx.reverb, d, ReverbType.allCases) } },
      { title: 'REV MIX', value: s => pct(s.fx.reverbMix), change: (s, d) => { s.fx.reverbMix = step(s.fx.reverbMix, d, 0.05, 0, 1) } },
      { title: 'DELAY', value: s => DelayTime.displayName(s.fx.delay), change: (s, d) => { s.fx.delay = cycle(s.fx.delay, d, DelayTime.allCases) } },
      { title: 'DLY FDBK', value: s => pct(s.fx.delayFeedback), change: (s, d) => { s.fx.delayFeedback = step(s.fx.delayFeedback, d, 0.05, 0, 0.9) } },
      { title: 'DLY MIX', value: s => pct(s.fx.delayMix), change: (s, d) => { s.fx.delayMix = step(s.fx.delayMix, d, 0.05, 0, 1) } },
      { title: 'MOD FX', value: s => ModType.displayName(s.fx.mod), change: (s, d) => { s.fx.mod = cycle(s.fx.mod, d, ModType.allCases) } },
      { title: 'TREMOLO', value: s => TremoloRate.displayName(s.fx.tremolo), change: (s, d) => { s.fx.tremolo = cycle(s.fx.tremolo, d, TremoloRate.allCases) } },
      { title: 'DRIVE', value: s => DriveType.displayName(s.fx.drive), change: (s, d) => { s.fx.drive = cycle(s.fx.drive, d, DriveType.allCases) } },
      { title: 'LO-FI', value: s => LofiType.displayName(s.fx.lofi), change: (s, d) => { s.fx.lofi = cycle(s.fx.lofi, d, LofiType.allCases) } },
      { title: 'SPREAD', value: s => pct(s.fx.spread), change: (s, d) => { s.fx.spread = step(s.fx.spread, d, 0.1, 0, 1) } },
      { title: 'ATTACK', value: s => `x${s.attackScale.toFixed(2)}`,
        change: (s, d) => { s.attackScale = Math.min(16, Math.max(0.125, s.attackScale * (d > 0 ? 1.4142 : 0.7071))) } },
      { title: 'RELEASE', value: s => `x${s.releaseScale.toFixed(2)}`,
        change: (s, d) => { s.releaseScale = Math.min(16, Math.max(0.125, s.releaseScale * (d > 0 ? 1.4142 : 0.7071))) } },
      { title: 'WHEEL', value: s => (s.filterWheel ? 'FILTER' : 'VOLUME'), change: s => { s.filterWheel = !s.filterWheel } },
    ]
  }

  private get modeItems(): MenuItem[] {
    return [
      { title: 'BPM', value: s => `${round(s.bpm)}`, change: (s, d) => { s.bpm = Math.min(300, Math.max(40, round(s.bpm) + d)) } },
      { title: 'ARP PATT', value: s => ArpPattern.displayName(s.arpPattern), change: (s, d) => { s.arpPattern = cycle(s.arpPattern, d, ArpPattern.allCases) } },
      { title: 'ARP RATE', value: s => NoteRate.displayName(s.arpRate), change: (s, d) => { s.arpRate = cycle(s.arpRate, d, NoteRate.allCases) } },
      { title: 'ARP LATCH', value: s => (s.arpLatch ? 'ON' : 'OFF'), change: s => { s.arpLatch = !s.arpLatch } },
      { title: 'REPEAT', value: s => NoteRate.displayName(s.repeatRate), change: (s, d) => { s.repeatRate = cycle(s.repeatRate, d, NoteRate.allCases) } },
      { title: 'STRUM', value: s => `${Math.trunc(s.strumMs)}MS`, change: (s, d) => { s.strumMs = step(s.strumMs, d, 4, 0, 120) } },
      { title: 'DRUM KIT', value: s => DrumKit.displayName(s.kit), change: (s, d) => { s.kit = cycle(s.kit, d, DrumKit.allCases) } },
      { title: 'SEQ STEP', value: s => beatsName(s.seqStepBeats),
        change: (s, d) => {
          const opts = [0.5, 1, 2, 4, 8]
          let i = opts.indexOf(s.seqStepBeats)
          if (i < 0) i = 2
          s.seqStepBeats = opts[Math.min(Math.max(i + d, 0), opts.length - 1)]
        } },
      { title: 'LOOP BARS', value: s => (s.loopBars === 0 ? 'FREE' : `${s.loopBars}`),
        change: (s, d) => {
          const opts = [0, 1, 2, 4, 8]
          let i = opts.indexOf(s.loopBars)
          if (i < 0) i = 2
          s.loopBars = opts[Math.min(Math.max(i + d, 0), opts.length - 1)]
        } },
      { title: 'METRONOME', value: s => (s.metronome ? 'ON' : 'OFF'), change: s => { s.metronome = !s.metronome } },
      { title: 'EAR LEVEL', value: s => `${EarTrainer.Level.allCases.indexOf(s.earLevel) + 1}`,
        change: (s, d) => { s.earLevel = cycle(s.earLevel, d, EarTrainer.Level.allCases) } },
      { title: 'GLIDE', value: s => (s.leadGlide <= 0.001 ? 'OFF' : `${round(s.leadGlide * 1000)}MS`),
        change: (s, d) => { s.leadGlide = step(s.leadGlide, d, 0.02, 0, 0.5) } },
      { title: 'SCOPE', value: s => (s.showScope ? 'ON' : 'OFF'), change: s => { s.showScope = !s.showScope } },
      { title: 'VOC SOURCE', value: s => VocoderSource.displayName(s.vocoder.source),
        change: (s, d) => { s.vocoder.source = cycle(s.vocoder.source, d, VocoderSource.allCases) } },
      { title: 'VOC FORMANT', value: s => `x${s.vocoder.formant.toFixed(2)}`,
        change: (s, d) => { s.vocoder.formant = step(s.vocoder.formant, d, 0.05, 0.5, 2) } },
      { title: 'VOC NOISE', value: s => pct(s.vocoder.noise), change: (s, d) => { s.vocoder.noise = step(s.vocoder.noise, d, 0.05, 0, 1) } },
    ]
  }

  private get currentItems(): MenuItem[] {
    switch (this._screen) {
      case Screen.keyList: return this.keyItems
      case Screen.soundList: return this.soundItems
      case Screen.modeList: return this.modeItems
      default: return []
    }
  }

  private menuJoystick(dir: JoyDirection, repeating: boolean): void {
    const horizontal = dir === JoyDirection.left ? -1 : dir === JoyDirection.right ? 1 : 0
    const vertical = dir === JoyDirection.up ? -1 : dir === JoyDirection.down ? 1 : 0
    switch (this._screen) {
      case Screen.keyMenu:
        if (horizontal !== 0) {
          this.update(s => { s.harmony.key = mod12(s.harmony.key + horizontal) })
        } else if (vertical !== 0) {
          this.update(s => { s.harmony.octave = Math.min(2, Math.max(-2, s.harmony.octave - vertical)) })
        }
        this.haptic(HapticKind.tick)
        break
      case Screen.soundMenu:
        if (horizontal !== 0) {
          let i = this._sounds.findIndex(p => p.name === this._settings.soundName)
          if (i < 0) i = 0
          const n = this._sounds.length
          this.selectSound(this._sounds[(i + horizontal + n) % n].name)
          this.haptic(HapticKind.tick)
        } else if (dir === JoyDirection.up && !repeating) {
          this._screen = Screen.soundList
          this._listIndex = 0
        }
        break
      case Screen.modeMenu:
        if (horizontal !== 0) {
          const all = PlayMode.allCases
          this.setMode(all[(this._settings.mode + horizontal + all.length) % all.length])
          this.haptic(HapticKind.tick)
        } else if (dir === JoyDirection.up && !repeating) {
          this._screen = Screen.modeList
          this._listIndex = 0
        }
        break
      case Screen.keyList: case Screen.soundList: case Screen.modeList: {
        const items = this.currentItems
        if (vertical !== 0) {
          this._listIndex = Math.min(Math.max(this._listIndex + vertical, 0), items.length - 1)
          this.haptic(HapticKind.tick)
        } else if (horizontal !== 0 && this._listIndex >= 0 && this._listIndex < items.length) {
          const item = items[this._listIndex]
          this.update(s => item.change(s, horizontal))
          this.haptic(HapticKind.tick)
        }
        break
      }
      case Screen.home:
        break
    }
  }

  private tapTempo(): void {
    this.tapTimes = this.tapTimes.filter(t => this._now - t < 2.5)
    this.tapTimes.push(this._now)
    if (this.tapTimes.length >= 2) {
      const intervals = this.tapTimes.slice(1).map((t, i) => t - this.tapTimes[i])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      if (avg > 0) this.update(s => { s.bpm = Math.min(300, Math.max(40, round(60 / avg))) })
    }
    this.flash('TAP', `${Math.trunc(this._settings.bpm)} BPM`)
  }

  // MARK: Ear trainer

  private askEarQuestion(): void {
    this.earFeedback = null
    const q = this.ear.next(this._settings.harmony)
    this.playEar(q)
  }

  private replayEar(): void {
    const q = this.ear.current
    if (!q) { this.askEarQuestion(); return }
    this.playEar(q)
  }

  private playEar(q: EarTrainer.Question): void {
    this.send({ type: 'stopPreview' })
    this.send({ type: 'preview', notes: noteSet(q.reference), delay: 0, duration: 0.7 })
    if (q.melodic) {
      q.prompt.forEach((n, i) => {
        this.send({ type: 'preview', notes: noteSet([n]), delay: 1.0 + 0.6 * i, duration: 0.55 })
      })
    } else {
      this.send({ type: 'preview', notes: noteSet(q.prompt), delay: 1.0, duration: 1.3 })
    }
  }

  private answerEar(b: number): void {
    if (!this.ear.current) { this.askEarQuestion(); return }
    const correct = this.ear.answer(b)
    const numeral = Device.numerals[b]
    if (correct) {
      this.earFeedback = { correct: true, text: '✓ ' + numeral, until: this._now + 1.4 }
      this.earNextAt = this._now + 1.5
      this.haptic(HapticKind.success)
    } else {
      this.earFeedback = { correct: false, text: '✗ ' + numeral, until: this._now + 1.0 }
      this.haptic(HapticKind.warning)
    }
    // Let the player hear what they picked.
    const s = this._settings
    const spec = ChordBuilder.diatonic(b, s.harmony)
    const h: HarmonySettings = { ...s.harmony, buttonOctaves: [...s.harmony.buttonOctaves], voiceLeading: false, bassMode: BassMode.off }
    const v = ChordBuilder.voicing(spec, b, h)
    this.send({ type: 'stopPreview' })
    const single = s.earLevel === EarTrainer.Level.notes || s.earLevel === EarTrainer.Level.intervals
    this.send({ type: 'preview', notes: noteSet(single ? [this.leadNote(b, JoyDirection.center)] : v.notes), delay: 0, duration: 0.8 })
  }

  // MARK: Accessibility

  /** What the display shows, in words (screen readers and UI tests). */
  get accessibilityText(): string {
    if (this.message) return [this.message.title, this.message.detail].filter((x): x is string => x !== null).join(' ')
    const s = this._settings
    const h = s.harmony
    switch (this._screen) {
      case Screen.keyMenu: return `Key ${NoteNames.keyName(h.key)} ${capitalized(Scale.displayName(h.scale))}, octave ${h.octave}`
      case Screen.soundMenu: return `Sound ${this.currentSound.name}`
      case Screen.modeMenu: return `Mode ${PlayMode.displayName(s.mode)}`
      case Screen.keyList: case Screen.soundList: case Screen.modeList: {
        const items = this.currentItems
        const item = items[this._listIndex]
        if (!item) return 'Setup'
        return `${item.title} ${item.value(s)}`
      }
      case Screen.home:
        switch (s.mode) {
          case PlayMode.tuner: {
            const t = this.tuner
            if (!t || !(t.confidence > 0.5)) return 'Tuner, play a note'
            return `Tuner ${NoteNames.noteName(tunerNearestNote(t))} ${round(tunerCents(t))} cents`
          }
          case PlayMode.chordRush: {
            const r = this._rush
            return r.phase === RushPhase.done ? `Chord Rush grade ${r.grade}, score ${r.score}` : `Chord Rush ${r.song.name}, score ${r.score}`
          }
          case PlayMode.earTrainer:
            return this.earFeedback?.text ?? `Ear trainer ${EarTrainer.Level.displayName(s.earLevel)}, score ${this.ear.score} of ${this.ear.attempts}`
          case PlayMode.drums:
            return this.lastDrumPad !== null ? DrumKit.padNames[this.lastDrumPad] : `Drums ${DrumKit.displayName(s.kit)}`
          case PlayMode.beat:
            return `Beat ${BeatStyle.displayName(s.beatStyle)} variation ${s.beatVariation + 1}`
          default:
            return this._displayChord ?? PlayMode.displayName(s.mode)
        }
    }
  }

  // MARK: Chord Rush

  private finishRush(): void {
    const rush = this._rush
    const s = this._settings
    this.send({ type: 'beat', style: rush.song.style, variation: 0, on: false })
    const i = rush.songIndex
    while (s.rushBest.length < ChordRush.songs.length) s.rushBest.push(0)
    if (rush.score > s.rushBest[i]) {
      s.rushBest[i] = rush.score
      this.flash('NEW BEST!', `${rush.score}`)
    }
    this.haptic(HapticKind.success)
    this.changed()
  }

  private drawRush(f: OLEDFrame): void {
    const rush = this._rush
    const best = this._settings.rushBest[rush.songIndex] ?? 0
    switch (rush.phase) {
      case RushPhase.idle:
        f.alignedText('◀ ' + rush.song.name + ' ▶', 12, Align.center)
        f.fittedText('RUSH', 32, 3)
        f.alignedText(`● START   BEST ${best}`, 45, Align.center)
        break
      case RushPhase.done:
        f.alignedText(rush.song.name, 12, Align.center)
        f.fittedText('GRADE ' + rush.grade, 28, 2)
        f.alignedText(`SCORE ${rush.score}  COMBO ${rush.bestCombo}`, 41, Align.center)
        f.alignedText('● AGAIN  ◀▶ SONG', 49, Align.center)
        break
      case RushPhase.waiting:
      case RushPhase.playing: {
        // Lane: chords travel right-to-left onto the hit line.
        const hitX = 18
        const pxPerBeat = 13.0
        f.vline(hitX, 13, 26)
        f.vline(hitX + 1, 13, 26)
        f.hline(0, 26, OLEDFrame.width)
        if (rush.phase === RushPhase.playing) {
          const b = this.beatNow
          rush.song.degrees.forEach((degree, i) => {
            const x = hitX + round((rush.targetBeat(i) - b) * pxPerBeat)
            if (!(x > -20 && x < OLEDFrame.width)) return
            const label = Device.numerals[degree]
            const w = OLEDFrame.textWidth(label) + 4
            const left = x - Math.trunc(w / 2)
            f.fill(left, 20, w, 13, false)
            f.rect(left, 20, w, 13)
            f.text(label, left + 2, 23)
            if (i < rush.results.length && rush.results[i] != null) f.invert(left, 20, w, 13)
          })
          // Beat ticks
          const phase = b - Math.floor(b)
          if (phase < 0.15) f.fill(hitX - 3, 13, 8, 2)
        } else {
          f.alignedText('GET READY', 23, Align.center)
        }
        const j = rush.lastJudgement
        if (this._now < this.rushFeedbackUntil && j !== null && j !== undefined) {
          f.alignedText(Judgement.label(j), 37, Align.center, 1)
        }
        f.text(`${rush.score}`, 1, 47)
        if (rush.combo > 1) f.alignedText(`x${rush.combo}`, 47, Align.right, 1, 1)
        break
      }
    }
  }

  // MARK: Output helpers

  private send(cmd: EngineCommand): void { this.host?.send(cmd) }

  private sendPatch(): void {
    const s = this._settings
    let p: SynthParams = withEnvelope(this.currentSound.params, s.attackScale, s.releaseScale)
    if (s.mode === PlayMode.lead) p.glide = s.leadGlide
    if (s.mode === PlayMode.drone) { p.attack = Math.max(p.attack, 0.4); p.release = Math.max(p.release, 1.5) }
    if (s.mode === PlayMode.vocoder) {
      // A bright, sustained carrier makes speech intelligible whatever sound is selected.
      p = { ...SoundLibrary.factory[0].params }
      p.cutoff = 9000; p.filterEnv = 0; p.sustain = 1; p.attack = 0.01; p.release = 0.15
    }
    this.send({ type: 'patch', params: p })
  }

  private sendMaster(): void {
    const s = this._settings
    // Filter wheel: exponential sweep 120 Hz ... 20 kHz.
    const cutoff = s.filterWheel ? 120 * Math.pow(20000.0 / 120.0, s.filter) : 20000
    this.send({ type: 'master', volume: s.volume, cutoff })
  }

  private flash(title: string, detail: string | null = null): void {
    this.message = { title, detail, until: this._now + 1.3 }
  }

  private haptic(kind: HapticKind): void {
    if (this._settings.haptics) this.host?.haptic(kind)
  }

  private touch(): void { this.lastInteraction = this._now }

  private changed(): void { this.host?.settingsDidChange() }

  // MARK: Display

  render(): OLEDFrame {
    const f = new OLEDFrame()
    switch (this._screen) {
      case Screen.home: this.drawHome(f); break
      case Screen.keyMenu: this.drawKeyMenu(f); break
      case Screen.soundMenu: this.drawSoundMenu(f); break
      case Screen.modeMenu: this.drawModeMenu(f); break
      case Screen.keyList: this.drawList(f, 'KEY SETUP'); break
      case Screen.soundList: this.drawList(f, 'SOUND FX'); break
      case Screen.modeList: this.drawList(f, 'SETUP'); break
    }
    if (this.message) this.drawMessage(f, this.message.title, this.message.detail)
    return f
  }

  private drawHeader(f: OLEDFrame, left: string, right: string): void {
    f.text(left, 1, 0)
    f.alignedText(right, 0, Align.right, 1, 1)
    f.hline(0, 9, OLEDFrame.width)
  }

  private drawFooter(f: OLEDFrame): void {
    const y = 56
    f.text('♪' + `${round(this._settings.bpm)}`, 1, y)
    // Six loop tracks
    const blink = Math.trunc(this._now * 4) % 2 === 0
    for (let t = 0; t < Engine.trackCount; t++) {
      const x = 40 + t * 8
      switch (trackState(this.status, t)) {
        case TrackState.empty: f.fill(x + 2, y + 5, 2, 1); break
        case TrackState.armed: if (blink) f.rect(x, y + 1, 6, 6); break
        case TrackState.recording: if (blink) f.fill(x, y + 1, 6, 6); else f.rect(x, y + 1, 6, 6); break
        case TrackState.playing: f.fill(x, y + 1, 6, 6); break
        case TrackState.muted: f.rect(x, y + 1, 6, 6); break
      }
    }
    if (this.status.loopLength > 0 && this.status.transportPlaying) {
      // Loop progress bar on the bottom pixel row, under the tracks.
      const w = Math.trunc((47 * this.status.loopPosition) / this.status.loopLength)
      f.hline(40, OLEDFrame.height - 1, Math.max(1, w))
    }
    // Battery
    if (this.battery !== null) {
      const bx = 113
      f.rect(bx, y + 1, 12, 6)
      f.fill(bx + 12, y + 3, 1, 2)
      f.fill(bx + 2, y + 3, Math.max(0, Math.min(8, round(this.battery * 8))), 2)
    }
    if (this.status.countIn > 0) {
      f.text(`${Math.ceil(this.status.countIn)}`, 94, y)
    } else if (this.status.beatOn) {
      f.text('●', 94, y)
    }
  }

  private get keyTag(): string {
    const h = this._settings.harmony
    return NoteNames.keyName(h.key) + ' ' + Scale.shortName(h.scale)
  }

  private drawHome(f: OLEDFrame): void {
    const s = this._settings
    if (s.mode !== PlayMode.tuner && s.mode !== PlayMode.mixer) {
      this.drawHeader(f, this.keyTag, PlayMode.shortName(s.mode))
    }
    const midY = 31
    switch (s.mode) {
      case PlayMode.play: case PlayMode.strum: case PlayMode.lead: case PlayMode.drone: case PlayMode.arp:
      case PlayMode.repeatGate: case PlayMode.sequencer: case PlayMode.vocoder: {
        const idle = this._heldButtons.length === 0 && this._now - this.lastChordTime > 2.5
        if (idle && s.showScope && this.scope.length > 0 && this.status.peak > 0.002) {
          this.drawScope(f, 12, 38)
        } else if (this._displayChord !== null) {
          f.fittedText(this._displayChord, midY - 2, 3)
          let detail = this.displayDegree !== null ? Device.numerals[this.displayDegree] : ''
          switch (s.mode) {
            case PlayMode.arp: detail += '  ' + ArpPattern.displayName(s.arpPattern) + ' ' + NoteRate.displayName(s.arpRate); break
            case PlayMode.repeatGate: detail += '  RPT ' + NoteRate.displayName(s.repeatRate); break
            case PlayMode.strum: detail += '  STRUM'; break
            case PlayMode.drone: detail += '  DRONE'; break
            case PlayMode.vocoder: detail += '  VOC ' + VocoderSource.displayName(s.vocoder.source); break
            case PlayMode.lead: detail = 'LEAD'; break
            case PlayMode.sequencer:
              detail = this.status.seqPlaying ? `▶ STEP ${this.status.seqStep + 1}/${this._seqNames.length}` : `STEPS ${this._seqNames.length}/16`
              break
            default: break
          }
          if (this._joystick !== JoyDirection.center && s.mode !== PlayMode.lead) {
            detail += '  ' + JoystickMap.legend(s.harmony.joystickMap, this._joystick)
          }
          f.alignedText(detail, 45, Align.center)
        } else {
          f.fittedText('Tonic', midY - 2, 3)
          const hint = s.mode === PlayMode.sequencer
            ? (this._seqNames.length === 0 ? 'TAP CHORDS TO ADD' : `STEPS ${this._seqNames.length}/16 ● PLAY`)
            : this.currentSound.name
          f.alignedText(hint, 45, Align.center)
        }
        break
      }
      case PlayMode.drums:
        f.fittedText(this.lastDrumPad !== null ? DrumKit.padNames[this.lastDrumPad] : 'DRUMS', midY - 2, 3)
        f.alignedText(DrumKit.displayName(s.kit), 45, Align.center)
        break
      case PlayMode.beat:
        f.fittedText(BeatStyle.displayName(s.beatStyle), midY - 4, 3)
        f.alignedText((this.status.beatOn ? '▶ ' : '■ ') + `VAR ${s.beatVariation + 1}/8`, 40, Align.center)
        for (let st = 0; st < 16; st++) {
          const x = 16 + st * 6
          if (this.status.beatOn && this.status.beatStep === st) {
            f.fill(x, 49, 5, 4)
          } else {
            f.fill(x + 2, 51, 1, 1)
            if (st % 4 === 0) f.fill(x + 1, 51, 3, 1)
          }
        }
        break
      case PlayMode.chordRush:
        this.drawRush(f)
        break
      case PlayMode.earTrainer:
        f.alignedText(EarTrainer.Level.displayName(s.earLevel), 12, Align.center)
        f.fittedText(this.earFeedback ? this.earFeedback.text : '?', midY + 1, 3)
        f.alignedText(`SCORE ${this.ear.score}/${this.ear.attempts}`, 45, Align.center)
        break
      case PlayMode.tuner:
        this.drawTuner(f)
        break
      case PlayMode.mic:
        if (this.capturing) {
          f.fittedText('● REC', midY - 4, 3)
          const w = Math.trunc(Math.min(1, this.micLevel * 4) * 100)
          f.rect(13, 44, 102, 6)
          f.fill(14, 45, w, 4)
        } else {
          f.fittedText('MIC', midY - 4, 3)
          f.alignedText('PRESS A KEY TO', 40, Align.center)
          f.alignedText('SAMPLE', 48, Align.center)
        }
        break
      case PlayMode.mixer:
        this.drawMixer(f)
        break
    }
    if (s.mode !== PlayMode.tuner && s.mode !== PlayMode.mixer) this.drawFooter(f)
  }

  private drawScope(f: OLEDFrame, top: number, height: number): void {
    // Find a rising zero crossing for a stable picture.
    const scope = this.scope
    const n = scope.length
    let start = 0
    const limit = Math.max(2, Math.trunc(n / 2))
    for (let i = 1; i < limit; i++) {
      if (scope[i - 1] < 0 && scope[i] >= 0) { start = i; break }
    }
    let maxAbs = 0
    for (const v of scope) maxAbs = Math.max(maxAbs, Math.abs(v))
    const peak = Math.max(0.05, n > 0 ? maxAbs : 1)
    let prevY: number | null = null
    const half = Math.trunc(height / 2)
    for (let x = 0; x < OLEDFrame.width; x++) {
      const i = start + x * 2
      if (i >= n) break
      const v = scope[i] / peak
      const y = top + half - round(v * (half - 1))
      if (prevY !== null) f.line(x - 1, prevY, x, y)
      else f.set(x, y)
      prevY = y
    }
  }

  private drawTuner(f: OLEDFrame): void {
    f.text('TUNER', 1, 0)
    f.alignedText('A440', 0, Align.right, 1, 1)
    f.hline(0, 9, OLEDFrame.width)
    const t = this.tuner
    if (!t || !(t.confidence > 0.5)) {
      f.fittedText('--', 28, 3)
      f.alignedText('PLAY A NOTE', 50, Align.center)
      return
    }
    const name = NoteNames.noteName(tunerNearestNote(t), HarmonySettings.prefersFlats(this._settings.harmony))
    f.fittedText(name, 25, 3)
    const cents = Math.max(-50, Math.min(50, tunerCents(t)))
    // Meter
    f.hline(14, 46, 101)
    for (let c = -50; c <= 50; c += 10) {
      const x = 64 + c
      f.vline(x, c === 0 ? 41 : 44, c === 0 ? 10 : 3)
    }
    const nx = 64 + round(cents)
    f.fill(nx - 1, 39, 3, 14)
    const inTune = Math.abs(cents) < 4
    f.alignedText(inTune ? 'IN TUNE' : `${signed(round(cents))} CENTS`, 56, Align.center)
  }

  private drawMixer(f: OLEDFrame): void {
    f.text('MIXER', 1, 0)
    f.alignedText(this.status.transportPlaying ? '▶' : '■', 0, Align.right, 1, 1)
    f.hline(0, 9, OLEDFrame.width)
    for (let t = 0; t < Engine.trackCount; t++) {
      const x = 6 + t * 20
      const state = trackState(this.status, t)
      const h = Math.trunc((this._trackLevels[t] / 1.5) * 34)
      f.rect(x, 13, 12, 36)
      if (state === TrackState.playing || state === TrackState.recording) {
        f.fill(x + 2, 47 - h, 8, Math.max(1, h))
      } else if (state === TrackState.muted) {
        f.line(x + 2, 15, x + 9, 46)
        f.line(x + 9, 15, x + 2, 46)
      }
      f.text(`${t + 1}`, x + 3, 54)
    }
  }

  private drawKeyMenu(f: OLEDFrame): void {
    const h = this._settings.harmony
    this.drawHeader(f, 'KEY', 'OCT ' + (h.octave === 0 ? '0' : signed(h.octave)))
    f.text('◀', 2, 25)
    f.alignedText('▶', 25, Align.right, 1, 2)
    f.fittedText(NoteNames.keyName(h.key), 26, 3)
    f.alignedText(Scale.displayName(h.scale), 42, Align.center)
    f.alignedText('● SETUP  ▲▼ OCTAVE', 55, Align.center)
  }

  private drawSoundMenu(f: OLEDFrame): void {
    const i = Math.max(0, this._sounds.findIndex(p => p.name === this._settings.soundName)) + 1
    this.drawHeader(f, 'SOUND', `${i}/${this._sounds.length}`)
    f.text('◀', 2, 27)
    f.alignedText('▶', 27, Align.right, 1, 2)
    f.fittedText(this.currentSound.name, 30, 2, 108)
    f.alignedText('▲ EFFECTS', 55, Align.center)
  }

  private drawModeMenu(f: OLEDFrame): void {
    const s = this._settings
    this.drawHeader(f, 'MODE', `${s.mode + 1}/${PlayMode.allCases.length}`)
    f.text('◀', 2, 27)
    f.alignedText('▶', 27, Align.right, 1, 2)
    f.fittedText(PlayMode.displayName(s.mode), 30, 2, 108)
    f.alignedText('▲ SETUP  ' + `♪${round(s.bpm)}`, 55, Align.center)
  }

  private drawList(f: OLEDFrame, title: string): void {
    const items = this.currentItems
    // Title bar: dark text on a lit bar.
    f.text(title, 2, 1)
    f.alignedText(`${this._listIndex + 1}/${items.length}`, 1, Align.right, 1, 2)
    f.invert(0, 0, OLEDFrame.width, 9)
    const rows = 4
    const first = Math.min(Math.max(0, this._listIndex - 1), Math.max(0, items.length - rows))
    for (let r = 0; r < rows; r++) {
      const i = first + r
      if (i >= items.length) break
      const y = 12 + r * 13
      f.text(items[i].title, 3, y + 2)
      f.alignedText(items[i].value(this._settings), y + 2, Align.right, 1, 3)
      if (i === this._listIndex) f.invert(0, y, OLEDFrame.width, 11)
    }
  }

  private drawMessage(f: OLEDFrame, title: string, detail: string | null): void {
    const h = detail === null ? 22 : 32
    const y = Math.trunc((OLEDFrame.height - h) / 2)
    f.fill(6, y, OLEDFrame.width - 12, h, false)
    f.rect(6, y, OLEDFrame.width - 12, h)
    f.rect(8, y + 2, OLEDFrame.width - 16, h - 4)
    const scale = OLEDFrame.textWidth(title, 2) <= OLEDFrame.width - 24 ? 2 : 1
    f.alignedText(title, y + (detail === null ? Math.trunc((h - 7 * scale) / 2) : 5), Align.center, scale)
    if (detail !== null) f.alignedText(detail, y + h - 13, Align.center)
  }
}
