import { OnePole, SVF, decayCoef, noiseValue, sin01, xorshift } from './dspUtil'

/** Synthesised drum instrument types. */
export enum DrumSound { kick, snare, closedHat, openHat, clap, tom, rim, cowbell, shaker }

/** Parameters for one drum pad in a kit. */
export interface DrumPad {
  sound: DrumSound
  /** base frequency multiplier */
  tune: number
  /** seconds */
  decay: number
  /** 0...1 sound-specific colour */
  tone: number
  level: number
}

export function drumPad(sound: DrumSound, o: { tune?: number; decay: number; tone?: number; level?: number }): DrumPad {
  return { sound, tune: o.tune ?? 1, decay: o.decay, tone: o.tone ?? 0.5, level: o.level ?? 1 }
}

/** Drum kits. Pads are ordered: kick, snare, closed hat, open hat, clap, tom, percussion. */
export enum DrumKit { tight, x0x, x9x, lynn, kr78, trap, lofi }

const S = DrumSound
const P = drumPad

export namespace DrumKit {
  export const allCases: readonly DrumKit[] = [
    DrumKit.tight, DrumKit.x0x, DrumKit.x9x, DrumKit.lynn, DrumKit.kr78, DrumKit.trap, DrumKit.lofi,
  ]
  export const padNames: readonly string[] = ['KICK', 'SNARE', 'C.HAT', 'O.HAT', 'CLAP', 'TOM', 'PERC']
  /** General MIDI notes for the seven pads. */
  export const gmNotes: readonly number[] = [36, 38, 42, 46, 39, 45, 37]

  export function displayName(k: DrumKit): string {
    return ['TIGHT KIT', 'X0X BOX', 'X9X BOX', 'LYNN KIT', 'KR-78', 'TRAP BOX', 'LOFI KIT'][k]
  }

  export function pads(k: DrumKit): DrumPad[] {
    switch (k) {
      case DrumKit.tight:
        return [P(S.kick, { tune: 1.0, decay: 0.28, tone: 0.6 }), P(S.snare, { tune: 1.1, decay: 0.16, tone: 0.6 }),
          P(S.closedHat, { decay: 0.045, tone: 0.7, level: 0.7 }), P(S.openHat, { decay: 0.3, tone: 0.7, level: 0.6 }),
          P(S.clap, { decay: 0.14, level: 0.8 }), P(S.tom, { tune: 1.0, decay: 0.25 }), P(S.rim, { decay: 0.04, level: 0.7 })]
      case DrumKit.x0x:
        return [P(S.kick, { tune: 0.82, decay: 0.75, tone: 0.2 }), P(S.snare, { tune: 0.95, decay: 0.2, tone: 0.45 }),
          P(S.closedHat, { decay: 0.05, tone: 0.5, level: 0.65 }), P(S.openHat, { decay: 0.45, tone: 0.5, level: 0.55 }),
          P(S.clap, { decay: 0.2, level: 0.85 }), P(S.tom, { tune: 0.8, decay: 0.4 }), P(S.cowbell, { decay: 0.25, level: 0.5 })]
      case DrumKit.x9x:
        return [P(S.kick, { tune: 1.05, decay: 0.42, tone: 0.8 }), P(S.snare, { tune: 1.0, decay: 0.22, tone: 0.75 }),
          P(S.closedHat, { decay: 0.06, tone: 0.9, level: 0.7 }), P(S.openHat, { decay: 0.5, tone: 0.9, level: 0.6 }),
          P(S.clap, { decay: 0.24, level: 0.85 }), P(S.tom, { tune: 1.2, decay: 0.3 }), P(S.rim, { tune: 1.2, decay: 0.05, level: 0.7 })]
      case DrumKit.lynn:
        return [P(S.kick, { tune: 1.15, decay: 0.22, tone: 0.9 }), P(S.snare, { tune: 1.25, decay: 0.18, tone: 0.85 }),
          P(S.closedHat, { decay: 0.035, tone: 1.0, level: 0.65 }), P(S.openHat, { decay: 0.28, tone: 1.0, level: 0.55 }),
          P(S.clap, { decay: 0.12, level: 0.8 }), P(S.tom, { tune: 1.4, decay: 0.22 }), P(S.cowbell, { tune: 1.1, decay: 0.18, level: 0.5 })]
      case DrumKit.kr78:
        return [P(S.kick, { tune: 1.25, decay: 0.16, tone: 0.1 }), P(S.snare, { tune: 1.5, decay: 0.09, tone: 0.3 }),
          P(S.closedHat, { decay: 0.025, tone: 0.3, level: 0.6 }), P(S.openHat, { decay: 0.18, tone: 0.3, level: 0.5 }),
          P(S.clap, { decay: 0.08, level: 0.7 }), P(S.tom, { tune: 1.6, decay: 0.16 }), P(S.shaker, { decay: 0.07, level: 0.6 })]
      case DrumKit.trap:
        return [P(S.kick, { tune: 0.7, decay: 1.4, tone: 0.3 }), P(S.snare, { tune: 1.1, decay: 0.18, tone: 0.9 }),
          P(S.closedHat, { decay: 0.03, tone: 0.8, level: 0.6 }), P(S.openHat, { decay: 0.35, tone: 0.8, level: 0.55 }),
          P(S.clap, { decay: 0.22, level: 0.9 }), P(S.tom, { tune: 0.9, decay: 0.5 }), P(S.rim, { tune: 0.9, decay: 0.04, level: 0.6 })]
      case DrumKit.lofi:
        return [P(S.kick, { tune: 0.95, decay: 0.3, tone: 0.3 }), P(S.snare, { tune: 0.85, decay: 0.15, tone: 0.3 }),
          P(S.closedHat, { decay: 0.04, tone: 0.2, level: 0.55 }), P(S.openHat, { decay: 0.22, tone: 0.2, level: 0.45 }),
          P(S.clap, { decay: 0.12, level: 0.7 }), P(S.tom, { tune: 0.9, decay: 0.28 }), P(S.shaker, { decay: 0.09, level: 0.55 })]
    }
  }
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21]

