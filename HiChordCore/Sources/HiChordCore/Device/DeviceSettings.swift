import Foundation

/// The device's play modes (red button menu).
public enum PlayMode: Int, CaseIterable, Codable, Sendable {
    case play, strum, lead, drone, arp, repeatGate, sequencer, drums, beat, chordHiro, earTrainer, tuner, mic, vocoder, mixer

    public var displayName: String {
        switch self {
        case .play: return "PLAY"
        case .strum: return "STRUM"
        case .lead: return "LEAD"
        case .drone: return "DRONE"
        case .arp: return "ARP"
        case .repeatGate: return "REPEAT"
        case .sequencer: return "SEQUENCER"
        case .drums: return "DRUMS"
        case .beat: return "BEAT"
        case .chordHiro: return "CHORD HIRO"
        case .earTrainer: return "EAR TRAIN"
        case .tuner: return "TUNER"
        case .mic: return "MIC"
        case .vocoder: return "VOCODER"
        case .mixer: return "MIXER"
        }
    }

    public var shortName: String {
        switch self {
        case .sequencer: return "SEQ"
        case .earTrainer: return "EAR"
        case .repeatGate: return "RPT"
        case .chordHiro: return "HIRO"
        case .vocoder: return "VOC"
        default: return displayName
        }
    }

    /// Modes where the seven buttons play chords.
    public var playsChords: Bool {
        switch self {
        case .play, .strum, .drone, .arp, .repeatGate, .sequencer, .vocoder: return true
        default: return false
        }
    }

    var engineStyle: PerformStyle {
        switch self {
        case .strum: return .strum
        case .drone: return .drone
        case .arp: return .arp
        case .repeatGate: return .repeatGate
        default: return .chord
        }
    }

    /// Whether the mode can use the microphone (the vocoder only with its mic source).
    public var usesMicrophone: Bool { self == .tuner || self == .mic || self == .vocoder }
}

/// Everything the user can set, persisted between launches.
public struct DeviceSettings: Codable, Equatable, Sendable {
    public var harmony = HarmonySettings()
    public var soundName = "PIANO"
    public var fx = FXParams()
    /// Multipliers applied to the preset's attack and release.
    public var attackScale: Float = 1
    public var releaseScale: Float = 1
    public var mode: PlayMode = .play
    public var bpm: Double = 100
    public var arpPattern: ArpPattern = .up
    public var arpRate: NoteRate = .sixteenth
    public var arpLatch = false
    public var repeatRate: NoteRate = .eighth
    public var strumMs: Float = 22
    public var kit: DrumKit = .tight
    public var beatStyle: BeatStyle = .rock
    public var beatVariation = 0
    /// Beats per sequencer step.
    public var seqStepBeats: Double = 2
    /// 0 = free, otherwise 1, 2, 4 or 8 bars.
    public var loopBars = 2
    public var metronome = false
    public var earLevel: EarTrainer.Level = .notes
    public var leadGlide: Float = 0.06
    /// The wheel sweeps the low-pass filter instead of the volume.
    public var filterWheel = false
    public var volume: Float = 0.75
    public var filter: Float = 1
    /// Hold one chord button and press another to put the second's root in the bass.
    public var slashChords = false
    public var showScope = true
    public var showKeyLabels = true
    public var haptics = true
    public var vocoder = VocoderParams()
    public var hiroSong = 0
    /// Best Chord Hiro score per song.
    public var hiroBest: [Int] = []

    public init() {}

    // Decode tolerantly so settings saved by older versions still load.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = DeviceSettings()
        func v<T: Decodable>(_ key: CodingKeys, _ fallback: T) -> T {
            (try? c.decodeIfPresent(T.self, forKey: key)) ?? fallback
        }
        harmony = v(.harmony, d.harmony)
        soundName = v(.soundName, d.soundName)
        fx = v(.fx, d.fx)
        attackScale = v(.attackScale, d.attackScale)
        releaseScale = v(.releaseScale, d.releaseScale)
        mode = v(.mode, d.mode)
        bpm = v(.bpm, d.bpm)
        arpPattern = v(.arpPattern, d.arpPattern)
        arpRate = v(.arpRate, d.arpRate)
        arpLatch = v(.arpLatch, d.arpLatch)
        repeatRate = v(.repeatRate, d.repeatRate)
        strumMs = v(.strumMs, d.strumMs)
        kit = v(.kit, d.kit)
        beatStyle = v(.beatStyle, d.beatStyle)
        beatVariation = v(.beatVariation, d.beatVariation)
        seqStepBeats = v(.seqStepBeats, d.seqStepBeats)
        loopBars = v(.loopBars, d.loopBars)
        metronome = v(.metronome, d.metronome)
        earLevel = v(.earLevel, d.earLevel)
        leadGlide = v(.leadGlide, d.leadGlide)
        filterWheel = v(.filterWheel, d.filterWheel)
        volume = v(.volume, d.volume)
        filter = v(.filter, d.filter)
        slashChords = v(.slashChords, d.slashChords)
        showScope = v(.showScope, d.showScope)
        showKeyLabels = v(.showKeyLabels, d.showKeyLabels)
        haptics = v(.haptics, d.haptics)
        vocoder = v(.vocoder, d.vocoder)
        hiroSong = v(.hiroSong, d.hiroSong)
        hiroBest = v(.hiroBest, d.hiroBest)
        if harmony.buttonOctaves.count != 7 { harmony.buttonOctaves = Array(repeating: 0, count: 7) }
    }
}
