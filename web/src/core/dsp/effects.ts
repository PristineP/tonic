import { OnePole, clamp, noiseValue, sin01, xorshift } from './dspUtil'

export enum ReverbType { off, room, hall, plate, spring, ambient }
export namespace ReverbType {
  export const allCases: readonly ReverbType[] = [0, 1, 2, 3, 4, 5]
  export function displayName(t: ReverbType): string { return ['OFF', 'ROOM', 'HALL', 'PLATE', 'SPRING', 'AMBIENT'][t] }
}

export enum DelayTime { off, quarter, eighth, dottedEighth, eighthTriplet, sixteenth }
export namespace DelayTime {
  export const allCases: readonly DelayTime[] = [0, 1, 2, 3, 4, 5]
  export function displayName(t: DelayTime): string { return ['OFF', '1/4', '1/8', '1/8.', '1/8T', '1/16'][t] }
  export function beats(t: DelayTime): number { return [0, 1, 0.5, 0.75, 1.0 / 3.0, 0.25][t] }
}

export enum ModType { off, chorus, wideChorus, flanger, jet }
export namespace ModType {
  export const allCases: readonly ModType[] = [0, 1, 2, 3, 4]
  export function displayName(t: ModType): string { return ['OFF', 'CHORUS', 'WIDE CHO', 'FLANGER', 'JET FLNG'][t] }
}

export enum DriveType { off, tube, drive, distortion, fuzz }
export namespace DriveType {
  export const allCases: readonly DriveType[] = [0, 1, 2, 3, 4]
  export function displayName(t: DriveType): string { return ['OFF', 'TUBE', 'DRIVE', 'DISTORT', 'FUZZ'][t] }
}

export enum LofiType { off, lofi, vinyl, tape }
export namespace LofiType {
  export const allCases: readonly LofiType[] = [0, 1, 2, 3]
  export function displayName(t: LofiType): string { return ['OFF', 'LO-FI', 'VINYL', 'TAPE'][t] }
}

export enum TremoloRate { off, half, quarter, eighth, sixteenth }
export namespace TremoloRate {
  export const allCases: readonly TremoloRate[] = [0, 1, 2, 3, 4]
  export function displayName(t: TremoloRate): string { return ['OFF', '1/2', '1/4', '1/8', '1/16'][t] }
  export function beats(t: TremoloRate): number { return [0, 2, 1, 0.5, 0.25][t] }
}

/** Master effect settings (plain data). */
export interface FXParams {
  reverb: ReverbType
  reverbMix: number
  delay: DelayTime
  delayFeedback: number
  delayMix: number
  mod: ModType
  tremolo: TremoloRate
  tremoloDepth: number
  drive: DriveType
  lofi: LofiType
  /** 0 = mono, 1 = wide. */
  spread: number
}

