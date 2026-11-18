import { describe, expect, it } from 'vitest'
import { ChordRush, Judgement, RushPhase } from '../src/core/training/chordRush'

describe('ChordRushTests', () => {
  it('perfect run scores max and grade S', () => {
    const g = new ChordRush()
    g.songIndex = 0
    g.arm()
    g.begin(0.3)
    expect(g.startBeat).toBe(8)
    g.song.degrees.forEach((d, i) => {
      expect(g.press(d, g.targetBeat(i) + 0.05)).toBe(Judgement.perfect)
      g.advance(g.targetBeat(i) + 1)
    })
    g.advance(g.targetBeat(g.song.degrees.length - 1) + 4)
    expect(g.phase).toBe(RushPhase.done)
    expect(g.score).toBe(g.maxScore)
    expect(g.grade).toBe('S')
    expect(g.bestCombo).toBe(g.song.degrees.length)
  })

  it('timing windows, wrong keys and misses', () => {
    const g = new ChordRush()
    g.arm()
    g.begin(0)
    const d0 = g.song.degrees[0]
    expect(g.press(d0, g.targetBeat(0) - 1.5)).toBeNull() // far too early: ignored
    expect(g.press(d0, g.targetBeat(0) + 0.3)).toBe(Judgement.good)
    expect(g.press(d0, g.targetBeat(0) + 0.31)).toBeNull() // already judged
    expect(g.press((g.song.degrees[1] + 1) % 7, g.targetBeat(1))).toBe(Judgement.miss)
    expect(g.combo).toBe(0)
    // Chord 2 passes untouched.
    expect(g.advance(g.targetBeat(2) + 0.5)).toBe(1)
    expect(g.results[2]).toBe(Judgement.miss)
    expect(g.score).toBe(50)
  })

  it('all songs are valid', () => {
    for (const s of ChordRush.songs) {
      expect(s.degrees.length).toBeGreaterThan(0)
      expect(s.degrees.every((d) => d >= 0 && d < 7)).toBe(true)
    }
  })
})