/** One sounding drum hit. */
export class DrumVoice {
  active = false
  owner = -1
  pad = 0
  sound: DrumSound = DrumSound.kick
  tune = 1
  decay = 0.2
  tone = 0.5
  level = 1
  t = 0
  delay = 0
  phase = 0
  phases = new Float64Array(6)
  rng = 12345
  bp = new SVF()
  hp = new OnePole()
  env = 1
  choke = false

  private noise(): number {
    this.rng = xorshift(this.rng)
    return noiseValue(this.rng)
  }

  start(p: DrumPad, pad: number, velocity: number, owner: number, delay: number, seed: number, sr: number): void {
    this.active = true
    this.owner = owner
    this.pad = pad
    this.sound = p.sound
    this.tune = p.tune
    this.decay = p.decay
    this.tone = p.tone
    this.level = p.level * (0.3 + 0.7 * velocity)
    this.t = 0
    this.delay = delay
    this.phase = 0
    const ph = this.phases
    ph[0] = 0; ph[1] = 0.13; ph[2] = 0.29; ph[3] = 0.41; ph[4] = 0.57; ph[5] = 0.73
    this.rng = (seed | 1) >>> 0
    this.bp.reset()
    this.hp.z = 0
    this.env = 1
    this.choke = false
    switch (this.sound) {
      case DrumSound.closedHat:
      case DrumSound.openHat:
        this.bp.setQ(7000 + 4000 * this.tone, 1.2, sr)
        this.hp.set(6000, sr)
        break
      case DrumSound.snare:
        this.hp.set(1500 + 2500 * this.tone, sr)
        break
      case DrumSound.clap:
        this.bp.setQ(1100 * this.tune, 2.5, sr)
        break
      case DrumSound.rim:
        this.bp.setQ(1700 * this.tune, 4, sr)
        break
      case DrumSound.cowbell:
        this.bp.setQ(800 * this.tune, 3, sr)
        break
      case DrumSound.shaker:
        this.hp.set(5000, sr)
        break
      default:
        break
    }
  }

