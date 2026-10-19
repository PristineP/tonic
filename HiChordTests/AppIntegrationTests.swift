import CoreMIDI
import HiChordCore
import XCTest
@testable import HiChord

/// Integration tests that run inside the app on the simulator: the real AVAudioEngine host,
/// CoreMIDI output as seen by another MIDI client, persistence and sample analysis.
@MainActor
final class AppIntegrationTests: XCTestCase {
    func testAudioEngineRendersAChord() async throws {
        let model = AppModel()
        model.start()
        try XCTSkipUnless(model.audio.isRunning, "No audio output device available on this machine")
        model.pressButton(0)
        try await Task.sleep(nanoseconds: 400_000_000)
        let status = model.audio.core.status
        XCTAssertGreaterThan(status.activeVoices, 0)
        XCTAssertGreaterThan(status.peak, 0.001, "engine should be producing sound")
        model.releaseButton(0)
        try await Task.sleep(nanoseconds: 1_500_000_000)
        XCTAssertLessThan(model.audio.core.status.peak, 0.05)
    }

    func testMIDIOutputReachesAnotherClient() async throws {
        let model = AppModel()
        model.start()
        model.setMIDIEnabled(true)

        let received = MIDIReceiver()
        try received.connect(toSourceNamed: "HiChord")
        try await Task.sleep(nanoseconds: 200_000_000)

        model.pressButton(0) // C major: 48, 52, 55 on channel 1
        if !model.audio.isRunning {
            // No audio device: drive the engine by hand so it still produces MIDI.
            var l = [Float](repeating: 0, count: 512), r = [Float](repeating: 0, count: 512)
            l.withUnsafeMutableBufferPointer { lp in
                r.withUnsafeMutableBufferPointer { rp in
                    model.audio.core.render(left: lp.baseAddress!, right: rp.baseAddress!, frames: 512)
                }
            }
        }
        let deadline = Date().addingTimeInterval(3)
        while received.noteOns.count < 3 && Date() < deadline {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        model.releaseButton(0)
        let ons = received.noteOns
        XCTAssertEqual(Set(ons.map(\.note)), [48, 52, 55], "got \(ons)")
        XCTAssertTrue(ons.allSatisfy { $0.channel == 0 })
    }

    func testSettingsPersist() {
        let saved = Persistence.loadSettings()
        defer { Persistence.saveSettings(saved) }
        var s = DeviceSettings()
        s.harmony.key = 9
        s.harmony.scale = .dorian
        s.soundName = "VOX AHH"
        s.vocoder.formant = 1.25
        Persistence.saveSettings(s)
        XCTAssertEqual(Persistence.loadSettings(), s)
    }

    func testMicSampleProcessingAndRootDetection() {
        let rate = 48000.0
        var x = [Float](repeating: 0, count: 2400) // leading silence
        for i in 0..<Int(rate) { x.append(Float(0.3 * sin(2 * Double.pi * 440 * Double(i) / rate))) }
        guard let processed = MicCapture.process(x) else { return XCTFail("tone should not be treated as silence") }
        XCTAssertLessThan(processed.count, x.count - 2000, "leading silence trimmed")
        XCTAssertEqual(processed.map(abs).max() ?? 0, 0.9, accuracy: 0.01)
        XCTAssertEqual(AppModel.detectRoot(processed, sampleRate: rate), 69)
        XCTAssertNil(MicCapture.process([Float](repeating: 0, count: 4800)))
    }
}

/// A minimal CoreMIDI input that records note-ons from one source.
final class MIDIReceiver: @unchecked Sendable {
    struct NoteOn: CustomStringConvertible {
        let channel: UInt8
        let note: UInt8
        var description: String { "ch\(channel + 1):\(note)" }
    }

    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private let lock = NSLock()
    private var _noteOns: [NoteOn] = []

    var noteOns: [NoteOn] { lock.lock(); defer { lock.unlock() }; return _noteOns }

    func connect(toSourceNamed name: String) throws {
        var status = MIDIClientCreateWithBlock("HiChordTests" as CFString, &client) { _ in }
        guard status == noErr else { throw NSError(domain: "MIDI", code: Int(status)) }
        status = MIDIInputPortCreateWithProtocol(client, "in" as CFString, ._1_0, &port) { [weak self] list, _ in
            self?.handle(list)
        }
        guard status == noErr else { throw NSError(domain: "MIDI", code: Int(status)) }
        // The test host app publishes its own "HiChord" source too, so listen to all of them.
        var connected = 0
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            var cfName: Unmanaged<CFString>?
            MIDIObjectGetStringProperty(src, kMIDIPropertyName, &cfName)
            if let n = cfName?.takeRetainedValue() as String?, n == name {
                MIDIPortConnectSource(port, src, nil)
                connected += 1
            }
        }
        if connected > 0 { return }
        throw NSError(domain: "MIDI", code: -1, userInfo: [NSLocalizedDescriptionKey: "No MIDI source named \(name)"])
    }

    private func handle(_ list: UnsafePointer<MIDIEventList>) {
        var found: [NoteOn] = []
        for packet in list.unsafeSequence() {
            let count = Int(packet.pointee.wordCount)
            withUnsafeBytes(of: packet.pointee.words) { raw in
                let words = raw.bindMemory(to: UInt32.self)
                for w in words.prefix(count) where w >> 28 == 0x2 {
                    let status = UInt8((w >> 16) & 0xFF)
                    let velocity = UInt8(w & 0x7F)
                    if status & 0xF0 == 0x90 && velocity > 0 {
                        found.append(NoteOn(channel: status & 0x0F, note: UInt8((w >> 8) & 0x7F)))
                    }
                }
            }
        }
        lock.lock(); _noteOns += found; lock.unlock()
    }

    deinit {
        if port != 0 { MIDIPortDispose(port) }
        if client != 0 { MIDIClientDispose(client) }
    }
}
