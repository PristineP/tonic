import SwiftUI

/// Heptad's colours: a matte slate-navy body, off-white keys and teal / amber / coral function keys.
enum Theme {
    static let bodyTop = Color(red: 0.137, green: 0.188, blue: 0.255)    // #233041
    static let bodyBottom = Color(red: 0.106, green: 0.149, blue: 0.208) // #1B2635
    static let bodyEdge = Color(red: 0.255, green: 0.322, blue: 0.408)
    static let keyTop = Color(red: 0.965, green: 0.965, blue: 0.957)
    static let keyBottom = Color(red: 0.902, green: 0.910, blue: 0.910)
    static let keyPressed = Color(red: 0.855, green: 0.875, blue: 0.878)
    static let keyLabel = Color(red: 0.36, green: 0.42, blue: 0.48)
    /// Accent ring on a pressed chord key and the active joystick direction.
    static let accent = Color(red: 0.180, green: 0.769, blue: 0.714)     // #2EC4B6
    static let teal = Color(red: 0.180, green: 0.769, blue: 0.714)       // #2EC4B6
    static let amber = Color(red: 0.949, green: 0.647, blue: 0.255)      // #F2A541
    static let coral = Color(red: 0.937, green: 0.435, blue: 0.424)      // #EF6F6C
    static let bezel = Color(red: 0.05, green: 0.07, blue: 0.10)
    static let oled = Color(red: 0.78, green: 0.91, blue: 1.0)
    /// Printing on the body (logo, legends, knob ticks).
    static let ink = Color(red: 0.86, green: 0.89, blue: 0.93)
    static let backdropCenter = Color(red: 0.16, green: 0.17, blue: 0.19)
    static let backdropEdge = Color(red: 0.035, green: 0.035, blue: 0.045)
    static let ledGreen = Color(red: 0.35, green: 0.95, blue: 0.55)
    static let ledRed = Color(red: 1.0, green: 0.27, blue: 0.25)
    static let ledYellow = Color(red: 1.0, green: 0.82, blue: 0.25)

    static func color(for key: FunctionKeyStyle) -> Color {
        switch key {
        case .key: return teal
        case .sound: return amber
        case .mode: return coral
        }
    }
}

enum FunctionKeyStyle { case key, sound, mode }

/// The dark studio backdrop the device sits on.
struct Backdrop: View {
    var body: some View {
        GeometryReader { geo in
            RadialGradient(colors: [Theme.backdropCenter, Theme.backdropEdge],
                           center: .init(x: 0.5, y: 0.38),
                           startRadius: 0,
                           endRadius: max(geo.size.width, geo.size.height) * 0.8)
        }
        .ignoresSafeArea()
    }
}
