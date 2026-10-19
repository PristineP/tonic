import HiChordCore
import SwiftUI

/// Touch handling shared by all keys: press on touch-down, release on lift,
/// and report swipe directions while held (the joystick stand-in on a key).
struct KeyTouch: ViewModifier {
    var onPress: () -> Void
    var onRelease: () -> Void
    var onSwipe: ((JoyDirection) -> Void)? = nil
    @State private var isDown = false
    @State private var lastDirection: JoyDirection = .center

    func body(content: Content) -> some View {
        content.gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { value in
                    if !isDown {
                        isDown = true
                        lastDirection = .center
                        onPress()
                    }
                    guard let onSwipe else { return }
                    let t = value.translation
                    // ~28 pt of travel selects a direction; the dead zone avoids accidental bends.
                    let dir = JoyDirection.from(x: t.width / 28, y: -t.height / 28, deadZone: 1)
                    if dir != lastDirection {
                        lastDirection = dir
                        onSwipe(dir)
                    }
                }
                .onEnded { _ in
                    if isDown {
                        isDown = false
                        onRelease()
                    }
                }
        )
    }
}

extension View {
    func keyTouch(onPress: @escaping () -> Void, onRelease: @escaping () -> Void,
                  onSwipe: ((JoyDirection) -> Void)? = nil) -> some View {
        modifier(KeyTouch(onPress: onPress, onRelease: onRelease, onSwipe: onSwipe))
    }
}

/// A cream chord key.
struct ChordKey: View {
    let index: Int
    let pressed: Bool
    let label: String?
    let numeral: String
    let corner: CGFloat
    let onPress: () -> Void
    let onRelease: () -> Void
    let onSwipe: (JoyDirection) -> Void

    var body: some View {
        GeometryReader { geo in
            let s = geo.size
            let unit = min(s.width, s.height)
            ZStack {
                // Shadow / gap the key sits in
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(Color.black.opacity(0.16))
                    .offset(y: pressed ? 0.5 : unit * 0.025)
                    .blur(radius: pressed ? 0.5 : unit * 0.02)
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(LinearGradient(colors: pressed ? [Theme.keyPressed, Theme.keyPressed.opacity(0.95)]
                                                         : [Theme.keyTop, Theme.keyBottom],
                                         startPoint: .top, endPoint: .bottom))
                    .overlay(
                        RoundedRectangle(cornerRadius: corner, style: .continuous)
                            .strokeBorder(LinearGradient(colors: [.white.opacity(0.85), .black.opacity(0.08)],
                                                         startPoint: .top, endPoint: .bottom), lineWidth: 1)
                    )
                    // Subtle concave dish
                    .overlay(
                        RoundedRectangle(cornerRadius: corner * 0.8, style: .continuous)
                            .fill(RadialGradient(colors: [.black.opacity(pressed ? 0.06 : 0.025), .clear],
                                                 center: .center, startRadius: 0, endRadius: unit * 0.6))
                            .padding(unit * 0.08)
                    )
                if let label {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(label)
                            .font(.system(size: max(9, unit * 0.17), weight: .semibold, design: .rounded))
                            .foregroundStyle(Theme.keyLabel)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                        Text(numeral)
                            .font(.system(size: max(7, unit * 0.11), weight: .medium, design: .rounded))
                            .foregroundStyle(Theme.keyLabel.opacity(0.7))
                    }
                    .padding(unit * 0.1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .allowsHitTesting(false)
                }
            }
            .scaleEffect(pressed ? 0.975 : 1)
            .offset(y: pressed ? unit * 0.015 : 0)
            .animation(.easeOut(duration: 0.06), value: pressed)
            .contentShape(Rectangle())
            .keyTouch(onPress: onPress, onRelease: onRelease, onSwipe: onSwipe)
        }
        .accessibilityElement()
        .accessibilityLabel(label.map { "Chord \(numeral), \($0)" } ?? "Chord button \(index + 1)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onPress(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { onRelease() } }
    }
}

/// One of the three coloured function keys.
struct FunctionKeyView: View {
    let style: FunctionKeyStyle
    let pressed: Bool
    let corner: CGFloat
    let accessibilityName: String
    let onPress: () -> Void
    let onRelease: () -> Void

