import Foundation

/// The three coloured function keys.
public enum FunctionKey: Int, CaseIterable, Sendable {
    case key   // grey
    case sound // yellow
    case mode  // red
}

public enum HapticKind: Sendable { case press, tick, success, warning }

/// Services the device needs from the app.
@MainActor
public protocol DeviceHost: AnyObject {
    func send(_ command: EngineCommand)
    func haptic(_ kind: HapticKind)
    /// Start or stop listening to the microphone (tuner and mic modes).
    func setMicrophoneActive(_ active: Bool)
    /// Record a short sample; answer with `HiChordDevice.sampleCaptured`.
    func captureSample()
    func settingsDidChange()
}

/// The HiChord "firmware": turns key presses into engine commands and draws the OLED.
@MainActor
public final class HiChordDevice {
    public enum Screen: Equatable {
        case home
        case keyMenu, soundMenu, modeMenu
        case keyList, soundList, modeList
    }

    public weak var host: DeviceHost?
    public private(set) var settings: DeviceSettings
    public private(set) var screen: Screen = .home
    public private(set) var listIndex = 0
    public private(set) var sounds: [SoundPreset] = SoundLibrary.factory
    public var status = EngineStatus()
    public var battery: Float? = nil
    public var scope: [Float] = []
    public private(set) var now: TimeInterval = 0

    // Input state
    public private(set) var heldButtons: [Int] = [] // in press order
    public private(set) var heldFunctions: Set<FunctionKey> = []
    public private(set) var joystick: JoyDirection = .center
    private var buttonSwipes: [Int: JoyDirection] = [:]
    private var functionUsedAsModifier: Set<FunctionKey> = []
    private var screenBeforeFunction: Screen = .home
    private var slashBassButtons: Set<Int> = []
    private var slashTarget: [Int: Int] = [:] // bass button -> chord button
    private var lastJoyEvent: TimeInterval = 0
    private var joyHeldSince: TimeInterval = 0
    private var lastInteraction: TimeInterval = 0
    private var tapTimes: [TimeInterval] = []

    // Performance state
    private var lastVoicing: Voicing?
    private var buttonChords: [Int: ChordSpec] = [:]
    public private(set) var displayChord: String?
    private var displayDegree: Int?
    private var lastChordTime: TimeInterval = -100
    private var lastDrumPad: Int?
    private var message: (title: String, detail: String?, until: TimeInterval)?

    // Sequencer
    public private(set) var seqNames: [String] = []

    // Ear trainer
    private var ear = EarTrainer()
    private var earFeedback: (correct: Bool, text: String, until: TimeInterval)?
    private var earNextAt: TimeInterval?

    // Tuner / mic
    public var tuner: PitchDetector.Result?
    public var micLevel: Float = 0
    private var capturing = false

    // Chord Hiro
    public private(set) var hiro = ChordHiro()
    private var hiroFeedbackUntil: TimeInterval = 0
    private var statusStamp: TimeInterval = 0

    /// The engine's beat position extrapolated to now.
    private var beatNow: Double {
        status.beat + max(0, now - statusStamp) * Double(status.tempo) / 60
    }

    // Mixer
    public private(set) var trackLevels: [Float] = Array(repeating: 1, count: HiChordEngine.trackCount)

    public init(settings: DeviceSettings = DeviceSettings()) {
        self.settings = settings
        ear.level = settings.earLevel
    }

    // MARK: Lifecycle

    /// Pushes every setting to the engine (call once the audio engine is running).
    public func syncEngine() {
        send(.style(settings.mode.engineStyle))
        sendPatch()
        send(.fx(settings.fx))
        send(.tempo(Float(settings.bpm)))
        send(.arp(pattern: settings.arpPattern, rate: settings.arpRate, latch: settings.arpLatch))
        send(.repeatRate(settings.repeatRate))
        send(.strumSpeed(settings.strumMs))
        send(.kit(Int32(settings.kit.rawValue)))
        send(.seqStepBeats(Float(settings.seqStepBeats)))
        send(.loopBars(Int32(settings.loopBars)))
        send(.metronome(settings.metronome))
        sendMaster()
        for t in 0..<HiChordEngine.trackCount { send(.loopLevel(track: Int32(t), level: trackLevels[t])) }
        send(.vocoder(on: settings.mode == .vocoder, params: settings.vocoder))
        updateMicrophone()
    }

    /// Asks the host for the microphone only when the current mode needs it.
    private func updateMicrophone() {
        let needsMic = settings.mode.usesMicrophone && !(settings.mode == .vocoder && settings.vocoder.source == .track1)
        host?.setMicrophoneActive(needsMic)
    }

    /// Replaces all settings (e.g. loading a preset).
    public func apply(_ newSettings: DeviceSettings) {
        settings = newSettings
        ear.level = settings.earLevel
        if sounds.firstIndex(where: { $0.name == settings.soundName }) == nil { settings.soundName = "PIANO" }
        syncEngine()
        changed()
    }

    /// Registers the microphone sample sound once a sample exists.
    public func addSampleSound(name: String = "MIC SAMPLE") {
        if !sounds.contains(where: { $0.name == name }) {
            sounds.append(SoundLibrary.samplePreset(name: name))
        }
    }

    public func tick(now: TimeInterval) {
        self.now = now
        statusStamp = now // the host refreshes `status` right before each tick
        if settings.mode == .chordHiro {
            if hiro.phase == .waiting && status.beatOn { hiro.begin(atBeat: beatNow) }
            if hiro.phase == .playing {
                if hiro.advance(toBeat: beatNow) > 0 { hiroFeedbackUntil = now + 0.6; haptic(.warning) }
                if hiro.phase == .done { finishHiro() }
            }
        }
        if let m = message, now > m.until { message = nil }
        if let f = earFeedback, now > f.until { earFeedback = nil }
        if let next = earNextAt, now >= next {
            earNextAt = nil
            askEarQuestion()
        }
        // Joystick auto-repeat in menus.
        if joystick != .center && screen != .home && now - joyHeldSince > 0.45 && now - lastJoyEvent > 0.09 {
            lastJoyEvent = now
            menuJoystick(joystick, repeating: true)
        }
        // Menus close after a few idle seconds (not while a function key is held).
        if screen != .home && heldFunctions.isEmpty && now - lastInteraction > 6 {
            screen = .home
        }
    }

    // MARK: Inputs — chord buttons