export function defaultFXParams(): FXParams {
  return {
    reverb: ReverbType.room, reverbMix: 0.22, delay: DelayTime.off, delayFeedback: 0.35, delayMix: 0.25,
    mod: ModType.off, tremolo: TremoloRate.off, tremoloDepth: 0.6, drive: DriveType.off, lofi: LofiType.off, spread: 0.6,
  }
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
const STEREO_SPREAD = 23

/** Freeverb-style stereo reverb. */
export class Reverb {
  private combBuf: Float32Array[] = []
  private combLen: number[] = []
  private combIdx: number[] = []
  private combStore: number[] = []
  private apBuf: Float32Array[] = []
  private apLen: number[] = []
  private apIdx: number[] = []
  private feedback = 0.84
  private damp = 0.2
  outL = 0
  outR = 0

  constructor(maxSampleRate: number) {
    const scale = maxSampleRate / 44100
    for (let ch = 0; ch < 2; ch++) {
      for (const t of COMB_TUNING) {
        const len = Math.trunc((t + ch * STEREO_SPREAD) * scale) + 1
        this.combBuf.push(new Float32Array(len)); this.combLen.push(len); this.combIdx.push(0); this.combStore.push(0)
      }
      for (const t of ALLPASS_TUNING) {
        const len = Math.trunc((t + ch * STEREO_SPREAD) * scale) + 1
        this.apBuf.push(new Float32Array(len)); this.apLen.push(len); this.apIdx.push(0)
      }
    }
  }

  /** Recomputes active delay lengths for the current sample rate (buffers are sized for the max). */
  configure(sampleRate: number): void {
    const scale = sampleRate / 44100
    for (let ch = 0; ch < 2; ch++) {
      COMB_TUNING.forEach((t, i) => {
        const idx = ch * 8 + i
        this.combLen[idx] = Math.max(1, Math.trunc((t + ch * STEREO_SPREAD) * scale) + 1)
        this.combIdx[idx] = 0
      })
      ALLPASS_TUNING.forEach((t, i) => {
        const idx = ch * 4 + i
        this.apLen[idx] = Math.max(1, Math.trunc((t + ch * STEREO_SPREAD) * scale) + 1)
        this.apIdx[idx] = 0
      })
    }
  }

  setType(type: ReverbType): void {
    switch (type) {
      case ReverbType.off:
      case ReverbType.room: this.feedback = 0.78; this.damp = 0.35; break
      case ReverbType.hall: this.feedback = 0.88; this.damp = 0.25; break
      case ReverbType.plate: this.feedback = 0.86; this.damp = 0.08; break
      case ReverbType.spring: this.feedback = 0.82; this.damp = 0.5; break
      case ReverbType.ambient: this.feedback = 0.94; this.damp = 0.3; break
    }
  }

  clear(): void {
    for (let i = 0; i < this.combBuf.length; i++) { this.combBuf[i].fill(0, 0, this.combLen[i]); this.combStore[i] = 0 }
    for (let i = 0; i < this.apBuf.length; i++) this.apBuf[i].fill(0, 0, this.apLen[i])
  }

  /** Processes one stereo sample; output in `outL` / `outR`. */
  process(inL: number, inR: number): void {
    const input = (inL + inR) * 0.015
    const damp = this.damp
    const feedback = this.feedback
    for (let ch = 0; ch < 2; ch++) {
      let acc = 0
      for (let c = 0; c < 8; c++) {
        const i = ch * 8 + c
        const buf = this.combBuf[i]
        const idx = this.combIdx[i]
        const y = buf[idx]
        this.combStore[i] = y * (1 - damp) + this.combStore[i] * damp
        buf[idx] = input + this.combStore[i] * feedback
        this.combIdx[i] = idx + 1 >= this.combLen[i] ? 0 : idx + 1
        acc += y
      }
      for (let a = 0; a < 4; a++) {
        const i = ch * 4 + a
        const buf = this.apBuf[i]
        const idx = this.apIdx[i]
        const b = buf[idx]
        buf[idx] = acc + b * 0.5
        acc = b - acc
        this.apIdx[i] = idx + 1 >= this.apLen[i] ? 0 : idx + 1
      }
      if (ch === 0) this.outL = acc
      else this.outR = acc
    }
  }
}

/** A simple circular delay line with fractional reads. */
export class DelayLine {
  readonly buf: Float32Array
  write = 0

  constructor(readonly capacity: number) {
    this.buf = new Float32Array(capacity)
  }

  push(x: number): void {
    this.buf[this.write] = x
    this.write += 1
    if (this.write >= this.capacity) this.write = 0
  }

  /** Reads `delay` samples behind the most recent write. */
  read(delay: number): number {
    const cap = this.capacity
    const d = Math.min(Math.max(delay, 1), cap - 2)
    let pos = this.write - d
    if (pos < 0) pos += cap
    const i0 = Math.trunc(pos)
    const frac = pos - i0
    const i1 = i0 + 1 >= cap ? 0 : i0 + 1
    const buf = this.buf
    return buf[i0] + (buf[i1] - buf[i0]) * frac
  }

  clear(): void { this.buf.fill(0) }
}

/** The master effects chain: drive -> lo-fi -> chorus/flanger -> tremolo -> delay -> reverb -> width. */
export class EffectsChain {
  params: FXParams = defaultFXParams()
  sampleRate = 48000
  bpm = 100

  private reverb: Reverb
  private delayL: DelayLine
  private delayR: DelayLine
  private modL: DelayLine
  private modR: DelayLine
  private tapeL: DelayLine
  private tapeR: DelayLine
  private lfo = 0
  private tapeLfo = 0
  private tremPhase = 0
  private crushHoldL = 0
  private crushHoldR = 0
  private crushCount = 0
  private rng = 987654321
  private lofiLP0 = new OnePole()
  private lofiLP1 = new OnePole()
  private delayLP0 = new OnePole()
  private delayLP1 = new OnePole()
  private crackleLP = new OnePole()
  private reverbHP0 = new OnePole()
  private reverbHP1 = new OnePole()
  private springLfo = 0

  constructor(maxSampleRate: number) {
    this.reverb = new Reverb(maxSampleRate)
    const delayCap = Math.trunc(maxSampleRate * 2.6)
    this.delayL = new DelayLine(delayCap)
    this.delayR = new DelayLine(delayCap)
    this.modL = new DelayLine(Math.trunc(maxSampleRate * 0.05))
    this.modR = new DelayLine(Math.trunc(maxSampleRate * 0.05))
    this.tapeL = new DelayLine(Math.trunc(maxSampleRate * 0.03))
    this.tapeR = new DelayLine(Math.trunc(maxSampleRate * 0.03))
  }

  private noise(): number {
    this.rng = xorshift(this.rng)
    return noiseValue(this.rng)
  }

  configure(sampleRate: number): void {
    this.sampleRate = sampleRate
    this.reverb.configure(sampleRate)
    this.reverb.clear()
    this.delayL.clear(); this.delayR.clear(); this.modL.clear(); this.modR.clear(); this.tapeL.clear(); this.tapeR.clear()
    this.lofiLP0.set(4500, sampleRate)
    this.lofiLP1.set(4500, sampleRate)
    this.delayLP0.set(5000, sampleRate)
    this.delayLP1.set(5000, sampleRate)
    this.crackleLP.set(2500, sampleRate)
    this.reverbHP0.set(120, sampleRate)
    this.reverbHP1.set(120, sampleRate)
  }

  set(p: FXParams): void {
    if (p.lofi !== this.params.lofi) {
      const fc = p.lofi === LofiType.vinyl ? 5500 : p.lofi === LofiType.tape ? 7500 : 4000
      this.lofiLP0.set(fc, this.sampleRate)
      this.lofiLP1.set(fc, this.sampleRate)
    }
    if (p.reverb !== this.params.reverb) this.reverb.setType(p.reverb)
    if (p.delay === DelayTime.off && this.params.delay !== DelayTime.off) { this.delayL.clear(); this.delayR.clear() }
    this.params = { ...p }
  }

  process(left: Float32Array, right: Float32Array, frames: number, table: Float32Array): void {
    const p = this.params
    const sr = this.sampleRate
    const samplesPerBeat = (sr * 60) / Math.max(this.bpm, 20)
    const delaySamples = DelayTime.beats(p.delay) * samplesPerBeat
    const tremInc = p.tremolo === TremoloRate.off ? 0 : 1.0 / (TremoloRate.beats(p.tremolo) * samplesPerBeat)
    let lfoRate = 0, modBase = 0, modDepth = 0, modFb = 0
    switch (p.mod) {
      case ModType.off: break
      case ModType.chorus: lfoRate = 0.8; modBase = 0.012; modDepth = 0.003; modFb = 0; break
      case ModType.wideChorus: lfoRate = 0.5; modBase = 0.018; modDepth = 0.005; modFb = 0; break
      case ModType.flanger: lfoRate = 0.25; modBase = 0.0015; modDepth = 0.0013; modFb = 0.65; break
      case ModType.jet: lfoRate = 0.12; modBase = 0.001; modDepth = 0.0009; modFb = 0.85; break
    }
    const driveGain = [1, 2, 4, 12, 30][p.drive]
    const reverbOn = p.reverb !== ReverbType.off
    const width = p.spread
    const reverb = this.reverb

    for (let i = 0; i < frames; i++) {
      let l = left[i]
      let r = right[i]

      // Drive
      switch (p.drive) {
        case DriveType.tube:
          l = (l * driveGain + 0.1) / (1 + Math.abs(l * driveGain + 0.1)) - 0.0909
          r = (r * driveGain + 0.1) / (1 + Math.abs(r * driveGain + 0.1)) - 0.0909
          break
        case DriveType.drive:
          l = Math.tanh(l * driveGain) * 0.7
          r = Math.tanh(r * driveGain) * 0.7
          break
        case DriveType.distortion:
          l = clamp(l * driveGain, -0.6, 0.6)
          r = clamp(r * driveGain, -0.6, 0.6)
          break
        case DriveType.fuzz:
          l = (l >= 0 ? 1 : -1) * (1 - Math.exp(-Math.abs(l * driveGain))) * 0.5
          r = (r >= 0 ? 1 : -1) * (1 - Math.exp(-Math.abs(r * driveGain))) * 0.5
          break
        default:
          break
      }

      // Lo-fi family
      switch (p.lofi) {
        case LofiType.lofi:
          this.crushCount += 1
          if (this.crushCount >= 4) {
            this.crushCount = 0
            // Swift .rounded() = half away from zero
            this.crushHoldL = roundHalfAway(l * 32) / 32
            this.crushHoldR = roundHalfAway(r * 32) / 32
          }
          l = this.lofiLP0.lowpass(this.crushHoldL)
          r = this.lofiLP1.lowpass(this.crushHoldR)
          break
        case LofiType.vinyl: {
          let crackle = 0
          const n = this.noise()
          if (Math.abs(n) > 0.9993) crackle = n * 0.25
          const hiss = this.crackleLP.lowpass(this.noise()) * 0.006
          l = this.lofiLP0.lowpass(l) + crackle + hiss
          r = this.lofiLP1.lowpass(r) + crackle + hiss
          break
        }
        case LofiType.tape: {
          this.tapeLfo += 0.6 / sr
          if (this.tapeLfo >= 1) this.tapeLfo -= 1
          const wow = (0.004 + 0.0012 * sin01(this.tapeLfo, table)) * sr
          this.tapeL.push(l); this.tapeR.push(r)
          l = Math.tanh(this.lofiLP0.lowpass(this.tapeL.read(wow)) * 1.3)
          r = Math.tanh(this.lofiLP1.lowpass(this.tapeR.read(wow)) * 1.3)
          break
        }
        default:
          break
      }

      // Chorus / flanger
      if (p.mod !== ModType.off) {
        this.lfo += lfoRate / sr
        if (this.lfo >= 1) this.lfo -= 1
        const mL = (modBase + modDepth * sin01(this.lfo, table)) * sr
        const mR = (modBase + modDepth * sin01(this.lfo + 0.25, table)) * sr
        const wl = this.modL.read(mL)
        const wr = this.modR.read(mR)
        this.modL.push(l + wl * modFb)
        this.modR.push(r + wr * modFb)
        l = (l + wl) * 0.7
        r = (r + wr) * 0.7
      }

      // Tremolo (tempo synced)
      if (tremInc > 0) {
        this.tremPhase += tremInc
        if (this.tremPhase >= 1) this.tremPhase -= 1
        const t = 1 - p.tremoloDepth * (0.5 + 0.5 * sin01(this.tremPhase, table))
        l *= t
        r *= t
      }

      // Ping-pong delay
      if (p.delay !== DelayTime.off) {
        const dl = this.delayL.read(delaySamples)
        const dr = this.delayR.read(delaySamples)
        this.delayL.push(l + this.delayLP1.lowpass(dr) * p.delayFeedback)
        this.delayR.push(this.delayLP0.lowpass(dl) * p.delayFeedback)
        l += dl * p.delayMix
        r += dr * p.delayMix
      }

      // Reverb
      if (reverbOn) {
        let inL = this.reverbHP0.highpass(l)
        let inR = this.reverbHP1.highpass(r)
        if (p.reverb === ReverbType.spring) {
          this.springLfo += 3.1 / sr
          if (this.springLfo >= 1) this.springLfo -= 1
          const wobble = 1 + 0.15 * sin01(this.springLfo, table)
          inL *= wobble; inR *= wobble
        }
        reverb.process(inL, inR)
        l += reverb.outL * p.reverbMix * 3
        r += reverb.outR * p.reverbMix * 3
      }

      // Stereo width
      const mid = 0.5 * (l + r)
      const side = 0.5 * (l - r) * (0.2 + 1.3 * width)
      left[i] = mid + side
      right[i] = mid - side
    }
  }
}

function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}
