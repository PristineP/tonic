import TonicCore
import SwiftUI

/// The built-in guide, shown on first launch and from the ? button.
struct HelpView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Every key is a chord.")
                            .font(.title2.weight(.heavy))
                        Text("The seven off-white keys play the seven chords of the current key, I to VII. The bottom row is I–IV and the top row is V–VII. Try I · V · VI · IV.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }

                Section("Playing") {
                    HelpRow(icon: "hand.tap", title: "Press a key", text: "Plays its chord. Hold several for legato changes.")
                    HelpRow(icon: "dot.arrowtriangles.up.right.down.left.circle", title: "Bend with the joystick",
                            text: "While holding a key, push the joystick to turn the chord into a 7th, 9th, sus, minor, diminished… The labels around it show what each direction does.")
                    HelpRow(icon: "hand.draw", title: "Or swipe on the key",
                            text: "Slide your finger off-centre on a held key to bend just that chord, no second hand needed.")
                    HelpRow(icon: "circle.circle", title: "Click the joystick",
                            text: "Tap it to record the next loop track, or to finish the one recording. In some modes it plays or stops.")
                    HelpRow(icon: "dial.medium", title: "Wheel", text: "Volume, or the low-pass filter if you switch the wheel to Filter.")
                }

                Section("The coloured keys") {
                    HelpRow(color: Theme.teal, title: "Key (teal)", text: "Joystick ←→ changes key, ↑↓ changes octave, click for scale, joystick map, inversion, voice leading and bass. Hold Key + a chord key to shift that key's octave.")
                    HelpRow(color: Theme.amber, title: "Sound (amber)", text: "Joystick ←→ browses sounds, ↑ opens effects and envelope. Hold Sound + a chord key for quick sounds.")
                    HelpRow(color: Theme.coral, title: "Mode (coral)", text: "Joystick ←→ changes play mode, ↑ opens tempo, arp, drum and looper settings. In the BPM row, tap Mode to tap the tempo. Hold Mode + a chord key to jump to a mode.")
                    Text("In menus: ↑↓ picks a row, ←→ changes it, click or press the key again to go back.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Modes") {
                    ForEach(PlayMode.allCases, id: \.self) { mode in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(mode.displayName.capitalized).font(.headline)
                            Text(Self.describe(mode)).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }

                Section("Looper") {
                    HelpRow(icon: "1.circle", title: "Track 1 sets the length",
                            text: "Choose 1–8 bars (with a one-bar count-in) or Free, where recording starts with your first note and stops when you tap again.")
                    HelpRow(icon: "square.stack.3d.up", title: "Layer up to six parts",
                            text: "Each new track records one full loop. Change sound or mode between takes: chords, bass in Lead, an arp, drums…")
                    HelpRow(icon: "speaker.slash", title: "Mute, re-record, clear",
                            text: "Tap a playing track to mute it. Long-press a track for more. Mixer mode sets levels.")
                }

                Section("MIDI") {
                    HelpRow(icon: "pianokeys", title: "Play other apps",
                            text: "Tonic publishes a virtual MIDI source called “Tonic”. Loop tracks send on channels 1–6 and drums on channel 10, so a multitimbral synth can voice every layer.")
                }
            }
            .navigationTitle("Tonic Guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Start playing") { dismiss() } }
            }
        }
    }

    static func describe(_ mode: PlayMode) -> String {
        switch mode {
        case .play: return "Full chords."
        case .strum: return "Chords rolled across six strings, like a guitar or harp. Strum speed is in Mode setup."
        case .lead: return "One scale note per key, for melodies and bass lines. Joystick ↑↓ shifts octave, ←→ by a semitone."
        case .drone: return "Chords sustain after you let go. Press another key to move the drone, or the same key to stop."
        case .arp: return "Tempo-synced arpeggios of the held chord. Pattern, rate and latch are in Mode setup."
        case .repeatGate: return "The held chord retriggers in time, for rhythmic stabs."
        case .sequencer: return "Tap chords to add up to 16 steps, then click the joystick to play. Joystick ← undoes a step, ↓ clears."
        case .drums: return "Seven drum pads. Hold a pad and push the joystick for note repeat."
        case .beat: return "Seven beat styles (rock, break, dub, funk, house, dembow, swing). Joystick ←→ picks one of eight variations."
        case .chordRush: return "A rhythm game: chords scroll to the line in time with a beat; press each on the downbeat. Joystick ←→ picks a song, click starts."
        case .vocoder: return "Hold chords and sing or talk into the mic: the chord takes the shape of your voice. In setup the source can be loop track 1 instead of the mic."
        case .earTrainer: return "Tonic plays the key's tonic, then a mystery note or chord. Answer with its key. Joystick ↑↓ changes level, → skips."
        case .tuner: return "Chromatic tuner using the microphone. Keys play reference notes."
        case .mic: return "Press a key and make a sound: Tonic samples it and you can play it as chords."
        case .mixer: return "Keys 1–6 mute loop tracks; hold one and push ↑↓ for its level. Key 7 starts and stops the loops."
        }
    }
}

private struct HelpRow: View {
    var icon: String? = nil
    var color: Color? = nil
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let icon {
                Image(systemName: icon)
                    .font(.title3)
                    .frame(width: 30)
                    .foregroundStyle(.tint)
            } else if let color {
                RoundedRectangle(cornerRadius: 5).fill(color).frame(width: 24, height: 24).padding(.horizontal, 3)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}