    public func pressButton(_ b: Int) {
        guard (0..<7).contains(b), !heldButtons.contains(b) else { return }
        touch()
        heldButtons.append(b)
        haptic(.press)

        // Function-key combinations
        if let f = heldFunctions.first {
            functionUsedAsModifier.insert(f)
            combo(f, button: b)
            return
        }

        switch settings.mode {
        case .play, .strum, .drone, .arp, .repeatGate, .vocoder:
            if settings.slashChords, settings.mode != .arp, let other = heldButtons.first(where: { $0 != b && !slashBassButtons.contains($0) }) {
                // Second button becomes the slash bass of the first.
                slashBassButtons.insert(b)
                slashTarget[b] = other
                playChord(other, bassFrom: b)
                return
            }
            playChord(b)
        case .lead:
            playLead(b)
        case .sequencer:
            if !status.seqPlaying && seqNames.count < 16 {
                let spec = chordSpec(for: b)
                let v = voicing(spec, degree: b)
                send(.seqStep(index: Int32(seqNames.count), notes: NoteSet(v.allNotes.sorted())))
                seqNames.append(spec.name(preferFlats: settings.harmony.prefersFlats))
                send(.seqLength(Int32(seqNames.count)))
                flash("STEP \(seqNames.count)", seqNames.last)
            }
            playChord(b)
        case .drums:
            lastDrumPad = b
            send(.drum(pad: Int32(b), velocity: 0.9))
            if joystick != .center { send(.drumRepeat(pad: Int32(b), on: true)) }
        case .beat:
            let style = BeatStyle(rawValue: b) ?? .rock
            if status.beatOn && settings.beatStyle == style {
                send(.beat(style: Int32(style.rawValue), variation: Int32(settings.beatVariation), on: false))
                status.beatOn = false
            } else {
                settings.beatStyle = style
                send(.beat(style: Int32(style.rawValue), variation: Int32(settings.beatVariation), on: true))
                status.beatOn = true
                changed()
            }
        case .earTrainer:
            answerEar(b)
        case .chordHiro:
            playChord(b)
            if let j = hiro.press(degree: b, atBeat: beatNow) {
                hiroFeedbackUntil = now + 0.6
                haptic(j == .miss ? .warning : .success)
            }
        case .tuner:
            // Reference tone for the scale degree.
            let note = leadNote(b, direction: .center)
            send(.preview(notes: NoteSet([note]), delay: 0, duration: 1.5))
            flash("REF " + NoteNames.noteName(midi: note, preferFlats: settings.harmony.prefersFlats))
        case .mic:
            if !capturing {
                capturing = true
                host?.captureSample()
            }
        case .mixer:
            if b < HiChordEngine.trackCount {
                let state = status.trackState(b)
                if state == .playing || state == .muted {
                    send(.loopMute(track: Int32(b), muted: state == .playing))
                }
            } else {
                send(.transport(playing: !status.transportPlaying))
            }
        }
    }

    public func releaseButton(_ b: Int) {
        guard let idx = heldButtons.firstIndex(of: b) else { return }
        heldButtons.remove(at: idx)
        buttonSwipes[b] = nil
        if slashBassButtons.contains(b) {
            slashBassButtons.remove(b)
            if let target = slashTarget.removeValue(forKey: b), heldButtons.contains(target) {
                playChord(target) // back to the plain chord
            }
            return
        }
        switch settings.mode {
        case .play, .strum, .drone, .arp, .repeatGate, .sequencer, .lead, .vocoder, .chordHiro:
            send(.release(id: Int32(b)))
            // Releasing the chord button also releases slash basses attached to it.
            for (bass, target) in slashTarget where target == b { slashTarget[bass] = nil; slashBassButtons.remove(bass) }
        case .drums:
            send(.drumRepeat(pad: Int32(b), on: false))
        default:
            break
        }
    }

    /// Direction from swiping on a chord key (the touch-screen stand-in for the joystick).
    public func swipeButton(_ b: Int, direction: JoyDirection) {
        guard heldButtons.contains(b), buttonSwipes[b, default: .center] != direction else { return }
        buttonSwipes[b] = direction
        if heldFunctions.isEmpty { retrigger(b) }
    }

    // MARK: Inputs — function keys

    public func pressFunction(_ f: FunctionKey) {
        touch()
        heldFunctions.insert(f)
        functionUsedAsModifier.remove(f)
        haptic(.tick)
        screenBeforeFunction = screen

        switch f {
        case .key:
            screen = (screen == .keyMenu || screen == .keyList) ? .home : .keyMenu
        case .sound:
            screen = (screen == .soundMenu || screen == .soundList) ? .home : .soundMenu
        case .mode:
            if screen == .modeList && listIndex == 0 {
                tapTempo()
                return
            }
            screen = (screen == .modeMenu || screen == .modeList) ? .home : .modeMenu
        }
        listIndex = 0
    }

    public func releaseFunction(_ f: FunctionKey) {
        heldFunctions.remove(f)
        if functionUsedAsModifier.contains(f) {
            functionUsedAsModifier.remove(f)
            screen = screenBeforeFunction == .home ? .home : screenBeforeFunction
        }
    }

    private func combo(_ f: FunctionKey, button b: Int) {
        switch f {
        case .key:
            // Cycle this button's octave: 0, +1, +2, -2, -1
            var o = settings.harmony.buttonOctaves[b] + 1
            if o > 2 { o = -2 }
            settings.harmony.buttonOctaves[b] = o
            flash("BTN \(b + 1) OCT", o == 0 ? "0" : String(format: "%+d", o))
        case .sound:
            let name = SoundLibrary.quickSelect[b]
            selectSound(named: name)
            flash(name)
        case .mode:
            let modes: [PlayMode] = [.play, .strum, .lead, .drone, .arp, .repeatGate, .drums]
            setMode(modes[b])
            flash(modes[b].displayName)
        }
        changed()
    }

    // MARK: Inputs — joystick & wheel

    public func setJoystick(_ dir: JoyDirection) {
        guard dir != joystick else { return }
        let previous = joystick
        joystick = dir
        touch()
        if dir != .center { joyHeldSince = now; lastJoyEvent = now }

        if screen != .home {
            if dir != .center { menuJoystick(dir, repeating: false) }
            return
        }

        switch settings.mode {
        case .play, .strum, .drone, .arp, .repeatGate, .sequencer, .lead, .vocoder:
            if !heldButtons.isEmpty {
                for b in heldButtons where buttonSwipes[b, default: .center] == .center && !slashBassButtons.contains(b) {
                    retrigger(b)
                }
            } else if settings.mode == .sequencer && previous == .center {
                if dir == .left, !seqNames.isEmpty {
                    seqNames.removeLast()
                    send(.seqLength(Int32(seqNames.count)))
                    flash("UNDO STEP", "\(seqNames.count)/16")
                } else if dir == .down {
                    seqNames.removeAll()
                    send(.seqPlay(false))
                    send(.seqLength(0))
                    flash("SEQ CLEARED")
                }
            }
        case .drums:
            for b in heldButtons { send(.drumRepeat(pad: Int32(b), on: dir != .center)) }
        case .beat:
            if previous == .center && (dir == .left || dir == .right) {
                settings.beatVariation = (settings.beatVariation + (dir == .right ? 1 : 7)) % 8
                if status.beatOn {
                    send(.beat(style: Int32(settings.beatStyle.rawValue), variation: Int32(settings.beatVariation), on: true))
                }
                flash("VARIATION", "\(settings.beatVariation + 1)/8")
                changed()
            }
        case .mixer:
            if previous == .center, dir == .up || dir == .down, let t = heldButtons.first, t < HiChordEngine.trackCount {
                trackLevels[t] = min(1.5, max(0, trackLevels[t] + (dir == .up ? 0.1 : -0.1)))
                send(.loopLevel(track: Int32(t), level: trackLevels[t]))
                flash("TRACK \(t + 1)", "\(Int((trackLevels[t] * 100).rounded()))%")
            }
        case .chordHiro:
            if previous == .center && (dir == .left || dir == .right) && hiro.phase != .playing && hiro.phase != .waiting {
                let n = ChordHiro.songs.count
                settings.hiroSong = (settings.hiroSong + (dir == .right ? 1 : n - 1)) % n
                hiro.songIndex = settings.hiroSong
                hiro.stop()
                changed()
            }
        case .earTrainer:
            if previous == .center && dir == .right { askEarQuestion() }
            if previous == .center && (dir == .up || dir == .down) {
                let levels = EarTrainer.Level.allCases
                let i = (settings.earLevel.rawValue + (dir == .up ? 1 : levels.count - 1)) % levels.count
                settings.earLevel = levels[i]
                ear.level = levels[i]
                ear.reset()
                askEarQuestion()
                changed()
            }
        default:
            break
        }
    }

