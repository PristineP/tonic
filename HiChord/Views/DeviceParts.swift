import HiChordCore
import SwiftUI

/// The perforated speaker grille.
struct SpeakerGrille: View {
    var body: some View {
        Canvas { ctx, size in
            let r = min(size.width, size.height) / 2
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let pitch = r / 6.3
            let hole = pitch * 0.56
            let n = Int(r / pitch) + 1
            for iy in -n...n {
                for ix in -n...n {
                    let x = CGFloat(ix) * pitch
                    let y = CGFloat(iy) * pitch
                    // Rounded-square grille outline like the hardware.
                    let nx = abs(x) / (r - hole), ny = abs(y) / (r - hole)
                    guard pow(nx, 2.6) + pow(ny, 2.6) <= 1 else { continue }
                    let rect = CGRect(x: c.x + x - hole / 2, y: c.y + y - hole / 2, width: hole, height: hole)
                    ctx.fill(Path(ellipseIn: rect), with: .color(Color(white: 0.24)))
                    ctx.fill(Path(ellipseIn: rect.offsetBy(dx: 0, dy: hole * 0.12).insetBy(dx: hole * 0.12, dy: hole * 0.12)),
                             with: .color(Color(white: 0.12)))
                    // Lit rim on the lower edge of each hole
                    ctx.stroke(Path(ellipseIn: rect.insetBy(dx: -0.3, dy: -0.3)),
                               with: .linearGradient(Gradient(colors: [.black.opacity(0.25), .white.opacity(0.7)]),
                                                     startPoint: CGPoint(x: rect.midX, y: rect.minY),
                                                     endPoint: CGPoint(x: rect.midX, y: rect.maxY)),
                               lineWidth: 0.6)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The cream volume / filter wheel with tick dots around it.
struct VolumeKnob: View {
    var value: Float
    var label: String
    var onChange: (Float) -> Void
    @State private var dragStart: Float?

    var body: some View {
        GeometryReader { geo in
            let d = min(geo.size.width, geo.size.height)
            let knob = d * 0.62
            ZStack {
                // Tick dots
                ForEach(0..<9) { i in
                    let angle = Angle.degrees(-225 + Double(i) * 33.75)
                    Circle()
                        .fill(Theme.ink.opacity(0.75))
                        .frame(width: d * 0.035, height: d * 0.035)
                        .offset(x: cos(angle.radians) * d * 0.44, y: sin(angle.radians) * d * 0.44)
                }
                Circle()
                    .fill(Color.black.opacity(0.22))
                    .frame(width: knob, height: knob)
                    .offset(y: knob * 0.05)
                    .blur(radius: knob * 0.04)
                Circle()
                    .fill(RadialGradient(colors: [Theme.keyTop, Theme.keyBottom], center: .init(x: 0.4, y: 0.3),
                                         startRadius: 0, endRadius: knob * 0.7))
                    .overlay(Circle().strokeBorder(LinearGradient(colors: [.white.opacity(0.9), .black.opacity(0.12)],
                                                                   startPoint: .top, endPoint: .bottom), lineWidth: 1))
                    .frame(width: knob, height: knob)
                // Indicator
                Capsule()
                    .fill(Theme.ink.opacity(0.55))
                    .frame(width: knob * 0.06, height: knob * 0.2)
                    .offset(y: -knob * 0.3)
                    .rotationEffect(.degrees(-135 + Double(value) * 270))
                    .frame(width: knob, height: knob)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        if dragStart == nil { dragStart = value }
                        let delta = Float((g.translation.width - g.translation.height) / (d * 2.2))
                        onChange(min(1, max(0, (dragStart ?? value) + delta)))
                    }
                    .onEnded { _ in dragStart = nil }
            )
        }
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { dir in
            switch dir {
            case .increment: onChange(min(1, value + 0.05))
            case .decrement: onChange(max(0, value - 0.05))
            @unknown default: break
            }
        }
    }
}

/// The eight-way clickable joystick. Drag to bend chords, tap to click.
struct JoystickView: View {
    var map: JoystickMap
    var direction: JoyDirection
    var onDirection: (JoyDirection) -> Void
    var onClick: () -> Void
    @State private var offset: CGSize = .zero
    @State private var downAt: Date?
    @State private var travelled: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let d = min(geo.size.width, geo.size.height)
            let radius = d * 0.3
            ZStack {
                // Base plate with direction legend
                Circle()
                    .fill(LinearGradient(colors: [Theme.bodyTop, Theme.bodyBottom], startPoint: .top, endPoint: .bottom))
                    .overlay(Circle().strokeBorder(Theme.bodyEdge.opacity(0.7), lineWidth: 1))
                    .shadow(color: .black.opacity(0.5), radius: d * 0.04, y: d * 0.02)
                ForEach(JoyDirection.allCases.filter { $0 != .center }, id: \.rawValue) { dir in
                    let v = dir.vector
                    let active = dir == direction
                    Text(map.legend(dir))
                        .font(.system(size: max(8, d * 0.065), weight: active ? .bold : .semibold, design: .rounded))
                        .foregroundStyle(active ? Theme.red : Theme.ink.opacity(0.55))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(width: d * 0.24)
                        .offset(x: v.x * d * 0.38, y: -v.y * d * 0.38)
                }
                // Well
                Circle()
                    .fill(RadialGradient(colors: [Color(white: 0.55), Color(white: 0.72)], center: .center,
                                         startRadius: 0, endRadius: d * 0.2))
                    .frame(width: d * 0.4, height: d * 0.4)
                // Stick cap
                Circle()
                    .fill(RadialGradient(colors: [Theme.keyTop, Theme.keyBottom], center: .init(x: 0.4, y: 0.3),
                                         startRadius: 0, endRadius: d * 0.2))
                    .overlay(Circle().strokeBorder(.white.opacity(0.8), lineWidth: 1))
                    .overlay(
                        Circle().fill(Theme.keyBottom.opacity(0.9)).frame(width: d * 0.12, height: d * 0.12)
                            .overlay(Circle().strokeBorder(.black.opacity(0.06), lineWidth: 1))
                    )
                    .frame(width: d * 0.3, height: d * 0.3)
                    .shadow(color: .black.opacity(0.35), radius: d * 0.03, y: d * 0.02)
                    .offset(offset)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        if downAt == nil { downAt = Date(); travelled = 0 }
                        var t = g.translation
                        let mag = (t.width * t.width + t.height * t.height).squareRoot()
                        travelled = max(travelled, mag)
                        if mag > radius {
                            t = CGSize(width: t.width / mag * radius, height: t.height / mag * radius)
                        }
                        offset = t
                        onDirection(JoyDirection.from(x: t.width / radius, y: -t.height / radius, deadZone: 0.45))
                    }
                    .onEnded { _ in
                        let quickTap = travelled < radius * 0.3 && Date().timeIntervalSince(downAt ?? Date()) < 0.35
                        withAnimation(.spring(response: 0.18, dampingFraction: 0.55)) { offset = .zero }
                        onDirection(.center)
                        if quickTap { onClick() }
                        downAt = nil
                    }
            )
        }
        .accessibilityElement()
        .accessibilityLabel("Joystick")
        .accessibilityHint("Drag to change the chord, tap to click")
        .accessibilityAction(named: "Click") { onClick() }
    }
}
