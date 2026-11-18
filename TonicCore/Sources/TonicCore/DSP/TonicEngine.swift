import Foundation

/// The complete Tonic sound engine: synth voices, drums, effects, clock, arpeggiator,
/// chord sequencer, beat machine and six-track looper.
///
/// Thread model: the UI thread calls `send(_:)`; the audio thread calls `render(...)`.
/// Everything the audio thread touches is preallocated, and the two sides communicate only
/// through lock-free queues, so rendering never blocks or allocates.
public final class TonicEngine {
    // MARK: Configuration

    public static let maxVoices = 48
    public static let maxDrumVoices = 24
    public static let trackCount = 6
    static let chunk = 64
    static let maxEventsPerTrack = 2048
    static let patchSlots = 8 // 0 live, 1-6 loop tracks, 7 spare

    // Owners
    static let ownerArp: Int32 = 20
    static let ownerRepeat: Int32 = 21
    static let ownerDrone: Int32 = 22
    static let ownerSeq: Int32 = 23
    static let ownerPreview: Int32 = 24
    static let ownerDrumLive: Int32 = 30
    static let ownerDrumBeat: Int32 = 31
    static let ownerMetronome: Int32 = 32
    static let ownerTrackBase: Int32 = 100

    public private(set) var sampleRate: Float

    // MARK: Cross-thread

    private let commands = SPSCQueue<EngineCommand>(capacity: 1024)
    /// MIDI produced by the engine; drained by the MIDI output on another thread.
    public let midiOut = SPSCQueue<MIDIMessage>(capacity: 4096)
    private let statusPtr: UnsafeMutablePointer<EngineStatus>
    public static let scopeSize = 512
    private let scope: UnsafeMutablePointer<Float>
    private var scopeWrite = 0

    // MARK: Voices & DSP

    private let voices: UnsafeMutablePointer<SynthVoice>
    private let drums: UnsafeMutablePointer<DrumVoice>
    private let pluckBuffers: UnsafeMutablePointer<Float>
    private let patches: UnsafeMutablePointer<SynthParams>
    private let trackKits: UnsafeMutablePointer<Int32>
    /// [kit * 7 + pad]
    private let kitPads: UnsafeMutablePointer<DrumPad>
    private static let kitCount = DrumKit.allCases.count
    private var fx: EffectsChain
    private let table = DSP.sineTable
    private let mixL: UnsafeMutablePointer<Float>
    private let mixR: UnsafeMutablePointer<Float>
    private var samples: (SampleSlot, SampleSlot)
    private var activeSample: Int32 = -1
    private let beatTable = BeatTable()
    private var voiceOrder: UInt64 = 0
    private var drumSeed: UInt32 = 1

    // MARK: Performance state

    private var style: PerformStyle = .chord
    private var held: UnsafeMutablePointer<NoteSet> // per live id 0..15
    private var heldActive: UnsafeMutablePointer<Bool>
    private static let liveIds = 16
    private var lastMonoFreq: Float?
    private var strumSamples: Float = 0.02
    private var volume: Float = 0.8
    private var smoothedVolume: Float = 0.8
    private var masterCutoff: Float = 20000
    private var masterFilter = (SVF(), SVF())
    private var rng: UInt32 = 0x1234_5678

    // Arp / repeat
    private var arpPattern: ArpPattern = .up
    private var arpRate: NoteRate = .sixteenth
    private var arpLatch = false
    private var arpNotes = NoteSet()
    private var arpOwnerId: Int32 = -1
    private var arpRunning = false
    private var arpIndex = 0
    private var arpOrigin: Double = 0
    private var repeatRate: NoteRate = .eighth
    private var repeatNotes = NoteSet()
    private var repeatOwnerId: Int32 = -1
    private var repeatRunning = false
    private var repeatOrigin: Double = 0
    private var droneId: Int32 = -1
    private var droneNotes = NoteSet()
    private var drumRepeatMask: UInt8 = 0

    // Vocoder
    private var vocoder = Vocoder()
    private var vocoderOn = false
    /// Microphone samples for the vocoder, written by the mic thread.
    private let modulatorRing = SPSCQueue<Float>(capacity: 32768)
    private let carrierL: UnsafeMutablePointer<Float>
    private let carrierR: UnsafeMutablePointer<Float>
    private let modL: UnsafeMutablePointer<Float>
    private let modR: UnsafeMutablePointer<Float>

    // Clock
    private var tempo: Float = 100
    private var beatPos: Double = 0

    // Sequencer
    private var seqSteps: UnsafeMutablePointer<NoteSet>
    private var seqLength = 0
    private var seqStepBeats: Double = 2
    private var seqPlaying = false
    private var seqOrigin: Double = 0
    private var seqCurrent = -1

    // Beat machine
    private var kit: Int32 = 0
    private var beatOn = false
    private var beatStyle: Int32 = 0
    private var beatVariation: Int32 = 0
    private var beatStep: Int32 = -1

    // Looper
    struct LoopEvent {
        var pos: Double
        var note: Int16
        var velocity: Float
        var on: Bool
        var drum: Bool
    }
    private let events: UnsafeMutablePointer<LoopEvent>
    private let eventCounts: UnsafeMutablePointer<Int>
    private let trackStates: UnsafeMutablePointer<TrackState>
    private let trackLevels: UnsafeMutablePointer<Float>
    private var loopBars: Int32 = 2 // 0 = free
    private var masterLength: Double = 0
    private var loopOrigin: Double = 0
    private var transportPlaying = false
    private var recTrack = -1
    private var recStart: Double = 0     // absolute beat when recording began
    private var recLoopStart: Double = 0 // loop position at which an overdub began
    private var countInEnd: Double? = nil
    private var metronomeOn = false
    private var lastMetronomeBeat: Int = Int.min

    // MARK: Init

