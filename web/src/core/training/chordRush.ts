import { BeatStyle } from '../dsp/drums'

export interface ChordRushSong {
  readonly name: string
  /** Scale degrees (0-6), one per bar. */
  readonly degrees: number[]
  readonly style: BeatStyle
}

export enum Judgement { perfect, good, miss }

export namespace Judgement {
  export function points(j: Judgement): number {
    return j === Judgement.perfect ? 100 : j === Judgement.good ? 50 : 0
  }
  export function label(j: Judgement): string {
    return j === Judgement.perfect ? 'PERFECT' : j === Judgement.good ? 'GOOD' : 'MISS'
  }
}

export enum RushPhase { idle, waiting, playing, done }

/** Chord Rush: a rhythm game. Chords scroll toward a hit line in time with a backing beat;
 *  press the matching chord key on the downbeat. */
export class ChordRush {
  static readonly songs: ChordRushSong[] = [
    { name: 'POP 1-5-6-4', degrees: [0, 4, 5, 3, 0, 4, 5, 3], style: BeatStyle.rock },
    { name: 'DOO-WOP', degrees: [0, 5, 3, 4, 0, 5, 3, 4], style: BeatStyle.swing },
    { name: 'CANON', degrees: [0, 4, 5, 2, 3, 0, 3, 4], style: BeatStyle.breakbeat },
    { name: 'JAZZ 2-5-1', degrees: [1, 4, 0, 0, 1, 4, 0, 5], style: BeatStyle.swing },
    { name: 'EPIC 6-4-1-5', degrees: [5, 3, 0, 4, 5, 3, 0, 4], style: BeatStyle.house },
    { name: '12 BAR BLUES', degrees: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], style: BeatStyle.funk },
  ]

  /** Beats per chord. */
  static readonly beatsPerChord = 4
  static readonly perfectWindow = 0.15
  static readonly goodWindow = 0.4

  songIndex = 0
  private _phase: RushPhase = RushPhase.idle
  private _startBeat = 0
  private _results: (Judgement | null)[] = []
  private _score = 0
  private _combo = 0
  private _bestCombo = 0
  private _lastJudgement: Judgement | null = null

  get phase(): RushPhase { return this._phase }
  get startBeat(): number { return this._startBeat }
  get results(): readonly (Judgement | null)[] { return this._results }
  get score(): number { return this._score }
  get combo(): number { return this._combo }
  get bestCombo(): number { return this._bestCombo }
  get lastJudgement(): Judgement | null { return this._lastJudgement }

  /** Value copy (Swift struct semantics). */
  clone(): ChordRush {
    const g = new ChordRush()
    g.songIndex = this.songIndex
    g._phase = this._phase
    g._startBeat = this._startBeat
    g._results = this._results.slice()
    g._score = this._score
    g._combo = this._combo
    g._bestCombo = this._bestCombo
    g._lastJudgement = this._lastJudgement
    return g
  }

  get song(): ChordRushSong {
    return ChordRush.songs[this.songIndex % ChordRush.songs.length]
  }

  targetBeat(i: number): number {
    return this._startBeat + i * ChordRush.beatsPerChord
  }

  /** Arms the game; call `begin(beat)` once the backing beat is running. */
  arm(): void {
    this._phase = RushPhase.waiting
    this._results = new Array(this.song.degrees.length).fill(null)
    this._score = 0
    this._combo = 0
    this._bestCombo = 0
    this._lastJudgement = null
  }

  /** Starts the song with one bar of lead-in after `beat`. */
  begin(beat: number): void {
    if (this._phase !== RushPhase.waiting) return
    this._startBeat = (Math.floor(beat / ChordRush.beatsPerChord) + 2) * ChordRush.beatsPerChord
    this._phase = RushPhase.playing
  }

  stop(): void { this._phase = RushPhase.idle }

  /** Judges a key press. Returns null when the press is not near any chord. */
  press(degree: number, beat: number): Judgement | null {
    if (this._phase !== RushPhase.playing) return null
    const i = swiftRound((beat - this._startBeat) / ChordRush.beatsPerChord)
    if (!(i >= 0 && i < this._results.length) || this._results[i] !== null) return null
    const dt = Math.abs(beat - this.targetBeat(i))
    if (!(dt <= ChordRush.goodWindow)) return null
    const j = degree !== this.song.degrees[i] ? Judgement.miss : dt <= ChordRush.perfectWindow ? Judgement.perfect : Judgement.good
    this.record(i, j)
    return j
  }

  /** Marks chords that passed without a press as misses and ends the song. Returns new misses. */
  advance(beat: number): number {
    if (this._phase !== RushPhase.playing) return 0
    let missed = 0
    for (let i = 0; i < this._results.length; i++) {
      if (this._results[i] === null && beat > this.targetBeat(i) + ChordRush.goodWindow) {
        this.record(i, Judgement.miss)
        missed += 1
      }
    }
    if (beat > this.targetBeat(this._results.length - 1) + ChordRush.beatsPerChord * 0.5) this._phase = RushPhase.done
    return missed
  }

  private record(i: number, j: Judgement): void {
    this._results[i] = j
    this._lastJudgement = j
    this._score += Judgement.points(j) + (j === Judgement.miss ? 0 : Math.min(this._combo, 10) * 5)
    this._combo = j === Judgement.miss ? 0 : this._combo + 1
    this._bestCombo = Math.max(this._bestCombo, this._combo)
  }

  get maxScore(): number {
    const n = this.song.degrees.length
    let total = 0
    for (let i = 0; i < n; i++) total += 100 + Math.min(i, 10) * 5
    return total
  }

  get grade(): string {
    const max = this.maxScore
    const pct = max > 0 ? this._score / max : 0
    if (pct >= 0.95) return 'S'
    if (pct >= 0.85) return 'A'
    if (pct >= 0.7) return 'B'
    if (pct >= 0.5) return 'C'
    return 'D'
  }
}

/** Swift `.rounded()`: half away from zero. */
function swiftRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

export namespace ChordRush {
  export type Song = ChordRushSong
  export const Phase = RushPhase
  export type Phase = RushPhase
}