    public func clickJoystick() {
        touch()
        haptic(.tick)
        switch screen {
        case .keyMenu: screen = .keyList; listIndex = 0; return
        case .soundMenu: screen = .soundList; listIndex = 0; return
        case .modeMenu: screen = .modeList; listIndex = 0; return
        case .keyList, .soundList, .modeList: screen = .home; return
        case .home: break
        }
        switch settings.mode {
        case .sequencer:
            if seqNames.isEmpty {
                flash("NO STEPS", "PRESS CHORDS")
            } else {
                send(.seqPlay(!status.seqPlaying))
                status.seqPlaying.toggle()
            }
        case .beat:
            send(.beat(style: Int32(settings.beatStyle.rawValue), variation: Int32(settings.beatVariation), on: !status.beatOn))
            status.beatOn.toggle()
        case .chordHiro:
            if hiro.phase == .playing || hiro.phase == .waiting {
                hiro.stop()
                send(.beat(style: Int32(hiro.song.style.rawValue), variation: 0, on: false))
            } else {
                hiro.songIndex = settings.hiroSong
                hiro.arm()
                send(.beat(style: Int32(hiro.song.style.rawValue), variation: 0, on: true))
            }
        case .earTrainer:
            replayEar()
        case .mic:
            if !capturing { capturing = true; host?.captureSample() }
        case .mixer:
            send(.transport(playing: !status.transportPlaying))
        default:
            loopNext()
        }
    }

    /// The wheel: 0 ... 1.
    public func setWheel(_ value: Float) {
        let v = min(max(value, 0), 1)
        if settings.filterWheel { settings.filter = v } else { settings.volume = v }
        sendMaster()
        changed()
    }

    public var wheelValue: Float { settings.filterWheel ? settings.filter : settings.volume }

    // MARK: Looper (also driven by the app's looper panel)

    /// Records the next empty track, or finishes the take in progress.
    public func loopNext() {
        if status.recordingTrack >= 0 {
            send(.loopRecord(track: status.recordingTrack))
            return
        }
        for t in 0..<HiChordEngine.trackCount where status.trackState(t) == .empty {
            loopRecord(track: t)
            return
        }
        flash("LOOPS FULL", "CLEAR A TRACK")
    }

    public func loopRecord(track t: Int) {
        send(.loopRecord(track: Int32(t)))
        if status.recordingTrack != Int32(t) {
            let free = status.loopLength == 0 && settings.loopBars == 0
            flash("REC TRACK \(t + 1)", free ? "PLAY TO START" : (status.loopLength == 0 ? "COUNT-IN" : nil))
        }
        haptic(.warning)
    }

    public func loopMute(track t: Int, muted: Bool) { send(.loopMute(track: Int32(t), muted: muted)) }

    public func loopClear(track t: Int) {
        send(.loopClear(track: Int32(t)))
        flash(t < 0 ? "LOOPS CLEARED" : "TRACK \(t + 1) CLEARED")
    }

    public func setTransport(playing: Bool) { send(.transport(playing: playing)) }

    public func setLoopBars(_ bars: Int) {
        settings.loopBars = bars
        send(.loopBars(Int32(bars)))
        changed()
    }

    public func setMetronome(_ on: Bool) {
        settings.metronome = on
        send(.metronome(on))
        changed()
    }

    public func setTrackLevel(_ t: Int, _ level: Float) {
        guard (0..<HiChordEngine.trackCount).contains(t) else { return }
        trackLevels[t] = min(max(level, 0), 1.5)
        send(.loopLevel(track: Int32(t), level: trackLevels[t]))
    }

    // MARK: Inputs — microphone

    /// Called by the host after `captureSample`. `rootNote` is the detected pitch (nil if unpitched).
    public func sampleCaptured(success: Bool, rootNote: Int?) {
        capturing = false
        guard success else {
            flash("NO SOUND", "TRY AGAIN")
            haptic(.warning)
            return
        }
        addSampleSound()
        selectSound(named: "MIC SAMPLE")
        let pitch = rootNote.map { NoteNames.noteName(midi: $0, preferFlats: settings.harmony.prefersFlats) } ?? "UNPITCHED"
        setMode(.play)
        flash("SAMPLED!", pitch)
        haptic(.success)
        changed()
    }

    public var isCapturing: Bool { capturing }

    // MARK: Settings helpers used by the app UI

    public func update(_ change: (inout DeviceSettings) -> Void) {
        var s = settings
        change(&s)
        let old = settings
        settings = s
        if old.fx != s.fx { send(.fx(s.fx)) }
        if old.soundName != s.soundName || old.attackScale != s.attackScale || old.releaseScale != s.releaseScale || old.leadGlide != s.leadGlide {
            sendPatch()
        }
        if old.mode != s.mode { setMode(s.mode) }
        if old.bpm != s.bpm { send(.tempo(Float(s.bpm))) }
        if old.volume != s.volume || old.filter != s.filter || old.filterWheel != s.filterWheel { sendMaster() }
        if old.kit != s.kit { send(.kit(Int32(s.kit.rawValue))) }
        if old.arpPattern != s.arpPattern || old.arpRate != s.arpRate || old.arpLatch != s.arpLatch {
            send(.arp(pattern: s.arpPattern, rate: s.arpRate, latch: s.arpLatch))
        }
        if old.repeatRate != s.repeatRate { send(.repeatRate(s.repeatRate)) }
        if old.strumMs != s.strumMs { send(.strumSpeed(s.strumMs)) }
        if old.seqStepBeats != s.seqStepBeats { send(.seqStepBeats(Float(s.seqStepBeats))) }
        if old.loopBars != s.loopBars { send(.loopBars(Int32(s.loopBars))) }
        if old.metronome != s.metronome { send(.metronome(s.metronome)) }
        if old.earLevel != s.earLevel { ear.level = s.earLevel }
        if old.vocoder != s.vocoder {
            send(.vocoder(on: s.mode == .vocoder, params: s.vocoder))
            updateMicrophone()
        }
        changed()
    }

    public var currentSound: SoundPreset {
        sounds.first { $0.name == settings.soundName } ?? sounds[0]
    }