    public init(sampleRate: Double = 48000) {
        let maxRate: Float = 96000
        self.sampleRate = Float(sampleRate)
        _ = DSP.sineTable[0] // build the table off the audio thread

        voices = .allocate(capacity: TonicEngine.maxVoices)
        voices.initialize(repeating: SynthVoice(), count: TonicEngine.maxVoices)
        pluckBuffers = .allocate(capacity: TonicEngine.maxVoices * SynthVoice.pluckCapacity)
        pluckBuffers.initialize(repeating: 0, count: TonicEngine.maxVoices * SynthVoice.pluckCapacity)
        for i in 0..<TonicEngine.maxVoices {
            voices[i].ks = pluckBuffers + i * SynthVoice.pluckCapacity
        }
        drums = .allocate(capacity: TonicEngine.maxDrumVoices)
        drums.initialize(repeating: DrumVoice(), count: TonicEngine.maxDrumVoices)
        patches = .allocate(capacity: TonicEngine.patchSlots)
        patches.initialize(repeating: SoundLibrary.factory[2].params, count: TonicEngine.patchSlots)
        trackKits = .allocate(capacity: TonicEngine.trackCount)
        trackKits.initialize(repeating: 0, count: TonicEngine.trackCount)
        kitPads = .allocate(capacity: TonicEngine.kitCount * 7)
        kitPads.initialize(from: DrumKit.allCases.flatMap { $0.pads }, count: TonicEngine.kitCount * 7)
        fx = EffectsChain(maxSampleRate: maxRate)
        mixL = .allocate(capacity: TonicEngine.chunk)
        mixR = .allocate(capacity: TonicEngine.chunk)
        mixL.initialize(repeating: 0, count: TonicEngine.chunk)
        mixR.initialize(repeating: 0, count: TonicEngine.chunk)
        carrierL = .allocate(capacity: TonicEngine.chunk)
        carrierR = .allocate(capacity: TonicEngine.chunk)
        modL = .allocate(capacity: TonicEngine.chunk)
        modR = .allocate(capacity: TonicEngine.chunk)
        for p in [carrierL, carrierR, modL, modR] { p.initialize(repeating: 0, count: TonicEngine.chunk) }
        let sampleCap = Int(maxRate * 3)
        let s0 = UnsafeMutablePointer<Float>.allocate(capacity: sampleCap)
        let s1 = UnsafeMutablePointer<Float>.allocate(capacity: sampleCap)
        s0.initialize(repeating: 0, count: sampleCap)
        s1.initialize(repeating: 0, count: sampleCap)
        samples = (SampleSlot(data: s0, capacity: sampleCap), SampleSlot(data: s1, capacity: sampleCap))
        held = .allocate(capacity: TonicEngine.liveIds)
        held.initialize(repeating: NoteSet(), count: TonicEngine.liveIds)
        heldActive = .allocate(capacity: TonicEngine.liveIds)
        heldActive.initialize(repeating: false, count: TonicEngine.liveIds)
        seqSteps = .allocate(capacity: 16)
        seqSteps.initialize(repeating: NoteSet(), count: 16)
        events = .allocate(capacity: TonicEngine.trackCount * TonicEngine.maxEventsPerTrack)
        eventCounts = .allocate(capacity: TonicEngine.trackCount)
        eventCounts.initialize(repeating: 0, count: TonicEngine.trackCount)
        trackStates = .allocate(capacity: TonicEngine.trackCount)
        trackStates.initialize(repeating: .empty, count: TonicEngine.trackCount)
        trackLevels = .allocate(capacity: TonicEngine.trackCount)
        trackLevels.initialize(repeating: 1, count: TonicEngine.trackCount)
        statusPtr = .allocate(capacity: 1)
        statusPtr.initialize(to: EngineStatus())
        scope = .allocate(capacity: TonicEngine.scopeSize)
        scope.initialize(repeating: 0, count: TonicEngine.scopeSize)
        configure(sampleRate: sampleRate)
    }

    deinit {
        voices.deallocate(); pluckBuffers.deallocate(); drums.deallocate(); patches.deallocate()
        trackKits.deallocate(); kitPads.deallocate(); mixL.deallocate(); mixR.deallocate()
        carrierL.deallocate(); carrierR.deallocate(); modL.deallocate(); modR.deallocate()
        samples.0.data.deallocate(); samples.1.data.deallocate()
        held.deallocate(); heldActive.deallocate(); seqSteps.deallocate(); events.deallocate()
        eventCounts.deallocate(); trackStates.deallocate(); trackLevels.deallocate()
        statusPtr.deallocate(); scope.deallocate()
    }

    /// Must not be called while the audio thread is rendering.
    public func configure(sampleRate: Double) {
        let sr = Float(min(max(sampleRate, 8000), 96000))
        self.sampleRate = sr
        fx.configure(sampleRate: sr)
        vocoder.configure(sampleRate: sr)
        fx.bpm = tempo
        strumSamples = 0.02 * sr
        masterFilter.0.set(cutoff: masterCutoff, resonance: 0.1, sampleRate: sr)
        masterFilter.1.set(cutoff: masterCutoff, resonance: 0.1, sampleRate: sr)
        for i in 0..<TonicEngine.maxVoices { voices[i].stage = .idle }
        for i in 0..<TonicEngine.maxDrumVoices { drums[i].active = false }
    }

    // MARK: UI-thread API

    /// Queues a command for the audio thread. Returns false if the queue is full.
    @discardableResult
    public func send(_ command: EngineCommand) -> Bool { commands.push(command) }

    /// Latest engine status (safe to call from any thread; values may be a buffer old).
    public var status: EngineStatus { statusPtr.pointee }

    /// Copies the most recent output samples (oldest first) for an oscilloscope.
    public func copyScope(into out: inout [Float]) {
        let n = TonicEngine.scopeSize
        if out.count != n { out = Array(repeating: 0, count: n) }
        let w = scopeWrite
        for i in 0..<n { out[i] = scope[(w + i) % n] }
    }

    /// Buffer that the UI may fill with a recorded sample before sending `.useSample`.
    /// Only write to the slot that is not currently active.
    public func sampleBuffer(slot: Int) -> (pointer: UnsafeMutablePointer<Float>, capacity: Int) {
        slot == 0 ? (samples.0.data, samples.0.capacity) : (samples.1.data, samples.1.capacity)
    }

    /// Feeds microphone audio to the vocoder. Call from a single (microphone) thread.
    public func pushModulator(_ samples: UnsafePointer<Float>, count: Int) {
        for i in 0..<count where !modulatorRing.push(samples[i]) { break }
    }

    // MARK: Render

    /// Renders `frames` of stereo audio into the two non-interleaved buffers.
    public func render(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
        while let cmd = commands.pop() { handle(cmd) }
        var offset = 0
        var peak: Float = 0
        while offset < frames {
            let n = min(TonicEngine.chunk, frames - offset)
            processChunk(n, outL: left + offset, outR: right + offset, peak: &peak, renderOffset: offset)
            offset += n
        }
        publishStatus(peak: peak)
    }