    var body: some View {
        GeometryReader { geo in
            let s = geo.size
            let base = Theme.color(for: style)
            ZStack {
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(Color.black.opacity(0.2))
                    .offset(y: pressed ? 0.5 : s.height * 0.03)
                    .blur(radius: pressed ? 0.5 : s.height * 0.02)
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(base)
                    .overlay(
                        RoundedRectangle(cornerRadius: corner, style: .continuous)
                            .fill(LinearGradient(colors: [.white.opacity(pressed ? 0 : 0.08), .black.opacity(pressed ? 0.2 : 0.08)],
                                                 startPoint: .top, endPoint: .bottom))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: corner, style: .continuous)
                            .strokeBorder(LinearGradient(colors: [.white.opacity(0.45), .black.opacity(0.1)],
                                                         startPoint: .top, endPoint: .bottom), lineWidth: 1)
                    )
                FunctionIcon(style: style)
                    .stroke(.white, style: StrokeStyle(lineWidth: max(1.5, s.width * 0.035), lineCap: .round, lineJoin: .round))
                    .frame(width: s.width * 0.3, height: s.width * 0.3)
                    .shadow(color: .black.opacity(0.12), radius: 0.5, y: 0.5)
            }
            .scaleEffect(pressed ? 0.97 : 1)
            .offset(y: pressed ? s.height * 0.015 : 0)
            .animation(.easeOut(duration: 0.06), value: pressed)
            .contentShape(Rectangle())
            .keyTouch(onPress: onPress, onRelease: onRelease)
        }
        .accessibilityElement()
        .accessibilityLabel(accessibilityName)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onPress(); onRelease() }
    }
}

/// Line icons printed on the function keys: key, waveform, clock.
struct FunctionIcon: Shape {
    let style: FunctionKeyStyle

    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        switch style {
        case .gray:
            // A key: ring at lower-left, shaft to upper-right with two teeth.
            let ringR = w * 0.22
            let c = CGPoint(x: r.minX + w * 0.3, y: r.minY + h * 0.7)
            p.addEllipse(in: CGRect(x: c.x - ringR, y: c.y - ringR, width: ringR * 2, height: ringR * 2))
            let start = CGPoint(x: c.x + ringR * 0.7, y: c.y - ringR * 0.7)
            let end = CGPoint(x: r.minX + w * 0.95, y: r.minY + h * 0.05)
            p.move(to: start)
            p.addLine(to: end)
            let t1 = CGPoint(x: start.x + (end.x - start.x) * 0.62, y: start.y + (end.y - start.y) * 0.62)
            let t2 = CGPoint(x: start.x + (end.x - start.x) * 0.86, y: start.y + (end.y - start.y) * 0.86)
            p.move(to: t1); p.addLine(to: CGPoint(x: t1.x + w * 0.14, y: t1.y + h * 0.14))
            p.move(to: t2); p.addLine(to: CGPoint(x: t2.x + w * 0.12, y: t2.y + h * 0.12))
        case .yellow:
            // A pulse waveform.
            p.move(to: CGPoint(x: r.minX, y: r.midY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.2, y: r.midY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.2, y: r.minY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.5, y: r.minY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.5, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.8, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX + w * 0.8, y: r.midY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.midY))
        case .red:
            // A clock.
            p.addEllipse(in: r)
            p.move(to: CGPoint(x: r.midX, y: r.midY))
            p.addLine(to: CGPoint(x: r.midX, y: r.minY + h * 0.22))
            p.move(to: CGPoint(x: r.midX, y: r.midY))
            p.addLine(to: CGPoint(x: r.midX + w * 0.22, y: r.midY))
        }
        return p
    }
}
