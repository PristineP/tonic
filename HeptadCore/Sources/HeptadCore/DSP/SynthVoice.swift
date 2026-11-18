import Foundation

/// A sample loaded into one of the engine's sample slots.
struct SampleSlot {
    var data: UnsafeMutablePointer<Float>
    var capacity: Int
    var length: Int = 0
    var sourceRate: Float = 48000
    /// MIDI note the recording sounds at when played back unshifted.
    var rootNote: Float = 60
}

/// One polyphonic synth voice. Plain data; rendered by `SynthVoice.render`.
struct SynthVoice {
    enum Stage: Int8 { case idle, attack, decay, sustain, release, kill }

    static let pluckCapacity = 4096

    var stage: Stage = .idle
    /// Who started the note (live button id, or track id for loop playback).
    var owner: Int32 = -1
    /// Which patch slot this voice reads its parameters from.
    var patch: Int32 = 0
    var note: Int32 = 0
    var velocity: Float = 0.8
    var startOrder: UInt64 = 0
    /// MIDI channel the note was sent on (0xFF = not sent).
    var midiChannel: UInt8 = 0xFF

    var freq: Float = 440
    var targetFreq: Float = 440
    var phase1: Float = 0
    var phase2: Float = 0
    var phase3: Float = 0
    var modPhase: Float = 0
    var env: Float = 0
    var fmEnv: Float = 1
    var filterEnv: Float = 1
    var age: Int = 0
    var vibPhase: Float = 0
    var tremPhase: Float = 0
    var filter = SVF()
    var formantA = SVF()
    var formantB = SVF()
    var rng: UInt32 = 22222
    /// Samples until an automatic release (-1 = hold until released).
    var releaseIn: Int = -1
    /// Samples to wait before sounding (strums).
    var delay: Int = 0
    var panL: Float = 0.707
    var panR: Float = 0.707
    /// Additional gain (e.g. drone crossfades, loop-track levels are applied separately).
    var gainScale: Float = 1

    // Plucked string state
    var ks: UnsafeMutablePointer<Float>?
    var ksWrite: Int = 0
    var ksDelay: Float = 100
    var ksLast: Float = 0
    var ksFeedback: Float = 0.99

    // Sample playback
    var samplePos: Double = 0
    var sampleRate: Double = 1

    var isActive: Bool { stage != .idle }
    var isReleasing: Bool { stage == .release || stage == .kill }

    mutating func start(
        note: Int32, velocity: Float, owner: Int32, patch: Int32, params: SynthParams,
        sampleRate sr: Float, order: UInt64, delay: Int, glideFrom: Float?, pan: Float,
        sample: SampleSlot?
    ) {
        self.note = note
        self.velocity = velocity
        self.owner = owner
        self.patch = patch
        self.startOrder = order
        self.delay = max(0, delay)
        let n = Float(note) + Float(params.octave * 12)
        targetFreq = midiToHz(n)
        freq = glideFrom ?? targetFreq
        phase1 = 0
        phase2 = 0.37
        phase3 = 0.71
        modPhase = 0
        env = 0
        fmEnv = 1
        filterEnv = 1
        age = 0
        vibPhase = 0
        tremPhase = 0
        filter.reset()
        formantA.reset()
        formantB.reset()
        rng = 0x9E37_79B9 &+ UInt32(truncatingIfNeeded: order &* 2_654_435_761)
        releaseIn = -1
        gainScale = 1
        let angle = (clamp(pan, -1, 1) + 1) * Float.pi / 4
        panL = Float(cos(Double(angle)))
        panR = Float(sin(Double(angle)))
        stage = .attack

        if params.wave == .pluck, let ks {
            // Excite the string with filtered noise.
            ksDelay = min(Float(SynthVoice.pluckCapacity - 4), max(2, sr / targetFreq - 0.5))
            let length = Int(ksDelay) + 2
            var lp: Float = 0
            let a = 0.15 + 0.85 * params.pluckBright
            for i in 0..<SynthVoice.pluckCapacity { ks[i] = 0 }
            for i in 0..<length {
                lp += a * (whiteNoise(&rng) - lp)
                ks[i] = lp
            }
            ksWrite = length
            ksLast = 0
            ksFeedback = Float(pow(10.0, -3.0 / Double(max(0.05, params.pluckDecay) * targetFreq)))
        }
        if params.wave == .sample, let sample, sample.length > 0 {
            samplePos = 0
            self.sampleRate = Double(sample.sourceRate / sr) * pow(2.0, Double(n - sample.rootNote) / 12.0)
        }
    }

    mutating func release() {
        if stage != .idle && stage != .kill { stage = .release }
        if delay > 0 { stage = .idle } // never sounded
    }

    /// Fast fade used for voice stealing and mutes.
    mutating func kill() {
        if stage != .idle { stage = delay > 0 ? .idle : .kill }
    }

