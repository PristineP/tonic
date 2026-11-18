export interface PitchResult {
  frequency: number
  /** 0 ... 1, higher is more certain. */
  confidence: number
}

export namespace PitchResult {
  export function midi(r: PitchResult): number { return 69 + 12 * Math.log2(r.frequency / 440) }
  /** Swift `.rounded()` (half away from zero). */
  export function nearestNote(r: PitchResult): number {
    const m = midi(r)
    return Math.sign(m) * Math.round(Math.abs(m))
  }
  export function cents(r: PitchResult): number { return (midi(r) - nearestNote(r)) * 100 }
}

/** YIN fundamental-frequency estimator, used by the tuner and to find the root of mic samples. */
export class PitchDetector {
  threshold = 0.12

  constructor(
    readonly sampleRate: number,
    readonly minFrequency = 50,
    readonly maxFrequency = 1500,
  ) {}

  /** Analyses a block of mono samples. Needs at least two periods of the lowest frequency. */
  detect(x: ArrayLike<number>): PitchResult | null {
    const n = x.length
    const maxLag = Math.min(Math.trunc(this.sampleRate / this.minFrequency), Math.trunc(n / 2))
    const minLag = Math.max(2, Math.trunc(this.sampleRate / this.maxFrequency))
    if (!(maxLag > minLag + 2)) return null

    // Reject silence.
    let energy = 0
    for (let i = 0; i < n; i++) energy += x[i] * x[i]
    if (!(energy / n > 1e-6)) return null

    const window = n - maxLag
    const diff = new Float64Array(maxLag + 1)
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0
      for (let i = 0; i < window; i++) {
        const d = x[i] - x[i + lag]
        sum += d * d
      }
      diff[lag] = sum
    }
    // Cumulative mean normalised difference.
    const cmnd = new Float64Array(maxLag + 1).fill(1)
    let running = 0
    for (let lag = 1; lag <= maxLag; lag++) {
      running += diff[lag]
      cmnd[lag] = running > 0 ? (diff[lag] * lag) / running : 1
    }
    let tau = -1
    let lag = minLag
    while (lag <= maxLag) {
      if (cmnd[lag] < this.threshold) {
        while (lag + 1 <= maxLag && cmnd[lag + 1] < cmnd[lag]) lag += 1
        tau = lag
        break
      }
      lag += 1
    }
    if (tau < 0) {
      // Fall back to the global minimum if it is reasonably clear.
      let best = minLag
      for (let l = minLag; l <= maxLag; l++) if (cmnd[l] < cmnd[best]) best = l
      if (!(cmnd[best] < 0.35)) return null
      tau = best
    }
    // Parabolic interpolation around the minimum.
    let refined = tau
    if (tau > 1 && tau < maxLag) {
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1]
      const denom = a - 2 * b + c
      if (Math.abs(denom) > 1e-12) refined += (0.5 * (a - c)) / denom
    }
    const f = this.sampleRate / refined
    if (!(f >= this.minFrequency * 0.9 && f <= this.maxFrequency * 1.1)) return null
    return { frequency: f, confidence: Math.max(0, Math.min(1, 1 - cmnd[tau])) }
  }
}

export namespace PitchDetector {
  export type Result = PitchResult
}
