import XCTest
@testable import HeptadCore

@MainActor
final class MockHost: DeviceHost {
    var commands: [EngineCommand] = []
    var micActive = false
    var captureRequests = 0
    func send(_ command: EngineCommand) { commands.append(command) }
    func haptic(_ kind: HapticKind) {}
    func setMicrophoneActive(_ active: Bool) { micActive = active }
    func captureSample() { captureRequests += 1 }
    func settingsDidChange() {}

    var lastPress: (id: Int32, notes: [Int])? {
        for c in commands.reversed() { if case let .press(id, notes, _) = c { return (id, notes.notes) } }
        return nil
    }
}

final class DeviceTests: XCTestCase {
    @MainActor
    func makeDevice() -> (HeptadDevice, MockHost) {
        let d = HeptadDevice()
        let h = MockHost()
        d.host = h
        d.syncEngine()
        d.tick(now: 10)
        return (d, h)
    }

    @MainActor
    func testPlayingChordsAndJoystick() async {
        let (d, h) = makeDevice()
        d.pressButton(0)
        XCTAssertEqual(d.displayChord, "C")
        XCTAssertEqual(h.lastPress?.notes, [48, 52, 55])
        d.setJoystick(.right)
        XCTAssertEqual(d.displayChord, "Cmaj7")
        XCTAssertEqual(h.lastPress?.notes, [48, 52, 55, 59])
        d.setJoystick(.center)
        XCTAssertEqual(d.displayChord, "C")
        d.releaseButton(0)
        guard case .release(id: 0)? = h.commands.last else { return XCTFail("expected release") }
        // Swiping on a key overrides the joystick for that key.
        d.pressButton(5)
        d.swipeButton(5, direction: .up)
        XCTAssertEqual(d.displayChord, "A")
    }

    @MainActor
    func testKeyMenuChangesKeyAndCloses() async {
        let (d, _) = makeDevice()
        d.pressFunction(.key)
        d.releaseFunction(.key)
        XCTAssertEqual(d.screen, .keyMenu)
        d.setJoystick(.right); d.setJoystick(.center)
        d.setJoystick(.right); d.setJoystick(.center)
        XCTAssertEqual(d.settings.harmony.key, 2)
        d.setJoystick(.up); d.setJoystick(.center)
        XCTAssertEqual(d.settings.harmony.octave, 1)
        d.pressButton(0)
        XCTAssertEqual(d.displayChord, "D")
        d.releaseButton(0)
        d.pressFunction(.key)
        d.releaseFunction(.key)
        XCTAssertEqual(d.screen, .home)
        // Menus time out.
        d.pressFunction(.sound); d.releaseFunction(.sound)
        d.tick(now: 30)
        XCTAssertEqual(d.screen, .home)
    }

    @MainActor
    func testListEditing() async {
        let (d, _) = makeDevice()
        d.pressFunction(.key); d.releaseFunction(.key)
        d.clickJoystick()
        XCTAssertEqual(d.screen, .keyList)
        d.setJoystick(.right); d.setJoystick(.center) // scale -> minor
        XCTAssertEqual(d.settings.harmony.scale, .minor)
        d.setJoystick(.down); d.setJoystick(.center)
        d.setJoystick(.right); d.setJoystick(.center) // joystick map -> extended
        XCTAssertEqual(d.settings.harmony.joystickMap, .extended)
        d.clickJoystick()
        XCTAssertEqual(d.screen, .home)
    }

    @MainActor
    func testFunctionCombos() async {
        let (d, _) = makeDevice()
        d.pressFunction(.sound)
        d.pressButton(3)
        d.releaseButton(3)
        d.releaseFunction(.sound)
        XCTAssertEqual(d.settings.soundName, SoundLibrary.quickSelect[3])
        XCTAssertEqual(d.screen, .home)
        d.pressFunction(.mode)
        d.pressButton(4)
        d.releaseButton(4)
        d.releaseFunction(.mode)
        XCTAssertEqual(d.settings.mode, .arp)
        d.pressFunction(.key)
        d.pressButton(2)
        d.releaseButton(2)
        d.releaseFunction(.key)
        XCTAssertEqual(d.settings.harmony.buttonOctaves[2], 1)
    }

    @MainActor
    func testModeSwitchingAndMic() async {
        let (d, h) = makeDevice()
        d.setMode(.tuner)
        XCTAssertTrue(h.micActive)
        d.setMode(.mic)
        d.pressButton(0)
        XCTAssertEqual(h.captureRequests, 1)
        d.sampleCaptured(success: true, rootNote: 61)
        XCTAssertEqual(d.settings.soundName, "MIC SAMPLE")
        XCTAssertEqual(d.settings.mode, .play)
        XCTAssertFalse(h.micActive)
    }

    @MainActor
    func testSequencerRecordsSteps() async {
        let (d, h) = makeDevice()
        d.setMode(.sequencer)
        for b in [0, 4, 5, 3] { d.pressButton(b); d.releaseButton(b) }
        XCTAssertEqual(d.seqNames, ["C", "G", "Am", "F"])
        d.clickJoystick()
        XCTAssertTrue(h.commands.contains { if case .seqPlay(true) = $0 { return true }; return false })
    }

    @MainActor
    func testEarTrainerAsksQuestions() async {
        let (d, h) = makeDevice()
        d.setMode(.earTrainer)
        XCTAssertTrue(h.commands.contains { if case .preview = $0 { return true }; return false })
    }

