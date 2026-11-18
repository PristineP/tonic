import XCTest
@testable import TonicCore

final class EngineTests: XCTestCase {
    let sr = 48000.0

    /// Renders `seconds` of audio and returns the left channel (and right via inout).
    func render(_ engine: TonicEngine, seconds: Double, right: UnsafeMutablePointer<[Float]>? = nil) -> [Float] {
        let total = Int(seconds * sr)
        var l = [Float](repeating: 0, count: total)
        var r = [Float](repeating: 0, count: total)
        var offset = 0
        let block = 256
        l.withUnsafeMutableBufferPointer { lp in
            r.withUnsafeMutableBufferPointer { rp in
                while offset < total {
                    let n = min(block, total - offset)
                    engine.render(left: lp.baseAddress! + offset, right: rp.baseAddress! + offset, frames: n)
                    offset += n
                }
            }
        }
        right?.pointee = r
        return l
    }

    func rms(_ x: ArraySlice<Float>) -> Float {
        guard !x.isEmpty else { return 0 }
        return (x.reduce(0) { $0 + $1 * $1 } / Float(x.count)).squareRoot()
    }

    func assertClean(_ x: [Float], file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(x.allSatisfy { $0.isFinite }, "non-finite samples", file: file, line: line)
        XCTAssertLessThanOrEqual(x.map(abs).max() ?? 0, 1.0, "output exceeds full scale", file: file, line: line)
    }

    func drainMIDI(_ engine: TonicEngine) -> [MIDIMessage] {
        var out: [MIDIMessage] = []
        while let m = engine.midiOut.pop() { out.append(m) }
        return out
    }

    func dryEngine() -> TonicEngine {
        let e = TonicEngine(sampleRate: sr)
        var fx = FXParams()
        fx.reverb = .off
        e.send(.fx(fx))
        return e
    }

    func testSilentAtStart() {
        let e = TonicEngine(sampleRate: sr)
        let out = render(e, seconds: 0.2)
        XCTAssertEqual(out.map(abs).max() ?? 1, 0)
    }

    func testChordPressAndRelease() {
        let e = TonicEngine(sampleRate: sr)
        e.send(.press(id: 0, notes: NoteSet([48, 52, 55]), velocity: 0.8))
        let held = render(e, seconds: 0.5)
        assertClean(held)
        XCTAssertGreaterThan(rms(held[12000...]), 0.01)
        e.send(.release(id: 0))
        let after = render(e, seconds: 3)
        assertClean(after)
        XCTAssertLessThan(rms(after[after.count - 4800 ..< after.count]), 0.002)
        XCTAssertEqual(e.status.activeVoices, 0)
    }

    func testEveryFactoryPresetIsAudibleAndInTune() {
        for preset in SoundLibrary.factory {
            let e = dryEngine()
            e.send(.patch(preset.params))
            e.send(.press(id: 0, notes: NoteSet([57]), velocity: 0.9)) // A3 = 220 Hz
            let out = render(e, seconds: 0.6)
            assertClean(out)
            let level = rms(out[4800...])
            XCTAssertGreaterThan(level, 0.003, "\(preset.name) too quiet")
            XCTAssertLessThan(level, 0.7, "\(preset.name) too loud")
            if preset.params.wave != .noise {
                let expected = 220.0 * pow(2, Double(preset.params.octave))
                let detector = PitchDetector(sampleRate: sr, minFrequency: 40, maxFrequency: 1000)
                let window = Array(out[19200 ..< 19200 + 4096])
                if let result = detector.detect(window) {
                    // Allow octave errors for timbres with strong harmonics, but the pitch class must match.
                    let semis = 12 * log2(result.frequency / expected)
                    let wrapped = semis - 12 * (semis / 12).rounded()
                    XCTAssertLessThan(abs(wrapped), 0.35, "\(preset.name) out of tune: \(result.frequency) Hz")
                } else {
                    XCTFail("\(preset.name): no pitch detected")
                }
            }
        }
    }