    /// Renders and accumulates `frames` samples into the stereo buffers.
    mutating func render(
        _ p: SynthParams, frames: Int, sampleRate sr: Float,
        left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>,
        table: UnsafeMutablePointer<Float>, sample: SampleSlot?, gain trackGain: Float
    ) {
        guard stage != .idle else { return }
        // `releaseIn` counts from now, independent of any start delay. Releasing at
        // block granularity (64 frames, ~1 ms) is inaudible.
        if releaseIn >= 0 {
            if releaseIn < frames {
                releaseIn = -1
                release()
                if stage == .idle { return }
            } else {
                releaseIn -= frames
            }
        }
        var start = 0
        if delay > 0 {
            if delay >= frames { delay -= frames; return }
            start = delay
            delay = 0
        }

        let n = frames - start
        let invSr = 1 / sr

        // Per-block modulation
        let attackInc = 1 / max(p.attack * sr, 1)
        let decayK = decayCoef(p.decay, sr)
        let releaseK = decayCoef(p.release, sr)
        let killDec: Float = 1 / (0.004 * sr)
        let fmK = decayCoef(p.fmDecay, sr)
        let fEnvK = decayCoef(p.filterDecay, sr)

        if p.glide > 0.0005 {
            let g = Float(exp(-Double(n) / Double(p.glide * sr * 0.25)))
            freq = targetFreq + (freq - targetFreq) * g
        } else {
            freq = targetFreq
        }

        var vib: Float = 1
        if p.vibratoDepth > 0 {
            let ageSec = Float(age) * invSr
            let ramp = p.vibratoDelay > 0 ? clamp(ageSec / p.vibratoDelay - 0.5, 0, 1) : 1
            vibPhase += p.vibratoRate * Float(n) * invSr
            vibPhase -= vibPhase.rounded(.down)
            vib = Float(pow(2.0, Double(p.vibratoDepth * ramp * sin01(vibPhase, table)) / 12))
        }
        var trem: Float = 1
        if p.tremoloDepth > 0 {
            tremPhase += p.tremoloRate * Float(n) * invSr
            tremPhase -= tremPhase.rounded(.down)
            trem = 1 - p.tremoloDepth * (0.5 + 0.5 * sin01(tremPhase, table))
        }

        let f = freq * vib
        let dt = min(f * invSr, 0.49)
        let detune = Float(pow(2.0, Double(p.detuneCents) / 1200))
        let dt2 = min(dt * Float(pow(2.0, Double(p.osc2Semitones) / 12)) * (p.osc2Mix > 0 ? detune : 1), 0.49)
        let dtUp = min(dt * detune, 0.49)
        let dtDown = dt / detune
        let modDt = dt * p.fmRatio

        // Filter cutoff with key tracking and envelope
        let keyFactor = Float(pow(Double(targetFreq / 261.63), Double(p.keyTrack)))
        let cutoff = p.cutoff * keyFactor * Float(pow(2.0, Double(p.filterEnv * filterEnv)))
        filter.set(cutoff: cutoff, resonance: p.resonance, sampleRate: sr)
        filterEnv *= Float(pow(Double(fEnvK), Double(n)))
        let useFormant = p.formant > 0.001
        if useFormant {
            formantA.set(cutoff: 750, q: 5, sampleRate: sr)
            formantB.set(cutoff: 1200, q: 6, sampleRate: sr)
        }
        let velGain = (0.35 + 0.65 * velocity) * p.gain * gainScale * trem * trackGain
        let osc2Mix = p.osc2Mix
        let osc1Mix = 1 - 0.5 * osc2Mix
        let fmBase = p.fmIndex
        let fmSus = p.fmSustain

        for i in start..<frames {
            // Envelope
            switch stage {
            case .attack:
                env += attackInc
                if env >= 1 { env = 1; stage = .decay }
            case .decay:
                env = p.sustain + (env - p.sustain) * decayK
                if env - p.sustain < 0.0005 { stage = .sustain }
            case .sustain:
                env = p.sustain
                if p.sustain <= 0.0001 { stage = .idle }
            case .release:
                env *= releaseK
                if env < 0.0002 { stage = .idle }
            case .kill:
                env -= killDec
                if env <= 0 { env = 0; stage = .idle }
            case .idle:
                break
            }
            if stage == .idle { break }

            // Oscillators
            var s: Float
            switch p.wave {
            case .sine:
                s = sin01(phase1, table)
            case .triangle:
                s = 4 * abs(phase1 - 0.5) - 1
            case .saw:
                s = 2 * phase1 - 1 - polyBlep(phase1, dt)
            case .square, .pulse:
                let pw: Float = p.wave == .pulse ? 0.25 : 0.5
                s = (phase1 < pw ? 1 : -1) + polyBlep(phase1, dt)
                var t2 = phase1 + 1 - pw
                t2 -= t2.rounded(.down)
                s -= polyBlep(t2, dt)
            case .sawSquare:
                let saw = 2 * phase1 - 1 - polyBlep(phase1, dt)
                var sq: Float = (phase3 < 0.5 ? 1 : -1) + polyBlep(phase3, dtUp)
                var t2 = phase3 + 0.5
                t2 -= t2.rounded(.down)
                sq -= polyBlep(t2, dtUp)
                s = 0.6 * saw + 0.5 * sq
            case .supersaw:
                let a = 2 * phase1 - 1 - polyBlep(phase1, dt)
                let b = 2 * phase2 - 1 - polyBlep(phase2, dtUp)
                let c = 2 * phase3 - 1 - polyBlep(phase3, dtDown)
                s = 0.5 * (a + 0.75 * (b + c))
            case .fm:
                let idx = fmBase * (fmSus + (1 - fmSus) * fmEnv)
                fmEnv *= fmK
                s = sin01(phase1 + idx * 0.159_154_9 * sin01(modPhase, table), table)
                modPhase += modDt
                if modPhase >= 1 { modPhase -= modPhase.rounded(.down) }
            case .organ, .buzzOrgan:
                // Drawbars: 16', 8', 5 1/3', 4', 2 2/3', 2' on a sub-octave phase.
                let ph = phase1 * 0.5 + (phase3 >= 0.5 ? 0.5 : 0)
                let w: (Float, Float, Float, Float, Float, Float) = p.wave == .organ
                    ? (0.55, 1.0, 0.45, 0.55, 0.25, 0.2)
                    : (0.3, 1.0, 0.7, 0.8, 0.7, 0.6)
                s = w.0 * sin01(ph, table) + w.1 * sin01(2 * ph, table) + w.2 * sin01(3 * ph, table)
                    + w.3 * sin01(4 * ph, table) + w.4 * sin01(6 * ph, table) + w.5 * sin01(8 * ph, table)
                s *= 0.42
                if p.wave == .buzzOrgan { s = s * 1.8 / (1 + abs(s * 1.8)) }
            case .noise:
                s = whiteNoise(&rng)
            case .pluck:
                if let ks {
                    let mask = SynthVoice.pluckCapacity - 1
                    let pos = Float(ksWrite) - ksDelay
                    let i0 = Int(pos.rounded(.down))
                    let frac = pos - Float(i0)
                    let a = ks[i0 & mask]
                    let b = ks[(i0 + 1) & mask]
                    let v = a + (b - a) * frac
                    let avg = 0.5 * (v + ksLast)
                    ksLast = v
                    let bright = 0.5 * p.pluckBright
                    let out = (avg * (1 - bright) + v * bright) * ksFeedback
                    ks[ksWrite & mask] = out
                    ksWrite = (ksWrite + 1) & mask
                    s = out * 1.6
                } else {
                    s = 0
                }
            case .sample:
                if let sample, sample.length > 1 {
                    let i0 = Int(samplePos)
                    if i0 >= sample.length - 1 {
                        s = 0
                        stage = .idle
                    } else {
                        let frac = Float(samplePos - Double(i0))
                        let a = sample.data[i0]
                        s = a + (sample.data[i0 + 1] - a) * frac
                        samplePos += sampleRate
                    }
                } else {
                    s = 0
                }
            }

            // Second oscillator
            if osc2Mix > 0 {
                var s2: Float
                switch p.wave2 {
                case .sine: s2 = sin01(phase2, table)
                case .triangle: s2 = 4 * abs(phase2 - 0.5) - 1
                case .square, .pulse:
                    s2 = (phase2 < 0.5 ? 1 : -1) + polyBlep(phase2, dt2)
                    var t2 = phase2 + 0.5
                    t2 -= t2.rounded(.down)
                    s2 -= polyBlep(t2, dt2)
                default: s2 = 2 * phase2 - 1 - polyBlep(phase2, dt2)
                }
                s = s * osc1Mix + s2 * osc2Mix
            }
            if p.noise > 0 { s += p.noise * whiteNoise(&rng) }

            // Phase advance
            phase1 += dt
            if phase1 >= 1 { phase1 -= 1 }
            if p.wave == .supersaw || p.wave == .sawSquare {
                phase3 += p.wave == .supersaw ? dtDown : dtUp
                if phase3 >= 1 { phase3 -= 1 }
            } else if p.wave == .organ || p.wave == .buzzOrgan {
                // phase3 toggles each cycle of phase1 to build the sub-octave
                if phase1 < dt { phase3 = phase3 >= 0.5 ? 0 : 0.5 }
            }
            phase2 += (p.wave == .supersaw) ? dtUp : dt2
            if phase2 >= 1 { phase2 -= 1 }

            // Formant & filter
            if useFormant {
                let fa = formantA.process(s).band
                let fb = formantB.process(s).band
                s = s * (1 - p.formant) + (fa * 1.6 + fb * 1.1) * p.formant
            }
            s = filter.lowpass(s)

            let out = s * env * velGain
            left[i] += out * panL
            right[i] += out * panR
        }
        age += n
    }
}
