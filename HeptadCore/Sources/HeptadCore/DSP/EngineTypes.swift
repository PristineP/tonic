import Foundation

/// Up to eight MIDI notes in a trivially copyable container.
public struct NoteSet: Equatable, Sendable {
    public private(set) var count: Int32 = 0
    private var storage: (Int16, Int16, Int16, Int16, Int16, Int16, Int16, Int16) = (0, 0, 0, 0, 0, 0, 0, 0)
    public static let capacity = 8

    public init() {}

    public init<S: Sequence>(_ notes: S) where S.Element == Int {
        for n in notes { append(n) }
    }

    public mutating func append(_ note: Int) {
        guard count < NoteSet.capacity else { return }
        withUnsafeMutableBytes(of: &storage) { raw in
            raw.bindMemory(to: Int16.self)[Int(count)] = Int16(clamping: note)
        }
        count += 1
    }

    public subscript(i: Int) -> Int {
        withUnsafeBytes(of: storage) { raw in Int(raw.bindMemory(to: Int16.self)[i]) }
    }

    public var notes: [Int] { (0..<Int(count)).map { self[$0] } }

    public var isEmpty: Bool { count == 0 }

    public func sorted() -> NoteSet { NoteSet(notes.sorted()) }

    public static func == (a: NoteSet, b: NoteSet) -> Bool { a.notes == b.notes }
}

/// How the engine turns a held chord into sound.
public enum PerformStyle: Int32, Sendable {
    case chord, strum, drone, arp, repeatGate
}

public enum ArpPattern: Int32, CaseIterable, Codable, Sendable {
    case up, down, upDown, random, converge, upTwoOctaves
    public var displayName: String { ["UP", "DOWN", "UP-DOWN", "RANDOM", "CONVERGE", "UP 2 OCT"][Int(rawValue)] }
}

public enum NoteRate: Int32, CaseIterable, Codable, Sendable {
    case quarter, eighth, eighthTriplet, sixteenth, sixteenthTriplet, thirtySecond
    public var displayName: String { ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"][Int(rawValue)] }
    public var stepsPerBeat: Double {
        switch self {
        case .quarter: return 1
        case .eighth: return 2
        case .eighthTriplet: return 3
        case .sixteenth: return 4
        case .sixteenthTriplet: return 6
        case .thirtySecond: return 8
        }
    }
}

/// Looper track states.
public enum TrackState: Int8, Sendable {
    case empty, armed, recording, playing, muted
}

/// Commands sent from the UI thread to the audio thread.
public enum EngineCommand: Sendable {
    case press(id: Int32, notes: NoteSet, velocity: Float)
    case release(id: Int32)
    case releaseAll
    case drum(pad: Int32, velocity: Float)
    case style(PerformStyle)
    case patch(SynthParams)
    case fx(FXParams)
    case tempo(Float)
    case arp(pattern: ArpPattern, rate: NoteRate, latch: Bool)
    case repeatRate(NoteRate)
    case strumSpeed(Float)
    case kit(Int32)
    case beat(style: Int32, variation: Int32, on: Bool)
    case seqStep(index: Int32, notes: NoteSet)
    case seqLength(Int32)
    case seqStepBeats(Float)
    case seqPlay(Bool)
    case loopRecord(track: Int32)
    case loopMute(track: Int32, muted: Bool)
    case loopLevel(track: Int32, level: Float)
    case loopClear(track: Int32)
    case loopBars(Int32)
    case transport(playing: Bool)
    case master(volume: Float, cutoff: Float)
    case metronome(Bool)
    case useSample(slot: Int32, length: Int32, sourceRate: Float, rootNote: Float)
    /// Plays notes for a fixed time (ear trainer prompts, auditions).
    case preview(notes: NoteSet, delay: Float, duration: Float)
    case stopPreview
    case drumRepeat(pad: Int32, on: Bool)
    case vocoder(on: Bool, params: VocoderParams)
}

/// A MIDI message produced by the engine for MIDI output.
public struct MIDIMessage: Sendable {
    public var status: UInt8
    public var data1: UInt8
    public var data2: UInt8
    /// Samples into the future at which the message is due (from the render call that produced it).
    public var sampleOffset: Int32
}

/// State published by the audio thread for the UI. Torn reads are harmless (display only).
public struct EngineStatus: Sendable {
    public var beat: Double = 0
    public var tempo: Float = 100
    public var loopLength: Double = 0
    public var loopPosition: Double = 0
    public var tracks: (Int8, Int8, Int8, Int8, Int8, Int8) = (0, 0, 0, 0, 0, 0)
    public var recordingTrack: Int32 = -1
    public var countIn: Float = 0
    public var beatStep: Int32 = -1
    public var seqStep: Int32 = -1
    public var peak: Float = 0
    public var transportPlaying = false
    public var beatOn = false
    public var seqPlaying = false
    public var activeVoices: Int32 = 0

    public init() {}

    public func trackState(_ t: Int) -> TrackState {
        let raw: Int8
        switch t {
        case 0: raw = tracks.0
        case 1: raw = tracks.1
        case 2: raw = tracks.2
        case 3: raw = tracks.3
        case 4: raw = tracks.4
        default: raw = tracks.5
        }
        return TrackState(rawValue: raw) ?? .empty
    }
}