    @MainActor
    func testSlashChords() async {
        let (d, h) = makeDevice()
        d.update { $0.slashChords = true }
        d.pressButton(0)
        d.pressButton(2)
        XCTAssertEqual(d.displayChord, "C/E")
        XCTAssertEqual(h.lastPress?.id, 0)
        d.releaseButton(2)
        XCTAssertEqual(d.displayChord, "C")
    }

    @MainActor
    func testVocoderModeTogglesEngineAndMicrophone() async {
        let (d, h) = makeDevice()
        d.setMode(.vocoder)
        XCTAssertTrue(h.micActive)
        XCTAssertTrue(h.commands.contains { if case .vocoder(true, _) = $0 { return true }; return false })
        d.update { $0.vocoder.source = .track1 }
        XCTAssertFalse(h.micActive, "track-1 modulator needs no microphone")
        d.pressButton(0)
        XCTAssertEqual(d.displayChord, "C")
        d.releaseButton(0)
        d.setMode(.play)
        guard case .vocoder(false, _)? = h.commands.last(where: { if case .vocoder = $0 { return true }; return false }) else {
            return XCTFail("vocoder should switch off")
        }
    }

    @MainActor
    func testChordRushGameFlow() async {
        let (d, h) = makeDevice()
        d.setMode(.chordRush)
        d.setJoystick(.right); d.setJoystick(.center)
        XCTAssertEqual(d.settings.rushSong, 1)
        d.setJoystick(.left); d.setJoystick(.center)
        d.clickJoystick()
        XCTAssertEqual(d.rush.phase, .waiting)
        XCTAssertTrue(h.commands.contains { if case .beat(_, _, true) = $0 { return true }; return false })
        // Simulate the engine clock: 100 BPM, beat 0 at t = 10.
        func at(_ beat: Double) {
            var s = d.status
            s.beatOn = true
            s.tempo = 100
            s.beat = beat
            d.status = s
            d.tick(now: 10 + beat * 0.6)
        }
        at(0.1)
        XCTAssertEqual(d.rush.phase, .playing)
        let song = d.rush.song
        for (i, degree) in song.degrees.enumerated() {
            if i == 2, let dir = ProcessInfo.processInfo.environment["OLED_DUMP"] {
                at(d.rush.targetBeat(i) - 0.5)
                let frame = d.render()
                var pbm = "P1\n\(OLEDFrame.width) \(OLEDFrame.height)\n"
                for y in 0..<OLEDFrame.height {
                    pbm += (0..<OLEDFrame.width).map { frame.isOn(x: $0, y: y) ? "1" : "0" }.joined(separator: " ") + "\n"
                }
                try? pbm.write(toFile: "\(dir)/rush-playing.pbm", atomically: true, encoding: .utf8)
            }
            at(d.rush.targetBeat(i))
            d.pressButton(degree)
            d.releaseButton(degree)
            at(d.rush.targetBeat(i) + 1)
        }
        at(d.rush.targetBeat(song.degrees.count - 1) + 4)
        XCTAssertEqual(d.rush.phase, .done)
        XCTAssertEqual(d.rush.grade, "S")
        XCTAssertEqual(d.settings.rushBest.first, d.rush.score)
        XCTAssertTrue(h.commands.contains { if case .beat(_, _, false) = $0 { return true }; return false })
    }

    @MainActor
    func testSettingsRoundTripAndTolerantDecoding() async throws {
        var s = DeviceSettings()
        s.harmony.key = 7
        s.fx.reverb = .hall
        s.mode = .arp
        let data = try JSONEncoder().encode(s)
        XCTAssertEqual(try JSONDecoder().decode(DeviceSettings.self, from: data), s)
        let partial = #"{"bpm": 133, "unknownKey": 1}"#.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(DeviceSettings.self, from: partial)
        XCTAssertEqual(decoded.bpm, 133)
        XCTAssertEqual(decoded.soundName, DeviceSettings().soundName)
    }

    @MainActor
    func testEveryScreenRenders() async throws {
        let (d, _) = makeDevice()
        var frames: [(String, OLEDFrame)] = []
        d.battery = 0.7
        for mode in PlayMode.allCases {
            d.setMode(mode)
            d.tick(now: d.now + 5)
            if mode.playsChords || mode == .lead || mode == .drums { d.pressButton(1); d.setJoystick(.right) }
            frames.append(("mode-\(mode.displayName)", d.render()))
            d.setJoystick(.center)
            d.releaseButton(1)
        }
        d.setMode(.play)
        d.tick(now: d.now + 5)
        for f in FunctionKey.allCases {
            d.pressFunction(f); d.releaseFunction(f)
            frames.append(("menu-\(f)", d.render()))
            d.clickJoystick()
            frames.append(("list-\(f)", d.render()))
            d.clickJoystick()
        }
        d.loopNext()
        frames.append(("message", d.render()))
        for (_, frame) in frames {
            XCTAssertGreaterThan(frame.pixels.filter { $0 != 0 }.count, 30)
        }
        if let dir = ProcessInfo.processInfo.environment["OLED_DUMP"] {
            for (name, frame) in frames {
                var pbm = "P1\n\(OLEDFrame.width) \(OLEDFrame.height)\n"
                for y in 0..<OLEDFrame.height {
                    pbm += (0..<OLEDFrame.width).map { frame.isOn(x: $0, y: y) ? "1" : "0" }.joined(separator: " ") + "\n"
                }
                try pbm.write(toFile: "\(dir)/\(name).pbm", atomically: true, encoding: .utf8)
            }
        }
    }
}
