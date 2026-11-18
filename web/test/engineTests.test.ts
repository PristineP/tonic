import { describe, expect, it } from 'vitest'
import { Engine } from '../src/core/dsp/engine'
import {
  ArpPattern, MIDIMessage, NoteRate, PerformStyle, TrackState, noteSet, trackState,
} from '../src/core/dsp/engineTypes'
import { BeatStyle, DrumKit } from '../src/core/dsp/drums'
import { DelayTime, DriveType, LofiType, ModType, ReverbType, TremoloRate, defaultFXParams } from '../src/core/dsp/effects'
import { SoundLibrary, WaveType } from '../src/core/dsp/synthParams'
import { defaultVocoderParams } from '../src/core/dsp/vocoder'
import { PitchDetector } from '../src/core/analysis/pitchDetector'

const sr = 48000

/** Renders `seconds` of audio and returns [left, right]. */
function renderLR(engine: Engine, seconds: number): [Float32Array, Float32Array] {
  const total = Math.trunc(seconds * sr)
  const l = new Float32Array(total)
  const r = new Float32Array(total)
  const block = 256
  const bl = new Float32Array(block)
  const br = new Float32Array(block)
  let offset = 0
  while (offset < total) {
    const n = Math.min(block, total - offset)
    engine.render(bl, br, n)
    l.set(bl.subarray(0, n), offset)
    r.set(br.subarray(0, n), offset)
    offset += n
  }
  return [l, r]
}

function render(engine: Engine, seconds: number): Float32Array {
  return renderLR(engine, seconds)[0]
}

function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  if (to <= from) return 0
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / (to - from))
}

function maxAbs(x: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

function assertClean(x: Float32Array, label = '') {
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) throw new Error(`non-finite samples ${label}`)
  }
  expect(maxAbs(x), `output exceeds full scale ${label}`).toBeLessThanOrEqual(1.0)
}

function drainMIDI(engine: Engine): MIDIMessage[] {
  return engine.drainMidi()
}

function dryEngine(): Engine {
  const e = new Engine(sr)
  const fx = defaultFXParams()
  fx.reverb = ReverbType.off
  e.send({ type: 'fx', params: fx })
  return e
}