    private func processChunk(_ n: Int, outL: UnsafeMutablePointer<Float>, outR: UnsafeMutablePointer<Float>,
                              peak: inout Float, renderOffset: Int) {
        let sr = sampleRate
        let spb = Double(sr) * 60 / Double(tempo) // samples per beat
        let chunkBeats = Double(n) / spb
        let t0 = beatPos
        let t1 = beatPos + chunkBeats

        scheduleClock(t0: t0, t1: t1, spb: spb)

        mixL.update(repeating: 0, count: n)
        mixR.update(repeating: 0, count: n)
        let sample0 = activeSample == 0 ? samples.0 : samples.1
        let sample: SampleSlot? = activeSample < 0 ? nil : sample0
        let vocoding = vocoderOn
        let trackModulator = vocoding && vocoder.params.source == .track1
        if vocoding {
            carrierL.update(repeating: 0, count: n)
            carrierR.update(repeating: 0, count: n)
            modL.update(repeating: 0, count: n)
            modR.update(repeating: 0, count: n)
            if !trackModulator {
                for i in 0..<n { modL[i] = modulatorRing.pop() ?? 0 }
            }
        } else {
            // Discard stale microphone audio so it never lags when the vocoder starts.
            var dropped = 0
            while dropped < 4096, modulatorRing.pop() != nil { dropped += 1 }
        }
        for i in 0..<TonicEngine.maxVoices where voices[i].isActive {
            let v = voices[i]
            let patch = patches[Int(v.patch)]
            let trackGain: Float = v.owner >= TonicEngine.ownerTrackBase
                ? trackLevels[Int(v.owner - TonicEngine.ownerTrackBase)] : 1
            var outL = mixL, outR = mixR
            if vocoding && v.owner < TonicEngine.ownerTrackBase && v.owner != TonicEngine.ownerPreview {
                outL = carrierL; outR = carrierR // live playing is the carrier
            } else if trackModulator && v.owner == TonicEngine.ownerTrackBase {
                outL = modL; outR = modR // loop track 1 is the voice
            }
            voices[i].render(patch, frames: n, sampleRate: sr, left: outL, right: outR, table: table,
                             sample: sample, gain: trackGain)
        }
        if vocoding {
            for i in 0..<n {
                carrierL[i] = 0.5 * (carrierL[i] + carrierR[i])
                modL[i] = trackModulator ? 0.5 * (modL[i] + modR[i]) : modL[i]
            }
            vocoder.process(carrier: carrierL, modulator: modL, frames: n, outL: mixL, outR: mixR)
        }
        for i in 0..<TonicEngine.maxDrumVoices where drums[i].active {
            let owner = drums[i].owner
            let g: Float = owner >= TonicEngine.ownerTrackBase
                ? trackLevels[Int(owner - TonicEngine.ownerTrackBase)] : 1
            drums[i].render(frames: n, sampleRate: sr, left: mixL, right: mixR, table: table, gain: g * 0.7)
        }
        fx.process(left: mixL, right: mixR, frames: n, table: table)

        let volK: Float = 0.002
        let filterOn = masterCutoff < 19000
        for i in 0..<n {
            smoothedVolume += (volume - smoothedVolume) * volK
            var l = mixL[i]
            var r = mixR[i]
            if filterOn {
                l = masterFilter.0.lowpass(l)
                r = masterFilter.1.lowpass(r)
            }
            let g = smoothedVolume * smoothedVolume * 1.4
            l = softClip(l * g)
            r = softClip(r * g)
            outL[i] = l
            outR[i] = r
            peak = max(peak, abs(l), abs(r))
            scope[scopeWrite] = 0.5 * (l + r)
            scopeWrite = scopeWrite + 1 >= TonicEngine.scopeSize ? 0 : scopeWrite + 1
        }
        beatPos = t1
    }

    @inline(__always) private func softClip(_ x: Float) -> Float {
        let c = clamp(x, -3, 3)
        return clamp(c * (27 + c * c) / (27 + 9 * c * c), -1, 1)
    }

    private func publishStatus(peak: Float) {
        var s = EngineStatus()
        s.beat = beatPos
        s.tempo = tempo
        s.loopLength = masterLength
        s.loopPosition = masterLength > 0 && transportPlaying ? loopPosition(at: beatPos) : 0
        s.tracks = (trackStates[0].rawValue, trackStates[1].rawValue, trackStates[2].rawValue,
                    trackStates[3].rawValue, trackStates[4].rawValue, trackStates[5].rawValue)
        s.recordingTrack = Int32(recTrack)
        if let c = countInEnd { s.countIn = Float(max(0, c - beatPos)) }
        s.beatStep = beatOn ? beatStep : -1
        s.seqStep = seqPlaying ? Int32(seqCurrent) : -1
        s.peak = peak
        s.transportPlaying = transportPlaying
        s.beatOn = beatOn
        s.seqPlaying = seqPlaying
        var count: Int32 = 0
        for i in 0..<TonicEngine.maxVoices where voices[i].isActive { count += 1 }
        s.activeVoices = count
        statusPtr.pointee = s
    }

    // MARK: Commands

