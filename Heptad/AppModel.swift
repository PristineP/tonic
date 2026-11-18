import HeptadCore
import Observation
import QuartzCore
import SwiftUI
import UIKit

/// Owns the device firmware, the audio engine and every service, and publishes
/// what the SwiftUI views draw.
@MainActor
@Observable
final class AppModel: DeviceHost {
    let device: HeptadDevice
    @ObservationIgnored let audio = AudioController()
    @ObservationIgnored let mic = MicCapture()
    @ObservationIgnored private(set) var midi: MIDIOutput!
    @ObservationIgnored private let haptics = Haptics()
    @ObservationIgnored private var displayLink: CADisplayLink?
    @ObservationIgnored private var saveWork: DispatchWorkItem?
    @ObservationIgnored private var scopeBuffer: [Float] = []
    @ObservationIgnored private var sampleSlot = 0

    // Published state
    private(set) var frame = OLEDFrame()
    /// The display in words, for VoiceOver.
    private(set) var displayText = ""
    private(set) var status = EngineStatus()
    private(set) var settings: DeviceSettings
    private(set) var pressedButtons: Set<Int> = []
    private(set) var pressedFunctions: Set<FunctionKey> = []
    private(set) var joystick: JoyDirection = .center
    private(set) var micDenied = false
    var presets: [DeviceSettings?] = Persistence.loadPresets()
    private(set) var midiEnabled: Bool

    func setMIDIEnabled(_ on: Bool) {
        midiEnabled = on
        midi.enabled = on
        UserDefaults.standard.set(on, forKey: Persistence.midiKey)
    }

    init() {
        let saved = Persistence.loadSettings()
        settings = saved
        device = HeptadDevice(settings: saved)
        midiEnabled = UserDefaults.standard.object(forKey: Persistence.midiKey) as? Bool ?? true
        midi = MIDIOutput(engine: audio.core)
        midi.enabled = midiEnabled
        device.host = self
        if Persistence.hasSample, let sample = Persistence.loadSample() {
            loadSample(sample.samples, sampleRate: sample.sampleRate, root: sample.rootNote)
            device.addSampleSound()
            device.apply(saved) // re-select a saved MIC SAMPLE sound now that it exists
        }
        UIDevice.current.isBatteryMonitoringEnabled = true
        audio.onRestart = { [weak self] in self?.device.syncEngine() }
        mic.onPitch = { [weak self] result in self?.device.tuner = result }
        mic.onLevel = { [weak self] level in self?.device.micLevel = level }
        mic.modulator = audio.core
    }

    func start() {
        audio.start()
        device.syncEngine()
        startDisplayLink()
        #if DEBUG
        applyDebugLaunchArguments()
        #endif
    }