describe('Engine', () => {
  it('is silent at start', () => {
    const e = new Engine(sr)
    const out = render(e, 0.2)
    expect(maxAbs(out)).toBe(0)
  })

  it('chord press and release', () => {
    const e = new Engine(sr)
    e.send({ type: 'press', id: 0, notes: noteSet([48, 52, 55]), velocity: 0.8 })
    const held = render(e, 0.5)
    assertClean(held)
    expect(rms(held, 12000)).toBeGreaterThan(0.01)
    e.send({ type: 'release', id: 0 })
    const after = render(e, 3)
    assertClean(after)
    expect(rms(after, after.length - 4800)).toBeLessThan(0.002)
    expect(e.status.activeVoices).toBe(0)
  })

  it('every factory preset is audible and in tune', () => {
    for (const preset of SoundLibrary.factory) {
      const e = dryEngine()
      e.send({ type: 'patch', params: preset.params })
      e.send({ type: 'press', id: 0, notes: noteSet([57]), velocity: 0.9 }) // A3 = 220 Hz
      const out = render(e, 0.6)
      assertClean(out, preset.name)
      const level = rms(out, 4800)
      expect(level, `${preset.name} too quiet`).toBeGreaterThan(0.003)
      expect(level, `${preset.name} too loud`).toBeLessThan(0.7)
      if (preset.params.wave !== WaveType.noise) {
        const expected = 220.0 * Math.pow(2, preset.params.octave)
        const detector = new PitchDetector(sr, 40, 1000)
        const window = Array.from(out.subarray(19200, 19200 + 4096))
        const result = detector.detect(window)
        expect(result, `${preset.name}: no pitch detected`).not.toBeNull()
        if (result) {
          // Allow octave errors for timbres with strong harmonics, but the pitch class must match.
          const semis = 12 * Math.log2(result.frequency / expected)
          const wrapped = semis - 12 * Math.round(semis / 12)
          expect(Math.abs(wrapped), `${preset.name} out of tune: ${result.frequency} Hz`).toBeLessThan(0.35)
        }
      }
    }
  })

  it('drum kits and beat patterns', () => {
    for (const kit of DrumKit.allCases) {
      const e = dryEngine()
      e.send({ type: 'kit', kit })
      for (let pad = 0; pad < 7; pad++) {
        e.send({ type: 'drum', pad, velocity: 1 })
        const out = render(e, 0.25)
        assertClean(out)
        expect(maxAbs(out), `${DrumKit.displayName(kit)} pad ${pad} silent`).toBeGreaterThan(0.02)
      }
    }
    for (const style of BeatStyle.allCases) {
      for (let v = 0; v < 8; v++) {
        const e = dryEngine()
        e.send({ type: 'tempo', bpm: 120 })
        e.send({ type: 'beat', style, variation: v, on: true })
        const out = render(e, 2.1) // > 1 bar at 120 BPM
        assertClean(out)
        expect(rms(out), `${style} v${v} silent`).toBeGreaterThan(0.005)
        const hits = drainMIDI(e).filter(m => m.status === 0x99)
        expect(hits.length, `${style} v${v}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('arpeggiator timing', () => {
    const e = dryEngine()
    e.send({ type: 'tempo', bpm: 120 })
    e.send({ type: 'style', style: PerformStyle.arp })
    e.send({ type: 'arp', pattern: ArpPattern.up, rate: NoteRate.sixteenth, latch: false })
    e.send({ type: 'press', id: 2, notes: noteSet([60, 64, 67]), velocity: 0.8 })
    render(e, 2.0)
    const ons = drainMIDI(e).filter(m => (m.status & 0xf0) === 0x90)
    // 120 BPM, 1/16 → 8 notes per second → 16 in 2 s (±1 for edges)
    expect(ons.length).toBeGreaterThanOrEqual(15)
    expect(ons.length).toBeLessThanOrEqual(17)
    expect(ons.slice(0, 4).map(m => m.data1)).toEqual([60, 64, 67, 60])
    e.send({ type: 'release', id: 2 })
    render(e, 0.5)
    expect(drainMIDI(e).filter(m => (m.status & 0xf0) === 0x90)).toEqual([])
  })

  it('every note-on gets a note-off', () => {
    const e = dryEngine()
    e.send({ type: 'tempo', bpm: 140 })
    for (const style of [PerformStyle.chord, PerformStyle.strum, PerformStyle.arp, PerformStyle.repeatGate, PerformStyle.drone]) {
      e.send({ type: 'style', style })
      e.send({ type: 'press', id: 1, notes: noteSet([60, 63, 67]), velocity: 0.8 })
      render(e, 0.4)
      e.send({ type: 'press', id: 3, notes: noteSet([65, 69, 72]), velocity: 0.8 })
      render(e, 0.3)
      e.send({ type: 'release', id: 1 })
      e.send({ type: 'release', id: 3 })
      render(e, 0.3)
    }
    e.send({ type: 'style', style: PerformStyle.chord }) // ends the drone
    render(e, 1)
    const balance = new Map<number, number>()
    for (const m of drainMIDI(e)) {
      const kind = m.status & 0xf0
      if (kind !== 0x90 && kind !== 0x80) continue
      const key = (m.status & 0x0f) * 128 + m.data1
      balance.set(key, (balance.get(key) ?? 0) + (kind === 0x90 ? 1 : -1))
    }
    const unbalanced = [...balance].filter(([, v]) => v !== 0)
    expect(unbalanced).toEqual([])
  })

  it('looper bar mode records and plays back', () => {
    const e = dryEngine()
    e.send({ type: 'tempo', bpm: 120 }) // 1 bar = 2 s
    e.send({ type: 'loopBars', bars: 1 })
    e.send({ type: 'loopRecord', track: 0 })
    render(e, 0.1)
    expect(trackState(e.status, 0)).toBe(TrackState.armed)
    expect(e.status.countIn).toBeGreaterThan(3)
    render(e, 2.0) // count-in
    expect(trackState(e.status, 0)).toBe(TrackState.recording)
    e.send({ type: 'press', id: 0, notes: noteSet([60, 64, 67]), velocity: 0.8 })
    render(e, 0.5)
    e.send({ type: 'release', id: 0 })
    render(e, 1.6) // finish the bar
    expect(trackState(e.status, 0)).toBe(TrackState.playing)
    expect(e.status.loopLength).toBeCloseTo(4, 3)
    drainMIDI(e)
    // Next cycle: the loop should replay the chord on channel 1 without any live input.
    const playback = render(e, 2.0)
    assertClean(playback)
    expect(rms(playback)).toBeGreaterThan(0.005)
    const ons = drainMIDI(e).filter(m => m.status === 0x90)
    expect(new Set(ons.map(m => m.data1))).toEqual(new Set([60, 64, 67]))

    // Overdub on track 2 (MIDI channel 2)
    e.send({ type: 'loopRecord', track: 1 })
    render(e, 0.05)
    expect(trackState(e.status, 1)).toBe(TrackState.recording)
    e.send({ type: 'press', id: 4, notes: noteSet([72]), velocity: 0.8 })
    render(e, 0.3)
    e.send({ type: 'release', id: 4 })
    render(e, 2.0)
    expect(trackState(e.status, 1)).toBe(TrackState.playing)
    drainMIDI(e)
    render(e, 2.0)
    const msgs = drainMIDI(e)
    expect(msgs.some(m => m.status === 0x91 && m.data1 === 72)).toBe(true)

    // Mute and clear
    e.send({ type: 'loopMute', track: 0, muted: true })
    render(e, 0.05)
    expect(trackState(e.status, 0)).toBe(TrackState.muted)
    e.send({ type: 'loopClear', track: -1 })
    render(e, 0.05)
    expect(trackState(e.status, 0)).toBe(TrackState.empty)
    expect(e.status.loopLength).toBe(0)
  })

  it('looper free mode starts on first note', () => {
    const e = dryEngine()
    e.send({ type: 'tempo', bpm: 120 })
    e.send({ type: 'loopBars', bars: 0 })
    e.send({ type: 'loopRecord', track: 0 })
    render(e, 1.0)
    expect(trackState(e.status, 0)).toBe(TrackState.armed)
    e.send({ type: 'press', id: 0, notes: noteSet([55]), velocity: 0.8 })
    render(e, 0.2)
    expect(trackState(e.status, 0)).toBe(TrackState.recording)
    e.send({ type: 'release', id: 0 })
    render(e, 1.3) // ~1.5 s = 3 beats
    e.send({ type: 'loopRecord', track: 0 })
    render(e, 0.05)
    expect(trackState(e.status, 0)).toBe(TrackState.playing)
    expect(e.status.loopLength).toBeCloseTo(3, 3)
  })

  it('sequencer plays steps', () => {
    const e = dryEngine()
    e.send({ type: 'tempo', bpm: 120 })
    e.send({ type: 'seqStep', index: 0, notes: noteSet([60, 64, 67]) })
    e.send({ type: 'seqStep', index: 1, notes: noteSet([65, 69, 72]) })
    e.send({ type: 'seqLength', length: 2 })
    e.send({ type: 'seqStepBeats', beats: 1 })
    e.send({ type: 'seqPlay', on: true })
    render(e, 1.95) // 4 steps
    const ons = drainMIDI(e).filter(m => (m.status & 0xf0) === 0x90).map(m => m.data1)
    expect(ons).toEqual([60, 64, 67, 65, 69, 72, 60, 64, 67, 65, 69, 72])
    e.send({ type: 'seqPlay', on: false })
    render(e, 0.5)
    expect(e.status.seqPlaying).toBe(false)
  })

  it('all effects stay finite', () => {
    for (const reverb of ReverbType.allCases) {
      for (const mod of ModType.allCases) {
        for (const drive of DriveType.allCases) {
          const e = new Engine(sr)
          const fx = defaultFXParams()
          fx.reverb = reverb
          fx.mod = mod
          fx.drive = drive
          fx.delay = DelayTime.dottedEighth
          fx.tremolo = TremoloRate.eighth
          fx.lofi = ((reverb + mod) % 4) as LofiType
          e.send({ type: 'fx', params: fx })
          e.send({ type: 'press', id: 0, notes: noteSet([48, 55, 64, 71]), velocity: 1 })
          const out = render(e, 0.3)
          assertClean(out, `${reverb}/${mod}/${drive}`)
          expect(rms(out)).toBeGreaterThan(0.001)
        }
      }
    }
  })

  it('sample playback pitch', () => {
    const e = dryEngine()
    // A 220 Hz recorded tone used as a sample rooted at A3.
    const buf = e.sampleBuffer(0)
    const len = 48000
    for (let i = 0; i < len; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
    e.send({ type: 'useSample', slot: 0, length: len, sourceRate: 48000, rootNote: 57 })
    e.send({ type: 'patch', params: SoundLibrary.samplePreset().params })
    e.send({ type: 'press', id: 0, notes: noteSet([69]), velocity: 1 }) // an octave up
    const out = render(e, 0.3)
    const r = new PitchDetector(sr).detect(Array.from(out.subarray(4800, 9000)))
    expect(r).not.toBeNull()
    expect(Math.abs((r?.frequency ?? 0) - 440)).toBeLessThanOrEqual(3)
  })

  it('pitch detector', () => {
    const d = new PitchDetector(sr)
    for (const f of [82.41, 110.0, 196.0, 329.63, 440.0, 987.77]) {
      const x: number[] = new Array(4096)
      for (let i = 0; i < x.length; i++) {
        const t = i / sr
        x[i] = Math.fround(0.6 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t))
      }
      const r = d.detect(x)
      expect(r).not.toBeNull()
      expect(Math.abs((r?.frequency ?? 0) - f)).toBeLessThanOrEqual(f * 0.004)
    }
    expect(d.detect(new Array(4096).fill(0))).toBeNull()
  })

  it('vocoder follows modulator', () => {
    const e = dryEngine()
    const saw = { ...SoundLibrary.factory[0].params }
    saw.release = 0.05
    e.send({ type: 'patch', params: saw })
    e.send({ type: 'vocoder', on: true, params: defaultVocoderParams() })
    e.send({ type: 'press', id: 0, notes: noteSet([48, 55, 60, 64]), velocity: 0.9 })
    // Silent modulator: the gate keeps the vocoder (and the carrier) quiet.
    const silent = render(e, 0.4)
    assertClean(silent)
    expect(rms(silent, 9600)).toBeLessThan(0.002)
    // A buzzy "voice": 140 Hz with vowel-ish partials.
    const voice = new Float32Array(48000)
    for (let i = 0; i < voice.length; i++) {
      const t = i / sr
      voice[i] = 0.5 * Math.sin(2 * Math.PI * 140 * t) + 0.3 * Math.sin(2 * Math.PI * 700 * t) + 0.2 * Math.sin(2 * Math.PI * 1200 * t)
    }
    const spoken: number[] = []
    let offset = 0
    while (offset < voice.length) {
      const n = Math.min(1024, voice.length - offset)
      e.pushModulator(voice.subarray(offset, offset + n), n)
      const chunk = render(e, n / sr)
      for (const s of chunk) spoken.push(s)
      offset += n
    }
    assertClean(Float32Array.from(spoken))
    expect(rms(spoken, 12000)).toBeGreaterThan(0.01)
    // Turning the vocoder off returns the plain carrier.
    e.send({ type: 'vocoder', on: false, params: defaultVocoderParams() })
    const plain = render(e, 0.3)
    expect(rms(plain, 4800)).toBeGreaterThan(0.01)
  })

  it('realtime performance', () => {
    // 24 sustained voices of the heaviest patch plus effects should render far faster than real time.
    const e = new Engine(sr)
    const fx = defaultFXParams()
    fx.reverb = ReverbType.hall; fx.delay = DelayTime.eighth; fx.mod = ModType.chorus; fx.drive = DriveType.tube
    e.send({ type: 'fx', params: fx })
    e.send({ type: 'patch', params: SoundLibrary.factory.find(p => p.name === 'ORGAN')!.params })
    for (let id = 0; id < 6; id++) {
      e.send({ type: 'press', id, notes: noteSet([48 + id, 52 + id, 55 + id, 59 + id]), velocity: 0.8 })
    }
    e.send({ type: 'beat', style: 3, variation: 1, on: true })
    const start = performance.now()
    render(e, 4)
    const elapsed = (performance.now() - start) / 1000
    console.log(`Rendered 4 s of 24-voice audio in ${elapsed.toFixed(3)} s`)
    expect(elapsed).toBeLessThan(4)
  })

  it('benchmark: 10 s, 8-note chord + drums + reverb', () => {
    const e = new Engine(sr)
    const fx = defaultFXParams()
    fx.reverb = ReverbType.hall
    e.send({ type: 'fx', params: fx })
    e.send({ type: 'press', id: 0, notes: noteSet([48, 52, 55, 59, 62, 64, 67, 71]), velocity: 0.8 })
    e.send({ type: 'beat', style: BeatStyle.rock, variation: 2, on: true })
    const start = performance.now()
    const out = render(e, 10)
    const elapsed = (performance.now() - start) / 1000
    console.log(`BENCH Rendered 10 s (8-note chord + beat + hall) in ${elapsed.toFixed(3)} s`)
    assertClean(out)
    expect(elapsed).toBeLessThan(10)
  })
})
