import { BeatStyle, BeatTable, DrumKit, DrumPad, DrumSound, DrumVoice, drumPad } from './drums'
import { SVF, clamp, midiToHz, sineTable, xorshift } from './dspUtil'
import { EffectsChain } from './effects'
import {
  ArpPattern, EngineCommand, EngineStatus, MIDIMessage, NoteRate, NoteSet, PerformStyle, TrackState,
  defaultEngineStatus,
} from './engineTypes'
import { SoundLibrary, SynthParams, WaveType } from './synthParams'
import { SampleSlot, SynthVoice, VoiceStage } from './synthVoice'
import { Vocoder, VocoderSource } from './vocoder'

const EMPTY: NoteSet = []

function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** UInt8(clamping:) */
function u8(x: number): number {
  return x < 0 ? 0 : x > 255 ? 255 : Math.trunc(x)
}

/**
 * The complete Tonic sound engine: synth voices, drums, effects, clock, arpeggiator,
 * chord sequencer, beat machine and six-track looper.
 *
 * Runs inside an AudioWorklet. The host calls `send(_:)` (queued, applied at the start of the
 * next render) and `render(...)`. Everything render touches is preallocated.
 */
export class Engine {
  // MARK: Configuration

  static readonly maxVoices = 48
  static readonly maxDrumVoices = 24
  static readonly trackCount = 6
  static readonly chunk = 64
  static readonly maxEventsPerTrack = 2048
  static readonly patchSlots = 8 // 0 live, 1-6 loop tracks, 7 spare
  static readonly scopeSize = 512
  static readonly midiCapacity = 4096
  static readonly modulatorCapacity = 32768
  static readonly liveIds = 16

  // Owners
  static readonly ownerArp = 20
  static readonly ownerRepeat = 21
  static readonly ownerDrone = 22
  static readonly ownerSeq = 23
  static readonly ownerPreview = 24
  static readonly ownerDrumLive = 30
  static readonly ownerDrumBeat = 31
  static readonly ownerMetronome = 32
  static readonly ownerTrackBase = 100

  private static readonly kitCount = DrumKit.allCases.length

  sampleRate = 48000

  // MARK: Cross-thread replacements

  private commands: EngineCommand[] = []
  private readonly midiRing: MIDIMessage[] = []
  private midiHead = 0 // next read
  private midiCount = 0
  private readonly _status: EngineStatus = defaultEngineStatus()
  private readonly scope = new Float32Array(Engine.scopeSize)
  private scopeWrite = 0

  // MARK: Voices & DSP

  private readonly voices: SynthVoice[] = []
  private readonly drums: DrumVoice[] = []
  private readonly pluckBuffers: Float32Array
  private readonly patches: SynthParams[] = []
  private readonly trackKits = new Int32Array(Engine.trackCount)
  /** [kit * 7 + pad] */
  private readonly kitPads: DrumPad[]
  private readonly fx: EffectsChain
  private readonly table = sineTable
  private readonly mixL = new Float32Array(Engine.chunk)
  private readonly mixR = new Float32Array(Engine.chunk)
  private readonly samples: [SampleSlot, SampleSlot]
  private activeSample = -1
  private readonly beatTable = new BeatTable()
  private voiceOrder = 0
  private drumSeed = 1

  // MARK: Performance state

  private style: PerformStyle = PerformStyle.chord
  private readonly held: NoteSet[] = []
  private readonly heldActive: boolean[] = []
  private lastMonoFreq: number | null = null
  private strumSamples = 0.02
  private volume = 0.8
  private smoothedVolume = 0.8
  private masterCutoff = 20000
  private readonly masterFilter0 = new SVF()
  private readonly masterFilter1 = new SVF()
  private rng = 0x12345678
  private readonly strumScratch: number[] = []

  // Arp / repeat
  private arpPattern: ArpPattern = ArpPattern.up
  private arpRate: NoteRate = NoteRate.sixteenth
  private arpLatch = false
  private arpNotes: NoteSet = EMPTY
  private arpOwnerId = -1
  private arpRunning = false
  private arpIndex = 0
  private arpOrigin = 0
  private arpDirectionUp = true
  private repeatRate: NoteRate = NoteRate.eighth
  private repeatNotes: NoteSet = EMPTY
  private repeatOwnerId = -1
  private repeatRunning = false
  private repeatOrigin = 0
  private droneId = -1
  private droneNotes: NoteSet = EMPTY
  private drumRepeatMask = 0

  // Vocoder
  private readonly vocoder = new Vocoder()
  private vocoderOn = false
  /** Microphone samples for the vocoder. */
  private readonly modRing = new Float32Array(Engine.modulatorCapacity)
  private modRead = 0
  private modCount = 0
  private readonly carrierL = new Float32Array(Engine.chunk)
  private readonly carrierR = new Float32Array(Engine.chunk)
  private readonly modL = new Float32Array(Engine.chunk)
  private readonly modR = new Float32Array(Engine.chunk)

  // Clock
  private tempo = 100
  private beatPos = 0

  // Sequencer
  private readonly seqSteps: NoteSet[] = []
  private seqLength = 0
  private seqStepBeats = 2
  private seqPlaying = false
  private seqOrigin = 0
  private seqCurrent = -1

  // Beat machine
  private kit = 0
  private beatOn = false
  private beatStyle = 0
  private beatVariation = 0
  private beatStep = -1

  // Looper events, flattened [track * maxEventsPerTrack + i]
  private readonly evPos = new Float64Array(Engine.trackCount * Engine.maxEventsPerTrack)
  private readonly evNote = new Int16Array(Engine.trackCount * Engine.maxEventsPerTrack)
  private readonly evVel = new Float32Array(Engine.trackCount * Engine.maxEventsPerTrack)
  private readonly evOn = new Uint8Array(Engine.trackCount * Engine.maxEventsPerTrack)
  private readonly evDrum = new Uint8Array(Engine.trackCount * Engine.maxEventsPerTrack)
  private readonly eventCounts = new Int32Array(Engine.trackCount)
  private readonly trackStates: TrackState[] = []
  private readonly trackLevels = new Float32Array(Engine.trackCount)
  private loopBars = 2 // 0 = free
  private masterLength = 0
  private loopOrigin = 0
  private transportPlaying = false
  private recTrack = -1
  private recStart = 0 // absolute beat when recording began
  private recLoopStart = 0 // loop position at which an overdub began
  private countInEnd: number | null = null
  private metronomeOn = false
  private lastMetronomeBeat = -Infinity

  // MARK: Init