  render(frames: number, sr: number, left: Float32Array, right: Float32Array, table: Float32Array, gain: number): void {
    if (!this.active) return
    let start = 0
    if (this.delay > 0) {
      if (this.delay >= frames) { this.delay -= frames; return }
      start = this.delay
      this.delay = 0
    }
    const invSr = 1 / sr
    const ampK = decayCoef(this.decay, sr)
    const chokeK = decayCoef(0.01, sr)
    const g = this.level * gain
    const tune = this.tune
    const tone = this.tone
    const clickLen = Math.trunc(0.004 * sr)
    const maxT = Math.trunc(4 * sr)
    const ph = this.phases
    for (let i = start; i < frames; i++) {
      const time = this.t * invSr
      let s = 0
      switch (this.sound) {
        case DrumSound.kick: {
          const pitchEnv = Math.exp(-time / 0.035)
          const f = 48 * tune * (1 + 3.2 * pitchEnv)
          this.phase += f * invSr
          if (this.phase >= 1) this.phase -= 1
          s = sin01(this.phase, table) * this.env
          if (this.t < clickLen) s += this.noise() * 0.35 * tone * (1 - time / 0.004)
          s = (s * 1.4) / (1 + Math.abs(s * 0.4))
          break
        }
        case DrumSound.snare: {
          const f = 185 * tune
          this.phase += f * invSr
          if (this.phase >= 1) this.phase -= 1
          const body = sin01(this.phase, table) * Math.exp(-time / 0.05)
          const noise = this.hp.highpass(this.noise())
          s = (body * (1 - 0.5 * tone) + noise * (0.5 + 0.5 * tone) * 1.3) * this.env
          break
        }
        case DrumSound.closedHat:
        case DrumSound.openHat: {
          const base = 100 * (0.9 + 0.2 * tone)
          let sum = 0
          for (let k = 0; k < 6; k++) {
            let x = ph[k] + base * HAT_RATIOS[k] * invSr
            x -= Math.floor(x)
            ph[k] = x
            sum += x < 0.5 ? 1 : -1
          }
          const metal = this.bp.bandpass(sum * 0.2 + this.noise() * 0.25)
          s = this.hp.highpass(metal) * 2.2 * this.env
          break
        }
        case DrumSound.clap: {
          let burst: number
          if (time < 0.03) {
            const local = time % 0.01
            burst = Math.exp(-local / 0.002)
          } else {
            burst = this.env
          }
          s = this.bp.bandpass(this.noise()) * burst * 2.4
          break
        }
        case DrumSound.tom: {
          const pitchEnv = Math.exp(-time / 0.06)
          const f = 110 * tune * (1 + 0.6 * pitchEnv)
          this.phase += f * invSr
          if (this.phase >= 1) this.phase -= 1
          s = sin01(this.phase, table) * this.env
          break
        }
        case DrumSound.rim:
          this.phase += 520 * tune * invSr
          if (this.phase >= 1) this.phase -= 1
          s = (sin01(this.phase, table) * 0.6 + this.bp.bandpass(this.noise()) * 1.5) * this.env
          break
        case DrumSound.cowbell: {
          this.phase += 540 * tune * invSr
          if (this.phase >= 1) this.phase -= 1
          ph[0] += 800 * tune * invSr
          if (ph[0] >= 1) ph[0] -= 1
          const sq = (this.phase < 0.5 ? 0.5 : -0.5) + (ph[0] < 0.5 ? 0.5 : -0.5)
          s = this.bp.bandpass(sq) * 1.6 * this.env
          break
        }
        case DrumSound.shaker: {
          const attack = Math.min(1, time / 0.008)
          s = this.hp.highpass(this.noise()) * this.env * attack * 0.9
          break
        }
      }
      this.env *= this.choke ? chokeK : ampK
      this.t += 1
      const out = s * g
      left[i] += out
      right[i] += out
      if (this.env < 0.0003 || this.t > maxT) { this.active = false; break }
    }
  }
}

/** Built-in beat patterns: seven styles with eight variations each. */
export enum BeatStyle { rock, breakbeat, dub, funk, house, dembow, swing }

type Rows = Record<string, string>

export namespace BeatStyle {
  export const allCases: readonly BeatStyle[] = [
    BeatStyle.rock, BeatStyle.breakbeat, BeatStyle.dub, BeatStyle.funk, BeatStyle.house, BeatStyle.dembow, BeatStyle.swing,
  ]

  export function displayName(s: BeatStyle): string {
    return ['ROCK', 'BREAK', 'DUB', 'FUNK', 'HOUSE', 'DEMBOW', 'SWING'][s]
  }

  /** 0 ... 1 shuffle applied to off-beat 8ths (1 = triplet feel). */
  export function swingAmount(s: BeatStyle): number {
    switch (s) {
      case BeatStyle.swing: return 1
      case BeatStyle.funk: return 0.25
      case BeatStyle.breakbeat: return 0.15
      default: return 0
    }
  }

