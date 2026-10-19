import Foundation

/// Oscillator / generator types.
public enum WaveType: Int32, Codable, Sendable {
    case sine, triangle, saw, square, pulse, sawSquare, supersaw, fm, pluck, organ, buzzOrgan, noise, sample
}

/// A complete synth voice description. Plain-old-data so it can cross to the audio thread.
public struct SynthParams: Equatable, Codable, Sendable {
    public var wave: WaveType = .saw
    /// Second oscillator (ignored by fm, pluck, organ, noise and sample).
    public var wave2: WaveType = .saw
    public var osc2Mix: Float = 0
    public var osc2Semitones: Float = 0
    public var detuneCents: Float = 0
    public var fmRatio: Float = 1
    public var fmIndex: Float = 0
    /// Seconds for the FM index to fall to `fmSustain` of its start value.
    public var fmDecay: Float = 0.5
    public var fmSustain: Float = 0.2
    public var noise: Float = 0
    public var attack: Float = 0.005
    public var decay: Float = 0.3
    public var sustain: Float = 0.8
    public var release: Float = 0.3
    public var cutoff: Float = 8000
    public var resonance: Float = 0.1
    /// Filter envelope depth in octaves.
    public var filterEnv: Float = 0
    public var filterDecay: Float = 0.3
    /// 0 ... 1, how much the cutoff follows pitch.
    public var keyTrack: Float = 0.5
    public var vibratoRate: Float = 5
    /// Vibrato depth in semitones.
    public var vibratoDepth: Float = 0
    public var vibratoDelay: Float = 0.3
    public var tremoloRate: Float = 5
    public var tremoloDepth: Float = 0
    /// Seconds for a plucked string to decay by 60 dB.
    public var pluckDecay: Float = 3
    /// 0 ... 1 brightness of plucked strings.
    public var pluckBright: Float = 0.5
    /// "Ahh" vowel formant amount, 0 ... 1.
    public var formant: Float = 0
    public var glide: Float = 0
    public var gain: Float = 0.5
    /// Plays one octave lower (used for basses).
    public var octave: Int32 = 0

    public init() {}

    /// Returns a copy with attack/release scaled by user offsets (in octaves of time).
    public func withEnvelope(attackScale: Float, releaseScale: Float) -> SynthParams {
        var p = self
        p.attack = min(4, max(0.001, attack * attackScale))
        p.release = min(8, max(0.01, release * releaseScale))
        return p
    }
}

/// A named factory or user sound.
public struct SoundPreset: Identifiable, Equatable, Codable, Sendable {
    public var id: String { name }
    public var name: String
    public var params: SynthParams
}