    #if DEBUG
    /// Launch arguments used by CI to capture screenshots of specific states.
    private func applyDebugLaunchArguments() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-uiLandscape"),
           let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
        }
        if args.contains("-uiDemo") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self else { return }
                self.setJoystick(.right)
                self.pressButton(5)
                self.loopTap(0)
            }
        }
    }
    #endif

    // MARK: Scene phase

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if !audio.isRunning {
                audio.start()
                device.syncEngine()
            }
            displayLink?.isPaused = false
        case .background:
            saveNow()
            displayLink?.isPaused = true
            // Keep playing in the background only while something is actually sounding.
            let s = audio.core.status
            let busy = s.transportPlaying || s.beatOn || s.seqPlaying || s.activeVoices > 0
            if !busy {
                audio.suspend()
                if mic.isActive { mic.stop() }
            }
        default:
            break
        }
    }

    // MARK: Display loop

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: DisplayLinkProxy { [weak self] in self?.step() }, selector: #selector(DisplayLinkProxy.tick))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 20, maximum: 30, preferred: 30)
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func step() {
        let s = audio.core.status
        device.status = s
        audio.core.copyScope(into: &scopeBuffer)
        device.scope = scopeBuffer
        let level = UIDevice.current.batteryLevel
        device.battery = level >= 0 ? level : nil
        device.tick(now: CACurrentMediaTime())
        let f = device.render()
        if f != frame {
            frame = f
            displayText = device.accessibilityText
        }
        if !statusEqual(s, status) { status = s }
    }

    private func statusEqual(_ a: EngineStatus, _ b: EngineStatus) -> Bool {
        // Only fields the looper panel shows (position is quantised to avoid redraw churn).
        a.tracks == b.tracks && a.recordingTrack == b.recordingTrack && a.transportPlaying == b.transportPlaying
            && a.beatOn == b.beatOn && a.seqPlaying == b.seqPlaying && a.loopLength == b.loopLength
            && Int(a.countIn.rounded(.up)) == Int(b.countIn.rounded(.up))
            && Int(a.loopPosition * 8) == Int(b.loopPosition * 8)
    }

    // MARK: Inputs from views

    func pressButton(_ b: Int) {
        pressedButtons.insert(b)
        device.pressButton(b)
        refresh()
    }

    func releaseButton(_ b: Int) {
        pressedButtons.remove(b)
        device.releaseButton(b)
        refresh()
    }

    func swipeButton(_ b: Int, _ dir: JoyDirection) {
        device.swipeButton(b, direction: dir)
        refresh()
    }

    func pressFunction(_ f: FunctionKey) {
        pressedFunctions.insert(f)
        device.pressFunction(f)
        refresh()
    }

    func releaseFunction(_ f: FunctionKey) {
        pressedFunctions.remove(f)
        device.releaseFunction(f)
        refresh()
    }

    func setJoystick(_ dir: JoyDirection) {
        guard dir != joystick else { return }
        joystick = dir
        device.setJoystick(dir)
        refresh()
    }

    func clickJoystick() {
        device.clickJoystick()
        refresh()
    }

    func setWheel(_ v: Float) {
        device.setWheel(v)
        refresh()
    }

    func update(_ change: (inout DeviceSettings) -> Void) {
        device.update(change)
        refresh()
    }

    func selectSound(_ name: String) { device.selectSound(named: name); refresh() }
    func setMode(_ mode: PlayMode) { device.setMode(mode); refresh() }

    // Looper panel
    func loopTap(_ t: Int) {
        switch status.trackState(t) {
        case .empty, .armed, .recording: device.loopRecord(track: t)
        case .playing: device.loopMute(track: t, muted: true)
        case .muted: device.loopMute(track: t, muted: false)
        }
        refresh()
    }

    func loopRerecord(_ t: Int) { device.loopRecord(track: t); refresh() }
    func loopClear(_ t: Int) { device.loopClear(track: t); refresh() }
    func toggleTransport() { device.setTransport(playing: !status.transportPlaying); refresh() }
    func setLoopBars(_ bars: Int) { device.setLoopBars(bars); refresh() }
    func toggleMetronome() { device.setMetronome(!device.settings.metronome); refresh() }

    // Presets
    func savePreset(_ slot: Int) {
        guard presets.indices.contains(slot) else { return }
        presets[slot] = device.settings
        Persistence.savePresets(presets)
        haptic(.success)
    }

    func loadPreset(_ slot: Int) {
        guard presets.indices.contains(slot), let p = presets[slot] else { return }
        device.apply(p)
        refresh()
        haptic(.success)
    }

    func resetSettings() {
        device.apply(DeviceSettings())
        refresh()
    }

    private func refresh() {
        if settings != device.settings { settings = device.settings }
        frame = device.render()
        displayText = device.accessibilityText
    }

    // MARK: DeviceHost

    func send(_ command: EngineCommand) {
        audio.core.send(command)
    }

    func haptic(_ kind: HapticKind) {
        haptics.play(kind)
    }

    func setMicrophoneActive(_ active: Bool) {
        if active {
            mic.requestPermission { [weak self] granted in
                guard let self else { return }
                self.micDenied = !granted
                guard granted, self.device.settings.mode.usesMicrophone else { return }
                self.audio.setInputEnabled(true)
                self.mic.start()
            }
        } else {
            if mic.isActive { mic.stop() }
            audio.setInputEnabled(false)
            device.tuner = nil
        }
    }

    func captureSample() {
        guard mic.isActive else {
            device.sampleCaptured(success: false, rootNote: nil)
            return
        }
        mic.capture { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(samples, rate):
                let root = Self.detectRoot(samples, sampleRate: rate)
                self.loadSample(samples, sampleRate: rate, root: root ?? 60)
                Persistence.saveSample(samples, sampleRate: rate, rootNote: root ?? 60)
                self.device.sampleCaptured(success: true, rootNote: root)
            case .failure:
                self.device.sampleCaptured(success: false, rootNote: nil)
            }
            self.refresh()
        }
    }

    func settingsDidChange() {
        if settings != device.settings { settings = device.settings }
        saveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.saveNow() }
        }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
    }

    private func saveNow() {
        Persistence.saveSettings(device.settings)
    }

    // MARK: Samples

    private func loadSample(_ samples: [Float], sampleRate: Double, root: Int) {
        // Write into the slot the engine is not playing from, then switch.
        sampleSlot = 1 - sampleSlot
        let (pointer, capacity) = audio.core.sampleBuffer(slot: sampleSlot)
        let n = min(samples.count, capacity)
        guard n > 0 else { return }
        samples.withUnsafeBufferPointer { src in
            pointer.update(from: src.baseAddress!, count: n)
        }
        send(.useSample(slot: Int32(sampleSlot), length: Int32(n), sourceRate: Float(sampleRate), rootNote: Float(root)))
    }

    nonisolated static func detectRoot(_ samples: [Float], sampleRate: Double) -> Int? {
        let window = 4096
        guard samples.count > window + 1024 else { return nil }
        let detector = PitchDetector(sampleRate: sampleRate, minFrequency: 50, maxFrequency: 1500)
        // Look a little after the attack where pitch is most stable.
        var results: [PitchDetector.Result] = []
        var start = min(2048, samples.count - window)
        while start + window <= min(samples.count, Int(sampleRate * 0.8)) {
            if let r = detector.detect(Array(samples[start ..< start + window])), r.confidence > 0.7 { results.append(r) }
            start += 2048
        }
        guard !results.isEmpty else { return nil }
        let notes = results.map(\.nearestNote).sorted()
        return notes[notes.count / 2]
    }
}

