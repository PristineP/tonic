import TonicCore
import SwiftUI

/// Six-track looper controls with state LEDs, transport and loop length.
struct LooperPanel: View {
    @Environment(AppModel.self) private var model
    var vertical = false

    var body: some View {
        let status = model.status
        VStack(spacing: 10) {
            HStack {
                Label("LOOPER", systemImage: "repeat")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.55))
                Spacer()
                if status.countIn > 0 {
                    Text("COUNT-IN \(Int(status.countIn.rounded(.up)))")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(Theme.ledYellow)
                } else if status.loopLength > 0 {
                    Text(loopLengthText(status.loopLength))
                        .font(.system(size: 11, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.55))
                }
            }
            LoopProgress(position: status.loopLength > 0 && status.transportPlaying ? status.loopPosition / status.loopLength : 0)
                .frame(height: 3)

            let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: vertical ? 2 : 6)
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(0..<6) { t in
                    TrackPad(track: t, state: status.trackState(t))
                }
            }

            HStack(spacing: 8) {
                Button {
                    model.toggleTransport()
                } label: {
                    Image(systemName: status.transportPlaying ? "stop.fill" : "play.fill")
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(PanelButtonStyle(tint: status.transportPlaying ? Theme.ledGreen : .white))
                .accessibilityLabel(status.transportPlaying ? "Stop loops" : "Play loops")

                Menu {
                    Picker("Loop length", selection: Binding(get: { model.settings.loopBars }, set: { model.setLoopBars($0) })) {
                        Text("Free").tag(0)
                        Text("1 bar").tag(1)
                        Text("2 bars").tag(2)
                        Text("4 bars").tag(4)
                        Text("8 bars").tag(8)
                    }
                } label: {
                    Text(model.settings.loopBars == 0 ? "FREE" : "\(model.settings.loopBars) BAR")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.07)))
                }
                .accessibilityLabel("Loop length")

                Button {
                    model.toggleMetronome()
                } label: {
                    Image(systemName: "metronome.fill")
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(PanelButtonStyle(tint: model.settings.metronome ? Theme.ledYellow : .white.opacity(0.6)))
                .accessibilityLabel("Metronome")
                .accessibilityValue(model.settings.metronome ? "On" : "Off")

                Button(role: .destructive) {
                    model.loopClear(-1)
                } label: {
                    Image(systemName: "trash")
                        .frame(maxWidth: .infinity, minHeight: 34)
                }
                .buttonStyle(PanelButtonStyle(tint: .white.opacity(0.6)))
                .accessibilityLabel("Clear all loops")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.white.opacity(0.05))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.08)))
        )
    }

    private func loopLengthText(_ beats: Double) -> String {
        let bars = beats / 4
        if bars == bars.rounded() { return "\(Int(bars)) BAR" + (bars == 1 ? "" : "S") }
        return "\(Int(beats)) BEATS"
    }
}

private struct LoopProgress: View {
    var position: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.08))
                Capsule().fill(Theme.ledGreen.opacity(0.85))
                    .frame(width: max(0, geo.size.width * position))
            }
        }
    }
}

private struct TrackPad: View {
    @Environment(AppModel.self) private var model
    let track: Int
    let state: TrackState
    @State private var blink = false

    var body: some View {
        Button {
            model.loopTap(track)
        } label: {
            VStack(spacing: 5) {
                Circle()
                    .fill(ledColor)
                    .frame(width: 9, height: 9)
                    .shadow(color: ledColor.opacity(state == .empty ? 0 : 0.9), radius: 5)
                    .opacity(isBlinking && blink ? 0.25 : 1)
                Text("\(track + 1)")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(state == .empty ? 0.45 : 0.9))
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(state == .recording ? Theme.ledRed.opacity(0.18) : .white.opacity(0.06))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(state == .muted ? .white.opacity(0.35) : .white.opacity(0.08),
                                      style: StrokeStyle(lineWidth: 1, dash: state == .muted ? [3, 3] : [])))
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button { model.loopRerecord(track) } label: { Label("Record again", systemImage: "record.circle") }
            if state == .playing || state == .muted {
                Button { model.loopTap(track) } label: {
                    Label(state == .muted ? "Unmute" : "Mute", systemImage: state == .muted ? "speaker.wave.2" : "speaker.slash")
                }
            }
            Button(role: .destructive) { model.loopClear(track) } label: { Label("Clear track", systemImage: "trash") }
        }
        .onAppear { startBlink() }
        .accessibilityLabel("Loop track \(track + 1)")
        .accessibilityValue(stateName)
        .accessibilityHint(hint)
    }

    private var isBlinking: Bool { state == .armed || state == .recording }

    private func startBlink() {
        withAnimation(.easeInOut(duration: 0.35).repeatForever(autoreverses: true)) { blink = true }
    }

    private var ledColor: Color {
        switch state {
        case .empty: return .white.opacity(0.15)
        case .armed: return Theme.ledYellow
        case .recording: return Theme.ledRed
        case .playing: return Theme.ledGreen
        case .muted: return .white.opacity(0.35)
        }
    }

    private var stateName: String {
        switch state {
        case .empty: return "Empty"
        case .armed: return "Waiting to record"
        case .recording: return "Recording"
        case .playing: return "Playing"
        case .muted: return "Muted"
        }
    }

    private var hint: String {
        switch state {
        case .empty: return "Starts recording"
        case .armed, .recording: return "Stops recording"
        case .playing: return "Mutes the track"
        case .muted: return "Unmutes the track"
        }
    }
}

struct PanelButtonStyle: ButtonStyle {
    var tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(tint)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(.white.opacity(configuration.isPressed ? 0.16 : 0.07))
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}