    func testDrumKitsAndBeatPatterns() {
        for kit in DrumKit.allCases {
            let e = dryEngine()
            e.send(.kit(Int32(kit.rawValue)))
            for pad in 0..<7 {
                e.send(.drum(pad: Int32(pad), velocity: 1))
                let out = render(e, seconds: 0.25)
                assertClean(out)
                XCTAssertGreaterThan(out.map(abs).max() ?? 0, 0.02, "\(kit) pad \(pad) silent")
            }
        }
        for style in BeatStyle.allCases {
            for v in 0..<8 {
                let e = dryEngine()
                e.send(.tempo(120))
                e.send(.beat(style: Int32(style.rawValue), variation: Int32(v), on: true))
                let out = render(e, seconds: 2.1) // > 1 bar at 120 BPM
                assertClean(out)
                XCTAssertGreaterThan(rms(out[...]), 0.005, "\(style) v\(v) silent")
                let hits = drainMIDI(e).filter { $0.status == 0x99 }
                XCTAssertGreaterThanOrEqual(hits.count, 4, "\(style) v\(v)")
            }
        }
    }

    func testArpeggiatorTiming() {
        let e = dryEngine()
        e.send(.tempo(120))
        e.send(.style(.arp))
        e.send(.arp(pattern: .up, rate: .sixteenth, latch: false))
        e.send(.press(id: 2, notes: NoteSet([60, 64, 67]), velocity: 0.8))
        _ = render(e, seconds: 2.0)
        let ons = drainMIDI(e).filter { $0.status & 0xF0 == 0x90 }
        // 120 BPM, 1/16 → 8 notes per second → 16 in 2 s (±1 for edges)
        XCTAssertTrue((15...17).contains(ons.count), "got \(ons.count)")
        XCTAssertEqual(ons.prefix(4).map(\.data1), [60, 64, 67, 60])
        e.send(.release(id: 2))
        _ = render(e, seconds: 0.5)
        XCTAssertTrue(drainMIDI(e).filter { $0.status & 0xF0 == 0x90 }.isEmpty)
    }

    func testEveryNoteOnGetsANoteOff() {
        let e = dryEngine()
        e.send(.tempo(140))
        for style in [PerformStyle.chord, .strum, .arp, .repeatGate, .drone] {
            e.send(.style(style))
            e.send(.press(id: 1, notes: NoteSet([60, 63, 67]), velocity: 0.8))
            _ = render(e, seconds: 0.4)
            e.send(.press(id: 3, notes: NoteSet([65, 69, 72]), velocity: 0.8))
            _ = render(e, seconds: 0.3)
            e.send(.release(id: 1))
            e.send(.release(id: 3))
            _ = render(e, seconds: 0.3)
        }
        e.send(.style(.chord)) // ends the drone
        _ = render(e, seconds: 1)
        var balance: [Int: Int] = [:]
        for m in drainMIDI(e) where m.status & 0xF0 == 0x90 || m.status & 0xF0 == 0x80 {
            let key = Int(m.status & 0x0F) * 128 + Int(m.data1)
            balance[key, default: 0] += (m.status & 0xF0 == 0x90) ? 1 : -1
        }
        XCTAssertTrue(balance.values.allSatisfy { $0 == 0 }, "unbalanced: \(balance.filter { $0.value != 0 })")
    }

