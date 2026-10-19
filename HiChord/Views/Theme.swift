import SwiftUI

/// Colours and materials sampled from the hardware.
enum Theme {
    static let bodyTop = Color(red: 0.925, green: 0.925, blue: 0.918)
    static let bodyBottom = Color(red: 0.835, green: 0.835, blue: 0.824)
    static let bodyEdge = Color(red: 0.70, green: 0.70, blue: 0.69)
    static let keyTop = Color(red: 0.957, green: 0.941, blue: 0.902)
    static let keyBottom = Color(red: 0.906, green: 0.886, blue: 0.835)
    static let keyPressed = Color(red: 0.86, green: 0.84, blue: 0.79)
    static let keyLabel = Color(red: 0.62, green: 0.60, blue: 0.56)
    static let gray = Color(red: 0.66, green: 0.665, blue: 0.675)
    static let yellow = Color(red: 0.97, green: 0.77, blue: 0.20)
    static let red = Color(red: 0.94, green: 0.31, blue: 0.29)
    static let bezel = Color(red: 0.10, green: 0.10, blue: 0.11)
    static let oled = Color(red: 0.78, green: 0.91, blue: 1.0)
    static let ink = Color(red: 0.20, green: 0.20, blue: 0.21)
    static let backdropCenter = Color(red: 0.16, green: 0.17, blue: 0.19)
    static let backdropEdge = Color(red: 0.035, green: 0.035, blue: 0.045)
    static let ledGreen = Color(red: 0.35, green: 0.95, blue: 0.55)
    static let ledRed = Color(red: 1.0, green: 0.27, blue: 0.25)
    static let ledYellow = Color(red: 1.0, green: 0.82, blue: 0.25)

    static func color(for key: FunctionKeyStyle) -> Color {
        switch key {
        case .gray: return gray
        case .yellow: return yellow
        case .red: return red
        }
    }
}

enum FunctionKeyStyle { case gray, yellow, red }

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