  constructor(sampleRate = 48000) {
    const maxRate = 96000
    this.pluckBuffers = new Float32Array(Engine.maxVoices * SynthVoice.pluckCapacity)
    for (let i = 0; i < Engine.maxVoices; i++) {
      const v = new SynthVoice()
      v.ks = this.pluckBuffers.subarray(i * SynthVoice.pluckCapacity, (i + 1) * SynthVoice.pluckCapacity)
      this.voices.push(v)
    }
    for (let i = 0; i < Engine.maxDrumVoices; i++) this.drums.push(new DrumVoice())
    for (let i = 0; i < Engine.patchSlots; i++) this.patches.push({ ...SoundLibrary.factory[2].params })
    this.kitPads = DrumKit.allCases.flatMap(k => DrumKit.pads(k))
    this.fx = new EffectsChain(maxRate)
    const sampleCap = maxRate * 3
    this.samples = [new SampleSlot(new Float32Array(sampleCap)), new SampleSlot(new Float32Array(sampleCap))]
    for (let i = 0; i < Engine.liveIds; i++) { this.held.push(EMPTY); this.heldActive.push(false) }
    for (let i = 0; i < 16; i++) this.seqSteps.push(EMPTY)
    for (let t = 0; t < Engine.trackCount; t++) { this.trackStates.push(TrackState.empty); this.trackLevels[t] = 1 }
    for (let i = 0; i < Engine.midiCapacity; i++) this.midiRing.push({ status: 0, data1: 0, data2: 0, sampleOffset: 0 })
    this.configure(sampleRate)
  }

  /** Must not be called while rendering. */
  configure(sampleRate: number): void {
    const sr = Math.min(Math.max(sampleRate, 8000), 96000)
    this.sampleRate = sr
    this.fx.configure(sr)
    this.vocoder.configure(sr)
    this.fx.bpm = this.tempo
    this.strumSamples = 0.02 * sr
    this.masterFilter0.set(this.masterCutoff, 0.1, sr)
    this.masterFilter1.set(this.masterCutoff, 0.1, sr)
    for (const v of this.voices) v.stage = VoiceStage.idle
    for (const d of this.drums) d.active = false
  }

  // MARK: Host API

  /** Queues a command for the next render. Returns false if the queue is full. */
  send(command: EngineCommand): boolean {
    if (this.commands.length >= 1024) return false
    this.commands.push(command)
    return true
  }

  /** Latest engine status (updated in place after every render). */
  get status(): EngineStatus { return this._status }

  /** Copies the most recent output samples (oldest first) for an oscilloscope. */
  copyScope(out: number[] | Float32Array): void {
    const n = Engine.scopeSize
    if (Array.isArray(out) && out.length !== n) out.length = n
    const w = this.scopeWrite
    const m = Math.min(n, out.length)
    for (let i = 0; i < m; i++) out[i] = this.scope[(w + i) % n]
  }

  /** Buffer the host may fill with a recorded sample before sending `useSample`. Only write the inactive slot. */
  sampleBuffer(slot: number): Float32Array {
    return slot === 0 ? this.samples[0].data : this.samples[1].data
  }

  /** Feeds microphone audio to the vocoder. */
  pushModulator(samples: ArrayLike<number>, count = samples.length): void {
    const cap = Engine.modulatorCapacity
    for (let i = 0; i < count; i++) {
      if (this.modCount >= cap) break
      this.modRing[(this.modRead + this.modCount) % cap] = samples[i]
      this.modCount++
    }
  }

  /** Returns and clears the MIDI produced since the last drain. */
  drainMidi(): MIDIMessage[] {
    const out: MIDIMessage[] = []
    while (this.midiCount > 0) {
      const m = this.midiRing[this.midiHead]
      out.push({ status: m.status, data1: m.data1, data2: m.data2, sampleOffset: m.sampleOffset })
      this.midiHead = (this.midiHead + 1) % Engine.midiCapacity
      this.midiCount--
    }
    return out
  }

  private popModulator(): number {
    if (this.modCount === 0) return 0
    const v = this.modRing[this.modRead]
    this.modRead = (this.modRead + 1) % Engine.modulatorCapacity
    this.modCount--
    return v
  }

  // MARK: Render

