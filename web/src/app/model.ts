// Owns the device firmware, the audio engine and the browser services, and tells views when to redraw.
import { Device, type DeviceHost, FunctionKey, HapticKind } from '../core/device/device'
import { defaultDeviceSettings, PlayMode, type DeviceSettings } from '../core/device/deviceSettings'
import { defaultEngineStatus, TrackState, type EngineCommand, type EngineStatus } from '../core/dsp/engineTypes'
import { OLEDFrame } from '../core/display/oledFrame'
import { JoyDirection } from '../core/theory/joystick'
import { AudioHost } from './audio'
import { MicAnalyser, detectRoot } from './mic'
import { MidiOut } from './midi'
import * as store from './persistence'

type Listener = () => void

export class AppModel implements DeviceHost {
  readonly device: Device
  readonly audio = new AudioHost()
  readonly mic = new MicAnalyser()
  readonly midi = new MidiOut()
  frame: OLEDFrame
  displayText = ''
  status: EngineStatus = defaultEngineStatus()
  settings: DeviceSettings
  pressedButtons = new Set<number>()
  pressedFunctions = new Set<FunctionKey>()
  joystick: JoyDirection = JoyDirection.center
  micDenied = false
  presets: (DeviceSettings | null)[] = store.loadPresets()
  prefs = store.loadPrefs()
  private sampleSlot = 0
  private saveTimer = 0
  private listeners = new Set<Listener>()
  private frameListeners = new Set<Listener>()
  private wantMic = false

  constructor() {
    const saved = store.loadSettings()
    this.settings = saved
    this.device = new Device(saved)
    this.device.host = this
    this.frame = this.device.render()
    const sample = store.loadSample()
    if (sample) {
      this.pendingSample = sample
      this.device.addSampleSound()
      this.device.apply(saved)
    }
    this.audio.onStart = () => {
      if (this.pendingSample) {
        const s = this.pendingSample
        this.pendingSample = null
        this.loadSample(s.samples, s.sampleRate, s.rootNote)
      }
      this.device.syncEngine()
    }
    this.audio.onTick = (m) => {
      this.status = m.status as EngineStatus
      if (m.midi.length) this.midi.send(m.midi, this.audio.sampleRate, this.audio.ctx?.outputLatency ?? 0)
      if (m.mic) this.mic.push(m.mic, performance.now() / 1000)
      this.device.status = this.status
      this.device.scope = Array.from(m.scope)
    }
    this.mic.onPitch = (r) => (this.device.tuner = r)
    this.mic.onLevel = (l) => (this.device.micLevel = l)
    if (this.prefs.midiEnabled) void this.setMidiEnabled(true)
    this.midi.portId = this.prefs.midiPort
    this.midi.onPortsChanged = () => this.notify()
  }

  private pendingSample: { samples: Float32Array; sampleRate: number; rootNote: number } | null = null