    public func selectSound(named name: String) {
        guard sounds.contains(where: { $0.name == name }) else { return }
        settings.soundName = name
        sendPatch()
        changed()
    }

    public func setMode(_ mode: PlayMode) {
        let old = settings.mode
        if old != mode {
            for b in heldButtons { releaseButton(b) }
            if old == .sequencer { send(.seqPlay(false)) }
            if old == .earTrainer { send(.stopPreview); earNextAt = nil }
            if old == .drums { for p in 0..<7 { send(.drumRepeat(pad: Int32(p), on: false)) } }
            if old == .chordHiro && hiro.phase != .idle {
                hiro.stop()
                send(.beat(style: Int32(hiro.song.style.rawValue), variation: 0, on: false))
            }
        }
        settings.mode = mode
        send(.style(mode.engineStyle))
        sendPatch()
        send(.vocoder(on: mode == .vocoder, params: settings.vocoder))
        updateMicrophone()
        if mode == .earTrainer && old != .earTrainer {
            ear.reset()
            askEarQuestion()
        }
        if mode != .mic { capturing = false }
        changed()
    }

    // MARK: Chords

    private func chordSpec(for b: Int, direction: JoyDirection? = nil) -> ChordSpec {
        let dir = direction ?? effectiveDirection(b)
        return ChordBuilder.chord(degree: b, direction: dir, settings: settings.harmony)
    }

    private func effectiveDirection(_ b: Int) -> JoyDirection {
        let swipe = buttonSwipes[b, default: .center]
        return swipe != .center ? swipe : joystick
    }

    private func voicing(_ spec: ChordSpec, degree: Int) -> Voicing {
        ChordBuilder.voicing(spec, degree: degree, settings: settings.harmony, previous: lastVoicing?.notes)
    }

    private func playChord(_ b: Int, bassFrom bassButton: Int? = nil) {
        var spec = chordSpec(for: b)
        if let bassButton {
            spec.bass = ChordBuilder.diatonic(degree: bassButton, settings: settings.harmony).root
        }
        let v = voicing(spec, degree: b)
        send(.press(id: Int32(b), notes: NoteSet(v.allNotes.sorted()), velocity: 0.8))
        lastVoicing = v
        buttonChords[b] = spec
        displayChord = spec.name(preferFlats: settings.harmony.prefersFlats)
        displayDegree = b
        lastChordTime = now
    }

    private func leadNote(_ b: Int, direction: JoyDirection) -> Int {
        let h = settings.harmony
        let keyRoot = 60 + h.key - (h.key > 6 ? 12 : 0)
        var note = keyRoot + h.scale.leadOffset(button: b) + 12 * (h.octave + h.buttonOctaves[b])
        switch direction {
        case .up: note += 12
        case .down: note -= 12
        case .right: note += 1
        case .left: note -= 1
        case .upRight: note += 13
        case .upLeft: note += 11
        case .downRight: note -= 11
        case .downLeft: note -= 13
        case .center: break
        }
        return min(max(note, 12), 115)
    }

    private func playLead(_ b: Int) {
        let note = leadNote(b, direction: effectiveDirection(b))
        send(.press(id: Int32(b), notes: NoteSet([note]), velocity: 0.8))
        displayChord = NoteNames.noteName(midi: note, preferFlats: settings.harmony.prefersFlats)
        displayDegree = b
        lastChordTime = now
    }

    /// Re-voices a held button after the joystick moved.
    private func retrigger(_ b: Int) {
        switch settings.mode {
        case .lead:
            playLead(b)
        case .play, .strum, .drone, .arp, .repeatGate, .sequencer, .vocoder:
            let spec = chordSpec(for: b)
            guard spec != buttonChords[b] else { return }
            playChord(b)
            haptic(.tick)
        default:
            break
        }
    }

    // MARK: Menus

    struct MenuItem {
        let title: String
        let value: (DeviceSettings) -> String
        let change: (inout DeviceSettings, Int) -> Void
    }

    private func cycle<T: CaseIterable & Equatable>(_ v: T, _ d: Int) -> T {
        let all = Array(T.allCases)
        let i = all.firstIndex(of: v) ?? 0
        return all[((i + d) % all.count + all.count) % all.count]
    }

    private func step(_ v: Float, _ d: Int, by s: Float, _ lo: Float, _ hi: Float) -> Float {
        min(hi, max(lo, ((v + Float(d) * s) / s).rounded() * s))
    }

    private static func pct(_ v: Float) -> String { "\(Int((v * 100).rounded()))%" }

    private var keyItems: [MenuItem] {
        [
            MenuItem(title: "SCALE", value: { $0.harmony.scale.displayName }, change: { s, d in s.harmony.scale = self.cycle(s.harmony.scale, d) }),
            MenuItem(title: "JOYSTICK", value: { $0.harmony.joystickMap.displayName }, change: { s, d in s.harmony.joystickMap = self.cycle(s.harmony.joystickMap, d) }),
            MenuItem(title: "INVERSION", value: { $0.harmony.inversion == 0 ? "ROOT" : "INV \($0.harmony.inversion)" },
                     change: { s, d in s.harmony.inversion = (s.harmony.inversion + d + 4) % 4 }),
            MenuItem(title: "VOICE LEAD", value: { $0.harmony.voiceLeading ? "ON" : "OFF" }, change: { s, _ in s.harmony.voiceLeading.toggle() }),
            MenuItem(title: "BASS", value: { $0.harmony.bassMode.displayName }, change: { s, d in s.harmony.bassMode = self.cycle(s.harmony.bassMode, d) }),
            MenuItem(title: "SLASH 2BTN", value: { $0.slashChords ? "ON" : "OFF" }, change: { s, _ in s.slashChords.toggle() }),
            MenuItem(title: "BTN OCTAVES", value: { $0.harmony.buttonOctaves.allSatisfy { $0 == 0 } ? "FLAT" : "CUSTOM" },
                     change: { s, _ in s.harmony.buttonOctaves = Array(repeating: 0, count: 7) }),
        ]
    }