  /** Renders `frames` of stereo audio into the two non-interleaved buffers. */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    const cmds = this.commands
    if (cmds.length > 0) {
      for (let i = 0; i < cmds.length; i++) this.handle(cmds[i])
      cmds.length = 0
    }
    let offset = 0
    let peak = 0
    while (offset < frames) {
      const n = Math.min(Engine.chunk, frames - offset)
      peak = this.processChunk(n, left, right, offset, peak)
      offset += n
    }
    this.publishStatus(peak)
  }

  private processChunk(n: number, outL: Float32Array, outR: Float32Array, offset: number, peakIn: number): number {
    const sr = this.sampleRate
    const spb = (sr * 60) / this.tempo // samples per beat
    const chunkBeats = n / spb
    const t0 = this.beatPos
    const t1 = this.beatPos + chunkBeats

    this.scheduleClock(t0, t1, spb)

    const mixL = this.mixL, mixR = this.mixR
    mixL.fill(0, 0, n)
    mixR.fill(0, 0, n)
    const sample = this.activeSample < 0 ? null : this.activeSample === 0 ? this.samples[0] : this.samples[1]
    const vocoding = this.vocoderOn
    const trackModulator = vocoding && this.vocoder.params.source === VocoderSource.track1
    const carrierL = this.carrierL, carrierR = this.carrierR, modL = this.modL, modR = this.modR
    if (vocoding) {
      carrierL.fill(0, 0, n)
      carrierR.fill(0, 0, n)
      modL.fill(0, 0, n)
      modR.fill(0, 0, n)
      if (!trackModulator) {
        for (let i = 0; i < n; i++) modL[i] = this.popModulator()
      }
    } else {
      // Discard stale microphone audio so it never lags when the vocoder starts.
      const drop = Math.min(4096, this.modCount)
      this.modRead = (this.modRead + drop) % Engine.modulatorCapacity
      this.modCount -= drop
    }
    for (let i = 0; i < Engine.maxVoices; i++) {
      const v = this.voices[i]
      if (!v.isActive) continue
      const patch = this.patches[v.patch]
      const trackGain = v.owner >= Engine.ownerTrackBase ? this.trackLevels[v.owner - Engine.ownerTrackBase] : 1
      let oL = mixL, oR = mixR
      if (vocoding && v.owner < Engine.ownerTrackBase && v.owner !== Engine.ownerPreview) {
        oL = carrierL; oR = carrierR // live playing is the carrier
      } else if (trackModulator && v.owner === Engine.ownerTrackBase) {
        oL = modL; oR = modR // loop track 1 is the voice
      }
      v.render(patch, n, sr, oL, oR, this.table, sample, trackGain)
    }
    if (vocoding) {
      for (let i = 0; i < n; i++) {
        carrierL[i] = 0.5 * (carrierL[i] + carrierR[i])
        modL[i] = trackModulator ? 0.5 * (modL[i] + modR[i]) : modL[i]
      }
      this.vocoder.process(carrierL, modL, n, mixL, mixR)
    }
    for (let i = 0; i < Engine.maxDrumVoices; i++) {
      const d = this.drums[i]
      if (!d.active) continue
      const owner = d.owner
      const g = owner >= Engine.ownerTrackBase ? this.trackLevels[owner - Engine.ownerTrackBase] : 1
      d.render(n, sr, mixL, mixR, this.table, g * 0.7)
    }
    this.fx.process(mixL, mixR, n, this.table)

    const volK = 0.002
    const filterOn = this.masterCutoff < 19000
    let peak = peakIn
    const scope = this.scope
    for (let i = 0; i < n; i++) {
      this.smoothedVolume += (this.volume - this.smoothedVolume) * volK
      let l = mixL[i]
      let r = mixR[i]
      if (filterOn) {
        l = this.masterFilter0.lowpass(l)
        r = this.masterFilter1.lowpass(r)
      }
      const g = this.smoothedVolume * this.smoothedVolume * 1.4
      l = softClip(l * g)
      r = softClip(r * g)
      outL[offset + i] = l
      outR[offset + i] = r
      const al = Math.abs(l), ar = Math.abs(r)
      if (al > peak) peak = al
      if (ar > peak) peak = ar
      scope[this.scopeWrite] = 0.5 * (l + r)
      this.scopeWrite = this.scopeWrite + 1 >= Engine.scopeSize ? 0 : this.scopeWrite + 1
    }
    this.beatPos = t1
    return peak
  }

  private publishStatus(peak: number): void {
    const s = this._status
    s.beat = this.beatPos
    s.tempo = this.tempo
    s.loopLength = this.masterLength
    s.loopPosition = this.masterLength > 0 && this.transportPlaying ? this.loopPosition(this.beatPos) : 0
    for (let t = 0; t < Engine.trackCount; t++) s.tracks[t] = this.trackStates[t]
    s.recordingTrack = this.recTrack
    s.countIn = this.countInEnd !== null ? Math.max(0, this.countInEnd - this.beatPos) : 0
    s.beatStep = this.beatOn ? this.beatStep : -1
    s.seqStep = this.seqPlaying ? this.seqCurrent : -1
    s.peak = peak
    s.transportPlaying = this.transportPlaying
    s.beatOn = this.beatOn
    s.seqPlaying = this.seqPlaying
    let count = 0
    for (let i = 0; i < Engine.maxVoices; i++) if (this.voices[i].isActive) count++
    s.activeVoices = count
  }

  // MARK: Commands

  private handle(cmd: EngineCommand): void {
    switch (cmd.type) {
      case 'press': this.press(cmd.id, cmd.notes, cmd.velocity); break
      case 'release': this.releaseLive(cmd.id); break
      case 'releaseAll':
        for (let id = 0; id < Engine.liveIds; id++) if (this.heldActive[id]) this.releaseLive(id)
        this.stopDrone()
        this.arpRunning = false
        this.repeatRunning = false
        break
      case 'drum': this.liveDrum(cmd.pad, cmd.velocity, 0); break
      case 'style':
        if (cmd.style !== this.style) {
          for (let id = 0; id < Engine.liveIds; id++) if (this.heldActive[id]) this.releaseLive(id)
          if (this.style === PerformStyle.drone) this.stopDrone()
          this.arpRunning = false
          this.repeatRunning = false
          this.style = cmd.style
        }
        break
      case 'patch': this.patches[0] = cmd.params; break
      case 'fx': this.fx.set(cmd.params); break
      case 'tempo':
        this.tempo = Math.min(Math.max(cmd.bpm, 30), 300)
        this.fx.bpm = this.tempo
        break
      case 'arp':
        this.arpPattern = cmd.pattern
        this.arpRate = cmd.rate
        if (this.arpLatch && !cmd.latch && this.arpOwnerId >= 0 && !this.heldActive[this.arpOwnerId]) this.arpRunning = false
        this.arpLatch = cmd.latch
        break
      case 'repeatRate': this.repeatRate = cmd.rate; break
      case 'strumSpeed': this.strumSamples = Math.max(0, cmd.ms) * 0.001 * this.sampleRate; break
      case 'kit': this.kit = Math.min(Math.max(Math.trunc(cmd.kit), 0), Engine.kitCount - 1); break
      case 'beat':
        this.beatStyle = Math.min(Math.max(Math.trunc(cmd.style), 0), BeatStyle.allCases.length - 1)
        this.beatVariation = Math.min(Math.max(Math.trunc(cmd.variation), 0), BeatTable.variations - 1)
        if (cmd.on && !this.beatOn) {
          if (!this.clockBusy) this.resetClock()
          this.beatOn = true
        } else if (!cmd.on) {
          this.beatOn = false
          this.beatStep = -1
        }
        break
      case 'seqStep':
        if (cmd.index >= 0 && cmd.index < 16) this.seqSteps[cmd.index] = cmd.notes
        break
      case 'seqLength': this.seqLength = Math.trunc(Math.min(Math.max(cmd.length, 0), 16)); break
      case 'seqStepBeats': this.seqStepBeats = Math.min(Math.max(cmd.beats, 0.25), 8); break
      case 'seqPlay':
        if (cmd.on && !this.seqPlaying) {
          if (!this.clockBusy) { this.resetClock(); this.seqOrigin = 0 } else { this.seqOrigin = Math.ceil(this.beatPos) }
          this.seqPlaying = true
          this.seqCurrent = -1
        } else if (!cmd.on) {
          this.seqPlaying = false
          this.seqCurrent = -1
          this.releaseOwner(Engine.ownerSeq)
        }
        break
      case 'loopRecord': this.loopRecord(cmd.track); break
      case 'loopMute': {
        const t = cmd.track
        if (!(t >= 0 && t < Engine.trackCount)) return
        if (cmd.muted && this.trackStates[t] === TrackState.playing) {
          this.trackStates[t] = TrackState.muted
          this.killOwner(Engine.ownerTrackBase + t)
        } else if (!cmd.muted && this.trackStates[t] === TrackState.muted) {
          this.trackStates[t] = TrackState.playing
        }
        break
      }
      case 'loopLevel':
        if (cmd.track >= 0 && cmd.track < Engine.trackCount) this.trackLevels[cmd.track] = Math.min(Math.max(cmd.level, 0), 1.5)
        break
      case 'loopClear':
        if (cmd.track < 0) {
          for (let t = 0; t < Engine.trackCount; t++) this.clearTrack(t)
        } else if (cmd.track < Engine.trackCount) {
          this.clearTrack(cmd.track)
        }
        break
      case 'loopBars': this.loopBars = Math.min(Math.max(Math.trunc(cmd.bars), 0), 8); break
      case 'transport': this.setTransport(cmd.playing); break
      case 'master':
        this.volume = Math.min(Math.max(cmd.volume, 0), 1)
        this.masterCutoff = Math.min(Math.max(cmd.cutoff, 60), 20000)
        this.masterFilter0.set(this.masterCutoff, 0.25, this.sampleRate)
        this.masterFilter1.set(this.masterCutoff, 0.25, this.sampleRate)
        break
      case 'metronome': this.metronomeOn = cmd.on; break
      case 'useSample': {
        const s = cmd.slot === 0 ? this.samples[0] : this.samples[1]
        s.length = Math.min(Math.trunc(cmd.length), s.capacity)
        s.sourceRate = cmd.sourceRate
        s.rootNote = cmd.rootNote
        this.activeSample = cmd.slot
        break
      }
      case 'preview': {
        const d = Math.trunc(cmd.delay * this.sampleRate)
        const len = Math.trunc(cmd.duration * this.sampleRate)
        for (let i = 0; i < cmd.notes.length; i++) {
          this.startVoice(cmd.notes[i], 0.8, Engine.ownerPreview, 0, d, len)
        }
        break
      }
      case 'stopPreview': this.killOwner(Engine.ownerPreview); break
      case 'vocoder':
        if (cmd.on && !this.vocoderOn) this.vocoder.reset()
        this.vocoderOn = cmd.on
        this.vocoder.set(cmd.params)
        break
      case 'drumRepeat':
        if (!(cmd.pad >= 0 && cmd.pad < 7)) return
        if (cmd.on) this.drumRepeatMask |= 1 << cmd.pad
        else this.drumRepeatMask &= ~(1 << cmd.pad)
        break
    }
  }

  /** Whether anything is following the clock (so new parts should align rather than reset it). */
  private get clockBusy(): boolean {
    return this.beatOn || this.seqPlaying || (this.transportPlaying && this.masterLength > 0) || this.countInEnd !== null
      || this.recTrack >= 0 || this.arpRunning || this.repeatRunning
  }

  /** Whether a clocked part is playing that new parts should lock to. */
  private get gridRunning(): boolean {
    return this.beatOn || this.seqPlaying || (this.transportPlaying && this.masterLength > 0)
  }

  private resetClock(): void {
    this.beatPos = 0
    this.lastMetronomeBeat = -Infinity
    this.arpOrigin = 0
    this.repeatOrigin = 0
  }

  // MARK: Live performance

  private press(id: number, notes: NoteSet, velocity: number): void {
    if (!(id >= 0 && id < Engine.liveIds)) return
    const wasHeld = this.heldActive[id] // re-voicing a held chord (joystick moved)
    if (wasHeld) this.releaseLive(id)
    this.held[id] = notes
    this.heldActive[id] = true

    switch (this.style) {
      case PerformStyle.chord: {
        const mono = notes.length === 1
        const glideFrom = mono && this.patches[0].glide > 0 ? this.lastMonoFreq : null
        this.playNotes(notes, id, velocity, 0, glideFrom)
        if (mono) this.lastMonoFreq = midiToHz(notes[0] + this.patches[0].octave * 12)
        break
      }
      case PerformStyle.strum:
        this.playNotes(this.strumExpand(notes), id, velocity, this.strumSamples, null)
        break
      case PerformStyle.drone:
        if (this.droneId === id && !wasHeld) {
          // Pressing the droning button again stops the drone.
          this.stopDrone()
          this.heldActive[id] = false
          return
        }
        this.stopDrone()
        this.droneId = id
        this.droneNotes = notes
        for (let i = 0; i < notes.length; i++) {
          const v = this.startVoice(notes[i], velocity, Engine.ownerDrone, 0, 0)
          if (v !== null) this.voices[v].gainScale = 0.9
          this.recordLive(notes[i], velocity, true, 0)
        }
        break
      case PerformStyle.arp:
        this.arpNotes = notes
        this.arpOwnerId = id
        if (!this.arpRunning) {
          this.arpRunning = true
          this.arpIndex = 0
          this.arpDirectionUp = true
          if (this.gridRunning) {
            this.arpOrigin = 0 // stay on the global grid
          } else {
            this.arpOrigin = this.beatPos
            this.arpStep(0)
          }
        }
        break
      case PerformStyle.repeatGate:
        this.repeatNotes = notes
        this.repeatOwnerId = id
        if (!this.repeatRunning) {
          this.repeatRunning = true
          if (this.gridRunning) {
            this.repeatOrigin = 0
          } else {
            this.repeatOrigin = this.beatPos
            this.repeatTrigger(0)
          }
        }
        break
    }
  }

  private releaseLive(id: number): void {
    if (!(id >= 0 && id < Engine.liveIds) || !this.heldActive[id]) return
    this.heldActive[id] = false
    const notes = this.held[id]
    switch (this.style) {
      case PerformStyle.chord:
      case PerformStyle.strum: {
        this.releaseOwner(id)
        const expanded = this.style === PerformStyle.strum ? this.strumExpand(notes) : notes
        for (let i = 0; i < expanded.length; i++) this.recordLive(expanded[i], 0, false, 0)
        break
      }
      case PerformStyle.drone:
        break // drones sustain until another chord or the same button
      case PerformStyle.arp:
        if (this.arpOwnerId === id && !this.arpLatch) {
          // Fall back to another held chord if there is one.
          const other = this.latestHeld()
          if (other !== null) {
            this.arpNotes = this.held[other]
            this.arpOwnerId = other
          } else {
            this.arpRunning = false
          }
        }
        break
      case PerformStyle.repeatGate:
        if (this.repeatOwnerId === id) {
          const other = this.latestHeld()
          if (other !== null) {
            this.repeatNotes = this.held[other]
            this.repeatOwnerId = other
          } else {
            this.repeatRunning = false
          }
        }
        break
    }
    // Voices started under a different style for this id still need releasing.
    this.releaseOwner(id)
  }

  private latestHeld(): number | null {
    for (let id = 0; id < Engine.liveIds; id++) if (this.heldActive[id]) return id
    return null
  }

  private stopDrone(): void {
    if (this.droneId < 0) return
    this.releaseOwner(Engine.ownerDrone)
    for (let i = 0; i < this.droneNotes.length; i++) this.recordLive(this.droneNotes[i], 0, false, 0)
    this.droneId = -1
    this.droneNotes = EMPTY
  }

  /** Adds octave doublings so a strum sounds like six strings. Returns a shared scratch array. */
  private strumExpand(notes: NoteSet): NoteSet {
    if (notes.length === 0) return notes
    const out = this.strumScratch
    out.length = 0
    for (let i = 0; i < notes.length && i < 8; i++) out.push(notes[i])
    let i = 0
    while (out.length < 6) {
      out.push(notes[i % notes.length] + 12 * (1 + Math.trunc(i / notes.length)))
      i += 1
    }
    return out
  }

  private playNotes(notes: NoteSet, owner: number, velocity: number, strum: number, glideFrom: number | null): void {
    for (let i = 0; i < notes.length; i++) {
      const delay = Math.trunc(strum * i)
      this.startVoice(notes[i], velocity, owner, 0, delay, null, glideFrom)
      this.recordLive(notes[i], velocity, true, delay)
    }
  }

  // MARK: Clock-driven parts

  private scheduleClock(t0: number, t1: number, spb: number): void {
    // Count-in → recording start
    const c = this.countInEnd
    if (c !== null && c < t1) {
      this.countInEnd = null
      if (this.recTrack >= 0 && this.trackStates[this.recTrack] === TrackState.armed) {
        this.trackStates[this.recTrack] = TrackState.recording
        this.recStart = c
      }
    }

    // Metronome clicks (count-in, and while recording if enabled)
    if (this.countInEnd !== null
      || (this.metronomeOn && this.recTrack >= 0 && this.trackStates[this.recTrack] === TrackState.recording)) {
      const b = Math.floor(t1)
      if (b >= t0 && b !== this.lastMetronomeBeat) {
        this.lastMetronomeBeat = b
        const d = Math.trunc((b - t0) * spb)
        this.metronomeClick(b % 4 === 0, Math.max(0, d))
      }
    }

    // Arpeggiator
    if (this.arpRunning) {
      const rate = NoteRate.stepsPerBeat(this.arpRate)
      const a = Math.floor((t0 - this.arpOrigin) * rate)
      const b = Math.floor((t1 - this.arpOrigin) * rate)
      if (b > a) {
        const stepBeat = this.arpOrigin + b / rate
        this.arpStep(Math.max(0, Math.trunc((stepBeat - t0) * spb)))
      }
    }

    // Repeat gate
    if (this.repeatRunning) {
      const rate = NoteRate.stepsPerBeat(this.repeatRate)
      const a = Math.floor((t0 - this.repeatOrigin) * rate)
      const b = Math.floor((t1 - this.repeatOrigin) * rate)
      if (b > a) {
        const stepBeat = this.repeatOrigin + b / rate
        this.repeatTrigger(Math.max(0, Math.trunc((stepBeat - t0) * spb)))
      }
    }

    // Drum note-repeat (16ths)
    if (this.drumRepeatMask !== 0) {
      const a = Math.floor(t0 * 4)
      const b = Math.floor(t1 * 4)
      if (b > a) {
        const d = Math.max(0, Math.trunc((b / 4 - t0) * spb))
        for (let pad = 0; pad < 7; pad++) {
          if ((this.drumRepeatMask & (1 << pad)) !== 0) this.liveDrum(pad, 0.7, d)
        }
      }
    }

    // Chord sequencer
    if (this.seqPlaying && this.seqLength > 0) {
      const a = Math.floor((t0 - this.seqOrigin) / this.seqStepBeats)
      const b = Math.floor((t1 - this.seqOrigin) / this.seqStepBeats)
      if (b > a || this.seqCurrent < 0) {
        if (t1 >= this.seqOrigin) {
          const stepIndex = Math.trunc(b) % this.seqLength
          const stepBeat = this.seqOrigin + b * this.seqStepBeats
          const d = Math.max(0, Math.trunc((stepBeat - t0) * spb))
          this.seqCurrent = stepIndex
          this.releaseOwner(Engine.ownerSeq)
          const notes = this.seqSteps[stepIndex] ?? EMPTY
          const gate = Math.trunc(this.seqStepBeats * 0.94 * spb)
          for (let i = 0; i < notes.length; i++) {
            this.startVoice(notes[i], 0.8, Engine.ownerSeq, 0, d, gate)
            this.recordNote(notes[i], 0.8, d, this.seqStepBeats * 0.94, false)
          }
        }
      }
    }

    // Beat machine
    if (this.beatOn) {
      const a = Math.floor(t0 * 4)
      const b = Math.floor(t1 * 4)
      if (b > a || this.beatStep < 0) {
        const stepAbs = Math.trunc(b)
        const step = ((stepAbs % 16) + 16) % 16
        this.beatStep = step
        let stepBeat = b / 4
        const swing = BeatStyle.swingAmount(this.beatStyle as BeatStyle) ?? 0
        if (step % 4 === 2) stepBeat += swing / 6
        const d = Math.max(0, Math.trunc((stepBeat - t0) * spb))
        for (let pad = 0; pad < BeatTable.pads; pad++) {
          const vel = this.beatTable.velocity(this.beatStyle, this.beatVariation, step, pad)
          if (vel > 0) {
            this.triggerDrum(this.kitPad(this.kit, pad), pad, vel, Engine.ownerDrumBeat, d)
            this.drumMIDI(pad, vel, d)
          }
        }
      }
    }

    // Loop playback
    const rt = this.recTrack
    if (this.transportPlaying && this.masterLength > 0) {
      this.playLoops(t0, t1, spb)
      // Auto-finish recordings
      if (this.recTrack >= 0 && this.trackStates[this.recTrack] === TrackState.recording) {
        if (t1 - this.recStart >= this.masterLength) this.finishRecording()
      }
    } else if (rt >= 0 && this.trackStates[rt] === TrackState.recording && this.masterLength === 0 && this.loopBars > 0) {
      if (t1 - this.recStart >= this.loopBars * 4) this.finishRecording(this.loopBars * 4)
    } else if (rt >= 0 && this.trackStates[rt] === TrackState.recording && this.masterLength === 0 && this.loopBars === 0) {
      if (t1 - this.recStart >= 64) this.finishRecording() // free mode cap
    }
  }

  private arpStep(delay: number): void {
    const notes = this.arpNotes
    const n = notes.length
    if (n <= 0) return
    const total = this.arpPattern === ArpPattern.upTwoOctaves ? n * 2 : n
    let idx: number
    switch (this.arpPattern) {
      case ArpPattern.up:
      case ArpPattern.upTwoOctaves:
        idx = this.arpIndex % total
        this.arpIndex += 1
        break
      case ArpPattern.down:
        idx = total - 1 - (this.arpIndex % total)
        this.arpIndex += 1
        break
      case ArpPattern.upDown:
        if (total === 1) idx = 0
        else {
          const cycle = 2 * (total - 1)
          const p = this.arpIndex % cycle
          idx = p < total ? p : cycle - p
        }
        this.arpIndex += 1
        break
      case ArpPattern.random:
        idx = this.whiteNoiseU() % total
        break
      case ArpPattern.converge: {
        const p = this.arpIndex % total
        idx = p % 2 === 0 ? Math.trunc(p / 2) : total - 1 - Math.trunc(p / 2)
        this.arpIndex += 1
        break
      }
      default:
        idx = 0
    }
    const note = notes[idx % n] + (idx >= n ? 12 : 0)
    const gateBeats = 0.5 / NoteRate.stepsPerBeat(this.arpRate)
    const spb = (this.sampleRate * 60) / this.tempo
    this.startVoice(note, 0.8, Engine.ownerArp, 0, delay, Math.trunc(gateBeats * spb))
    this.recordNote(note, 0.8, delay, gateBeats, false)
  }

  private repeatTrigger(delay: number): void {
    const gateBeats = 0.45 / NoteRate.stepsPerBeat(this.repeatRate)
    const spb = (this.sampleRate * 60) / this.tempo
    const notes = this.repeatNotes
    for (let i = 0; i < notes.length; i++) {
      this.startVoice(notes[i], 0.8, Engine.ownerRepeat, 0, delay, Math.trunc(gateBeats * spb))
      this.recordNote(notes[i], 0.8, delay, gateBeats, false)
    }
  }

  private whiteNoiseU(): number {
    this.rng = xorshift(this.rng)
    return this.rng
  }

  private readonly clickAccent: DrumPad = drumPad(DrumSound.rim, { tune: 2.4, decay: 0.03, tone: 0.5, level: 0.9 })
  private readonly clickNormal: DrumPad = drumPad(DrumSound.rim, { tune: 1.8, decay: 0.03, tone: 0.5, level: 0.6 })

  private metronomeClick(accent: boolean, delay: number): void {
    this.triggerDrum(accent ? this.clickAccent : this.clickNormal, 6, 1, Engine.ownerMetronome, delay)
  }

  private liveDrum(pad: number, velocity: number, delay: number): void {
    if (!(pad >= 0 && pad < 7)) return
    this.triggerDrum(this.kitPad(this.kit, pad), pad, velocity, Engine.ownerDrumLive, delay)
    this.drumMIDI(pad, velocity, delay)
    const rt = this.recTrack
    if (rt >= 0) {
      if (this.trackStates[rt] === TrackState.armed && this.masterLength === 0 && this.loopBars === 0) this.beginFreeRecording()
      if (this.trackStates[rt] === TrackState.recording) {
        this.trackKits[rt] = this.kit
        this.appendEvent(rt, this.recordPosition(delay), pad, velocity, true, true)
      }
    }
  }

  // MARK: Voice management

  /** Starts a voice. `gate`, if given, is the note length in samples after its start delay. */
  private startVoice(note: number, velocity: number, owner: number, patch: number, delay: number,
    gate: number | null = null, glideFrom: number | null = null): number | null {
    const p = this.patches[patch]
    const voices = this.voices
    let slot = -1
    for (let i = 0; i < Engine.maxVoices; i++) if (!voices[i].isActive) { slot = i; break }
    if (slot < 0) {
      // Steal the oldest releasing voice, else the oldest voice.
      let best = -1
      let bestOrder = Infinity
      for (let i = 0; i < Engine.maxVoices; i++) {
        if (voices[i].isReleasing && voices[i].startOrder < bestOrder) { best = i; bestOrder = voices[i].startOrder }
      }
      if (best < 0) {
        for (let i = 0; i < Engine.maxVoices; i++) {
          if (voices[i].startOrder < bestOrder) { best = i; bestOrder = voices[i].startOrder }
        }
      }
      slot = best
      if (slot >= 0 && !voices[slot].isReleasing && voices[slot].releaseIn < 0) {
        this.emitMIDI((0x80 | voices[slot].midiChannel) & 0xff, u8(voices[slot].note), 0, 0)
      }
    }
    if (slot < 0) return null
    this.voiceOrder += 1
    // Spread chord notes across the stereo field (Swift % keeps the dividend's sign, as JS does).
    const pan = (((note % 7) - 3) / 3) * 0.6
    const sample = this.activeSample < 0 ? null : this.activeSample === 0 ? this.samples[0] : this.samples[1]
    const v = voices[slot]
    v.start(note, velocity, owner, patch, p, this.sampleRate, this.voiceOrder, delay, glideFrom, pan, sample)
    const ch = this.midiChannel(owner)
    v.midiChannel = ch
    const sendMIDI = owner !== Engine.ownerPreview
    if (sendMIDI) {
      this.emitMIDI(0x90 | ch, u8(note), Math.trunc(Math.min(127, Math.max(1, velocity * 127))), delay)
    }
    if (gate !== null) {
      v.releaseIn = delay + Math.max(1, gate)
      if (sendMIDI) this.emitMIDI(0x80 | ch, u8(note), 0, delay + Math.max(1, gate))
    }
    if (!sendMIDI) v.midiChannel = 0xff
    return slot
  }

  private releaseOwner(owner: number): void {
    for (const v of this.voices) {
      if (v.isActive && v.owner === owner && !v.isReleasing) {
        // Auto-released notes already sent their note-off.
        if (v.releaseIn < 0) this.noteOffMIDI(v, 0)
        v.release()
        v.releaseIn = -1
      }
    }
  }

  private killOwner(owner: number): void {
    for (const v of this.voices) {
      if (v.isActive && v.owner === owner) {
        if (!v.isReleasing && v.releaseIn < 0) this.noteOffMIDI(v, 0)
        v.kill()
        v.releaseIn = -1
      }
    }
    for (const d of this.drums) if (d.active && d.owner === owner) d.choke = true
  }

  private releaseNote(owner: number, note: number, delay: number): void {
    for (const v of this.voices) {
      if (v.isActive && v.owner === owner && v.note === note && !v.isReleasing && v.releaseIn < 0) {
        v.releaseIn = delay
        this.noteOffMIDI(v, delay)
        return
      }
    }
  }

  private triggerDrum(pad: DrumPad, index: number, velocity: number, owner: number, delay: number): void {
    const drums = this.drums
    let slot = -1
    for (let i = 0; i < Engine.maxDrumVoices; i++) if (!drums[i].active) { slot = i; break }
    if (slot < 0) {
      let oldest = 0
      for (let i = 1; i < Engine.maxDrumVoices; i++) if (drums[i].t > drums[oldest].t) oldest = i
      slot = oldest
    }
    // A closed hat chokes ringing open hats.
    if (pad.sound === DrumSound.closedHat) {
      for (const d of drums) if (d.active && d.sound === DrumSound.openHat && d.delay <= delay) d.choke = true
    }
    this.drumSeed = (Math.imul(this.drumSeed, 1664525) + 1013904223) >>> 0
    drums[slot].start(pad, index, velocity, owner, delay, this.drumSeed, this.sampleRate)
  }

  private kitPad(kit: number, pad: number): DrumPad {
    return this.kitPads[Math.min(Math.max(kit, 0), Engine.kitCount - 1) * 7 + pad]
  }

  // MARK: MIDI out

  /** Drum hits go out on channel 10 with a short gate. */
  private drumMIDI(pad: number, velocity: number, delay: number): void {
    const note = DrumKit.gmNotes[pad]
    this.emitMIDI(0x99, note, Math.trunc(Math.min(127, Math.max(1, velocity * 127))), delay)
    this.emitMIDI(0x89, note, 0, delay + Math.trunc(0.05 * this.sampleRate))
  }

  /** Live playing goes out on the channel of the track that would record next. */
  private midiChannel(owner: number): number {
    if (owner >= Engine.ownerTrackBase) return (owner - Engine.ownerTrackBase) & 0xff
    if (this.recTrack >= 0) return this.recTrack
    for (let t = 0; t < Engine.trackCount; t++) if (this.trackStates[t] === TrackState.empty) return t
    return 0
  }

  private noteOffMIDI(v: SynthVoice, delay: number): void {
    if (v.midiChannel === 0xff) return
    this.emitMIDI(0x80 | v.midiChannel, u8(v.note), 0, delay)
  }

  private emitMIDI(status: number, note: number, velocity: number, delay: number): void {
    if (this.midiCount >= Engine.midiCapacity) return
    const m = this.midiRing[(this.midiHead + this.midiCount) % Engine.midiCapacity]
    m.status = status & 0xff
    m.data1 = Math.min(note, 127)
    m.data2 = Math.min(velocity, 127)
    m.sampleOffset = Math.max(-2147483648, Math.min(2147483647, delay))
    this.midiCount++
  }

  // MARK: Looper

  private loopPosition(beat: number): number {
    if (!(this.masterLength > 0)) return 0
    const p = (beat - this.loopOrigin) % this.masterLength
    return p < 0 ? p + this.masterLength : p
  }

  private setTransport(playing: boolean): void {
    if (playing) {
      if (!this.transportPlaying) {
        this.resetClock()
        this.loopOrigin = 0
        this.transportPlaying = this.masterLength > 0
      }
    } else {
      if (this.recTrack >= 0) this.cancelRecording()
      this.transportPlaying = false
      this.beatOn = false
      this.beatStep = -1
      if (this.seqPlaying) { this.seqPlaying = false; this.releaseOwner(Engine.ownerSeq) }
      for (let t = 0; t < Engine.trackCount; t++) this.killOwner(Engine.ownerTrackBase + t)
    }
  }

  private loopRecord(track: number): void {
    if (!(track >= 0 && track < Engine.trackCount)) return
    if (this.recTrack === track) {
      switch (this.trackStates[track]) {
        case TrackState.recording: this.finishRecording(); break
        case TrackState.armed: this.cancelRecording(); break
        default: break
      }
      return
    }
    if (this.recTrack >= 0) {
      if (this.trackStates[this.recTrack] === TrackState.recording) this.finishRecording()
      else this.cancelRecording()
    }
    const busy = this.clockBusy
    this.killOwner(Engine.ownerTrackBase + track)
    this.eventCounts[track] = 0
    this.trackKits[track] = this.kit
    this.patches[track + 1] = this.patches[0]
    this.recTrack = track

    if (this.masterLength === 0) {
      // This recording defines the loop.
      for (let t = 0; t < Engine.trackCount; t++) {
        if (t !== track && this.trackStates[t] !== TrackState.empty) this.clearTrack(t)
      }
      if (this.loopBars > 0) {
        this.trackStates[track] = TrackState.armed
        if (!busy) {
          this.beatPos = -4 // one-bar count-in, recording starts at beat 0
          this.lastMetronomeBeat = -Infinity
          this.countInEnd = 0
        } else {
          this.countInEnd = Math.ceil(this.beatPos / 4) * 4
        }
      } else {
        this.trackStates[track] = TrackState.armed // waits for the first note
      }
    } else {
      if (!this.transportPlaying) {
        this.resetClock()
        this.loopOrigin = 0
        this.transportPlaying = true
      }
      this.trackStates[track] = TrackState.recording
      this.recStart = this.beatPos
      this.recLoopStart = this.loopPosition(this.beatPos)
    }
  }

  private beginFreeRecording(): void {
    const rt = this.recTrack
    if (rt < 0 || this.trackStates[rt] !== TrackState.armed || this.masterLength !== 0 || this.loopBars !== 0) return
    this.trackStates[rt] = TrackState.recording
    this.recStart = this.beatPos
  }

  /**
   * Ends the current take. `length` fixes the loop length of a first take (bar mode);
   * otherwise a first take's length is however long it ran, rounded to whole beats.
   */
  private finishRecording(length: number | null = null): void {
    if (this.recTrack < 0) return
    const t = this.recTrack
    const isMaster = this.masterLength === 0
    if (isMaster) {
      this.masterLength = length ?? Math.min(64, Math.max(1, roundHalfAway(this.beatPos - this.recStart)))
      this.loopOrigin = this.recStart
      this.transportPlaying = true
    }
    // Close notes still held.
    const endPos = this.recordPosition(0)
    for (let id = 0; id < Engine.liveIds; id++) {
      if (!this.heldActive[id]) continue
      const notes = this.style === PerformStyle.strum ? this.strumExpand(this.held[id]) : this.held[id]
      for (let i = 0; i < notes.length; i++) this.appendEvent(t, endPos, notes[i], 0, false, false)
    }
    if (this.droneId >= 0) {
      for (let i = 0; i < this.droneNotes.length; i++) this.appendEvent(t, endPos, this.droneNotes[i], 0, false, false)
    }
    // Normalise positions into the loop and keep the event list sorted.
    const base = t * Engine.maxEventsPerTrack
    const count = this.eventCounts[t]
    for (let i = 0; i < count; i++) {
      let p = this.evPos[base + i] % this.masterLength
      if (p < 0) p += this.masterLength
      this.evPos[base + i] = p
    }
    this.sortEvents(t)
    this.trackStates[t] = count > 0 ? TrackState.playing : TrackState.empty
    this.recTrack = -1
    this.countInEnd = null
    if (isMaster && count === 0) {
      this.masterLength = 0
      this.transportPlaying = false
    }
  }

  private cancelRecording(): void {
    if (this.recTrack < 0) return
    const t = this.recTrack
    this.eventCounts[t] = 0
    this.trackStates[t] = TrackState.empty
    this.recTrack = -1
    this.countInEnd = null
    if (this.masterLength === 0) this.transportPlaying = false
  }

  private clearTrack(t: number): void {
    if (this.recTrack === t) { this.recTrack = -1; this.countInEnd = null }
    this.killOwner(Engine.ownerTrackBase + t)
    this.eventCounts[t] = 0
    this.trackStates[t] = TrackState.empty
    let any = false
    for (let i = 0; i < Engine.trackCount; i++) if (this.trackStates[i] !== TrackState.empty) any = true
    if (!any && this.recTrack < 0) {
      this.masterLength = 0
      this.transportPlaying = false
    }
  }

  /** Position (in loop beats, before wrapping) for an event `delay` samples from the current chunk. */
  private recordPosition(delay: number): number {
    const spb = (this.sampleRate * 60) / this.tempo
    const beat = this.beatPos + delay / spb
    if (this.masterLength === 0) return beat - this.recStart
    return this.loopPosition(beat)
  }

  /** Records a held-note event from live playing. */
  private recordLive(note: number, velocity: number, on: boolean, delay: number): void {
    const rt = this.recTrack
    if (rt < 0) return
    if (on && this.trackStates[rt] === TrackState.armed && this.masterLength === 0 && this.loopBars === 0) this.beginFreeRecording()
    if (this.trackStates[rt] !== TrackState.recording) return
    this.appendEvent(rt, this.recordPosition(delay), note, velocity, on, false)
  }

  /** Records a note with a known length (arp, repeat, sequencer). */
  private recordNote(note: number, velocity: number, delay: number, gateBeats: number, drum: boolean): void {
    const rt = this.recTrack
    if (rt < 0) return
    if (this.trackStates[rt] === TrackState.armed && this.masterLength === 0 && this.loopBars === 0) this.beginFreeRecording()
    if (this.trackStates[rt] !== TrackState.recording) return
    const pos = this.recordPosition(delay)
    this.appendEvent(rt, pos, note, velocity, true, drum)
    this.appendEvent(rt, pos + gateBeats, note, 0, false, drum)
  }

  private appendEvent(t: number, pos: number, note: number, velocity: number, on: boolean, drum: boolean): void {
    const count = this.eventCounts[t]
    // Keep headroom so note-offs always fit.
    if (on && count >= Engine.maxEventsPerTrack - 64) return
    if (count >= Engine.maxEventsPerTrack) return
    const i = t * Engine.maxEventsPerTrack + count
    this.evPos[i] = pos
    this.evNote[i] = note
    this.evVel[i] = velocity
    this.evOn[i] = on ? 1 : 0
    this.evDrum[i] = drum ? 1 : 0
    this.eventCounts[t] = count + 1
  }

  /** Stable insertion sort by position (note-offs before note-ons at equal positions). */
  private sortEvents(t: number): void {
    const base = t * Engine.maxEventsPerTrack
    const count = this.eventCounts[t]
    if (count <= 1) return
    const P = this.evPos, N = this.evNote, V = this.evVel, O = this.evOn, D = this.evDrum
    for (let i = 1; i < count; i++) {
      const ep = P[base + i], en = N[base + i], ev = V[base + i], eo = O[base + i], ed = D[base + i]
      let j = i - 1
      while (j >= 0 && (P[base + j] > ep || (P[base + j] === ep && O[base + j] === 1 && eo === 0))) {
        P[base + j + 1] = P[base + j]; N[base + j + 1] = N[base + j]; V[base + j + 1] = V[base + j]
        O[base + j + 1] = O[base + j]; D[base + j + 1] = D[base + j]
        j -= 1
      }
      P[base + j + 1] = ep; N[base + j + 1] = en; V[base + j + 1] = ev; O[base + j + 1] = eo; D[base + j + 1] = ed
    }
  }

  private lowerBound(t: number, pos: number): number {
    const base = t * Engine.maxEventsPerTrack
    let lo = 0
    let hi = this.eventCounts[t]
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.evPos[base + mid] < pos) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private playLoops(t0: number, t1: number, spb: number): void {
    const p0 = this.loopPosition(t0)
    const len = this.masterLength
    const span = t1 - t0
    for (let t = 0; t < Engine.trackCount; t++) {
      if (this.trackStates[t] !== TrackState.playing) continue
      if (p0 + span <= len) {
        this.fire(t, p0, p0 + span, 0, spb)
      } else {
        this.fire(t, p0, len, 0, spb)
        this.fire(t, 0, p0 + span - len, len - p0, spb)
      }
    }
  }

  private fire(t: number, from: number, to: number, beatOffset: number, spb: number): void {
    const base = t * Engine.maxEventsPerTrack
    const count = this.eventCounts[t]
    let i = this.lowerBound(t, from)
    const owner = Engine.ownerTrackBase + t
    while (i < count && this.evPos[base + i] < to) {
      const k = base + i
      const d = Math.max(0, Math.trunc((this.evPos[k] - from + beatOffset) * spb))
      const note = this.evNote[k]
      const vel = this.evVel[k]
      if (this.evDrum[k]) {
        if (this.evOn[k]) {
          const kit = this.trackKits[t]
          if (note >= 0 && note < 7) {
            this.triggerDrum(this.kitPad(kit, note), note, vel, owner, d)
            this.drumMIDI(note, vel, d)
          }
        }
      } else if (this.evOn[k]) {
        this.startVoice(note, vel, owner, t + 1, d)
      } else {
        this.releaseNote(owner, note, d)
      }
      i += 1
    }
  }
}

function softClip(x: number): number {
  const c = clamp(x, -3, 3)
  return clamp((c * (27 + c * c)) / (27 + 9 * c * c), -1, 1)
}

// Re-exported for hosts that only import the engine module.
export { WaveType }
