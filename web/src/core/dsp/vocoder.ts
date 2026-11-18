import { OnePole, SVF, clamp, noiseValue, xorshift } from './dspUtil'

/** Where the vocoder's modulator (the "voice") comes from. */
export enum VocoderSource { mic, track1 }
export namespace VocoderSource {
  export const allCases: readonly VocoderSource[] = [VocoderSource.mic, VocoderSource.track1]
  export function displayName(s: VocoderSource): string { return s === VocoderSource.mic ? 'MIC' : 'TRACK 1' }
}

/** Vocoder settings (plain data). */
export interface VocoderParams {
  source: VocoderSource
  /** Carrier band shift, 0.5 ... 2 (formant shift). */
  formant: number
  /** Band resonance, 0 ... 1. */
  q: number
  attack: number
  release: number
  /** Unvoiced "consonant" noise level, 0 ... 1. */
  noise: number
  /** Modulator level below which the vocoder is silent, 0 ... 0.1. */
  gate: number
}

export function defaultVocoderParams(): VocoderParams {
  return { source: VocoderSource.mic, formant: 1, q: 0.5, attack: 0.005, release: 0.06, noise: 0.35, gate: 0.01 }
}

/** A 12-band channel vocoder: the modulator's spectral envelope shapes the carrier (the held chord). */
export class Vocoder {
  static readonly bands = 12
  private analysis: SVF[] = []
  private synthesis: SVF[] = []
  private envelopes = new Float64Array(Vocoder.bands)
  private centers: number[] = []
  private gateEnv = 0
  private noiseHP = new OnePole()
  private hfEnv = 0
  private rng = 0xbeef
  private sampleRate = 48000
  private attackK = 0
  private releaseK = 0
  params: VocoderParams = defaultVocoderParams()

  constructor() {
    for (let b = 0; b < Vocoder.bands; b++) {
      this.analysis.push(new SVF())
      this.synthesis.push(new SVF())
      // Log-spaced 160 Hz ... 7 kHz.
      this.centers.push(160 * Math.pow(7000.0 / 160.0, b / (Vocoder.bands - 1)))
    }
  }

  configure(sr: number): void {
    this.sampleRate = sr
    this.noiseHP.set(5000, sr)
    this.set(this.params)
  }

  set(p: VocoderParams): void {
    this.params = { ...p }
    const q = 4 + 14 * clamp(p.q, 0, 1)
    const sr = this.sampleRate
    for (let b = 0; b < Vocoder.bands; b++) {
      this.analysis[b].setQ(this.centers[b], q, sr)
      this.synthesis[b].setQ(Math.min(sr * 0.45, this.centers[b] * clamp(p.formant, 0.5, 2)), q, sr)
    }
    this.attackK = 1 - Math.exp(-1 / (Math.max(0.0005, p.attack) * sr))
    this.releaseK = 1 - Math.exp(-1 / (Math.max(0.005, p.release) * sr))
  }

  reset(): void {
    for (let b = 0; b < Vocoder.bands; b++) {
      this.analysis[b].reset()
      this.synthesis[b].reset()
      this.envelopes[b] = 0
    }
    this.gateEnv = 0
    this.hfEnv = 0
  }

  /** Adds the vocoded signal of `carrier` shaped by `modulator` into `outL`/`outR`. */
  process(carrier: Float32Array, modulator: Float32Array, frames: number, outL: Float32Array, outR: Float32Array): void {
    const gateK = 1 - Math.exp(-1 / (0.02 * this.sampleRate))
    const noiseLevel = this.params.noise
    const gate = this.params.gate
    const attackK = this.attackK
    const releaseK = this.releaseK
    const env = this.envelopes
    for (let i = 0; i < frames; i++) {
      const m = modulator[i]
      const c = carrier[i]
      let out = 0
      for (let b = 0; b < Vocoder.bands; b++) {
        const level = Math.abs(this.analysis[b].bandpass(m))
        const e = env[b]
        env[b] = e + (level > e ? attackK : releaseK) * (level - e)
        out += this.synthesis[b].bandpass(c) * env[b]
      }
      // Consonants: high-passed noise follows the modulator's top end.
      const hf = Math.abs(m - this.noiseHP.lowpass(m))
      this.hfEnv += (hf > this.hfEnv ? attackK : releaseK) * (hf - this.hfEnv)
      this.rng = xorshift(this.rng)
      out += noiseValue(this.rng) * this.hfEnv * noiseLevel * 2
      // Gate
      this.gateEnv += gateK * (Math.abs(m) - this.gateEnv)
      const open = this.gateEnv > gate ? 1 : Math.max(0, this.gateEnv / Math.max(gate, 1e-5))
      const y = out * 3.5 * open
      outL[i] += y
      outR[i] += y
    }
  }
}
