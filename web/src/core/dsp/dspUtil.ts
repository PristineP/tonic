// Shared lookup tables and small DSP helpers. Everything here is allocation-free once built.

export const SINE_TABLE_SIZE = 4096

/** One cycle of a sine plus two guard points, so lookups never need to wrap. */
export const sineTable: Float32Array = (() => {
  const t = new Float32Array(SINE_TABLE_SIZE + 2)
  for (let i = 0; i <= SINE_TABLE_SIZE + 1; i++) t[i] = Math.sin((2 * Math.PI * i) / SINE_TABLE_SIZE)
  return t
})()

/** sin(2π x) via table lookup with linear interpolation. */
export function sin01(x: number, table: Float32Array = sineTable): number {
  const f = x - Math.floor(x)
  const pos = f * SINE_TABLE_SIZE
  const i = pos | 0
  const frac = pos - i
  const a = table[i]
  return a + (table[i + 1] - a) * frac
}

/** PolyBLEP residual for band-limited discontinuities. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  } else if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/** One xorshift32 step (UInt32 semantics). Returns the new state. */
export function xorshift(s: number): number {
  s ^= s << 13
  s >>>= 0
  s ^= s >>> 17
  s ^= s << 5
  return s >>> 0
}

/** Converts a UInt32 noise state into -1 ... 1 (Int32 bit pattern / 2^31). */
export function noiseValue(state: number): number {
  return (state | 0) * (1.0 / 2147483648.0)
}

/** Topology-preserving-transform state variable filter (Zavalishin). */
export class SVF {
  ic1 = 0
  ic2 = 0
  a1 = 0
  a2 = 0
  a3 = 0
  k = 2
  // Outputs of the last `process` call (avoids allocating tuples).
  low = 0
  band = 0
  high = 0

  /** resonance 0 ... 1 (0 = no peak, 1 = near self-oscillation) */
  set(cutoff: number, resonance: number, sampleRate: number): void {
    const fc = Math.min(Math.max(cutoff, 20), sampleRate * 0.45)
    const g = Math.tan((Math.PI * fc) / sampleRate)
    this.k = 2 - 1.95 * Math.min(Math.max(resonance, 0), 1)
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }

  /** Sets the filter from an explicit Q value (for band-pass use). */
  setQ(cutoff: number, q: number, sampleRate: number): void {
    const fc = Math.min(Math.max(cutoff, 20), sampleRate * 0.45)
    const g = Math.tan((Math.PI * fc) / sampleRate)
    this.k = 1 / Math.max(q, 0.05)
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }

  /** Processes one sample; results in `low`, `band`, `high`. Returns `low`. */
  process(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.low = v2
    this.band = v1
    this.high = v0 - this.k * v1 - v2
    return v2
  }

  /** Band-pass output of one sample. */
  bandpass(v0: number): number {
    this.process(v0)
    return this.band
  }

  lowpass(x: number): number {
    return this.process(x)
  }

  reset(): void {
    this.ic1 = 0
    this.ic2 = 0
  }
}

/** One-pole smoother / filter. */
export class OnePole {
  z = 0
  a = 0.5

  set(cutoff: number, sampleRate: number): void {
    this.a = 1 - Math.exp((-2.0 * Math.PI * cutoff) / sampleRate)
  }

  lowpass(x: number): number {
    this.z += this.a * (x - this.z)
    return this.z
  }

  highpass(x: number): number {
    this.z += this.a * (x - this.z)
    return x - this.z
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/** exp-based coefficient that decays to 1% (−40 dB) in `seconds`. */
export function decayCoef(seconds: number, sampleRate: number): number {
  return Math.exp(-4.6 / (Math.max(seconds, 0.0005) * sampleRate))
}

export function midiToHz(note: number): number {
  return 440 * Math.pow(2.0, (note - 69) / 12)
}
