import HiChordCore
import SwiftUI

/// Full-screen access to everything the device menus control, plus app options.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false

    private func binding<T>(_ keyPath: WritableKeyPath<DeviceSettings, T>) -> Binding<T> {
        Binding(get: { model.settings[keyPath: keyPath] },
                set: { value in model.update { $0[keyPath: keyPath] = value } })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Sound") {
                    Picker("Sound", selection: Binding(get: { model.settings.soundName }, set: { model.selectSound($0) })) {
                        ForEach(model.device.sounds) { Text($0.name.capitalized).tag($0.name) }
                    }
                    Picker("Mode", selection: Binding(get: { model.settings.mode }, set: { model.setMode($0) })) {
                        ForEach(PlayMode.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    LabeledSlider(title: "Attack", value: binding(\.attackScale), range: 0.125...16, log: true, format: { String(format: "×%.2f", $0) })
                    LabeledSlider(title: "Release", value: binding(\.releaseScale), range: 0.125...16, log: true, format: { String(format: "×%.2f", $0) })
                    Toggle("Wheel controls filter", isOn: binding(\.filterWheel))
                }

                Section("Harmony") {
                    Picker("Key", selection: binding(\.harmony.key)) {
                        ForEach(0..<12) { Text(NoteNames.keyName($0)).tag($0) }
                    }
                    Picker("Scale", selection: binding(\.harmony.scale)) {
                        ForEach(Scale.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Stepper("Octave \(model.settings.harmony.octave >= 0 ? "+" : "")\(model.settings.harmony.octave)",
                            value: binding(\.harmony.octave), in: -2...2)
                    Picker("Joystick map", selection: binding(\.harmony.joystickMap)) {
                        ForEach(JoystickMap.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Picker("Inversion", selection: binding(\.harmony.inversion)) {
                        Text("Root").tag(0); Text("1st").tag(1); Text("2nd").tag(2); Text("3rd").tag(3)
                    }
                    Toggle("Voice leading", isOn: binding(\.harmony.voiceLeading))
                    Picker("Bass", selection: binding(\.harmony.bassMode)) {
                        ForEach(BassMode.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Toggle("Two-button slash chords", isOn: binding(\.slashChords))
                    Button("Reset per-button octaves") {
                        model.update { $0.harmony.buttonOctaves = Array(repeating: 0, count: 7) }
                    }
                    .disabled(model.settings.harmony.buttonOctaves.allSatisfy { $0 == 0 })
                }

                Section("Effects") {
                    Picker("Reverb", selection: binding(\.fx.reverb)) {
                        ForEach(ReverbType.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    LabeledSlider(title: "Reverb mix", value: binding(\.fx.reverbMix), range: 0...1)
                    Picker("Delay", selection: binding(\.fx.delay)) {
                        ForEach(DelayTime.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    LabeledSlider(title: "Delay feedback", value: binding(\.fx.delayFeedback), range: 0...0.9)
                    LabeledSlider(title: "Delay mix", value: binding(\.fx.delayMix), range: 0...1)
                    Picker("Modulation", selection: binding(\.fx.mod)) {
                        ForEach(ModType.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Picker("Tremolo", selection: binding(\.fx.tremolo)) {
                        ForEach(TremoloRate.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    Picker("Drive", selection: binding(\.fx.drive)) {
                        ForEach(DriveType.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Picker("Lo-fi", selection: binding(\.fx.lofi)) {
                        ForEach(LofiType.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    LabeledSlider(title: "Stereo spread", value: binding(\.fx.spread), range: 0...1)
                }

                Section("Rhythm") {
                    Stepper("Tempo \(Int(model.settings.bpm.rounded())) BPM", value: binding(\.bpm), in: 40...300, step: 1)
                    Picker("Arp pattern", selection: binding(\.arpPattern)) {
                        ForEach(ArpPattern.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Picker("Arp rate", selection: binding(\.arpRate)) {
                        ForEach(NoteRate.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    Toggle("Arp latch", isOn: binding(\.arpLatch))
                    Picker("Repeat rate", selection: binding(\.repeatRate)) {
                        ForEach(NoteRate.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    LabeledSlider(title: "Strum speed", value: binding(\.strumMs), range: 0...120, format: { "\(Int($0)) ms" })
                    LabeledSlider(title: "Lead glide", value: binding(\.leadGlide), range: 0...0.5, format: { "\(Int($0 * 1000)) ms" })
                    Picker("Drum kit", selection: binding(\.kit)) {
                        ForEach(DrumKit.allCases, id: \.self) { Text($0.displayName.capitalized).tag($0) }
                    }
                    Picker("Sequencer step", selection: binding(\.seqStepBeats)) {
                        Text("1/8 note").tag(0.5); Text("1 beat").tag(1.0); Text("2 beats").tag(2.0)
                        Text("1 bar").tag(4.0); Text("2 bars").tag(8.0)
                    }
                }

                Section {
                    Picker("Loop length", selection: binding(\.loopBars)) {
                        Text("Free").tag(0); Text("1 bar").tag(1); Text("2 bars").tag(2); Text("4 bars").tag(4); Text("8 bars").tag(8)
                    }
                    Toggle("Metronome while recording", isOn: binding(\.metronome))
                } header: {
                    Text("Looper")
                } footer: {
                    Text("Track 1 sets the loop length. In Free mode recording starts with your first note.")
                }

                Section {
                    Toggle("Virtual MIDI output", isOn: Binding(get: { model.midiEnabled }, set: { model.setMIDIEnabled($0) }))
                } header: {
                    Text("MIDI")
                } footer: {
                    Text("HiChord appears as a MIDI source named “HiChord” in other apps. Loop tracks send on channels 1–6, live playing on the channel of the next free track, drums on channel 10.")
                }

                Section("Display & feel") {
                    Toggle("Chord names on keys", isOn: binding(\.showKeyLabels))
                    Toggle("Oscilloscope when idle", isOn: binding(\.showScope))
                    Toggle("Haptics", isOn: binding(\.haptics))
                }

                Section {
                    ForEach(0..<4) { slot in
                        HStack {
                            Text("Preset \(slot + 1)")
                            if let p = model.presets[slot] {
                                Text("\(NoteNames.keyName(p.harmony.key)) · \(p.soundName.capitalized) · \(p.mode.displayName.capitalized)")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Button("Load") { model.loadPreset(slot) }
                                .buttonStyle(.bordered)
                                .disabled(model.presets[slot] == nil)
                            Button("Save") { model.savePreset(slot) }
                                .buttonStyle(.borderedProminent)
                        }
                    }
                } header: {
                    Text("Presets")
                } footer: {
                    Text("Presets store the key, sound, effects, mode and rhythm settings.")
                }

                Section {
                    Button("Reset all settings", role: .destructive) { confirmReset = true }
                } footer: {
                    Text("HiChord \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Reset all settings?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset", role: .destructive) { model.resetSettings() }
            } message: {
                Text("Presets and loops are kept.")
            }
        }
    }
}

private struct LabeledSlider: View {
    let title: String
    @Binding var value: Float
    var range: ClosedRange<Float>
    var log = false
    var format: (Float) -> String = { "\(Int(($0 * 100).rounded()))%" }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text(format(value)).foregroundStyle(.secondary).monospacedDigit()
            }
            if log {
                Slider(value: Binding(get: { log2(value) }, set: { value = pow(2, $0) }),
                       in: log2(range.lowerBound)...log2(range.upperBound))
            } else {
                Slider(value: $value, in: range)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