    private func handle(_ cmd: EngineCommand) {
        switch cmd {
        case let .press(id, notes, velocity): press(id: id, notes: notes, velocity: velocity)
        case let .release(id): releaseLive(id: id)
        case .releaseAll:
            for id in 0..<TonicEngine.liveIds where heldActive[id] { releaseLive(id: Int32(id)) }
            stopDrone()
            arpRunning = false
            repeatRunning = false
        case let .drum(pad, velocity): liveDrum(pad: Int(pad), velocity: velocity, delay: 0)
        case let .style(s):
            if s != style {
                for id in 0..<TonicEngine.liveIds where heldActive[id] { releaseLive(id: Int32(id)) }
                if style == .drone { stopDrone() }
                arpRunning = false
                repeatRunning = false
                style = s
            }
        case let .patch(p): patches[0] = p
        case let .fx(p): fx.set(p)
        case let .tempo(t):
            tempo = min(max(t, 30), 300)
            fx.bpm = tempo
        case let .arp(pattern, rate, latch):
            arpPattern = pattern
            arpRate = rate
            if arpLatch && !latch && arpOwnerId >= 0 && !heldActive[Int(arpOwnerId)] { arpRunning = false }
            arpLatch = latch
        case let .repeatRate(r): repeatRate = r
        case let .strumSpeed(ms): strumSamples = max(0, ms) * 0.001 * sampleRate
        case let .kit(k): kit = min(max(k, 0), Int32(TonicEngine.kitCount - 1))
        case let .beat(styleIdx, variation, on):
            beatStyle = min(max(styleIdx, 0), Int32(BeatStyle.allCases.count - 1))
            beatVariation = min(max(variation, 0), Int32(BeatTable.variations - 1))
            if on && !beatOn {
                if !clockBusy { resetClock() }
                beatOn = true
            } else if !on {
                beatOn = false
                beatStep = -1
            }
        case let .seqStep(index, notes):
            if index >= 0 && index < 16 { seqSteps[Int(index)] = notes }
        case let .seqLength(len): seqLength = Int(min(max(len, 0), 16))
        case let .seqStepBeats(b): seqStepBeats = Double(min(max(b, 0.25), 8))
        case let .seqPlay(on):
            if on && !seqPlaying {
                if !clockBusy { resetClock(); seqOrigin = 0 } else { seqOrigin = beatPos.rounded(.up) }
                seqPlaying = true
                seqCurrent = -1
            } else if !on {
                seqPlaying = false
                seqCurrent = -1
                releaseOwner(TonicEngine.ownerSeq)
            }
        case let .loopRecord(track): loopRecord(Int(track))
        case let .loopMute(track, muted):
            guard (0..<TonicEngine.trackCount).contains(Int(track)) else { return }
            let t = Int(track)
            if muted, trackStates[t] == .playing {
                trackStates[t] = .muted
                killOwner(TonicEngine.ownerTrackBase + Int32(t))
            } else if !muted, trackStates[t] == .muted {
                trackStates[t] = .playing
            }
        case let .loopLevel(track, level):
            if (0..<TonicEngine.trackCount).contains(Int(track)) { trackLevels[Int(track)] = min(max(level, 0), 1.5) }
        case let .loopClear(track):
            if track < 0 {
                for t in 0..<TonicEngine.trackCount { clearTrack(t) }
            } else if Int(track) < TonicEngine.trackCount {
                clearTrack(Int(track))
            }
        case let .loopBars(b): loopBars = min(max(b, 0), 8)
        case let .transport(playing): setTransport(playing)
        case let .master(vol, cutoff):
            volume = min(max(vol, 0), 1)
            masterCutoff = min(max(cutoff, 60), 20000)
            masterFilter.0.set(cutoff: masterCutoff, resonance: 0.25, sampleRate: sampleRate)
            masterFilter.1.set(cutoff: masterCutoff, resonance: 0.25, sampleRate: sampleRate)
        case let .metronome(on): metronomeOn = on
        case let .useSample(slot, length, sourceRate, rootNote):
            if slot == 0 {
                samples.0.length = min(Int(length), samples.0.capacity)
                samples.0.sourceRate = sourceRate
                samples.0.rootNote = rootNote
            } else {
                samples.1.length = min(Int(length), samples.1.capacity)
                samples.1.sourceRate = sourceRate
                samples.1.rootNote = rootNote
            }
            activeSample = slot
        case let .preview(notes, delay, duration):
            let d = Int(delay * sampleRate)
            let len = Int(duration * sampleRate)
            for i in 0..<Int(notes.count) {
                startVoice(note: notes[i], velocity: 0.8, owner: TonicEngine.ownerPreview, patch: 0, delay: d, gate: len)
            }
        case .stopPreview: killOwner(TonicEngine.ownerPreview)
        case let .vocoder(on, params):
            if on && !vocoderOn { vocoder.reset() }
            vocoderOn = on
            vocoder.set(params)
        case let .drumRepeat(pad, on):
            guard pad >= 0 && pad < 7 else { return }
            if on { drumRepeatMask |= (1 << UInt8(pad)) } else { drumRepeatMask &= ~(1 << UInt8(pad)) }
        }
    }

    /// Whether anything is following the clock (so new parts should align rather than reset it).
    private var clockBusy: Bool {
        beatOn || seqPlaying || (transportPlaying && masterLength > 0) || countInEnd != nil || recTrack >= 0 || arpRunning || repeatRunning
    }

    /// Whether a clocked part is playing that new parts should lock to.
    private var gridRunning: Bool { beatOn || seqPlaying || (transportPlaying && masterLength > 0) }

    private func resetClock() {
        beatPos = 0
        lastMetronomeBeat = Int.min
        arpOrigin = 0
        repeatOrigin = 0
    }

    // MARK: Live performance

    private func press(id: Int32, notes: NoteSet, velocity: Float) {
        guard id >= 0 && Int(id) < TonicEngine.liveIds else { return }
        let wasHeld = heldActive[Int(id)] // re-voicing a held chord (joystick moved)
        if wasHeld { releaseLive(id: id) }
        held[Int(id)] = notes
        heldActive[Int(id)] = true

        switch style {
        case .chord:
            let mono = notes.count == 1
            let glideFrom: Float? = mono && patches[0].glide > 0 ? lastMonoFreq : nil
            playNotes(notes, owner: id, velocity: velocity, strum: 0, glideFrom: glideFrom)
            if mono { lastMonoFreq = midiToHz(Float(notes[0]) + Float(patches[0].octave * 12)) }
        case .strum:
            playNotes(strumExpand(notes), owner: id, velocity: velocity, strum: strumSamples, glideFrom: nil)
        case .drone:
            if droneId == id && !wasHeld {
                // Pressing the droning button again stops the drone.
                stopDrone()
                heldActive[Int(id)] = false
                return
            }
            stopDrone()
            droneId = id
            droneNotes = notes
            for i in 0..<Int(notes.count) {
                if let v = startVoice(note: notes[i], velocity: velocity, owner: TonicEngine.ownerDrone, patch: 0, delay: 0) {
                    voices[v].gainScale = 0.9
                }
                recordLive(note: notes[i], velocity: velocity, on: true, delay: 0)
            }
        case .arp:
            arpNotes = notes
            arpOwnerId = id
            if !arpRunning {
                arpRunning = true
                arpIndex = 0
                arpDirectionUp = true
                if gridRunning {
                    arpOrigin = 0 // stay on the global grid
                } else {
                    arpOrigin = beatPos
                    arpStep(delay: 0)
                }
            }
        case .repeatGate:
            repeatNotes = notes
            repeatOwnerId = id
            if !repeatRunning {
                repeatRunning = true
                if gridRunning {
                    repeatOrigin = 0
                } else {
                    repeatOrigin = beatPos
                    repeatTrigger(delay: 0)
                }
            }
        }
    }

