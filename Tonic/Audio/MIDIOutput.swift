import CoreMIDI
import Foundation
import TonicCore
import os

/// Publishes Tonic as a virtual CoreMIDI source ("Tonic") so DAWs and other apps
/// can record its chords. Loop tracks use channels 1-6, drums channel 10.
final class MIDIOutput: @unchecked Sendable {
    private var client = MIDIClientRef()
    private var source = MIDIEndpointRef()
    private let queue = DispatchQueue(label: "com.pristinep.tonic.midi", qos: .userInteractive)
    private var timer: DispatchSourceTimer?
    private let engine: TonicEngine
    private let log = Logger(subsystem: "com.pristinep.tonic", category: "midi")
    private var ticksPerSecond: Double = 1_000_000_000
    private let enabledLock = NSLock()
    private var _enabled = true
    private(set) var isAvailable = false

    var enabled: Bool {
        get { enabledLock.lock(); defer { enabledLock.unlock() }; return _enabled }
        set { enabledLock.lock(); _enabled = newValue; enabledLock.unlock() }
    }

    init(engine: TonicEngine) {
        self.engine = engine
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        ticksPerSecond = 1_000_000_000 * Double(info.denom) / Double(info.numer)

        var status = MIDIClientCreateWithBlock("Tonic" as CFString, &client) { _ in }
        if status == noErr {
            status = MIDISourceCreateWithProtocol(client, "Tonic" as CFString, ._1_0, &source)
        }
        isAvailable = status == noErr
        if !isAvailable { log.error("CoreMIDI unavailable: \(status)") }

        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(2), leeway: .microseconds(500))
        t.setEventHandler { [weak self] in self?.drain() }
        t.resume()
        timer = t
    }

    deinit {
        timer?.cancel()
        if source != 0 { MIDIEndpointDispose(source) }
        if client != 0 { MIDIClientDispose(client) }
        listBuffer.deallocate()
    }

    private static let listBytes = 4096
    private let listBuffer = UnsafeMutableRawPointer.allocate(byteCount: MIDIOutput.listBytes,
                                                              alignment: MemoryLayout<MIDIEventList>.alignment)

    private func drain() {
        let send = enabled && isAvailable
        let sampleRate = Double(engine.sampleRate)
        let now = mach_absolute_time()
        let list = listBuffer.bindMemory(to: MIDIEventList.self, capacity: 1)
        var packet: UnsafeMutablePointer<MIDIEventPacket>? = MIDIEventListInit(list, ._1_0)
        var pending = 0
        while let m = engine.midiOut.pop() {
            guard send else { continue }
            let offsetTicks = UInt64(max(0, Double(m.sampleOffset) / sampleRate * ticksPerSecond))
            // Universal MIDI Packet, MIDI 1.0 channel voice message (type 2), group 0.
            var word: UInt32 = (0x2 << 28) | (UInt32(m.status) << 16) | (UInt32(m.data1 & 0x7F) << 8) | UInt32(m.data2 & 0x7F)
            let time = now + offsetTicks
            if let current = packet {
                packet = MIDIEventListAdd(list, MIDIOutput.listBytes, current, time, 1, &word)
            }
            if packet == nil {
                // List full: send what we have and start a new one with this message.
                if pending > 0 { MIDIReceivedEventList(source, list) }
                pending = 0
                packet = MIDIEventListInit(list, ._1_0)
                if let current = packet {
                    packet = MIDIEventListAdd(list, MIDIOutput.listBytes, current, time, 1, &word)
                }
            }
            pending += 1
            if pending >= 128 {
                MIDIReceivedEventList(source, list)
                packet = MIDIEventListInit(list, ._1_0)
                pending = 0
            }
        }
        if pending > 0 { MIDIReceivedEventList(source, list) }
    }
}
