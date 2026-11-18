// Tuner analysis and sample capture from mic audio forwarded by the worklet.
import { PitchDetector, PitchResult } from '../core/analysis/pitchDetector'

export const CAPTURE_SECONDS = 1.6

export class MicAnalyser {
  private ring = new Float32Array(16384)
  private write = 0
  private filled = 0
  private recording: Float32Array[] | null = null
  private recorded = 0
  private captureDone: ((r: { samples: Float32Array; rate: number } | null) => void) | null = null
  private captureDeadline = 0
  private lastAnalysis = 0
  rate = 48000
  onPitch: ((r: PitchResult | null) => void) | null = null
  onLevel: ((level: number) => void) | null = null

  reset(rate: number): void {
    this.rate = rate
    this.write = 0
    this.filled = 0
    this.recording = null
  }

  push(x: Float32Array, now: number): void {
    for (let i = 0; i < x.length; i++) {
      this.ring[this.write] = x[i]
      this.write = (this.write + 1) % this.ring.length
    }
    this.filled = Math.min(this.ring.length, this.filled + x.length)
    if (this.recording && this.recorded < this.rate * 3) {
      this.recording.push(x.slice())
      this.recorded += x.length
    }
    if (now - this.lastAnalysis >= 0.06) {
      this.lastAnalysis = now
      this.analyse(now)
    }
  }

  private recent(n: number): Float32Array {
    const count = Math.min(n, this.filled)
    const out = new Float32Array(count)
    const len = this.ring.length
    for (let i = 0; i < count; i++) out[i] = this.ring[(this.write - count + i + len) % len]
    return out
  }

  capture(now: number, done: (r: { samples: Float32Array; rate: number } | null) => void): void {
    this.recording = []
    this.recorded = 0
    this.captureDone = done
    this.captureDeadline = now + CAPTURE_SECONDS
  }

  cancel(): void {
    const d = this.captureDone
    this.captureDone = null
    this.recording = null
    d?.(null)
  }

  private analyse(now: number): void {
    const recent = this.recent(4096)
    let peak = 0
    for (let i = Math.max(0, recent.length - 1024); i < recent.length; i++) peak = Math.max(peak, Math.abs(recent[i]))
    this.onLevel?.(peak)
    if (this.captureDone && now >= this.captureDeadline) {
      const chunks = this.recording ?? []
      this.recording = null
      const all = new Float32Array(chunks.reduce((a, c) => a + c.length, 0))
      let o = 0
      for (const c of chunks) {
        all.set(c, o)
        o += c.length
      }
      const done = this.captureDone
      this.captureDone = null
      const processed = processSample(all)
      done(processed ? { samples: processed, rate: this.rate } : null)
      return
    }
    if (!this.onPitch || recent.length < 4096) return
    const detector = new PitchDetector(this.rate, 40, 1600)
    this.onPitch(detector.detect(recent))
  }
}

/// Trims leading silence, normalises and fades the tail. Null if silent.
export function processSample(x: Float32Array): Float32Array | null {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  if (peak <= 0.01) return null
  const threshold = peak * 0.08
  let start = -1
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) > threshold) {
      start = i
      break
    }
  if (start < 0) return null
  const out = x.slice(Math.max(0, start - 64))
  const gain = 0.9 / peak
  for (let i = 0; i < out.length; i++) out[i] *= gain
  const fade = Math.min(out.length, 960)
  for (let i = 0; i < fade; i++) out[out.length - fade + i] *= (fade - i) / fade
  return out
}

/// Median detected note a little after the attack, or null.
export function detectRoot(samples: Float32Array, sampleRate: number): number | null {
  const window = 4096
  if (samples.length <= window + 1024) return null
  const detector = new PitchDetector(sampleRate, 50, 1500)
  const notes: number[] = []
  let start = Math.min(2048, samples.length - window)
  while (start + window <= Math.min(samples.length, Math.floor(sampleRate * 0.8))) {
    const r = detector.detect(samples.subarray(start, start + window))
    if (r && r.confidence > 0.7) notes.push(PitchResult.nearestNote(r))
    start += 2048
  }
  if (!notes.length) return null
  notes.sort((a, b) => a - b)
  return notes[Math.floor(notes.length / 2)]
}