  /// Start audio (must run inside a user gesture the first time).
  unlock(): void {
    if (!this.audio.running) void this.audio.start()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  subscribeFrame(fn: Listener): () => void {
    this.frameListeners.add(fn)
    return () => this.frameListeners.delete(fn)
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }

  // Display loop (~30 fps).
  private lastStep = 0
  startLoop(): void {
    const loop = (t: number) => {
      if (t - this.lastStep >= 32) {
        this.lastStep = t
        this.step()
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  private lastStatusKey = ''
  private step(): void {
    this.device.tick(performance.now() / 1000)
    this.frame = this.device.render()
    this.displayText = this.device.accessibilityText
    for (const l of this.frameListeners) l()
    const s = this.status
    const key = [
      s.tracks.join(''),
      s.recordingTrack,
      s.transportPlaying,
      s.beatOn,
      s.seqPlaying,
      s.loopLength,
      Math.ceil(s.countIn),
      Math.floor(s.loopPosition * 8),
    ].join('|')
    if (key !== this.lastStatusKey) {
      this.lastStatusKey = key
      this.notify()
    }
  }

  private refresh(): void {
    this.settings = this.device.settings
    this.frame = this.device.render()
    this.displayText = this.device.accessibilityText
    for (const l of this.frameListeners) l()
    this.notify()
  }

  // Inputs from views
  pressButton(b: number): void {
    this.unlock()
    this.pressedButtons.add(b)
    this.device.pressButton(b)
    this.refresh()
  }
  releaseButton(b: number): void {
    if (!this.pressedButtons.has(b)) return
    this.pressedButtons.delete(b)
    this.device.releaseButton(b)
    this.refresh()
  }
  swipeButton(b: number, dir: JoyDirection): void {
    this.device.swipeButton(b, dir)
    this.refresh()
  }
  pressFunction(f: FunctionKey): void {
    this.unlock()
    this.pressedFunctions.add(f)
    this.device.pressFunction(f)
    this.refresh()
  }
  releaseFunction(f: FunctionKey): void {
    if (!this.pressedFunctions.has(f)) return
    this.pressedFunctions.delete(f)
    this.device.releaseFunction(f)
    this.refresh()
  }
  setJoystick(dir: JoyDirection): void {
    if (dir === this.joystick) return
    this.unlock()
    this.joystick = dir
    this.device.setJoystick(dir)
    this.refresh()
  }
  clickJoystick(): void {
    this.unlock()
    this.device.clickJoystick()
    this.refresh()
  }
  setWheel(v: number): void {
    this.device.setWheel(v)
    this.refresh()
  }
  update(change: (s: DeviceSettings) => void): void {
    this.device.update(change)
    this.refresh()
  }
  selectSound(name: string): void {
    this.device.selectSound(name)
    this.refresh()
  }
  setMode(mode: PlayMode): void {
    this.unlock()
    this.device.setMode(mode)
    this.refresh()
  }

  // Looper panel
  loopTap(t: number): void {
    this.unlock()
    const st = this.status.tracks[t] as TrackState
    switch (st) {
      case TrackState.playing:
        this.device.loopMute(t, true)
        break
      case TrackState.muted:
        this.device.loopMute(t, false)
        break
      default:
        this.device.loopRecord(t)
    }
    this.refresh()
  }
  loopRerecord(t: number): void {
    this.device.loopRecord(t)
    this.refresh()
  }
  loopClear(t: number): void {
    this.device.loopClear(t)
    this.refresh()
  }
  toggleTransport(): void {
    this.unlock()
    this.device.setTransport(!this.status.transportPlaying)
    this.refresh()
  }
  setLoopBars(bars: number): void {
    this.device.setLoopBars(bars)
    this.refresh()
  }
  toggleMetronome(): void {
    this.device.setMetronome(!this.device.settings.metronome)
    this.refresh()
  }

  // Presets
  savePreset(slot: number): void {
    this.presets[slot] = structuredClone(this.device.settings)
    store.savePresets(this.presets)
    this.haptic(HapticKind.success)
    this.notify()
  }
  loadPreset(slot: number): void {
    const p = this.presets[slot]
    if (!p) return
    this.device.apply(structuredClone(p))
    this.refresh()
  }
  resetSettings(): void {
    this.device.apply(defaultDeviceSettings())
    this.refresh()
  }

  setPrefs(change: Partial<store.Prefs>): void {
    this.prefs = { ...this.prefs, ...change }
    store.savePrefs(this.prefs)
    this.notify()
  }

  async setMidiEnabled(on: boolean): Promise<void> {
    if (on) on = await this.midi.enable()
    else {
      this.midi.allNotesOff()
      this.midi.enabled = false
    }
    this.setPrefs({ midiEnabled: on })
  }

  setMidiPort(id: string): void {
    this.midi.allNotesOff()
    this.midi.portId = id
    this.setPrefs({ midiPort: id })
  }

  // DeviceHost
  send(command: EngineCommand): void {
    this.audio.send(command)
  }

  haptic(kind: HapticKind): void {
    if (!this.settings.haptics || typeof navigator.vibrate !== 'function') return
    try {
      navigator.vibrate(kind === HapticKind.success ? [12, 40, 12] : kind === HapticKind.warning ? [30, 30, 30] : kind === HapticKind.press ? 10 : 5)
    } catch {
      /* not allowed */
    }
  }

  setMicrophoneActive(active: boolean): void {
    this.wantMic = active
    if (active) {
      void this.audio.startMic().then((ok) => {
        this.micDenied = !ok
        if (!ok || !this.wantMic || !PlayMode.usesMicrophone(this.device.settings.mode)) {
          if (ok && !this.wantMic) this.audio.stopMic()
          this.notify()
          return
        }
        this.mic.reset(this.audio.sampleRate)
        this.notify()
      })
    } else {
      this.mic.cancel()
      this.audio.stopMic()
      this.device.tuner = null
    }
  }

  captureSample(): void {
    if (!this.audio.micActive) {
      this.device.sampleCaptured(false, null)
      return
    }
    this.mic.capture(performance.now() / 1000, (r) => {
      if (!r) {
        this.device.sampleCaptured(false, null)
      } else {
        const root = detectRoot(r.samples, r.rate)
        this.loadSample(r.samples, r.rate, root ?? 60)
        store.saveSample(r.samples, r.rate, root ?? 60)
        this.device.sampleCaptured(true, root)
      }
      this.refresh()
    })
  }

  settingsDidChange(): void {
    this.settings = this.device.settings
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => store.saveSettings(this.device.settings), 800)
  }

  saveNow(): void {
    store.saveSettings(this.device.settings)
  }

  private loadSample(samples: Float32Array, sampleRate: number, root: number): void {
    this.sampleSlot = 1 - this.sampleSlot
    // The engine's slot capacity is checked worklet-side; cap here to ~4 s to keep messages small.
    const n = Math.min(samples.length, Math.floor(sampleRate * 4), 288_000)
    if (n <= 0) return
    this.audio.loadSample(this.sampleSlot, samples.subarray(0, n))
    this.send({ type: 'useSample', slot: this.sampleSlot, length: n, sourceRate: sampleRate, rootNote: root })
  }
}
