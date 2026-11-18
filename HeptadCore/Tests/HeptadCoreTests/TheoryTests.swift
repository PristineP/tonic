import XCTest
@testable import HeptadCore

final class TheoryTests: XCTestCase {
    func names(_ settings: HarmonySettings, _ dir: JoyDirection = .center) -> [String] {
        (0..<7).map { ChordBuilder.chord(degree: $0, direction: dir, settings: settings).name(preferFlats: settings.prefersFlats) }
    }

    func testCMajorDiatonicChords() {
        XCTAssertEqual(names(HarmonySettings()), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"])
    }

    func testAMinorAndModes() {
        var s = HarmonySettings()
        s.key = 9
        s.scale = .minor
        XCTAssertEqual(names(s), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"])
        s.scale = .harmonicMinor
        XCTAssertEqual(names(s), ["Am", "Bdim", "Caug", "Dm", "E", "F", "G#dim"])
        s.key = 2
        s.scale = .dorian
        XCTAssertEqual(names(s), ["Dm", "Em", "F", "G", "Am", "Bdim", "C"])
        s.key = 7
        s.scale = .mixolydian
        XCTAssertEqual(names(s), ["G", "Am", "Bdim", "C", "Dm", "Em", "F"])
        s.key = 5
        s.scale = .lydian
        XCTAssertEqual(names(s), ["F", "G", "Am", "Bdim", "C", "Dm", "Em"])
    }

    func testFlatKeysSpellWithFlats() {
        var s = HarmonySettings()
        s.key = 10 // Bb major
        XCTAssertEqual(names(s), ["Bb", "Cm", "Dm", "Eb", "F", "Gm", "Adim"])
        s.key = 0
        s.scale = .minor // C minor: relative major Eb
        XCTAssertEqual(names(s), ["Cm", "Ddim", "Eb", "Fm", "Gm", "Ab", "Bb"])
        s.key = 4 // E major
        s.scale = .major
        XCTAssertEqual(names(s), ["E", "F#m", "G#m", "A", "B", "C#m", "D#dim"])
    }

    func testPentatonicAndBluesBorrowParentChords() {
        var s = HarmonySettings()
        s.scale = .majorPentatonic
        XCTAssertEqual(names(s), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"])
        s.scale = .blues
        XCTAssertEqual(names(s), ["C7", "Dm", "Edim", "F7", "G7", "Am", "Bb"])
    }

    func testDefaultJoystickMap() {
        let s = HarmonySettings()
        XCTAssertEqual(names(s, .up), ["Cm", "D", "E", "Fm", "Gm", "A", "B"])
        XCTAssertEqual(names(s, .upRight), ["C7", "D7", "E7", "F7", "G7", "A7", "B7"])
        XCTAssertEqual(names(s, .right), ["Cmaj7", "Dm7", "Em7", "Fmaj7", "Gmaj7", "Am7", "Bm7b5"])
        XCTAssertEqual(names(s, .down)[0], "Csus4")
        XCTAssertEqual(names(s, .downLeft)[0], "C6")
        XCTAssertEqual(names(s, .downLeft)[1], "Dsus2")
        XCTAssertEqual(names(s, .left)[6], "Bm")
        XCTAssertEqual(names(s, .upLeft)[0], "Caug")
    }

    func testBorrowMap() {
        var s = HarmonySettings()
        s.joystickMap = .borrow
        // V7 of each degree
        XCTAssertEqual(ChordBuilder.chord(degree: 1, direction: .up, settings: s).name(preferFlats: false), "A7")
        // Tritone sub of G
        XCTAssertEqual(ChordBuilder.chord(degree: 4, direction: .down, settings: s).name(preferFlats: true), "Db7")
        // Parallel minor iv
        XCTAssertEqual(ChordBuilder.chord(degree: 3, direction: .upRight, settings: s).name(preferFlats: true), "Fm")
        // Backdoor bVII7 of C
        XCTAssertEqual(ChordBuilder.chord(degree: 0, direction: .downLeft, settings: s).name(preferFlats: true), "Bb7")
        // Flat-side majors: bII, bIII, bVI, bVII
        XCTAssertEqual(ChordBuilder.chord(degree: 1, direction: .right, settings: s).name(preferFlats: true), "Db")
        XCTAssertEqual(ChordBuilder.chord(degree: 2, direction: .right, settings: s).name(preferFlats: true), "Eb")
        XCTAssertEqual(ChordBuilder.chord(degree: 5, direction: .right, settings: s).name(preferFlats: true), "Ab")
        XCTAssertEqual(ChordBuilder.chord(degree: 6, direction: .right, settings: s).name(preferFlats: true), "Bb")
    }

    func testChromaticShift() {
        var s = HarmonySettings()
        s.joystickMap = .chromatic
        XCTAssertEqual(ChordBuilder.chord(degree: 1, direction: .up, settings: s).name(preferFlats: true), "Ebm")
        XCTAssertEqual(ChordBuilder.chord(degree: 0, direction: .down, settings: s).name(preferFlats: false), "B")
    }

    func testVoicingRootPositionAndInversions() {
        var s = HarmonySettings()
        let c = ChordBuilder.diatonic(degree: 0, settings: s)
        XCTAssertEqual(ChordBuilder.voicing(c, degree: 0, settings: s).notes, [48, 52, 55])
        s.inversion = 1
        XCTAssertEqual(ChordBuilder.voicing(c, degree: 0, settings: s).notes, [52, 55, 60])
        s.inversion = 2
        XCTAssertEqual(ChordBuilder.voicing(c, degree: 0, settings: s).notes, [55, 60, 64])
        s.inversion = 0
        s.octave = 1
        XCTAssertEqual(ChordBuilder.voicing(c, degree: 0, settings: s).notes, [60, 64, 67])
        s.octave = 0
        s.buttonOctaves[0] = -1
        XCTAssertEqual(ChordBuilder.voicing(c, degree: 0, settings: s).notes, [36, 40, 43])
    }

    func testBassModes() {
        var s = HarmonySettings()
        s.bassMode = .root
        let g = ChordBuilder.diatonic(degree: 4, settings: s)
        let v = ChordBuilder.voicing(g, degree: 4, settings: s)
        XCTAssertEqual(v.notes, [55, 59, 62])
        XCTAssertEqual(v.bass.map(mod12), 7)
        XCTAssertLessThan(v.bass!, 55 - 11)
        // Slash chords keep the requested bass.
        let slash = ChordSpec(root: 0, type: .major, bass: 4)
        XCTAssertEqual(slash.name(preferFlats: false), "C/E")
        let sv = ChordBuilder.voicing(slash, degree: 0, settings: s)
        XCTAssertEqual(sv.bass.map(mod12), 4)
    }

    func testVoiceLeadingStaysClose() {
        var s = HarmonySettings()
        s.voiceLeading = true
        let c = ChordBuilder.voicing(ChordBuilder.diatonic(degree: 0, settings: s), degree: 0, settings: s)
        let f = ChordBuilder.voicing(ChordBuilder.diatonic(degree: 3, settings: s), degree: 3, settings: s, previous: c.notes)
        let b = ChordBuilder.voicing(ChordBuilder.diatonic(degree: 6, settings: s), degree: 6, settings: s, previous: f.notes)
        func centroid(_ n: [Int]) -> Double { Double(n.reduce(0, +)) / Double(n.count) }
        XCTAssertLessThan(abs(centroid(f.notes) - centroid(c.notes)), 4)
        XCTAssertLessThan(abs(centroid(b.notes) - centroid(f.notes)), 4)
        XCTAssertEqual(Set(f.notes.map(mod12)), [5, 9, 0])
    }

    func testAllChordTypesHaveUniqueSuffixesAndFitPolyphony() {
        let suffixes = ChordType.allCases.map(\.suffix)
        XCTAssertEqual(Set(suffixes).count, suffixes.count)
        for t in ChordType.allCases {
            XCTAssertLessThanOrEqual(t.intervals.count, 6, "\(t)")
            XCTAssertEqual(t.intervals.first, 0)
        }
    }

    func testEveryCombinationProducesPlayableNotes() {
        var s = HarmonySettings()
        for map in JoystickMap.allCases {
            s.joystickMap = map
            for scale in Scale.allCases {
                s.scale = scale
                for key in 0..<12 {
                    s.key = key
                    for degree in 0..<7 {
                        for dir in JoyDirection.allCases {
                            let spec = ChordBuilder.chord(degree: degree, direction: dir, settings: s)
                            let v = ChordBuilder.voicing(spec, degree: degree, settings: s)
                            XCTAssertFalse(v.notes.isEmpty)
                            XCTAssertLessThanOrEqual(v.allNotes.count, NoteSet.capacity)
                            XCTAssertTrue(v.allNotes.allSatisfy { (0...127).contains($0) })
                        }
                    }
                }
            }
        }
    }

    func testJoystickDirectionFromVector() {
        XCTAssertEqual(JoyDirection.from(x: 0, y: 1), .up)
        XCTAssertEqual(JoyDirection.from(x: 1, y: 0), .right)
        XCTAssertEqual(JoyDirection.from(x: -0.7, y: -0.7), .downLeft)
        XCTAssertEqual(JoyDirection.from(x: 0.1, y: 0.1), .center)
        XCTAssertEqual(JoyDirection.from(x: -1, y: 0.05), .left)
    }

    func testLeadOffsets() {
        XCTAssertEqual((0..<7).map { Scale.major.leadOffset(button: $0) }, [0, 2, 4, 5, 7, 9, 11])
        XCTAssertEqual((0..<7).map { Scale.minorPentatonic.leadOffset(button: $0) }, [0, 3, 5, 7, 10, 12, 15])
    }

    func testNoteSet() {
        var n = NoteSet([60, 64, 67])
        XCTAssertEqual(n.count, 3)
        XCTAssertEqual(n[1], 64)
        for i in 0..<10 { n.append(70 + i) }
        XCTAssertEqual(Int(n.count), NoteSet.capacity)
        XCTAssertEqual(NoteSet([67, 60]).sorted().notes, [60, 67])
    }

    func testEarTrainer() {
        var t = EarTrainer(seed: 42)
        let s = HarmonySettings()
        for level in EarTrainer.Level.allCases {
            t.level = level
            for _ in 0..<20 {
                let q = t.next(settings: s)
                XCTAssertTrue((0..<7).contains(q.answer))
                XCTAssertFalse(q.prompt.isEmpty)
                XCTAssertFalse(t.answer((q.answer + 1) % 7))
                XCTAssertTrue(t.answer(q.answer))
            }
        }
        XCTAssertEqual(t.score, 120)
    }
}
