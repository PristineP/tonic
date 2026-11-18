import { SVF, clamp, decayCoef, midiToHz, noiseValue, polyBlep, sin01, xorshift } from './dspUtil'
import { SynthParams, WaveType } from './synthParams'

/** A sample loaded into one of the engine's sample slots. */
export class SampleSlot {
  length = 0
  sourceRate = 48000
  /** MIDI note the recording sounds at when played back unshifted. */
  rootNote = 60
  constructor(public data: Float32Array, public capacity: number = data.length) {}
}

export enum VoiceStage { idle, attack, decay, sustain, release, kill }

const ORGAN_W = [0.55, 1.0, 0.45, 0.55, 0.25, 0.2]
const BUZZ_W = [0.3, 1.0, 0.7, 0.8, 0.7, 0.6]

/** One polyphonic synth voice. */
export class SynthVoice {
  static readonly pluckCapacity = 4096

  stage: VoiceStage = VoiceStage.idle
  /** Who started the note (live button id, or track id for loop playback). */
  owner = -1
  /** Which patch slot this voice reads its parameters from. */
  patch = 0
  note = 0
  velocity = 0.8
  startOrder = 0
  /** MIDI channel the note was sent on (0xFF = not sent). */
  midiChannel = 0xff

  freq = 440
  targetFreq = 440
  phase1 = 0
  phase2 = 0
  phase3 = 0
  modPhase = 0
  env = 0
  fmEnv = 1
  filterEnv = 1
  age = 0
  vibPhase = 0
  tremPhase = 0
  filter = new SVF()
  formantA = new SVF()
  formantB = new SVF()
  rng = 22222
  /** Samples until an automatic release (-1 = hold until released). */
  releaseIn = -1
  /** Samples to wait before sounding (strums). */
  delay = 0
  panL = 0.707
  panR = 0.707
  /** Additional gain (e.g. drone crossfades). */
  gainScale = 1

  // Plucked string state
  ks: Float32Array | null = null
  ksWrite = 0
  ksDelay = 100
  ksLast = 0
  ksFeedback = 0.99

  // Sample playback
  samplePos = 0
  sampleRate = 1

  get isActive(): boolean { return this.stage !== VoiceStage.idle }
  get isReleasing(): boolean { return this.stage === VoiceStage.release || this.stage === VoiceStage.kill }

  private noise(): number {
    this.rng = xorshift(this.rng)
    return noiseValue(this.rng)
  }

  start(
    note: number, velocity: number, owner: number, patch: number, params: SynthParams,
    sr: number, order: number, delay: number, glideFrom: number | null, pan: number,
    sample: SampleSlot | null,
  ): void {
    this.note = note
    this.velocity = velocity
    this.owner = owner
    this.patch = patch
    this.startOrder = order
    this.delay = Math.max(0, delay)
    const n = note + params.octave * 12
    this.targetFreq = midiToHz(n)
    this.freq = glideFrom ?? this.targetFreq
    this.phase1 = 0
    this.phase2 = 0.37
    this.phase3 = 0.71
    this.modPhase = 0
    this.env = 0
    this.fmEnv = 1
    this.filterEnv = 1
    this.age = 0
    this.vibPhase = 0
    this.tremPhase = 0
    this.filter.reset()
    this.formantA.reset()
    this.formantB.reset()
    this.rng = (0x9e3779b9 + (Math.imul(order >>> 0, 2654435761 | 0) >>> 0)) >>> 0
    this.releaseIn = -1
    this.gainScale = 1
    const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4
    this.panL = Math.cos(angle)
    this.panR = Math.sin(angle)
    this.stage = VoiceStage.attack

    const ks = this.ks
    if (params.wave === WaveType.pluck && ks) {
      // Excite the string with filtered noise.
      this.ksDelay = Math.min(SynthVoice.pluckCapacity - 4, Math.max(2, sr / this.targetFreq - 0.5))
      const length = Math.trunc(this.ksDelay) + 2
      let lp = 0
      const a = 0.15 + 0.85 * params.pluckBright
      ks.fill(0)
      for (let i = 0; i < length; i++) {
        lp += a * (this.noise() - lp)
        ks[i] = lp
      }
      this.ksWrite = length
      this.ksLast = 0
      this.ksFeedback = Math.pow(10.0, -3.0 / (Math.max(0.05, params.pluckDecay) * this.targetFreq))
    }
    if (params.wave === WaveType.sample && sample && sample.length > 0) {
      this.samplePos = 0
      this.sampleRate = (sample.sourceRate / sr) * Math.pow(2.0, (n - sample.rootNote) / 12.0)
    }
  }