    private var soundItems: [MenuItem] {
        [
            MenuItem(title: "REVERB", value: { $0.fx.reverb.displayName }, change: { s, d in s.fx.reverb = self.cycle(s.fx.reverb, d) }),
            MenuItem(title: "REV MIX", value: { Self.pct($0.fx.reverbMix) }, change: { s, d in s.fx.reverbMix = self.step(s.fx.reverbMix, d, by: 0.05, 0, 1) }),
            MenuItem(title: "DELAY", value: { $0.fx.delay.displayName }, change: { s, d in s.fx.delay = self.cycle(s.fx.delay, d) }),
            MenuItem(title: "DLY FDBK", value: { Self.pct($0.fx.delayFeedback) }, change: { s, d in s.fx.delayFeedback = self.step(s.fx.delayFeedback, d, by: 0.05, 0, 0.9) }),
            MenuItem(title: "DLY MIX", value: { Self.pct($0.fx.delayMix) }, change: { s, d in s.fx.delayMix = self.step(s.fx.delayMix, d, by: 0.05, 0, 1) }),
            MenuItem(title: "MOD FX", value: { $0.fx.mod.displayName }, change: { s, d in s.fx.mod = self.cycle(s.fx.mod, d) }),
            MenuItem(title: "TREMOLO", value: { $0.fx.tremolo.displayName }, change: { s, d in s.fx.tremolo = self.cycle(s.fx.tremolo, d) }),
            MenuItem(title: "DRIVE", value: { $0.fx.drive.displayName }, change: { s, d in s.fx.drive = self.cycle(s.fx.drive, d) }),
            MenuItem(title: "LO-FI", value: { $0.fx.lofi.displayName }, change: { s, d in s.fx.lofi = self.cycle(s.fx.lofi, d) }),
            MenuItem(title: "SPREAD", value: { Self.pct($0.fx.spread) }, change: { s, d in s.fx.spread = self.step(s.fx.spread, d, by: 0.1, 0, 1) }),
            MenuItem(title: "ATTACK", value: { String(format: "x%.2f", $0.attackScale) },
                     change: { s, d in s.attackScale = min(16, max(0.125, s.attackScale * (d > 0 ? 1.4142 : 0.7071))) }),
            MenuItem(title: "RELEASE", value: { String(format: "x%.2f", $0.releaseScale) },
                     change: { s, d in s.releaseScale = min(16, max(0.125, s.releaseScale * (d > 0 ? 1.4142 : 0.7071))) }),
            MenuItem(title: "WHEEL", value: { $0.filterWheel ? "FILTER" : "VOLUME" }, change: { s, _ in s.filterWheel.toggle() }),
        ]
    }

    private var modeItems: [MenuItem] {
        [
            MenuItem(title: "BPM", value: { "\(Int($0.bpm.rounded()))" }, change: { s, d in s.bpm = min(300, max(40, s.bpm.rounded() + Double(d))) }),
            MenuItem(title: "ARP PATT", value: { $0.arpPattern.displayName }, change: { s, d in s.arpPattern = self.cycle(s.arpPattern, d) }),
            MenuItem(title: "ARP RATE", value: { $0.arpRate.displayName }, change: { s, d in s.arpRate = self.cycle(s.arpRate, d) }),
            MenuItem(title: "ARP LATCH", value: { $0.arpLatch ? "ON" : "OFF" }, change: { s, _ in s.arpLatch.toggle() }),
            MenuItem(title: "REPEAT", value: { $0.repeatRate.displayName }, change: { s, d in s.repeatRate = self.cycle(s.repeatRate, d) }),
            MenuItem(title: "STRUM", value: { "\(Int($0.strumMs))MS" }, change: { s, d in s.strumMs = self.step(s.strumMs, d, by: 4, 0, 120) }),
            MenuItem(title: "DRUM KIT", value: { $0.kit.displayName }, change: { s, d in s.kit = self.cycle(s.kit, d) }),
            MenuItem(title: "SEQ STEP", value: { Self.beatsName($0.seqStepBeats) },
                     change: { s, d in
                         let opts: [Double] = [0.5, 1, 2, 4, 8]
                         let i = opts.firstIndex(of: s.seqStepBeats) ?? 2
                         s.seqStepBeats = opts[min(max(i + d, 0), opts.count - 1)]
                     }),
            MenuItem(title: "LOOP BARS", value: { $0.loopBars == 0 ? "FREE" : "\($0.loopBars)" },
                     change: { s, d in
                         let opts = [0, 1, 2, 4, 8]
                         let i = opts.firstIndex(of: s.loopBars) ?? 2
                         s.loopBars = opts[min(max(i + d, 0), opts.count - 1)]
                     }),
            MenuItem(title: "METRONOME", value: { $0.metronome ? "ON" : "OFF" }, change: { s, _ in s.metronome.toggle() }),
            MenuItem(title: "EAR LEVEL", value: { "\($0.earLevel.rawValue + 1)" }, change: { s, d in s.earLevel = self.cycle(s.earLevel, d) }),
            MenuItem(title: "GLIDE", value: { $0.leadGlide <= 0.001 ? "OFF" : "\(Int(($0.leadGlide * 1000).rounded()))MS" },
                     change: { s, d in s.leadGlide = self.step(s.leadGlide, d, by: 0.02, 0, 0.5) }),
            MenuItem(title: "SCOPE", value: { $0.showScope ? "ON" : "OFF" }, change: { s, _ in s.showScope.toggle() }),
            MenuItem(title: "VOC SOURCE", value: { $0.vocoder.source.displayName }, change: { s, d in s.vocoder.source = self.cycle(s.vocoder.source, d) }),
            MenuItem(title: "VOC FORMANT", value: { String(format: "x%.2f", $0.vocoder.formant) },
                     change: { s, d in s.vocoder.formant = self.step(s.vocoder.formant, d, by: 0.05, 0.5, 2) }),
            MenuItem(title: "VOC NOISE", value: { Self.pct($0.vocoder.noise) }, change: { s, d in s.vocoder.noise = self.step(s.vocoder.noise, d, by: 0.05, 0, 1) }),
        ]
    }

    private static func beatsName(_ b: Double) -> String {
        switch b {
        case 0.5: return "1/8"
        case 1: return "1/4"
        case 2: return "1/2"
        case 4: return "1 BAR"
        default: return "2 BARS"
        }
    }

    private var currentItems: [MenuItem] {
        switch screen {
        case .keyList: return keyItems
        case .soundList: return soundItems
        case .modeList: return modeItems
        default: return []
        }
    }

    private func menuJoystick(_ dir: JoyDirection, repeating: Bool) {
        let horizontal = dir == .left ? -1 : (dir == .right ? 1 : 0)
        let vertical = dir == .up ? -1 : (dir == .down ? 1 : 0)
        switch screen {
        case .keyMenu:
            if horizontal != 0 {
                update { $0.harmony.key = mod12($0.harmony.key + horizontal) }
            } else if vertical != 0 {
                update { $0.harmony.octave = min(2, max(-2, $0.harmony.octave - vertical)) }
            }
            haptic(.tick)
        case .soundMenu:
            if horizontal != 0 {
                let i = sounds.firstIndex { $0.name == settings.soundName } ?? 0
                selectSound(named: sounds[(i + horizontal + sounds.count) % sounds.count].name)
                haptic(.tick)
            } else if dir == .up && !repeating {
                screen = .soundList
                listIndex = 0
            }
        case .modeMenu:
            if horizontal != 0 {
                let all = PlayMode.allCases
                setMode(all[(settings.mode.rawValue + horizontal + all.count) % all.count])
                haptic(.tick)
            } else if dir == .up && !repeating {
                screen = .modeList
                listIndex = 0
            }
        case .keyList, .soundList, .modeList:
            let items = currentItems
            if vertical != 0 {
                listIndex = min(max(listIndex + vertical, 0), items.count - 1)
                haptic(.tick)
            } else if horizontal != 0, items.indices.contains(listIndex) {
                let item = items[listIndex]
                update { item.change(&$0, horizontal) }
                haptic(.tick)
            }
        case .home:
            break
        }
    }

