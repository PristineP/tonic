import { ChordBuilder, copyHarmonySettings, HarmonySettings } from '../theory/harmony'
import { JoyDirection } from '../theory/joystick'
import { Scale } from '../theory/music'

export enum EarLevel { notes, intervals, triads, sevenths, inversions, altered }

export namespace EarLevel {
  export const allCases: EarLevel[] = [0, 1, 2, 3, 4, 5]
  export function displayName(l: EarLevel): string {
    return ['LV1 NOTES', 'LV2 INTERV', 'LV3 CHORDS', 'LV4 7THS', 'LV5 INVERT', 'LV6 COLOR'][l]
  }
}

export interface EarQuestion {
  /** The degree (0-6) that answers the question. */
  answer: number
  /** Notes to play as the reference (tonic). */
  reference: number[]
  /** Notes to play as the question. */
  prompt: number[]
  /** Whether `prompt` should be played one note at a time. */
  melodic: boolean
}

const MASK64 = (1n << 64n) - 1n

/** Ear-training game: Tonic plays the key's tonic for reference, then a mystery
 *  note or chord; the player answers with the matching chord button. */
export class EarTrainer {
  level: EarLevel = EarLevel.notes
  private _score = 0
  private _attempts = 0
  private _streak = 0
  private _current: EarQuestion | null = null
  private rng: bigint

  constructor(seed: number | bigint = Date.now()) {
    this.rng = (BigInt.asUintN(64, BigInt(seed)) | 1n) & MASK64
  }

  get score(): number { return this._score }
  get attempts(): number { return this._attempts }
  get streak(): number { return this._streak }
  get current(): EarQuestion | null { return this._current }

  /** Value copy (Swift struct semantics). */
  clone(): EarTrainer {
    const t = new EarTrainer(1)
    t.level = this.level
    t._score = this._score
    t._attempts = this._attempts
    t._streak = this._streak
    t._current = this._current
    t.rng = this.rng
    return t
  }

  private random(n: number): number {
    let r = this.rng
    r ^= (r << 13n) & MASK64
    r ^= r >> 7n
    r ^= (r << 17n) & MASK64
    this.rng = r
    return Number(r % BigInt(Math.max(n, 1)))
  }

  next(settings: HarmonySettings): EarQuestion {
    let degree = this.random(7)
    const previous = this._current?.answer
    if (previous !== undefined && degree === previous) degree = (degree + 1 + this.random(6)) % 7
    const s = copyHarmonySettings(settings)
    s.voiceLeading = false
    s.bassMode = 0
    s.octave = 0
    s.buttonOctaves = [0, 0, 0, 0, 0, 0, 0]
    s.inversion = 0
    const tonic = ChordBuilder.voicing(ChordBuilder.diatonic(0, s), 0, s).notes
    const keyRoot = 60 + s.key - (s.key > 6 ? 12 : 0)
    let q: EarQuestion
    switch (this.level) {
      case EarLevel.notes: {
        const note = keyRoot + Scale.chordParent(s.scale)[degree]
        q = { answer: degree, reference: tonic, prompt: [note], melodic: false }
        break
      }
      case EarLevel.intervals: {
        const note = keyRoot + Scale.chordParent(s.scale)[degree]
        q = { answer: degree, reference: [keyRoot], prompt: [keyRoot, note], melodic: true }
        break
      }
      case EarLevel.triads: {
        const v = ChordBuilder.voicing(ChordBuilder.diatonic(degree, s), degree, s)
        q = { answer: degree, reference: tonic, prompt: v.notes, melodic: false }
        break
      }
      case EarLevel.sevenths: {
        const spec = ChordBuilder.chord(degree, JoyDirection.right, s)
        const v = ChordBuilder.voicing(spec, degree, s)
        q = { answer: degree, reference: tonic, prompt: v.notes, melodic: false }
        break
      }
      case EarLevel.inversions: {
        const v = ChordBuilder.voicing(ChordBuilder.diatonic(degree, s), degree, s, null, 1 + this.random(2))
        q = { answer: degree, reference: tonic, prompt: v.notes, melodic: false }
        break
      }
      case EarLevel.altered: {
        const dirs = [JoyDirection.upRight, JoyDirection.right, JoyDirection.downRight, JoyDirection.down, JoyDirection.downLeft]
        const spec = ChordBuilder.chord(degree, dirs[this.random(dirs.length)], s)
        const v = ChordBuilder.voicing(spec, degree, s)
        q = { answer: degree, reference: tonic, prompt: v.notes, melodic: false }
        break
      }
    }
    this._current = q
    return q
  }

  /** Returns whether the answer was correct. A wrong answer keeps the question. */
  answer(degree: number): boolean {
    const q = this._current
    if (q === null) return false
    this._attempts += 1
    if (degree === q.answer) {
      this._score += 1
      this._streak += 1
      return true
    }
    this._streak = 0
    return false
  }

  reset(): void {
    this._score = 0
    this._attempts = 0
    this._streak = 0
    this._current = null
  }
}

export namespace EarTrainer {
  export const Level = EarLevel
  export type Level = EarLevel
  export type Question = EarQuestion
}