/// Breaks the CADisplayLink → target retain cycle.
private final class DisplayLinkProxy: NSObject {
    let action: @MainActor () -> Void
    init(_ action: @escaping @MainActor () -> Void) { self.action = action }
    @objc func tick() { MainActor.assumeIsolated { action() } }
}

/// Haptic feedback, prepared ahead so taps feel immediate.
@MainActor
final class Haptics {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private let notify = UINotificationFeedbackGenerator()

    init() {
        light.prepare()
        rigid.prepare()
    }

    func play(_ kind: HapticKind) {
        switch kind {
        case .press: rigid.impactOccurred(intensity: 0.7); rigid.prepare()
        case .tick: light.impactOccurred(intensity: 0.5); light.prepare()
        case .success: notify.notificationOccurred(.success)
        case .warning: notify.notificationOccurred(.warning)
        }
    }
}

/// UserDefaults / file persistence.
enum Persistence {
    static let settingsKey = "heptad.settings.v1"
    static let presetsKey = "heptad.presets.v1"
    static let midiKey = "heptad.midi.enabled"

    static func loadSettings() -> DeviceSettings {
        guard let data = UserDefaults.standard.data(forKey: settingsKey),
              let s = try? JSONDecoder().decode(DeviceSettings.self, from: data) else { return DeviceSettings() }
        return s
    }

    static func saveSettings(_ s: DeviceSettings) {
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: settingsKey) }
    }

    static func loadPresets() -> [DeviceSettings?] {
        guard let data = UserDefaults.standard.data(forKey: presetsKey),
              let p = try? JSONDecoder().decode([DeviceSettings?].self, from: data), p.count == 4 else {
            return [nil, nil, nil, nil]
        }
        return p
    }

    static func savePresets(_ p: [DeviceSettings?]) {
        if let data = try? JSONEncoder().encode(p) { UserDefaults.standard.set(data, forKey: presetsKey) }
    }

    // The latest mic sample survives relaunches.
    private static var sampleURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("mic-sample.bin")
    }

    static var hasSample: Bool { FileManager.default.fileExists(atPath: sampleURL.path) }

    static func saveSample(_ samples: [Float], sampleRate: Double, rootNote: Int) {
        var data = Data()
        var header: (Double, Int64) = (sampleRate, Int64(rootNote))
        withUnsafeBytes(of: &header) { data.append(contentsOf: $0) }
        samples.withUnsafeBufferPointer { data.append(Data(buffer: $0)) }
        try? data.write(to: sampleURL, options: .atomic)
    }

    static func loadSample() -> (samples: [Float], sampleRate: Double, rootNote: Int)? {
        guard let data = try? Data(contentsOf: sampleURL), data.count > 16 else { return nil }
        let rate = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: Double.self) }
        let root = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 8, as: Int64.self) }
        let body = data.dropFirst(16)
        let count = body.count / MemoryLayout<Float>.size
        var samples = [Float](repeating: 0, count: count)
        _ = samples.withUnsafeMutableBytes { body.copyBytes(to: $0) }
        guard rate > 0, (0...127).contains(root) else { return nil }
        return (samples, rate, Int(root))
    }
}
