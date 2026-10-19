import HiChordCore
import SwiftUI

/// The HiChord itself, drawn to scale from the hardware (100 × 71 mm).
struct DeviceView: View {
    @Environment(AppModel.self) private var model
    static let aspect: CGFloat = 470.0 / 335.0

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width
            let H = geo.size.height
            ZStack(alignment: .topLeading) {
                chassis(W: W, H: H)
                leftPanel(W: W, H: H)
                rightPanel(W: W, H: H)
            }
        }
        .aspectRatio(DeviceView.aspect, contentMode: .fit)
    }

    // MARK: Chassis

    private func chassis(W: CGFloat, H: CGFloat) -> some View {
        let corner = W * 0.045
        return ZStack {
            // Drop shadow on the backdrop
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(.black.opacity(0.55))
                .blur(radius: W * 0.03)
                .offset(y: W * 0.022)
            // Anodised aluminium
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(LinearGradient(colors: [Theme.bodyTop, Theme.bodyBottom], startPoint: .top, endPoint: .bottom))
            // Brushed texture
            BrushedTexture()
                .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
                .opacity(0.35)
            // Bevel
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white, Theme.bodyEdge], startPoint: .top, endPoint: .bottom),
                              lineWidth: max(1, W * 0.004))
            RoundedRectangle(cornerRadius: corner * 0.9, style: .continuous)
                .strokeBorder(Color.black.opacity(0.06), lineWidth: 1)
                .padding(W * 0.006)
        }
        .frame(width: W, height: H)
    }

    // MARK: Left panel: logo, grille, wheel, legend

    private func leftPanel(W: CGFloat, H: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            Text("HiChord")
                .font(.system(size: W * 0.046, weight: .heavy).italic())
                .tracking(-0.3)
                .foregroundStyle(Theme.ink)
                .position(x: W * 0.155, y: H * 0.085)

            SpeakerGrille()
                .frame(width: W * 0.3, height: H * 0.42)
                .position(x: W * 0.19, y: H * 0.345)

            VolumeKnob(value: model.settings.filterWheel ? model.settings.filter : model.settings.volume,
                       label: model.settings.filterWheel ? "Filter" : "Volume",
                       onChange: { model.setWheel($0) })
                .frame(width: W * 0.2, height: W * 0.2)
                .position(x: W * 0.178, y: H * 0.705)

            VStack(spacing: H * 0.008) {
                Text("Chord Synthesizer 1.0")
                Text("Pocket Audio")
            }
            .font(.system(size: W * 0.024, weight: .medium))
            .foregroundStyle(Theme.ink.opacity(0.85))
            .position(x: W * 0.175, y: H * 0.915)
            .accessibilityHidden(true)
        }
        .frame(width: W, height: H, alignment: .topLeading)
    }

    // MARK: Right panel: OLED, function keys, chord keys

    private func rightPanel(W: CGFloat, H: CGFloat) -> some View {
        let left = W * 0.351
        let right = W * 0.970
        let gap = W * 0.011
        let colW = (right - left - 3 * gap) / 4
        let topY = H * 0.045
        let topH = H * 0.195
        let midY = topY + topH + H * 0.024
        let midH = H * 0.205
        let botY = midY + midH + H * 0.016
        let botH = H * 0.955 - botY
        let keyCorner = W * 0.016
        let fnCorner = W * 0.014

        func x(_ col: CGFloat) -> CGFloat { left + col * (colW + gap) }
        let midWide = colW * 1.5 + gap * 0.5

        return ZStack(alignment: .topLeading) {
            LiveOLED()
                .frame(width: colW * 0.92, height: topH)
                .offset(x: x(0) + colW * 0.04, y: topY)

            functionKey(.key, style: .gray, name: "Key", corner: fnCorner)
                .frame(width: colW, height: topH).offset(x: x(1), y: topY)
            functionKey(.sound, style: .yellow, name: "Sound", corner: fnCorner)
                .frame(width: colW, height: topH).offset(x: x(2), y: topY)
            functionKey(.mode, style: .red, name: "Mode", corner: fnCorner)
                .frame(width: colW, height: topH).offset(x: x(3), y: topY)

            // Upper chord row: degrees 5, 6, 7
            chordKey(4, corner: keyCorner).frame(width: midWide, height: midH).offset(x: x(0), y: midY)
            chordKey(5, corner: keyCorner).frame(width: colW, height: midH).offset(x: x(0) + midWide + gap, y: midY)
            chordKey(6, corner: keyCorner).frame(width: right - (x(0) + midWide + gap + colW + gap), height: midH)
                .offset(x: x(0) + midWide + gap + colW + gap, y: midY)

            // Lower chord row: degrees 1-4
            ForEach(0..<4) { i in
                chordKey(i, corner: keyCorner).frame(width: colW, height: botH).offset(x: x(CGFloat(i)), y: botY)
            }
        }
        .frame(width: W, height: H, alignment: .topLeading)
    }

    private func functionKey(_ key: FunctionKey, style: FunctionKeyStyle, name: String, corner: CGFloat) -> some View {
        FunctionKeyView(style: style, pressed: model.pressedFunctions.contains(key), corner: corner,
                        accessibilityName: name,
                        onPress: { model.pressFunction(key) },
                        onRelease: { model.releaseFunction(key) })
    }

    private func chordKey(_ b: Int, corner: CGFloat) -> some View {
        ChordKey(index: b,
                 pressed: model.pressedButtons.contains(b),
                 label: model.settings.showKeyLabels ? keyLabel(b) : nil,
                 numeral: numeral(b),
                 corner: corner,
                 onPress: { model.pressButton(b) },
                 onRelease: { model.releaseButton(b) },
                 onSwipe: { model.swipeButton(b, $0) })
    }

    private func numeral(_ b: Int) -> String {
        let mode = model.settings.mode
        if mode == .mixer { return b < 6 ? "TRACK" : "PLAY" }
        if mode == .drums || mode == .beat { return "\(b + 1)" }
        return ["I", "II", "III", "IV", "V", "VI", "VII"][b]
    }

    private func keyLabel(_ b: Int) -> String {
        let s = model.settings
        switch s.mode {
        case .play, .strum, .drone, .arp, .repeatGate, .sequencer, .earTrainer:
            if s.mode == .earTrainer { return "?" }
            return ChordBuilder.diatonic(degree: b, settings: s.harmony).name(preferFlats: s.harmony.prefersFlats)
        case .lead, .tuner:
            let h = s.harmony
            return NoteNames.name(h.key + h.scale.leadOffset(button: b), preferFlats: h.prefersFlats)
        case .drums: return DrumKit.padNames[b]
        case .beat: return BeatStyle(rawValue: b)?.displayName ?? ""
        case .mic: return "REC"
        case .mixer: return b < 6 ? "\(b + 1)" : "▶■"
        }
    }
}

/// Reads the framebuffer in its own view so 30 fps display updates only redraw the OLED.
private struct LiveOLED: View {
    @Environment(AppModel.self) private var model
    @AppStorage("hichord.bigDisplay") private var bigDisplay = true

    var body: some View {
        OLEDModule(frame: model.frame)
            .contentShape(Rectangle())
            .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { bigDisplay.toggle() } }
            .accessibilityHint("Tap to show or hide the large display")
    }
}

/// Fine horizontal brushing for the aluminium.
struct BrushedTexture: View {
    var body: some View {
        Canvas { ctx, size in
            var seed: UInt32 = 0x2468ACE
            func rand() -> CGFloat {
                seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5
                return CGFloat(seed % 1000) / 1000
            }
            var y: CGFloat = 0
            while y < size.height {
                let alpha = 0.02 + rand() * 0.06
                let color: Color = rand() > 0.5 ? .white : .black
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 0.6)), with: .color(color.opacity(alpha)))
                y += 0.8 + rand() * 1.2
            }
        }
        .allowsHitTesting(false)
    }
}