    func testLooperBarModeRecordsAndPlaysBack() {
        let e = dryEngine()
        e.send(.tempo(120)) // 1 bar = 2 s
        e.send(.loopBars(1))
        e.send(.loopRecord(track: 0))
        _ = render(e, seconds: 0.1)
        XCTAssertEqual(e.status.trackState(0), .armed)
        XCTAssertGreaterThan(e.status.countIn, 3)
        _ = render(e, seconds: 2.0) // count-in
        XCTAssertEqual(e.status.trackState(0), .recording)
        e.send(.press(id: 0, notes: NoteSet([60, 64, 67]), velocity: 0.8))
        _ = render(e, seconds: 0.5)
        e.send(.release(id: 0))
        _ = render(e, seconds: 1.6) // finish the bar
        XCTAssertEqual(e.status.trackState(0), .playing)
        XCTAssertEqual(e.status.loopLength, 4, accuracy: 0.001)
        _ = drainMIDI(e)
        // Next cycle: the loop should replay the chord on channel 1 without any live input.
        let playback = render(e, seconds: 2.0)
        assertClean(playback)
        XCTAssertGreaterThan(rms(playback[...]), 0.005)
        let ons = drainMIDI(e).filter { $0.status == 0x90 }
        XCTAssertEqual(Set(ons.map(\.data1)), [60, 64, 67])

        // Overdub on track 2 (MIDI channel 2)
        e.send(.loopRecord(track: 1))
        _ = render(e, seconds: 0.05)
        XCTAssertEqual(e.status.trackState(1), .recording)
        e.send(.press(id: 4, notes: NoteSet([72]), velocity: 0.8))
        _ = render(e, seconds: 0.3)
        e.send(.release(id: 4))
        _ = render(e, seconds: 2.0)
        XCTAssertEqual(e.status.trackState(1), .playing)
        _ = drainMIDI(e)
        _ = render(e, seconds: 2.0)
        let msgs = drainMIDI(e)
        XCTAssertTrue(msgs.contains { $0.status == 0x91 && $0.data1 == 72 })

        // Mute and clear
        e.send(.loopMute(track: 0, muted: true))
        _ = render(e, seconds: 0.05)
        XCTAssertEqual(e.status.trackState(0), .muted)
        e.send(.loopClear(track: -1))
        _ = render(e, seconds: 0.05)
        XCTAssertEqual(e.status.trackState(0), .empty)
        XCTAssertEqual(e.status.loopLength, 0)
    }

    func testLooperFreeModeStartsOnFirstNote() {
        let e = dryEngine()
        e.send(.tempo(120))
        e.send(.loopBars(0))
        e.send(.loopRecord(track: 0))
        _ = render(e, seconds: 1.0)
        XCTAssertEqual(e.status.trackState(0), .armed)
        e.send(.press(id: 0, notes: NoteSet([55]), velocity: 0.8))
        _ = render(e, seconds: 0.2)
        XCTAssertEqual(e.status.trackState(0), .recording)
        e.send(.release(id: 0))
        _ = render(e, seconds: 1.3) // ~1.5 s = 3 beats
        e.send(.loopRecord(track: 0))
        _ = render(e, seconds: 0.05)
        XCTAssertEqual(e.status.trackState(0), .playing)
        XCTAssertEqual(e.status.loopLength, 3, accuracy: 0.001)
    }

    func testSequencerPlaysSteps() {
        let e = dryEngine()
        e.send(.tempo(120))
        e.send(.seqStep(index: 0, notes: NoteSet([60, 64, 67])))
        e.send(.seqStep(index: 1, notes: NoteSet([65, 69, 72])))
        e.send(.seqLength(2))
        e.send(.seqStepBeats(1))
        e.send(.seqPlay(true))
        _ = render(e, seconds: 1.95) // 4 steps
        let ons = drainMIDI(e).filter { $0.status & 0xF0 == 0x90 }.map(\.data1)
        XCTAssertEqual(ons, [60, 64, 67, 65, 69, 72, 60, 64, 67, 65, 69, 72])
        e.send(.seqPlay(false))
        _ = render(e, seconds: 0.5)
        XCTAssertFalse(e.status.seqPlaying)
    }

    func testAllEffectsStayFinite() {
        for reverb in ReverbType.allCases {
            for mod in ModType.allCases {
                for drive in DriveType.allCases {
                    let e = TonicEngine(sampleRate: sr)
                    var fx = FXParams()
                    fx.reverb = reverb
                    fx.mod = mod
                    fx.drive = drive
                    fx.delay = .dottedEighth
                    fx.tremolo = .eighth
                    fx.lofi = LofiType(rawValue: Int32((reverb.rawValue + mod.rawValue) % 4))!
                    e.send(.fx(fx))
                    e.send(.press(id: 0, notes: NoteSet([48, 55, 64, 71]), velocity: 1))
                    let out = render(e, seconds: 0.3)
                    assertClean(out)
                    XCTAssertGreaterThan(rms(out[...]), 0.001)
                }
            }
        }
    }