    private func releaseLive(id: Int32) {
        guard id >= 0 && Int(id) < TonicEngine.liveIds, heldActive[Int(id)] else { return }
        heldActive[Int(id)] = false
        let notes = held[Int(id)]
        switch style {
        case .chord, .strum:
            releaseOwner(id)
            let expanded = style == .strum ? strumExpand(notes) : notes
            for i in 0..<Int(expanded.count) { recordLive(note: expanded[i], velocity: 0, on: false, delay: 0) }
        case .drone:
            break // drones sustain until another chord or the same button
        case .arp:
            if arpOwnerId == id && !arpLatch {
                // Fall back to another held chord if there is one.
                if let other = latestHeld() {
                    arpNotes = held[other]
                    arpOwnerId = Int32(other)
                } else {
                    arpRunning = false
                }
            }
        case .repeatGate:
            if repeatOwnerId == id {
                if let other = latestHeld() {
                    repeatNotes = held[other]
                    repeatOwnerId = Int32(other)
                } else {
                    repeatRunning = false
                }
            }
        }
        // Voices started under a different style for this id still need releasing.
        releaseOwner(id)
    }

    private func latestHeld() -> Int? {
        for id in 0..<TonicEngine.liveIds where heldActive[id] { return id }
        return nil
    }

    private func stopDrone() {
        guard droneId >= 0 else { return }
        releaseOwner(TonicEngine.ownerDrone)
        for i in 0..<Int(droneNotes.count) { recordLive(note: droneNotes[i], velocity: 0, on: false, delay: 0) }
        droneId = -1
        droneNotes = NoteSet()
    }

    /// Adds octave doublings so a strum sounds like six strings.
    private func strumExpand(_ notes: NoteSet) -> NoteSet {
        guard notes.count > 0 else { return notes }
        var out = notes
        var i = 0
        while out.count < 6 {
            out.append(notes[i % Int(notes.count)] + 12 * (1 + i / Int(notes.count)))
            i += 1
        }
        return out
    }

    private func playNotes(_ notes: NoteSet, owner: Int32, velocity: Float, strum: Float, glideFrom: Float?) {
        for i in 0..<Int(notes.count) {
            let delay = Int(strum * Float(i))
            _ = startVoice(note: notes[i], velocity: velocity, owner: owner, patch: 0, delay: delay, glideFrom: glideFrom)
            recordLive(note: notes[i], velocity: velocity, on: true, delay: delay)
        }
    }

    // MARK: Clock-driven parts

    private var arpDirectionUp = true

    private func scheduleClock(t0: Double, t1: Double, spb: Double) {
        // Count-in → recording start
        if let c = countInEnd, c < t1 {
            countInEnd = nil
            if recTrack >= 0 && trackStates[recTrack] == .armed {
                trackStates[recTrack] = .recording
                recStart = c
            }
        }

        // Metronome clicks (count-in, and while recording if enabled)
        if countInEnd != nil || (metronomeOn && recTrack >= 0 && trackStates[recTrack] == .recording) {
            let b = Int(t1.rounded(.down))
            if Double(b) >= t0 && b != lastMetronomeBeat {
                lastMetronomeBeat = b
                let d = Int((Double(b) - t0) * spb)
                metronomeClick(accent: b % 4 == 0, delay: max(0, d))
            }
        }

        // Arpeggiator
        if arpRunning {
            let rate = arpRate.stepsPerBeat
            let a = ((t0 - arpOrigin) * rate).rounded(.down)
            let b = ((t1 - arpOrigin) * rate).rounded(.down)
            if b > a {
                let stepBeat = arpOrigin + b / rate
                arpStep(delay: max(0, Int((stepBeat - t0) * spb)))
            }
        }

        // Repeat gate
        if repeatRunning {
            let rate = repeatRate.stepsPerBeat
            let a = ((t0 - repeatOrigin) * rate).rounded(.down)
            let b = ((t1 - repeatOrigin) * rate).rounded(.down)
            if b > a {
                let stepBeat = repeatOrigin + b / rate
                repeatTrigger(delay: max(0, Int((stepBeat - t0) * spb)))
            }
        }

        // Drum note-repeat (16ths)
        if drumRepeatMask != 0 {
            let a = (t0 * 4).rounded(.down)
            let b = (t1 * 4).rounded(.down)
            if b > a {
                let d = max(0, Int((b / 4 - t0) * spb))
                for pad in 0..<7 where drumRepeatMask & (1 << UInt8(pad)) != 0 {
                    liveDrum(pad: pad, velocity: 0.7, delay: d)
                }
            }
        }

        // Chord sequencer
        if seqPlaying && seqLength > 0 {
            let a = ((t0 - seqOrigin) / seqStepBeats).rounded(.down)
            let b = ((t1 - seqOrigin) / seqStepBeats).rounded(.down)
            if b > a || seqCurrent < 0 {
                if t1 >= seqOrigin {
                    let stepIndex = Int(b) % seqLength
                    let stepBeat = seqOrigin + b * seqStepBeats
                    let d = max(0, Int((stepBeat - t0) * spb))
                    seqCurrent = stepIndex
                    releaseOwner(TonicEngine.ownerSeq)
                    let notes = seqSteps[stepIndex]
                    let gate = Int(seqStepBeats * 0.94 * spb)
                    for i in 0..<Int(notes.count) {
                        startVoice(note: notes[i], velocity: 0.8, owner: TonicEngine.ownerSeq, patch: 0, delay: d, gate: gate)
                        recordNote(note: notes[i], velocity: 0.8, delay: d, gateBeats: seqStepBeats * 0.94, drum: false)
                    }
                }
            }
        }

        // Beat machine
        if beatOn {
            let a = (t0 * 4).rounded(.down)
            let b = (t1 * 4).rounded(.down)
            if b > a || beatStep < 0 {
                let stepAbs = Int(b)
                let step = ((stepAbs % 16) + 16) % 16
                beatStep = Int32(step)
                var stepBeat = b / 4
                let swing = BeatStyle(rawValue: Int(beatStyle))?.swing ?? 0
                if step % 4 == 2 { stepBeat += Double(swing) / 6 }
                let d = max(0, Int((stepBeat - t0) * spb))
                for pad in 0..<BeatTable.pads {
                    let vel = beatTable.velocity(style: Int(beatStyle), variation: Int(beatVariation), step: step, pad: pad)
                    if vel > 0 {
                        triggerDrum(kitPad(Int(kit), pad), pad: pad, velocity: vel, owner: TonicEngine.ownerDrumBeat, delay: d)
                        drumMIDI(pad: pad, velocity: vel, delay: d)
                    }
                }
            }
        }

        // Loop playback
        if transportPlaying && masterLength > 0 {
            playLoops(t0: t0, t1: t1, spb: spb)
            // Auto-finish recordings
            if recTrack >= 0 && trackStates[recTrack] == .recording {
                if t1 - recStart >= masterLength { finishRecording() }
            }
        } else if recTrack >= 0 && trackStates[recTrack] == .recording && masterLength == 0 && loopBars > 0 {
            if t1 - recStart >= Double(loopBars) * 4 {
                finishRecording(length: Double(loopBars) * 4)
            }
        } else if recTrack >= 0 && trackStates[recTrack] == .recording && masterLength == 0 && loopBars == 0 {
            if t1 - recStart >= 64 { finishRecording() } // free mode cap
        }
    }