  /** Pattern rows are 16 steps per bar. K kick, S snare, H closed hat, O open hat, C clap, T tom, P perc. */
  export function basePatterns(s: BeatStyle): { a: Rows; b: Rows } {
    switch (s) {
      case BeatStyle.rock:
        return { a: { K: 'x.......x.x.....', S: '....X.......X...', H: 'x.x.x.x.x.x.x.x.' },
          b: { K: 'x......xx.x.....', S: '....X.......X..g', H: 'x.x.x.x.x.x.x.o.' } }
      case BeatStyle.breakbeat:
        return { a: { K: 'x.x.......xx....', S: '....X..g.g..X..g', H: 'x.x.x.x.x.x.x.x.' },
          b: { K: 'x......x..x.....', S: '....X.......X...', H: 'x.xxx.x.x.xxx.x.' } }
      case BeatStyle.dub:
        return { a: { K: '........X.......', P: '........x.......', H: 'x.x.x.x.x.x.x.x.' },
          b: { K: 'x...x...x...x...', S: '........X.......', H: '..x...x...x...x.' } }
      case BeatStyle.funk:
        return { a: { K: 'x..x..x...x.....', S: '....X..g.g.gX...', H: 'xxxxxxxxxxxxxxxx' },
          b: { K: 'x.....x.x.....x.', S: '....X..g....X...', H: 'x.x.x.x.x.x.x.o.' } }
      case BeatStyle.house:
        return { a: { K: 'X...X...X...X...', C: '....x.......x...', O: '..x...x...x...x.', H: 'x...x...x...x...' },
          b: { K: 'X...X...X...X...', C: '....x.......x...', O: '..x...x...x...x.', P: 'xxxxxxxxxxxxxxxx' } }
      case BeatStyle.dembow:
        return { a: { K: 'X...X...X...X...', S: '...x..x....x..x.', H: 'x.x.x.x.x.x.x.x.' },
          b: { K: 'X...X...X...X...', S: '...x..x....x..x.', C: '...x..x....x..x.', P: 'x.xxx.xxx.xxx.xx' } }
      case BeatStyle.swing:
        return { a: { O: 'x...x.x.x...x.x.', H: '....x.......x...', K: 'x.......x.......' },
          b: { O: 'x...x.x.x...x.x.', H: '....x.......x...', S: '......g.......g.', K: 'x.........x.....' } }
    }
  }
}

/** Flattened pattern table: [style][variation][step][pad] -> velocity (0 = silent). */
export class BeatTable {
  static readonly variations = 8
  static readonly steps = 16
  static readonly pads = 7

  readonly data: Float32Array

  constructor() {
    const count = BeatStyle.allCases.length * BeatTable.variations * BeatTable.steps * BeatTable.pads
    this.data = new Float32Array(count)
    const empty = '.'.repeat(16)
    for (const style of BeatStyle.allCases) {
      const { a, b } = BeatStyle.basePatterns(style)
      for (let v = 0; v < BeatTable.variations; v++) {
        const rows: Rows = { ...((v % 2 === 0 || v === 7) ? a : b) }
        switch (v) {
          case 2: // busier hats
            if (rows.H !== undefined && style !== BeatStyle.funk) rows.H = rows.H.replace(/\./g, 'g')
            break
          case 3: // ghost snares
            rows.S = BeatTable.overlay(rows.S ?? empty, '......g.......g.')
            break
          case 4: // open hat lift
            rows.O = BeatTable.overlay(rows.O ?? empty, '..............x.')
            break
          case 5: // clap layer
            rows.C = BeatTable.overlay(rows.C ?? empty, '....x.......x...')
            break
          case 6: // syncopated kick
            rows.K = BeatTable.overlay(rows.K ?? empty, '...........x..x.')
            break
          case 7: // fill on the last beat
            rows.S = BeatTable.overlay((rows.S ?? empty).slice(0, 12) + '....', '............xgxX')
            rows.T = '............x.x.'
            break
        }
        for (const key of Object.keys(rows)) {
          const pad = BeatTable.padIndex(key)
          if (pad === null) continue
          const row = rows[key]
          for (let step = 0; step < row.length && step < BeatTable.steps; step++) {
            const ch = row[step]
            let vel: number
            switch (ch) {
              case 'X': vel = 1; break
              case 'x': vel = 0.78; break
              case 'g': vel = 0.32; break
              case 'o': vel = 0.8; break
              default: vel = 0
            }
            if (!(vel > 0)) continue
            // "o" in a hat row means open hat
            const targetPad = ch === 'o' && key === 'H' ? 3 : pad
            this.data[BeatTable.index(style, v, step, targetPad)] = vel
          }
        }
      }
    }
  }

  static overlay(base: string, add: string): string {
    const n = Math.min(base.length, add.length)
    let out = ''
    for (let i = 0; i < n; i++) out += add[i] === '.' ? base[i] : add[i]
    return out
  }

  static padIndex(key: string): number | null {
    const i = 'KSHOCTP'.indexOf(key)
    return i < 0 || key.length !== 1 ? null : i
  }

  static index(style: number, variation: number, step: number, pad: number): number {
    return ((style * BeatTable.variations + variation) * BeatTable.steps + step) * BeatTable.pads + pad
  }

  velocity(style: number, variation: number, step: number, pad: number): number {
    return this.data[BeatTable.index(style, variation, step, pad)]
  }
}