/// The built-in sound library (modelled on the Rev 3.0 browse list).
public enum SoundLibrary {
    public static let factory: [SoundPreset] = {
        var list: [SoundPreset] = []
        func add(_ name: String, _ build: (inout SynthParams) -> Void) {
            var p = SynthParams()
            build(&p)
            list.append(SoundPreset(name: name, params: p))
        }

        add("SAW") { p in
            p.wave = .supersaw; p.detuneCents = 14; p.cutoff = 3200; p.resonance = 0.15
            p.filterEnv = 1.2; p.filterDecay = 0.4; p.attack = 0.004; p.decay = 0.6; p.sustain = 0.7; p.release = 0.35; p.gain = 0.32
        }
        add("SAW BASS") { p in
            p.wave = .saw; p.wave2 = .square; p.osc2Mix = 0.35; p.osc2Semitones = -12; p.octave = -1
            p.cutoff = 600; p.resonance = 0.35; p.filterEnv = 2.5; p.filterDecay = 0.25; p.keyTrack = 0.3
            p.attack = 0.002; p.decay = 0.4; p.sustain = 0.6; p.release = 0.12; p.gain = 0.45
        }
        add("PIANO") { p in
            p.wave = .fm; p.fmRatio = 1; p.fmIndex = 2.2; p.fmDecay = 0.6; p.fmSustain = 0.1; p.wave2 = .triangle; p.osc2Mix = 0.3
            p.attack = 0.002; p.decay = 1.8; p.sustain = 0.0; p.release = 0.35; p.cutoff = 5000; p.keyTrack = 0.6; p.gain = 0.42
        }
        add("TINE EP") { p in
            p.wave = .fm; p.fmRatio = 14; p.fmIndex = 1.6; p.fmDecay = 0.12; p.fmSustain = 0.05; p.wave2 = .sine; p.osc2Mix = 0.6
            p.attack = 0.002; p.decay = 2.4; p.sustain = 0.15; p.release = 0.5; p.cutoff = 7000; p.tremoloRate = 4.5; p.tremoloDepth = 0.12; p.gain = 0.45
        }
        add("ORGAN") { p in
            p.wave = .organ; p.attack = 0.006; p.decay = 0.1; p.sustain = 1; p.release = 0.06; p.cutoff = 9000
            p.vibratoRate = 6.5; p.vibratoDepth = 0.08; p.vibratoDelay = 0; p.gain = 0.3
        }
        add("STRINGS") { p in
            p.wave = .supersaw; p.detuneCents = 18; p.attack = 0.35; p.decay = 0.5; p.sustain = 0.85; p.release = 0.9
            p.cutoff = 2600; p.resonance = 0.05; p.vibratoRate = 5; p.vibratoDepth = 0.06; p.gain = 0.3
        }
        add("HORNS") { p in
            p.wave = .saw; p.wave2 = .saw; p.osc2Mix = 0.5; p.detuneCents = 8; p.attack = 0.05; p.decay = 0.3; p.sustain = 0.8; p.release = 0.2
            p.cutoff = 900; p.filterEnv = 1.8; p.filterDecay = 0.25; p.resonance = 0.1; p.vibratoDepth = 0.05; p.gain = 0.36
        }
        add("BRASS") { p in
            p.wave = .supersaw; p.detuneCents = 10; p.attack = 0.03; p.decay = 0.4; p.sustain = 0.75; p.release = 0.25
            p.cutoff = 1200; p.filterEnv = 2.2; p.filterDecay = 0.35; p.resonance = 0.2; p.gain = 0.32
        }
        add("E.GUITAR") { p in
            p.wave = .pluck; p.pluckDecay = 4; p.pluckBright = 0.7; p.attack = 0.001; p.sustain = 1; p.release = 0.25
            p.cutoff = 3500; p.resonance = 0.2; p.gain = 0.55
        }
        add("CLARINET") { p in
            p.wave = .square; p.attack = 0.04; p.decay = 0.2; p.sustain = 0.9; p.release = 0.12; p.cutoff = 1400; p.resonance = 0.1
            p.keyTrack = 0.8; p.vibratoDepth = 0.04; p.noise = 0.02; p.gain = 0.32
        }
        add("FLUTE") { p in
            p.wave = .sine; p.wave2 = .triangle; p.osc2Mix = 0.3; p.osc2Semitones = 12; p.noise = 0.06; p.attack = 0.06; p.decay = 0.2
            p.sustain = 0.9; p.release = 0.15; p.cutoff = 4000; p.vibratoDepth = 0.07; p.vibratoDelay = 0.25; p.gain = 0.42
        }
        add("GRAND PNO") { p in
            p.wave = .fm; p.fmRatio = 1; p.fmIndex = 3.0; p.fmDecay = 0.4; p.fmSustain = 0.15; p.wave2 = .saw; p.osc2Mix = 0.15; p.detuneCents = 3
            p.attack = 0.001; p.decay = 2.6; p.sustain = 0; p.release = 0.45; p.cutoff = 6000; p.filterEnv = 0.8; p.filterDecay = 0.8; p.gain = 0.42
        }
        add("RETRO EP") { p in
            p.wave = .fm; p.fmRatio = 1; p.fmIndex = 1.2; p.fmDecay = 0.25; p.fmSustain = 0.3; p.attack = 0.003; p.decay = 1.5; p.sustain = 0.3
            p.release = 0.4; p.cutoff = 3000; p.tremoloRate = 5.5; p.tremoloDepth = 0.25; p.gain = 0.45
        }
        add("VOX AHH") { p in
            p.wave = .saw; p.wave2 = .saw; p.osc2Mix = 0.5; p.detuneCents = 9; p.formant = 1; p.attack = 0.25; p.decay = 0.4; p.sustain = 0.9
            p.release = 0.6; p.cutoff = 3000; p.vibratoRate = 5.2; p.vibratoDepth = 0.12; p.gain = 0.55
        }
        add("VIBES") { p in
            p.wave = .fm; p.fmRatio = 4; p.fmIndex = 0.8; p.fmDecay = 0.15; p.fmSustain = 0.1; p.attack = 0.001; p.decay = 2.8; p.sustain = 0
            p.release = 0.8; p.tremoloRate = 6; p.tremoloDepth = 0.3; p.cutoff = 8000; p.gain = 0.5
        }
        add("FM EPIANO") { p in
            p.wave = .fm; p.fmRatio = 1; p.fmIndex = 1.8; p.fmDecay = 0.3; p.fmSustain = 0.2; p.wave2 = .sine; p.osc2Mix = 0.25; p.osc2Semitones = 12
            p.attack = 0.002; p.decay = 2.0; p.sustain = 0.2; p.release = 0.5; p.cutoff = 6000; p.gain = 0.45
        }
        add("AC.GUITAR") { p in
            p.wave = .pluck; p.pluckDecay = 2.5; p.pluckBright = 0.45; p.attack = 0.001; p.sustain = 1; p.release = 0.3; p.cutoff = 6000; p.gain = 0.6
        }
        add("HARP") { p in
            p.wave = .pluck; p.pluckDecay = 5; p.pluckBright = 0.25; p.attack = 0.001; p.sustain = 1; p.release = 1.5; p.cutoff = 5000; p.gain = 0.6
        }
        add("BUZZ ORGAN") { p in
            p.wave = .buzzOrgan; p.attack = 0.004; p.decay = 0.1; p.sustain = 1; p.release = 0.05; p.cutoff = 5000; p.resonance = 0.2; p.gain = 0.26
        }
        add("HUMMING") { p in
            p.wave = .triangle; p.wave2 = .sine; p.osc2Mix = 0.5; p.formant = 0.5; p.attack = 0.3; p.decay = 0.3; p.sustain = 0.9; p.release = 0.5
            p.cutoff = 1200; p.vibratoDepth = 0.1; p.vibratoRate = 4.8; p.gain = 0.6
        }
        add("SINE") { p in
            p.wave = .sine; p.attack = 0.01; p.decay = 0.3; p.sustain = 0.9; p.release = 0.3; p.cutoff = 12000; p.gain = 0.5
        }
        add("FM WOW") { p in
            p.wave = .fm; p.fmRatio = 2; p.fmIndex = 5; p.fmDecay = 1.2; p.fmSustain = 0.05; p.attack = 0.01; p.decay = 1.2; p.sustain = 0.5
            p.release = 0.5; p.cutoff = 4000; p.resonance = 0.4; p.filterEnv = 2; p.filterDecay = 0.6; p.gain = 0.38
        }
        add("ROBBO BASS") { p in
            p.wave = .square; p.wave2 = .saw; p.osc2Mix = 0.5; p.detuneCents = 12; p.octave = -1; p.cutoff = 400; p.resonance = 0.6
            p.filterEnv = 3; p.filterDecay = 0.18; p.attack = 0.002; p.decay = 0.3; p.sustain = 0.5; p.release = 0.1; p.gain = 0.4
        }
        add("SHUTTER") { p in
            p.wave = .pulse; p.attack = 0.002; p.decay = 0.12; p.sustain = 0.25; p.release = 0.1; p.cutoff = 2500; p.resonance = 0.5
            p.filterEnv = 2.5; p.filterDecay = 0.08; p.tremoloRate = 12; p.tremoloDepth = 0.6; p.gain = 0.4
        }
        add("TRIANGLE") { p in
            p.wave = .triangle; p.attack = 0.005; p.decay = 0.3; p.sustain = 0.8; p.release = 0.25; p.cutoff = 10000; p.gain = 0.55
        }
        add("SQUARE") { p in
            p.wave = .square; p.attack = 0.003; p.decay = 0.3; p.sustain = 0.8; p.release = 0.2; p.cutoff = 6000; p.gain = 0.3
        }
        add("SAWSQUARE") { p in
            p.wave = .sawSquare; p.detuneCents = 6; p.attack = 0.003; p.decay = 0.4; p.sustain = 0.7; p.release = 0.25; p.cutoff = 4000
            p.filterEnv = 1; p.filterDecay = 0.3; p.gain = 0.3
        }
        add("OCEAN") { p in
            p.wave = .noise; p.attack = 1.2; p.decay = 1; p.sustain = 0.9; p.release = 2.5; p.cutoff = 900; p.resonance = 0.55
            p.keyTrack = 1; p.vibratoRate = 0.15; p.vibratoDepth = 6; p.vibratoDelay = 0; p.gain = 0.7
        }
        return list
    }()

    /// Sound used when the user records or loads a sample.
    public static func samplePreset(name: String = "MIC SAMPLE") -> SoundPreset {
        var p = SynthParams()
        p.wave = .sample; p.attack = 0.002; p.decay = 0.5; p.sustain = 1; p.release = 0.25; p.cutoff = 14000; p.keyTrack = 0; p.gain = 0.8
        return SoundPreset(name: name, params: p)
    }

    /// Indices used by the yellow + button quick-select shortcuts.
    public static let quickSelect: [String] = ["PIANO", "TINE EP", "STRINGS", "SAW", "SAW BASS", "E.GUITAR", "VOX AHH"]
}