    private func tapTempo() {
        tapTimes = tapTimes.filter { now - $0 < 2.5 }
        tapTimes.append(now)
        if tapTimes.count >= 2 {
            let intervals = zip(tapTimes.dropFirst(), tapTimes).map { $0 - $1 }
            let avg = intervals.reduce(0, +) / Double(intervals.count)
            if avg > 0 { update { $0.bpm = min(300, max(40, (60 / avg).rounded())) } }
        }
        flash("TAP", "\(Int(settings.bpm)) BPM")
    }

    // MARK: Ear trainer

    private func askEarQuestion() {
        earFeedback = nil
        let q = ear.next(settings: settings.harmony)
        playEar(q)
    }

    private func replayEar() {
        guard let q = ear.current else { askEarQuestion(); return }
        playEar(q)
    }

    private func playEar(_ q: EarTrainer.Question) {
        send(.stopPreview)
        send(.preview(notes: NoteSet(q.reference), delay: 0, duration: 0.7))
        if q.melodic {
            for (i, n) in q.prompt.enumerated() {
                send(.preview(notes: NoteSet([n]), delay: 1.0 + 0.6 * Float(i), duration: 0.55))
            }
        } else {
            send(.preview(notes: NoteSet(q.prompt), delay: 1.0, duration: 1.3))
        }
    }

    private func answerEar(_ b: Int) {
        guard ear.current != nil else { askEarQuestion(); return }
        let correct = ear.answer(b)
        let numeral = HiChordDevice.numerals[b]
        if correct {
            earFeedback = (true, "✓ " + numeral, now + 1.4)
            earNextAt = now + 1.5
            haptic(.success)
        } else {
            earFeedback = (false, "✗ " + numeral, now + 1.0)
            haptic(.warning)
        }
        // Let the player hear what they picked.
        let spec = ChordBuilder.diatonic(degree: b, settings: settings.harmony)
        var h = settings.harmony
        h.voiceLeading = false
        h.bassMode = .off
        let v = ChordBuilder.voicing(spec, degree: b, settings: h)
        send(.stopPreview)
        send(.preview(notes: NoteSet(settings.earLevel == .notes || settings.earLevel == .intervals ? [leadNote(b, direction: .center)] : v.notes),
                      delay: 0, duration: 0.8))
    }

    static let numerals = ["I", "II", "III", "IV", "V", "VI", "VII"]

    // MARK: Accessibility

    /// What the display shows, in words (VoiceOver and UI tests).
    public var accessibilityText: String {
        if let m = message { return [m.title, m.detail].compactMap { $0 }.joined(separator: " ") }
        let h = settings.harmony
        switch screen {
        case .keyMenu: return "Key \(NoteNames.keyName(h.key)) \(h.scale.displayName.capitalized), octave \(h.octave)"
        case .soundMenu: return "Sound \(currentSound.name)"
        case .modeMenu: return "Mode \(settings.mode.displayName)"
        case .keyList, .soundList, .modeList:
            let items = currentItems
            guard items.indices.contains(listIndex) else { return "Setup" }
            return "\(items[listIndex].title) \(items[listIndex].value(settings))"
        case .home:
            switch settings.mode {
            case .tuner:
                guard let t = tuner, t.confidence > 0.5 else { return "Tuner, play a note" }
                return "Tuner \(NoteNames.noteName(midi: t.nearestNote)) \(Int(t.cents.rounded())) cents"
            case .chordHiro:
                return hiro.phase == .done ? "Chord Hiro grade \(hiro.grade), score \(hiro.score)" : "Chord Hiro \(hiro.song.name), score \(hiro.score)"
            case .earTrainer:
                return earFeedback?.text ?? "Ear trainer \(settings.earLevel.displayName), score \(ear.score) of \(ear.attempts)"
            case .drums: return lastDrumPad.map { DrumKit.padNames[$0] } ?? "Drums \(settings.kit.displayName)"
            case .beat: return "Beat \(settings.beatStyle.displayName) variation \(settings.beatVariation + 1)"
            default: return displayChord ?? settings.mode.displayName
            }
        }
    }

    // MARK: Chord Hiro

    private func finishHiro() {
        send(.beat(style: Int32(hiro.song.style.rawValue), variation: 0, on: false))
        let i = hiro.songIndex
        if settings.hiroBest.count < ChordHiro.songs.count {
            settings.hiroBest += Array(repeating: 0, count: ChordHiro.songs.count - settings.hiroBest.count)
        }
        if hiro.score > settings.hiroBest[i] {
            settings.hiroBest[i] = hiro.score
            flash("NEW BEST!", "\(hiro.score)")
        }
        haptic(.success)
        changed()
    }

    private func drawHiro(_ f: inout OLEDFrame) {
        let best = settings.hiroBest.indices.contains(hiro.songIndex) ? settings.hiroBest[hiro.songIndex] : 0
        switch hiro.phase {
        case .idle:
            f.text("◀ " + hiro.song.name + " ▶", y: 12, align: .center)
            f.fittedText("HIRO", centerY: 32, maxScale: 3)
            f.text("● START   BEST \(best)", y: 45, align: .center)
        case .done:
            f.text(hiro.song.name, y: 12, align: .center)
            f.fittedText("GRADE " + hiro.grade, centerY: 28, maxScale: 2)
            f.text("SCORE \(hiro.score)  COMBO \(hiro.bestCombo)", y: 41, align: .center)
            f.text("● AGAIN  ◀▶ SONG", y: 49, align: .center)
        case .waiting, .playing:
            // Lane: chords travel right-to-left onto the hit line.
            let hitX = 18
            let pxPerBeat = 13.0
            f.vline(x: hitX, y: 13, h: 26)
            f.vline(x: hitX + 1, y: 13, h: 26)
            f.hline(x: 0, y: 26, w: OLEDFrame.width)
            if hiro.phase == .playing {
                let b = beatNow
                for (i, degree) in hiro.song.degrees.enumerated() {
                    let x = hitX + Int(((hiro.targetBeat(i) - b) * pxPerBeat).rounded())
                    guard x > -20 && x < OLEDFrame.width else { continue }
                    let label = HiChordDevice.numerals[degree]
                    let w = OLEDFrame.textWidth(label) + 4
                    f.fill(x: x - w / 2, y: 20, w: w, h: 13, on: false)
                    f.rect(x: x - w / 2, y: 20, w: w, h: 13)
                    f.text(label, x: x - w / 2 + 2, y: 23)
                    if hiro.results.indices.contains(i), hiro.results[i] != nil { f.invert(x: x - w / 2, y: 20, w: w, h: 13) }
                }
                // Beat ticks
                let phase = b - b.rounded(.down)
                if phase < 0.15 { f.fill(x: hitX - 3, y: 13, w: 8, h: 2) }
            } else {
                f.text("GET READY", y: 23, align: .center)
            }
            if now < hiroFeedbackUntil, let j = hiro.lastJudgement {
                f.text(j.label, y: 37, align: .center, scale: 1)
            }
            f.text("\(hiro.score)", x: 1, y: 47)
            if hiro.combo > 1 { f.text("x\(hiro.combo)", y: 47, align: .right, inset: 1) }
        }
    }

    // MARK: Output helpers

    private func send(_ cmd: EngineCommand) { host?.send(cmd) }