  release(): void {
    if (this.stage !== VoiceStage.idle && this.stage !== VoiceStage.kill) this.stage = VoiceStage.release
    if (this.delay > 0) this.stage = VoiceStage.idle // never sounded
  }

  /** Fast fade used for voice stealing and mutes. */
  kill(): void {
    if (this.stage !== VoiceStage.idle) this.stage = this.delay > 0 ? VoiceStage.idle : VoiceStage.kill
  }

  /** Renders and accumulates `frames` samples into the stereo buffers. */
  render(
    p: SynthParams, frames: number, sr: number, left: Float32Array, right: Float32Array,
    table: Float32Array, sample: SampleSlot | null, trackGain: number,
  ): void {
    if (this.stage === VoiceStage.idle) return
    if (this.releaseIn >= 0) {
      if (this.releaseIn < frames) {
        this.releaseIn = -1
        this.release()
        if ((this.stage as VoiceStage) === VoiceStage.idle) return
      } else {
        this.releaseIn -= frames
      }
    }
    let start = 0
    if (this.delay > 0) {
      if (this.delay >= frames) { this.delay -= frames; return }
      start = this.delay
      this.delay = 0
    }

    const n = frames - start
    const invSr = 1 / sr

    const attackInc = 1 / Math.max(p.attack * sr, 1)
    const decayK = decayCoef(p.decay, sr)
    const releaseK = decayCoef(p.release, sr)
    const killDec = 1 / (0.004 * sr)
    const fmK = decayCoef(p.fmDecay, sr)
    const fEnvK = decayCoef(p.filterDecay, sr)

    if (p.glide > 0.0005) {
      const g = Math.exp(-n / (p.glide * sr * 0.25))
      this.freq = this.targetFreq + (this.freq - this.targetFreq) * g
    } else {
      this.freq = this.targetFreq
    }

    let vib = 1
    if (p.vibratoDepth > 0) {
      const ageSec = this.age * invSr
      const ramp = p.vibratoDelay > 0 ? clamp(ageSec / p.vibratoDelay - 0.5, 0, 1) : 1
      this.vibPhase += p.vibratoRate * n * invSr
      this.vibPhase -= Math.floor(this.vibPhase)
      vib = Math.pow(2.0, (p.vibratoDepth * ramp * sin01(this.vibPhase, table)) / 12)
    }
    let trem = 1
    if (p.tremoloDepth > 0) {
      this.tremPhase += p.tremoloRate * n * invSr
      this.tremPhase -= Math.floor(this.tremPhase)
      trem = 1 - p.tremoloDepth * (0.5 + 0.5 * sin01(this.tremPhase, table))
    }

    const f = this.freq * vib
    const dt = Math.min(f * invSr, 0.49)
    const detune = Math.pow(2.0, p.detuneCents / 1200)
    const dt2 = Math.min(dt * Math.pow(2.0, p.osc2Semitones / 12) * (p.osc2Mix > 0 ? detune : 1), 0.49)
    const dtUp = Math.min(dt * detune, 0.49)
    const dtDown = dt / detune
    const modDt = dt * p.fmRatio

    const keyFactor = Math.pow(this.targetFreq / 261.63, p.keyTrack)
    const cutoff = p.cutoff * keyFactor * Math.pow(2.0, p.filterEnv * this.filterEnv)
    this.filter.set(cutoff, p.resonance, sr)
    this.filterEnv *= Math.pow(fEnvK, n)
    const useFormant = p.formant > 0.001
    if (useFormant) {
      this.formantA.setQ(750, 5, sr)
      this.formantB.setQ(1200, 6, sr)
    }
    const velGain = (0.35 + 0.65 * this.velocity) * p.gain * this.gainScale * trem * trackGain
    const osc2Mix = p.osc2Mix
    const osc1Mix = 1 - 0.5 * osc2Mix
    const fmBase = p.fmIndex
    const fmSus = p.fmSustain
    const wave = p.wave
    const wave2 = p.wave2
    const ks = this.ks

    for (let i = start; i < frames; i++) {
      // Envelope
      switch (this.stage) {
        case VoiceStage.attack:
          this.env += attackInc
          if (this.env >= 1) { this.env = 1; this.stage = VoiceStage.decay }
          break
        case VoiceStage.decay:
          this.env = p.sustain + (this.env - p.sustain) * decayK
          if (this.env - p.sustain < 0.0005) this.stage = VoiceStage.sustain
          break
        case VoiceStage.sustain:
          this.env = p.sustain
          if (p.sustain <= 0.0001) this.stage = VoiceStage.idle
          break
        case VoiceStage.release:
          this.env *= releaseK
          if (this.env < 0.0002) this.stage = VoiceStage.idle
          break
        case VoiceStage.kill:
          this.env -= killDec
          if (this.env <= 0) { this.env = 0; this.stage = VoiceStage.idle }
          break
        default:
          break
      }
      if (this.stage === VoiceStage.idle) break

      // Oscillators
      let s: number
      const phase1 = this.phase1
      switch (wave) {
        case WaveType.sine:
          s = sin01(phase1, table)
          break
        case WaveType.triangle:
          s = 4 * Math.abs(phase1 - 0.5) - 1
          break
        case WaveType.saw:
          s = 2 * phase1 - 1 - polyBlep(phase1, dt)
          break
        case WaveType.square:
        case WaveType.pulse: {
          const pw = wave === WaveType.pulse ? 0.25 : 0.5
          s = (phase1 < pw ? 1 : -1) + polyBlep(phase1, dt)
          let t2 = phase1 + 1 - pw
          t2 -= Math.floor(t2)
          s -= polyBlep(t2, dt)
          break
        }
        case WaveType.sawSquare: {
          const saw = 2 * phase1 - 1 - polyBlep(phase1, dt)
          const p3 = this.phase3
          let sq = (p3 < 0.5 ? 1 : -1) + polyBlep(p3, dtUp)
          let t2 = p3 + 0.5
          t2 -= Math.floor(t2)
          sq -= polyBlep(t2, dtUp)
          s = 0.6 * saw + 0.5 * sq
          break
        }
        case WaveType.supersaw: {
          const a = 2 * phase1 - 1 - polyBlep(phase1, dt)
          const b = 2 * this.phase2 - 1 - polyBlep(this.phase2, dtUp)
          const c = 2 * this.phase3 - 1 - polyBlep(this.phase3, dtDown)
          s = 0.5 * (a + 0.75 * (b + c))
          break
        }
        case WaveType.fm: {
          const idx = fmBase * (fmSus + (1 - fmSus) * this.fmEnv)
          this.fmEnv *= fmK
          s = sin01(phase1 + idx * 0.1591549 * sin01(this.modPhase, table), table)
          this.modPhase += modDt
          if (this.modPhase >= 1) this.modPhase -= Math.floor(this.modPhase)
          break
        }
        case WaveType.organ:
        case WaveType.buzzOrgan: {
          // Drawbars: 16', 8', 5 1/3', 4', 2 2/3', 2' on a sub-octave phase.
          const ph = phase1 * 0.5 + (this.phase3 >= 0.5 ? 0.5 : 0)
          const w = wave === WaveType.organ ? ORGAN_W : BUZZ_W
          s = w[0] * sin01(ph, table) + w[1] * sin01(2 * ph, table) + w[2] * sin01(3 * ph, table)
            + w[3] * sin01(4 * ph, table) + w[4] * sin01(6 * ph, table) + w[5] * sin01(8 * ph, table)
          s *= 0.42
          if (wave === WaveType.buzzOrgan) s = (s * 1.8) / (1 + Math.abs(s * 1.8))
          break
        }
        case WaveType.noise:
          s = this.noise()
          break
        case WaveType.pluck:
          if (ks) {
            const mask = SynthVoice.pluckCapacity - 1
            const pos = this.ksWrite - this.ksDelay
            const i0 = Math.floor(pos)
            const frac = pos - i0
            const a = ks[i0 & mask]
            const b = ks[(i0 + 1) & mask]
            const v = a + (b - a) * frac
            const avg = 0.5 * (v + this.ksLast)
            this.ksLast = v
            const bright = 0.5 * p.pluckBright
            const out = (avg * (1 - bright) + v * bright) * this.ksFeedback
            ks[this.ksWrite & mask] = out
            this.ksWrite = (this.ksWrite + 1) & mask
            s = out * 1.6
          } else {
            s = 0
          }
          break
        case WaveType.sample:
          if (sample && sample.length > 1) {
            const i0 = Math.trunc(this.samplePos)
            if (i0 >= sample.length - 1) {
              s = 0
              this.stage = VoiceStage.idle
            } else {
              const frac = this.samplePos - i0
              const a = sample.data[i0]
              s = a + (sample.data[i0 + 1] - a) * frac
              this.samplePos += this.sampleRate
            }
          } else {
            s = 0
          }
          break
        default:
          s = 0
      }

      // Second oscillator
      if (osc2Mix > 0) {
        let s2: number
        const p2 = this.phase2
        switch (wave2) {
          case WaveType.sine: s2 = sin01(p2, table); break
          case WaveType.triangle: s2 = 4 * Math.abs(p2 - 0.5) - 1; break
          case WaveType.square:
          case WaveType.pulse: {
            s2 = (p2 < 0.5 ? 1 : -1) + polyBlep(p2, dt2)
            let t2 = p2 + 0.5
            t2 -= Math.floor(t2)
            s2 -= polyBlep(t2, dt2)
            break
          }
          default: s2 = 2 * p2 - 1 - polyBlep(p2, dt2)
        }
        s = s * osc1Mix + s2 * osc2Mix
      }
      if (p.noise > 0) s += p.noise * this.noise()

      // Phase advance
      this.phase1 += dt
      if (this.phase1 >= 1) this.phase1 -= 1
      if (wave === WaveType.supersaw || wave === WaveType.sawSquare) {
        this.phase3 += wave === WaveType.supersaw ? dtDown : dtUp
        if (this.phase3 >= 1) this.phase3 -= 1
      } else if (wave === WaveType.organ || wave === WaveType.buzzOrgan) {
        // phase3 toggles each cycle of phase1 to build the sub-octave
        if (this.phase1 < dt) this.phase3 = this.phase3 >= 0.5 ? 0 : 0.5
      }
      this.phase2 += wave === WaveType.supersaw ? dtUp : dt2
      if (this.phase2 >= 1) this.phase2 -= 1

      // Formant & filter
      if (useFormant) {
        const fa = this.formantA.bandpass(s)
        const fb = this.formantB.bandpass(s)
        s = s * (1 - p.formant) + (fa * 1.6 + fb * 1.1) * p.formant
      }
      s = this.filter.lowpass(s)

      const out = s * this.env * velGain
      left[i] += out * this.panL
      right[i] += out * this.panR
    }
    this.age += n
  }
}