    private func arpStep(delay: Int) {
        let n = Int(arpNotes.count)
        guard n > 0 else { return }
        let total = arpPattern == .upTwoOctaves ? n * 2 : n
        var idx: Int
        switch arpPattern {
        case .up, .upTwoOctaves:
            idx = arpIndex % total
            arpIndex += 1
        case .down:
            idx = total - 1 - (arpIndex % total)
            arpIndex += 1
        case .upDown:
            if total == 1 { idx = 0 } else {
                let cycle = 2 * (total - 1)
                let p = arpIndex % cycle
                idx = p < total ? p : cycle - p
            }
            arpIndex += 1
        case .random:
            idx = Int(whiteNoiseU() % UInt32(total))
        case .converge:
            let p = arpIndex % total
            idx = p % 2 == 0 ? p / 2 : total - 1 - p / 2
            arpIndex += 1
        }
        let note = arpNotes[idx % n] + (idx >= n ? 12 : 0)
        let gateBeats = 0.5 / arpRate.stepsPerBeat
        let spb = Double(sampleRate) * 60 / Double(tempo)
        startVoice(note: note, velocity: 0.8, owner: TonicEngine.ownerArp, patch: 0, delay: delay, gate: Int(gateBeats * spb))
        recordNote(note: note, velocity: 0.8, delay: delay, gateBeats: gateBeats, drum: false)
    }

    private func repeatTrigger(delay: Int) {
        let gateBeats = 0.45 / repeatRate.stepsPerBeat
        let spb = Double(sampleRate) * 60 / Double(tempo)
        for i in 0..<Int(repeatNotes.count) {
            startVoice(note: repeatNotes[i], velocity: 0.8, owner: TonicEngine.ownerRepeat, patch: 0, delay: delay, gate: Int(gateBeats * spb))
            recordNote(note: repeatNotes[i], velocity: 0.8, delay: delay, gateBeats: gateBeats, drum: false)
        }
    }

    private func whiteNoiseU() -> UInt32 {
        rng ^= rng << 13
        rng ^= rng >> 17
        rng ^= rng << 5
        return rng
    }

    private func metronomeClick(accent: Bool, delay: Int) {
        let pad = DrumPad(.rim, tune: accent ? 2.4 : 1.8, decay: 0.03, tone: 0.5, level: accent ? 0.9 : 0.6)
        triggerDrum(pad, pad: 6, velocity: 1, owner: TonicEngine.ownerMetronome, delay: delay)
    }

    private func liveDrum(pad: Int, velocity: Float, delay: Int) {
        guard pad >= 0 && pad < 7 else { return }
        triggerDrum(kitPad(Int(kit), pad), pad: pad, velocity: velocity, owner: TonicEngine.ownerDrumLive, delay: delay)
        drumMIDI(pad: pad, velocity: velocity, delay: delay)
        if recTrack >= 0 {
            if trackStates[recTrack] == .armed && masterLength == 0 && loopBars == 0 { beginFreeRecording() }
            if trackStates[recTrack] == .recording {
                trackKits[recTrack] = kit
                appendEvent(track: recTrack, pos: recordPosition(delay: delay), note: Int16(pad), velocity: velocity, on: true, drum: true)
            }
        }
    }

    // MARK: Voice management

    @discardableResult
    /// Starts a voice. `gate`, if given, is the note length in samples after its start delay.
    private func startVoice(note: Int, velocity: Float, owner: Int32, patch: Int32, delay: Int, gate: Int? = nil,
                            glideFrom: Float? = nil) -> Int? {
        let p = patches[Int(patch)]
        var slot = -1
        for i in 0..<TonicEngine.maxVoices where !voices[i].isActive { slot = i; break }
        if slot < 0 {
            // Steal the oldest releasing voice, else the oldest voice.
            var best = -1
            var bestOrder = UInt64.max
            for i in 0..<TonicEngine.maxVoices where voices[i].isReleasing && voices[i].startOrder < bestOrder {
                best = i; bestOrder = voices[i].startOrder
            }
            if best < 0 {
                for i in 0..<TonicEngine.maxVoices where voices[i].startOrder < bestOrder {
                    best = i; bestOrder = voices[i].startOrder
                }
            }
            slot = best
            if slot >= 0 && !voices[slot].isReleasing && voices[slot].releaseIn < 0 {
                emitMIDI(status: 0x80 | voices[slot].midiChannel, note: UInt8(clamping: voices[slot].note), velocity: 0, delay: 0)
            }
        }
        guard slot >= 0 else { return nil }
        voiceOrder &+= 1
        // Spread chord notes across the stereo field.
        let pan = Float((note % 7) - 3) / 3 * 0.6
        let sample: SampleSlot? = activeSample < 0 ? nil : (activeSample == 0 ? samples.0 : samples.1)
        voices[slot].start(note: Int32(note), velocity: velocity, owner: owner, patch: patch, params: p,
                           sampleRate: sampleRate, order: voiceOrder, delay: delay, glideFrom: glideFrom,
                           pan: pan, sample: sample)
        let ch = midiChannel(forOwner: owner)
        voices[slot].midiChannel = ch
        let sendMIDI = owner != TonicEngine.ownerPreview
        if sendMIDI {
            emitMIDI(status: 0x90 | ch, note: UInt8(clamping: note), velocity: UInt8(min(127, max(1, velocity * 127))), delay: delay)
        }
        if let gate {
            voices[slot].releaseIn = delay + max(1, gate)
            if sendMIDI {
                emitMIDI(status: 0x80 | ch, note: UInt8(clamping: note), velocity: 0, delay: delay + max(1, gate))
            }
        }
        if !sendMIDI { voices[slot].midiChannel = 0xFF }
        return slot
    }

    private func releaseOwner(_ owner: Int32) {
        for i in 0..<TonicEngine.maxVoices where voices[i].isActive && voices[i].owner == owner && !voices[i].isReleasing {
            // Auto-released notes already sent their note-off.
            if voices[i].releaseIn < 0 { noteOffMIDI(voices[i], delay: 0) }
            voices[i].release()
            voices[i].releaseIn = -1
        }
    }