    private func sendPatch() {
        var p = currentSound.params.withEnvelope(attackScale: settings.attackScale, releaseScale: settings.releaseScale)
        if settings.mode == .lead { p.glide = settings.leadGlide }
        if settings.mode == .drone { p.attack = max(p.attack, 0.4); p.release = max(p.release, 1.5) }
        if settings.mode == .vocoder {
            // A bright, sustained carrier makes speech intelligible whatever sound is selected.
            p = SoundLibrary.factory[0].params
            p.cutoff = 9000; p.filterEnv = 0; p.sustain = 1; p.attack = 0.01; p.release = 0.15
        }
        send(.patch(p))
    }

    private func sendMaster() {
        // Filter wheel: exponential sweep 120 Hz ... 20 kHz.
        let cutoff = settings.filterWheel ? 120 * Float(pow(20000.0 / 120.0, Double(settings.filter))) : 20000
        send(.master(volume: settings.volume, cutoff: cutoff))
    }

    private func flash(_ title: String, _ detail: String? = nil) {
        message = (title, detail, now + 1.3)
    }

    private func haptic(_ kind: HapticKind) {
        if settings.haptics { host?.haptic(kind) }
    }

    private func touch() { lastInteraction = now }

    private func changed() { host?.settingsDidChange() }

    // MARK: Display

    public func render() -> OLEDFrame {
        var f = OLEDFrame()
        switch screen {
        case .home: drawHome(&f)
        case .keyMenu: drawKeyMenu(&f)
        case .soundMenu: drawSoundMenu(&f)
        case .modeMenu: drawModeMenu(&f)
        case .keyList: drawList(&f, title: "KEY SETUP")
        case .soundList: drawList(&f, title: "SOUND FX")
        case .modeList: drawList(&f, title: "SETUP")
        }
        if let m = message { drawMessage(&f, m.title, m.detail) }
        return f
    }

    private func drawHeader(_ f: inout OLEDFrame, left: String, right: String) {
        f.text(left, x: 1, y: 0)
        f.text(right, y: 0, align: .right, inset: 1)
        f.hline(x: 0, y: 9, w: OLEDFrame.width)
    }

    private func drawFooter(_ f: inout OLEDFrame) {
        let y = 56
        f.text("♪" + "\(Int(settings.bpm.rounded()))", x: 1, y: y)
        // Six loop tracks
        let blink = Int(now * 4) % 2 == 0
        for t in 0..<HiChordEngine.trackCount {
            let x = 40 + t * 8
            switch status.trackState(t) {
            case .empty: f.fill(x: x + 2, y: y + 5, w: 2, h: 1)
            case .armed: if blink { f.rect(x: x, y: y + 1, w: 6, h: 6) }
            case .recording: if blink { f.fill(x: x, y: y + 1, w: 6, h: 6) } else { f.rect(x: x, y: y + 1, w: 6, h: 6) }
            case .playing: f.fill(x: x, y: y + 1, w: 6, h: 6)
            case .muted: f.rect(x: x, y: y + 1, w: 6, h: 6)
            }
        }
        if status.loopLength > 0 && status.transportPlaying {
            // Loop progress bar on the bottom pixel row, under the tracks.
            let w = Int(Double(47) * status.loopPosition / status.loopLength)
            f.hline(x: 40, y: OLEDFrame.height - 1, w: max(1, w))
        }
        // Battery
        if let battery {
            let bx = 113
            f.rect(x: bx, y: y + 1, w: 12, h: 6)
            f.fill(x: bx + 12, y: y + 3, w: 1, h: 2)
            f.fill(x: bx + 2, y: y + 3, w: max(0, min(8, Int((battery * 8).rounded()))), h: 2)
        }
        if status.countIn > 0 {
            f.text("\(Int(status.countIn.rounded(.up)))", x: 94, y: y)
        } else if status.beatOn {
            f.text("●", x: 94, y: y)
        }
    }

    private var keyTag: String {
        NoteNames.keyName(settings.harmony.key) + " " + settings.harmony.scale.shortName
    }

    private func drawHome(_ f: inout OLEDFrame) {
        if settings.mode != .tuner && settings.mode != .mixer {
            drawHeader(&f, left: keyTag, right: settings.mode.shortName)
        }
        let midY = 31
        switch settings.mode {
        case .play, .strum, .lead, .drone, .arp, .repeatGate, .sequencer, .vocoder:
            let idle = heldButtons.isEmpty && now - lastChordTime > 2.5
            if idle && settings.showScope && !scope.isEmpty && status.peak > 0.002 {
                drawScope(&f, top: 12, height: 38)
            } else if let chord = displayChord {
                f.fittedText(chord, centerY: midY - 2, maxScale: 3)
                var detail = displayDegree.map { HiChordDevice.numerals[$0] } ?? ""
                switch settings.mode {
                case .arp: detail += "  " + settings.arpPattern.displayName + " " + settings.arpRate.displayName
                case .repeatGate: detail += "  RPT " + settings.repeatRate.displayName
                case .strum: detail += "  STRUM"
                case .drone: detail += "  DRONE"
                case .vocoder: detail += "  VOC " + settings.vocoder.source.displayName
                case .lead: detail = "LEAD"
                case .sequencer:
                    detail = status.seqPlaying ? "▶ STEP \(status.seqStep + 1)/\(seqNames.count)" : "STEPS \(seqNames.count)/16"
                default: break
                }
                if joystick != .center && settings.mode != .lead {
                    detail += "  " + settings.harmony.joystickMap.legend(joystick)
                }
                f.text(detail, y: 45, align: .center)
            } else {
                f.fittedText("HiChord", centerY: midY - 2, maxScale: 3)
                let hint = settings.mode == .sequencer ? (seqNames.isEmpty ? "TAP CHORDS TO ADD" : "STEPS \(seqNames.count)/16 ● PLAY")
                                                       : currentSound.name
                f.text(hint, y: 45, align: .center)
            }
        case .drums:
            f.fittedText(lastDrumPad.map { DrumKit.padNames[$0] } ?? "DRUMS", centerY: midY - 2, maxScale: 3)
            f.text(settings.kit.displayName, y: 45, align: .center)
        case .beat:
            f.fittedText(settings.beatStyle.displayName, centerY: midY - 4, maxScale: 3)
            f.text((status.beatOn ? "▶ " : "■ ") + "VAR \(settings.beatVariation + 1)/8", y: 40, align: .center)
            for s in 0..<16 {
                let x = 16 + s * 6
                if status.beatOn && Int(status.beatStep) == s {
                    f.fill(x: x, y: 49, w: 5, h: 4)
                } else {
                    f.fill(x: x + 2, y: 51, w: 1, h: 1)
                    if s % 4 == 0 { f.fill(x: x + 1, y: 51, w: 3, h: 1) }
                }
            }
        case .chordHiro:
            drawHiro(&f)
        case .earTrainer:
            f.text(settings.earLevel.displayName, y: 12, align: .center)
            if let fb = earFeedback {
                f.fittedText(fb.text, centerY: midY + 1, maxScale: 3)
            } else {
                f.fittedText("?", centerY: midY + 1, maxScale: 3)
            }
            f.text("SCORE \(ear.score)/\(ear.attempts)", y: 45, align: .center)
        case .tuner:
            drawTuner(&f)
        case .mic:
            if capturing {
                f.fittedText("● REC", centerY: midY - 4, maxScale: 3)
                let w = Int(min(1, micLevel * 4) * 100)
                f.rect(x: 13, y: 44, w: 102, h: 6)
                f.fill(x: 14, y: 45, w: w, h: 4)
            } else {
                f.fittedText("MIC", centerY: midY - 4, maxScale: 3)
                f.text("PRESS A KEY TO", y: 40, align: .center)
                f.text("SAMPLE", y: 48, align: .center)
            }
        case .mixer:
            drawMixer(&f)
        }
        if settings.mode != .tuner && settings.mode != .mixer { drawFooter(&f) }
    }

