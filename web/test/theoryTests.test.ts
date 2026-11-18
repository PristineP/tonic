import { describe, expect, it } from 'vitest'
import { ChordType } from '../src/core/theory/chordType'
import { BassMode, ChordBuilder, ChordSpec, chordSpec, defaultHarmonySettings, HarmonySettings, Voicing } from '../src/core/theory/harmony'
import { JoyDirection, JoystickMap } from '../src/core/theory/joystick'
import { mod12, Scale } from '../src/core/theory/music'
import { EarLevel, EarTrainer } from '../src/core/training/earTrainer'
import { noteSet } from '../src/core/dsp/engineTypes'

/** NoteSet capacity (Swift NoteSet.capacity). */
const NOTESET_CAPACITY = 8

function names(settings: HarmonySettings, dir: JoyDirection = JoyDirection.center): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) =>
    ChordSpec.name(ChordBuilder.chord(d, dir, settings), HarmonySettings.prefersFlats(settings)),
  )
}

describe('TheoryTests', () => {
  it('C major diatonic chords', () => {
    expect(names(defaultHarmonySettings())).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
  })

  it('A minor and modes', () => {
    const s = defaultHarmonySettings()
    s.key = 9
    s.scale = Scale.minor
    expect(names(s)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'])
    s.scale = Scale.harmonicMinor
    expect(names(s)).toEqual(['Am', 'Bdim', 'Caug', 'Dm', 'E', 'F', 'G#dim'])
    s.key = 2
    s.scale = Scale.dorian
    expect(names(s)).toEqual(['Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C'])
    s.key = 7
    s.scale = Scale.mixolydian
    expect(names(s)).toEqual(['G', 'Am', 'Bdim', 'C', 'Dm', 'Em', 'F'])
    s.key = 5
    s.scale = Scale.lydian
    expect(names(s)).toEqual(['F', 'G', 'Am', 'Bdim', 'C', 'Dm', 'Em'])
  })

  it('flat keys spell with flats', () => {
    const s = defaultHarmonySettings()
    s.key = 10 // Bb major
    expect(names(s)).toEqual(['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim'])
    s.key = 0
    s.scale = Scale.minor // C minor: relative major Eb
    expect(names(s)).toEqual(['Cm', 'Ddim', 'Eb', 'Fm', 'Gm', 'Ab', 'Bb'])
    s.key = 4 // E major
    s.scale = Scale.major
    expect(names(s)).toEqual(['E', 'F#m', 'G#m', 'A', 'B', 'C#m', 'D#dim'])
  })

  it('pentatonic and blues borrow parent chords', () => {
    const s = defaultHarmonySettings()
    s.scale = Scale.majorPentatonic
    expect(names(s)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
    s.scale = Scale.blues
    expect(names(s)).toEqual(['C7', 'Dm', 'Edim', 'F7', 'G7', 'Am', 'Bb'])
  })

  it('default joystick map', () => {
    const s = defaultHarmonySettings()
    expect(names(s, JoyDirection.up)).toEqual(['Cm', 'D', 'E', 'Fm', 'Gm', 'A', 'B'])
    expect(names(s, JoyDirection.upRight)).toEqual(['C7', 'D7', 'E7', 'F7', 'G7', 'A7', 'B7'])
    expect(names(s, JoyDirection.right)).toEqual(['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'Gmaj7', 'Am7', 'Bm7b5'])
    expect(names(s, JoyDirection.down)[0]).toBe('Csus4')
    expect(names(s, JoyDirection.downLeft)[0]).toBe('C6')
    expect(names(s, JoyDirection.downLeft)[1]).toBe('Dsus2')
    expect(names(s, JoyDirection.left)[6]).toBe('Bm')
    expect(names(s, JoyDirection.upLeft)[0]).toBe('Caug')
  })

  it('borrow map', () => {
    const s = defaultHarmonySettings()
    s.joystickMap = JoystickMap.borrow
    const n = (deg: number, dir: JoyDirection, flats: boolean) => ChordSpec.name(ChordBuilder.chord(deg, dir, s), flats)
    // V7 of each degree
    expect(n(1, JoyDirection.up, false)).toBe('A7')
    // Tritone sub of G
    expect(n(4, JoyDirection.down, true)).toBe('Db7')
    // Parallel minor iv
    expect(n(3, JoyDirection.upRight, true)).toBe('Fm')
    // Backdoor bVII7 of C
    expect(n(0, JoyDirection.downLeft, true)).toBe('Bb7')
    // Flat-side majors: bII, bIII, bVI, bVII
    expect(n(1, JoyDirection.right, true)).toBe('Db')
    expect(n(2, JoyDirection.right, true)).toBe('Eb')
    expect(n(5, JoyDirection.right, true)).toBe('Ab')
    expect(n(6, JoyDirection.right, true)).toBe('Bb')
  })

  it('chromatic shift', () => {
    const s = defaultHarmonySettings()
    s.joystickMap = JoystickMap.chromatic
    expect(ChordSpec.name(ChordBuilder.chord(1, JoyDirection.up, s), true)).toBe('Ebm')
    expect(ChordSpec.name(ChordBuilder.chord(0, JoyDirection.down, s), false)).toBe('B')
  })

  it('voicing root position and inversions', () => {
    const s = defaultHarmonySettings()
    const c = ChordBuilder.diatonic(0, s)
    expect(ChordBuilder.voicing(c, 0, s).notes).toEqual([48, 52, 55])
    s.inversion = 1
    expect(ChordBuilder.voicing(c, 0, s).notes).toEqual([52, 55, 60])
    s.inversion = 2
    expect(ChordBuilder.voicing(c, 0, s).notes).toEqual([55, 60, 64])
    s.inversion = 0
    s.octave = 1
    expect(ChordBuilder.voicing(c, 0, s).notes).toEqual([60, 64, 67])
    s.octave = 0
    s.buttonOctaves[0] = -1
    expect(ChordBuilder.voicing(c, 0, s).notes).toEqual([36, 40, 43])
  })

  it('bass modes', () => {
    const s = defaultHarmonySettings()
    s.bassMode = BassMode.root
    const g = ChordBuilder.diatonic(4, s)
    const v = ChordBuilder.voicing(g, 4, s)
    expect(v.notes).toEqual([55, 59, 62])
    expect(v.bass === null ? null : mod12(v.bass)).toBe(7)
    expect(v.bass!).toBeLessThan(55 - 11)
    // Slash chords keep the requested bass.
    const slash = chordSpec(0, ChordType.major, 4)
    expect(ChordSpec.name(slash, false)).toBe('C/E')
    const sv = ChordBuilder.voicing(slash, 0, s)
    expect(sv.bass === null ? null : mod12(sv.bass)).toBe(4)
  })

  it('voice leading stays close', () => {
    const s = defaultHarmonySettings()
    s.voiceLeading = true
    const c = ChordBuilder.voicing(ChordBuilder.diatonic(0, s), 0, s)
    const f = ChordBuilder.voicing(ChordBuilder.diatonic(3, s), 3, s, c.notes)
    const b = ChordBuilder.voicing(ChordBuilder.diatonic(6, s), 6, s, f.notes)
    const centroid = (n: number[]) => n.reduce((a, x) => a + x, 0) / n.length
    expect(Math.abs(centroid(f.notes) - centroid(c.notes))).toBeLessThan(4)
    expect(Math.abs(centroid(b.notes) - centroid(f.notes))).toBeLessThan(4)
    expect(new Set(f.notes.map(mod12))).toEqual(new Set([5, 9, 0]))
  })

  it('all chord types have unique suffixes and fit polyphony', () => {
    const suffixes = ChordType.allCases.map(ChordType.suffix)
    expect(new Set(suffixes).size).toBe(suffixes.length)
    for (const t of ChordType.allCases) {
      expect(ChordType.intervals(t).length).toBeLessThanOrEqual(6)
      expect(ChordType.intervals(t)[0]).toBe(0)
    }
  })

  it('every combination produces playable notes', () => {
    const s = defaultHarmonySettings()
    for (const map of JoystickMap.allCases) {
      s.joystickMap = map
      for (const scale of Scale.allCases) {
        s.scale = scale
        for (let key = 0; key < 12; key++) {
          s.key = key
          for (let degree = 0; degree < 7; degree++) {
            for (const dir of JoyDirection.allCases) {
              const spec = ChordBuilder.chord(degree, dir, s)
              const v = ChordBuilder.voicing(spec, degree, s)
              const all = Voicing.allNotes(v)
              if (v.notes.length === 0 || all.length > NOTESET_CAPACITY || !all.every((n) => n >= 0 && n <= 127)) {
                throw new Error(`bad voicing map=${map} scale=${scale} key=${key} degree=${degree} dir=${dir}: ${all}`)
              }
            }
          }
        }
      }
    }
  })

  it('joystick direction from vector', () => {
    expect(JoyDirection.from(0, 1)).toBe(JoyDirection.up)
    expect(JoyDirection.from(1, 0)).toBe(JoyDirection.right)
    expect(JoyDirection.from(-0.7, -0.7)).toBe(JoyDirection.downLeft)
    expect(JoyDirection.from(0.1, 0.1)).toBe(JoyDirection.center)
    expect(JoyDirection.from(-1, 0.05)).toBe(JoyDirection.left)
  })

  it('lead offsets', () => {
    const r = [0, 1, 2, 3, 4, 5, 6]
    expect(r.map((b) => Scale.leadOffset(Scale.major, b))).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(r.map((b) => Scale.leadOffset(Scale.minorPentatonic, b))).toEqual([0, 3, 5, 7, 10, 12, 15])
  })

  it('note set', () => {
    let n = noteSet([60, 64, 67])
    expect(n.length).toBe(3)
    expect(n[1]).toBe(64)
    for (let i = 0; i < 10; i++) n = noteSet([...n, 70 + i])
    expect(n.length).toBe(NOTESET_CAPACITY)
    expect(noteSet([67, 60]).slice().sort((a, b) => a - b)).toEqual([60, 67])
  })

  it('ear trainer', () => {
    const t = new EarTrainer(42)
    const s = defaultHarmonySettings()
    for (const level of EarLevel.allCases) {
      t.level = level
      for (let i = 0; i < 20; i++) {
        const q = t.next(s)
        expect(q.answer >= 0 && q.answer < 7).toBe(true)
        expect(q.prompt.length).toBeGreaterThan(0)
        expect(t.answer((q.answer + 1) % 7)).toBe(false)
        expect(t.answer(q.answer)).toBe(true)
      }
    }
    expect(t.score).toBe(120)
  })
})