    private func killOwner(_ owner: Int32) {
        for i in 0..<TonicEngine.maxVoices where voices[i].isActive && voices[i].owner == owner {
            if !voices[i].isReleasing && voices[i].releaseIn < 0 { noteOffMIDI(voices[i], delay: 0) }
            voices[i].kill()
            voices[i].releaseIn = -1
        }
        for i in 0..<TonicEngine.maxDrumVoices where drums[i].active && drums[i].owner == owner {
            drums[i].choke = true
        }
    }

    private func releaseNote(owner: Int32, note: Int, delay: Int) {
        for i in 0..<TonicEngine.maxVoices
        where voices[i].isActive && voices[i].owner == owner && voices[i].note == note && !voices[i].isReleasing && voices[i].releaseIn < 0 {
            voices[i].releaseIn = delay
            noteOffMIDI(voices[i], delay: delay)
            return
        }
    }

    private func triggerDrum(_ pad: DrumPad, pad index: Int, velocity: Float, owner: Int32, delay: Int) {
        var slot = -1
        for i in 0..<TonicEngine.maxDrumVoices where !drums[i].active { slot = i; break }
        if slot < 0 {
            var oldest = 0
            for i in 1..<TonicEngine.maxDrumVoices where drums[i].t > drums[oldest].t { oldest = i }
            slot = oldest
        }
        // A closed hat chokes ringing open hats.
        if pad.sound == .closedHat {
            for i in 0..<TonicEngine.maxDrumVoices where drums[i].active && drums[i].sound == .openHat && drums[i].delay <= delay {
                drums[i].choke = true
            }
        }
        drumSeed = drumSeed &* 1_664_525 &+ 1_013_904_223
        drums[slot].start(pad, pad: index, velocity: velocity, owner: owner, delay: delay, seed: drumSeed, sampleRate: sampleRate)
    }

    @inline(__always) private func kitPad(_ kit: Int, _ pad: Int) -> DrumPad {
        kitPads[min(max(kit, 0), TonicEngine.kitCount - 1) * 7 + pad]
    }

    // MARK: MIDI out

    /// Drum hits go out on channel 10 with a short gate.
    private func drumMIDI(pad: Int, velocity: Float, delay: Int) {
        let note = DrumKit.gmNotes[pad]
        emitMIDI(status: 0x99, note: note, velocity: UInt8(min(127, max(1, velocity * 127))), delay: delay)
        emitMIDI(status: 0x89, note: note, velocity: 0, delay: delay + Int(0.05 * sampleRate))
    }

    /// Live playing goes out on the channel of the track that would record next.
    private func midiChannel(forOwner owner: Int32) -> UInt8 {
        if owner >= TonicEngine.ownerTrackBase { return UInt8(owner - TonicEngine.ownerTrackBase) }
        if recTrack >= 0 { return UInt8(recTrack) }
        for t in 0..<TonicEngine.trackCount where trackStates[t] == .empty { return UInt8(t) }
        return 0
    }

    private func noteOffMIDI(_ v: SynthVoice, delay: Int) {
        guard v.midiChannel != 0xFF else { return }
        emitMIDI(status: 0x80 | v.midiChannel, note: UInt8(clamping: v.note), velocity: 0, delay: delay)
    }

    private func emitMIDI(status: UInt8, note: UInt8, velocity: UInt8, delay: Int) {
        midiOut.push(MIDIMessage(status: status, data1: min(note, 127), data2: min(velocity, 127), sampleOffset: Int32(clamping: delay)))
    }

    // MARK: Looper

    @inline(__always) private func loopPosition(at beat: Double) -> Double {
        guard masterLength > 0 else { return 0 }
        let p = (beat - loopOrigin).truncatingRemainder(dividingBy: masterLength)
        return p < 0 ? p + masterLength : p
    }

    private func setTransport(_ playing: Bool) {
        if playing {
            if !transportPlaying {
                resetClock()
                loopOrigin = 0
                transportPlaying = masterLength > 0
            }
        } else {
            if recTrack >= 0 { cancelRecording() }
            transportPlaying = false
            beatOn = false
            beatStep = -1
            if seqPlaying { seqPlaying = false; releaseOwner(TonicEngine.ownerSeq) }
            for t in 0..<TonicEngine.trackCount { killOwner(TonicEngine.ownerTrackBase + Int32(t)) }
        }
    }

    private func loopRecord(_ track: Int) {
        guard (0..<TonicEngine.trackCount).contains(track) else { return }
        if recTrack == track {
            switch trackStates[track] {
            case .recording: finishRecording()
            case .armed: cancelRecording()
            default: break
            }
            return
        }
        if recTrack >= 0 {
            if trackStates[recTrack] == .recording { finishRecording() } else { cancelRecording() }
        }
        let busy = clockBusy
        killOwner(TonicEngine.ownerTrackBase + Int32(track))
        eventCounts[track] = 0
        trackKits[track] = kit
        patches[track + 1] = patches[0]
        recTrack = track

        if masterLength == 0 {
            // This recording defines the loop.
            for t in 0..<TonicEngine.trackCount where t != track && trackStates[t] != .empty { clearTrack(t) }
            if loopBars > 0 {
                trackStates[track] = .armed
                if !busy {
                    beatPos = -4 // one-bar count-in, recording starts at beat 0
                    lastMetronomeBeat = Int.min
                    countInEnd = 0
                } else {
                    countInEnd = (beatPos / 4).rounded(.up) * 4
                }
            } else {
                trackStates[track] = .armed // waits for the first note
            }
        } else {
            if !transportPlaying {
                resetClock()
                loopOrigin = 0
                transportPlaying = true
            }
            trackStates[track] = .recording
            recStart = beatPos
            recLoopStart = loopPosition(at: beatPos)
        }
    }

    private func beginFreeRecording() {
        guard recTrack >= 0, trackStates[recTrack] == .armed, masterLength == 0, loopBars == 0 else { return }
        trackStates[recTrack] = .recording
        recStart = beatPos
    }