    private func drawScope(_ f: inout OLEDFrame, top: Int, height: Int) {
        // Find a rising zero crossing for a stable picture.
        let n = scope.count
        var start = 0
        for i in 1..<max(2, n / 2) where scope[i - 1] < 0 && scope[i] >= 0 { start = i; break }
        let peak = max(0.05, scope.map(abs).max() ?? 1)
        var prevY: Int?
        for x in 0..<OLEDFrame.width {
            let i = start + x * 2
            guard i < n else { break }
            let v = scope[i] / peak
            let y = top + height / 2 - Int((v * Float(height / 2 - 1)).rounded())
            if let p = prevY { f.line(x0: x - 1, y0: p, x1: x, y1: y) } else { f.set(x, y) }
            prevY = y
        }
    }

    private func drawTuner(_ f: inout OLEDFrame) {
        f.text("TUNER", x: 1, y: 0)
        f.text("A440", y: 0, align: .right, inset: 1)
        f.hline(x: 0, y: 9, w: OLEDFrame.width)
        guard let t = tuner, t.confidence > 0.5 else {
            f.fittedText("--", centerY: 28, maxScale: 3)
            f.text("PLAY A NOTE", y: 50, align: .center)
            return
        }
        let name = NoteNames.noteName(midi: t.nearestNote, preferFlats: settings.harmony.prefersFlats)
        f.fittedText(name, centerY: 25, maxScale: 3)
        let cents = max(-50, min(50, t.cents))
        // Meter
        f.hline(x: 14, y: 46, w: 101)
        for c in stride(from: -50, through: 50, by: 10) {
            let x = 64 + c
            f.vline(x: x, y: c == 0 ? 41 : 44, h: c == 0 ? 10 : 3)
        }
        let nx = 64 + Int(cents.rounded())
        f.fill(x: nx - 1, y: 39, w: 3, h: 14)
        let inTune = abs(cents) < 4
        f.text(inTune ? "IN TUNE" : String(format: "%+d CENTS", Int(cents.rounded())), y: 56, align: .center)
    }

    private func drawMixer(_ f: inout OLEDFrame) {
        f.text("MIXER", x: 1, y: 0)
        f.text(status.transportPlaying ? "▶" : "■", y: 0, align: .right, inset: 1)
        f.hline(x: 0, y: 9, w: OLEDFrame.width)
        for t in 0..<HiChordEngine.trackCount {
            let x = 6 + t * 20
            let state = status.trackState(t)
            let h = Int(trackLevels[t] / 1.5 * 34)
            f.rect(x: x, y: 13, w: 12, h: 36)
            if state == .playing || state == .recording {
                f.fill(x: x + 2, y: 47 - h, w: 8, h: max(1, h))
            } else if state == .muted {
                f.line(x0: x + 2, y0: 15, x1: x + 9, y1: 46)
                f.line(x0: x + 9, y0: 15, x1: x + 2, y1: 46)
            }
            f.text("\(t + 1)", x: x + 3, y: 54)
        }
    }

    private func drawKeyMenu(_ f: inout OLEDFrame) {
        drawHeader(&f, left: "KEY", right: "OCT " + (settings.harmony.octave == 0 ? "0" : String(format: "%+d", settings.harmony.octave)))
        f.text("◀", x: 2, y: 25)
        f.text("▶", y: 25, align: .right, inset: 2)
        f.fittedText(NoteNames.keyName(settings.harmony.key), centerY: 26, maxScale: 3)
        f.text(settings.harmony.scale.displayName, y: 42, align: .center)
        f.text("● SETUP  ▲▼ OCTAVE", y: 55, align: .center)
    }

    private func drawSoundMenu(_ f: inout OLEDFrame) {
        let i = (sounds.firstIndex { $0.name == settings.soundName } ?? 0) + 1
        drawHeader(&f, left: "SOUND", right: "\(i)/\(sounds.count)")
        f.text("◀", x: 2, y: 27)
        f.text("▶", y: 27, align: .right, inset: 2)
        f.fittedText(currentSound.name, centerY: 30, maxScale: 2, maxWidth: 108)
        f.text("▲ EFFECTS", y: 55, align: .center)
    }

    private func drawModeMenu(_ f: inout OLEDFrame) {
        drawHeader(&f, left: "MODE", right: "\(settings.mode.rawValue + 1)/\(PlayMode.allCases.count)")
        f.text("◀", x: 2, y: 27)
        f.text("▶", y: 27, align: .right, inset: 2)
        f.fittedText(settings.mode.displayName, centerY: 30, maxScale: 2, maxWidth: 108)
        f.text("▲ SETUP  " + "♪\(Int(settings.bpm.rounded()))", y: 55, align: .center)
    }

    private func drawList(_ f: inout OLEDFrame, title: String) {
        let items = currentItems
        // Title bar: dark text on a lit bar.
        f.text(title, x: 2, y: 1)
        f.text("\(listIndex + 1)/\(items.count)", y: 1, align: .right, inset: 2)
        f.invert(x: 0, y: 0, w: OLEDFrame.width, h: 9)
        let rows = 4
        let first = min(max(0, listIndex - 1), max(0, items.count - rows))
        for r in 0..<rows {
            let i = first + r
            guard items.indices.contains(i) else { break }
            let y = 12 + r * 13
            f.text(items[i].title, x: 3, y: y + 2)
            f.text(items[i].value(settings), y: y + 2, align: .right, inset: 3)
            if i == listIndex { f.invert(x: 0, y: y, w: OLEDFrame.width, h: 11) }
        }
    }

    private func drawMessage(_ f: inout OLEDFrame, _ title: String, _ detail: String?) {
        let h = detail == nil ? 22 : 32
        let y = (OLEDFrame.height - h) / 2
        f.fill(x: 6, y: y, w: OLEDFrame.width - 12, h: h, on: false)
        f.rect(x: 6, y: y, w: OLEDFrame.width - 12, h: h)
        f.rect(x: 8, y: y + 2, w: OLEDFrame.width - 16, h: h - 4)
        let scale = OLEDFrame.textWidth(title, scale: 2) <= OLEDFrame.width - 24 ? 2 : 1
        f.text(title, y: y + (detail == nil ? (h - 7 * scale) / 2 : 5), align: .center, scale: scale)
        if let detail { f.text(detail, y: y + h - 13, align: .center) }
    }
}