    func testSamplePlaybackPitch() {
        let e = dryEngine()
        // A 220 Hz recorded tone used as a sample rooted at A3.
        let buf = e.sampleBuffer(slot: 0)
        let len = 48000
        for i in 0..<len { buf.pointer[i] = 0.5 * Float(sin(2 * Double.pi * 220 * Double(i) / sr)) }
        e.send(.useSample(slot: 0, length: Int32(len), sourceRate: 48000, rootNote: 57))
        e.send(.patch(SoundLibrary.samplePreset().params))
        e.send(.press(id: 0, notes: NoteSet([69]), velocity: 1)) // an octave up
        let out = render(e, seconds: 0.3)
        let r = PitchDetector(sampleRate: sr).detect(Array(out[4800 ..< 9000]))
        XCTAssertNotNil(r)
        XCTAssertEqual(r?.frequency ?? 0, 440, accuracy: 3)
    }

    func testPitchDetector() {
        let d = PitchDetector(sampleRate: sr)
        for f in [82.41, 110.0, 196.0, 329.63, 440.0, 987.77] {
            var x = [Float](repeating: 0, count: 4096)
            for i in 0..<x.count {
                let t = Double(i) / sr
                let fundamental = 0.6 * sin(2 * Double.pi * f * t)
                let harmonic = 0.2 * sin(4 * Double.pi * f * t)
                x[i] = Float(fundamental + harmonic)
            }
            let r = d.detect(x)
            XCTAssertNotNil(r)
            XCTAssertEqual(r?.frequency ?? 0, f, accuracy: f * 0.004)
        }
        XCTAssertNil(d.detect([Float](repeating: 0, count: 4096)))
    }

    func testVocoderFollowsModulator() {
        let e = dryEngine()
        var saw = SoundLibrary.factory[0].params
        saw.release = 0.05
        e.send(.patch(saw))
        e.send(.vocoder(on: true, params: VocoderParams()))
        e.send(.press(id: 0, notes: NoteSet([48, 55, 60, 64]), velocity: 0.9))
        // Silent modulator: the gate keeps the vocoder (and the carrier) quiet.
        let silent = render(e, seconds: 0.4)
        assertClean(silent)
        XCTAssertLessThan(rms(silent[9600...]), 0.002)
        // A buzzy "voice": pulse train at 140 Hz with a vowel-ish formant.
        var voice = [Float](repeating: 0, count: 48000)
        for i in 0..<voice.count {
            let t = Double(i) / sr
            voice[i] = Float(0.5 * sin(2 * .pi * 140 * t) + 0.3 * sin(2 * .pi * 700 * t) + 0.2 * sin(2 * .pi * 1200 * t))
        }
        var spoken: [Float] = []
        var offset = 0
        while offset < voice.count {
            let n = min(1024, voice.count - offset)
            voice.withUnsafeBufferPointer { e.pushModulator($0.baseAddress! + offset, count: n) }
            spoken += render(e, seconds: Double(n) / sr)
            offset += n
        }
        assertClean(spoken)
        XCTAssertGreaterThan(rms(spoken[12000...]), 0.01)
        // Turning the vocoder off returns the plain carrier.
        e.send(.vocoder(on: false, params: VocoderParams()))
        let plain = render(e, seconds: 0.3)
        XCTAssertGreaterThan(rms(plain[4800...]), 0.01)
    }

    func testRealtimePerformance() {
        // 24 sustained voices of the heaviest patch plus effects should render far faster than real time.
        let e = TonicEngine(sampleRate: sr)
        var fx = FXParams()
        fx.reverb = .hall; fx.delay = .eighth; fx.mod = .chorus; fx.drive = .tube
        e.send(.fx(fx))
        e.send(.patch(SoundLibrary.factory.first { $0.name == "ORGAN" }!.params))
        for id in 0..<6 { e.send(.press(id: Int32(id), notes: NoteSet([48 + id, 52 + id, 55 + id, 59 + id]), velocity: 0.8)) }
        e.send(.beat(style: 3, variation: 1, on: true))
        let start = Date()
        _ = render(e, seconds: 4)
        let elapsed = Date().timeIntervalSince(start)
        print("Rendered 4 s of 24-voice audio in \(String(format: "%.3f", elapsed)) s")
        XCTAssertLessThan(elapsed, 4)
    }
}