    /// Ends the current take. `length` fixes the loop length of a first take (bar mode);
    /// otherwise a first take's length is however long it ran, rounded to whole beats.
    private func finishRecording(length: Double? = nil) {
        guard recTrack >= 0 else { return }
        let t = recTrack
        let isMaster = masterLength == 0
        if isMaster {
            masterLength = length ?? min(64, max(1, (beatPos - recStart).rounded()))
            loopOrigin = recStart
            transportPlaying = true
        }
        // Close notes still held.
        let endPos = recordPosition(delay: 0)
        for id in 0..<TonicEngine.liveIds where heldActive[id] {
            let notes = style == .strum ? strumExpand(held[id]) : held[id]
            for i in 0..<Int(notes.count) {
                appendEvent(track: t, pos: endPos, note: Int16(notes[i]), velocity: 0, on: false, drum: false)
            }
        }
        if droneId >= 0 {
            for i in 0..<Int(droneNotes.count) {
                appendEvent(track: t, pos: endPos, note: Int16(droneNotes[i]), velocity: 0, on: false, drum: false)
            }
        }
        // Normalise positions into the loop and keep the event list sorted.
        let base = t * TonicEngine.maxEventsPerTrack
        let count = eventCounts[t]
        for i in 0..<count {
            var p = events[base + i].pos.truncatingRemainder(dividingBy: masterLength)
            if p < 0 { p += masterLength }
            events[base + i].pos = p
        }
        sortEvents(track: t)
        trackStates[t] = count > 0 ? .playing : .empty
        recTrack = -1
        countInEnd = nil
        if isMaster && count == 0 {
            masterLength = 0
            transportPlaying = false
        }
    }

    private func cancelRecording() {
        guard recTrack >= 0 else { return }
        let t = recTrack
        eventCounts[t] = 0
        trackStates[t] = .empty
        recTrack = -1
        countInEnd = nil
        if masterLength == 0 { transportPlaying = false }
    }

    private func clearTrack(_ t: Int) {
        if recTrack == t { recTrack = -1; countInEnd = nil }
        killOwner(TonicEngine.ownerTrackBase + Int32(t))
        eventCounts[t] = 0
        trackStates[t] = .empty
        var any = false
        for i in 0..<TonicEngine.trackCount where trackStates[i] != .empty { any = true }
        if !any && recTrack < 0 {
            masterLength = 0
            transportPlaying = false
        }
    }

    /// Position (in loop beats, before wrapping) for an event happening `delay` samples from the current chunk.
    private func recordPosition(delay: Int) -> Double {
        let spb = Double(sampleRate) * 60 / Double(tempo)
        let beat = beatPos + Double(delay) / spb
        if masterLength == 0 { return beat - recStart }
        return loopPosition(at: beat)
    }

    /// Records a held-note event from live playing.
    private func recordLive(note: Int, velocity: Float, on: Bool, delay: Int) {
        guard recTrack >= 0 else { return }
        if on && trackStates[recTrack] == .armed && masterLength == 0 && loopBars == 0 { beginFreeRecording() }
        guard trackStates[recTrack] == .recording else { return }
        appendEvent(track: recTrack, pos: recordPosition(delay: delay), note: Int16(note), velocity: velocity, on: on, drum: false)
    }

    /// Records a note with a known length (arp, repeat, sequencer).
    private func recordNote(note: Int, velocity: Float, delay: Int, gateBeats: Double, drum: Bool) {
        guard recTrack >= 0 else { return }
        if trackStates[recTrack] == .armed && masterLength == 0 && loopBars == 0 { beginFreeRecording() }
        guard trackStates[recTrack] == .recording else { return }
        let pos = recordPosition(delay: delay)
        appendEvent(track: recTrack, pos: pos, note: Int16(note), velocity: velocity, on: true, drum: drum)
        appendEvent(track: recTrack, pos: pos + gateBeats, note: Int16(note), velocity: 0, on: false, drum: drum)
    }

    private func appendEvent(track t: Int, pos: Double, note: Int16, velocity: Float, on: Bool, drum: Bool) {
        let count = eventCounts[t]
        // Keep headroom so note-offs always fit.
        if on && count >= TonicEngine.maxEventsPerTrack - 64 { return }
        if count >= TonicEngine.maxEventsPerTrack { return }
        events[t * TonicEngine.maxEventsPerTrack + count] = LoopEvent(pos: pos, note: note, velocity: velocity, on: on, drum: drum)
        eventCounts[t] = count + 1
    }

    /// Stable insertion sort by position (note-offs before note-ons at equal positions).
    private func sortEvents(track t: Int) {
        let base = events + t * TonicEngine.maxEventsPerTrack
        let count = eventCounts[t]
        guard count > 1 else { return }
        for i in 1..<count {
            let e = base[i]
            var j = i - 1
            while j >= 0 && (base[j].pos > e.pos || (base[j].pos == e.pos && base[j].on && !e.on)) {
                base[j + 1] = base[j]
                j -= 1
            }
            base[j + 1] = e
        }
    }

    private func lowerBound(track t: Int, pos: Double) -> Int {
        let base = events + t * TonicEngine.maxEventsPerTrack
        var lo = 0
        var hi = eventCounts[t]
        while lo < hi {
            let mid = (lo + hi) / 2
            if base[mid].pos < pos { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    private func playLoops(t0: Double, t1: Double, spb: Double) {
        let p0 = loopPosition(at: t0)
        let len = masterLength
        let span = t1 - t0
        for t in 0..<TonicEngine.trackCount where trackStates[t] == .playing {
            if p0 + span <= len {
                fire(track: t, from: p0, to: p0 + span, beatOffset: 0, spb: spb)
            } else {
                fire(track: t, from: p0, to: len, beatOffset: 0, spb: spb)
                fire(track: t, from: 0, to: p0 + span - len, beatOffset: len - p0, spb: spb)
            }
        }
    }

    private func fire(track t: Int, from: Double, to: Double, beatOffset: Double, spb: Double) {
        let base = events + t * TonicEngine.maxEventsPerTrack
        let count = eventCounts[t]
        var i = lowerBound(track: t, pos: from)
        let owner = TonicEngine.ownerTrackBase + Int32(t)
        while i < count && base[i].pos < to {
            let e = base[i]
            let d = max(0, Int((e.pos - from + beatOffset) * spb))
            if e.drum {
                if e.on {
                    let k = Int(trackKits[t])
                    let pad = Int(e.note)
                    if pad >= 0 && pad < 7 {
                        triggerDrum(kitPad(k, pad), pad: pad, velocity: e.velocity, owner: owner, delay: d)
                        drumMIDI(pad: pad, velocity: e.velocity, delay: d)
                    }
                }
            } else if e.on {
                _ = startVoice(note: Int(e.note), velocity: e.velocity, owner: owner, patch: Int32(t + 1), delay: d)
            } else {
                releaseNote(owner: owner, note: Int(e.note), delay: d)
            }
            i += 1
        }
    }
}
