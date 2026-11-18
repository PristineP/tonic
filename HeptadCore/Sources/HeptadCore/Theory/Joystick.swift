import Foundation

/// The eight joystick directions, plus centre.
public enum JoyDirection: Int, CaseIterable, Codable, Sendable {
    case center, up, upRight, right, downRight, down, downLeft, left, upLeft

    /// Maps a 2-D deflection (x right, y up) to a direction. Returns `.center` inside the dead zone.
    public static func from(x: Double, y: Double, deadZone: Double = 0.35) -> JoyDirection {
        let mag = (x * x + y * y).squareRoot()
        guard mag >= deadZone else { return .center }
        var angle = atan2(y, x) * 180 / .pi // 0 = right, 90 = up
        if angle < 0 { angle += 360 }
        let sector = Int((angle + 22.5) / 45) % 8
        let order: [JoyDirection] = [.right, .upRight, .up, .upLeft, .left, .downLeft, .down, .downRight]
        return order[sector]
    }

    /// Unit vector for drawing.
    public var vector: (x: Double, y: Double) {
        let d = 0.7071
        switch self {
        case .center: return (0, 0)
        case .up: return (0, 1)
        case .upRight: return (d, d)
        case .right: return (1, 0)
        case .downRight: return (d, -d)
        case .down: return (0, -1)
        case .downLeft: return (-d, -d)
        case .left: return (-1, 0)
        case .upLeft: return (-d, d)
        }
    }
}

/// The joystick's harmonic personality.
public enum JoystickMap: Int, CaseIterable, Codable, Sendable {
    case standard, extended, chromatic, borrow, classic

    public var displayName: String {
        switch self {
        case .standard: return "DEFAULT"
        case .extended: return "EXTENDED"
        case .chromatic: return "CHROMATIC"
        case .borrow: return "BORROW"
        case .classic: return "CLASSIC"
        }
    }

    /// Short labels for each direction, used by the on-screen joystick legend.
    public func legend(_ dir: JoyDirection) -> String {
        switch (self, dir) {
        case (_, .center): return ""
        case (.standard, .up): return "maj/min"
        case (.standard, .upRight): return "7"
        case (.standard, .right): return "maj7/m7"
        case (.standard, .downRight): return "9"
        case (.standard, .down): return "sus4"
        case (.standard, .downLeft): return "6/sus2"
        case (.standard, .left): return "dim"
        case (.standard, .upLeft): return "aug"
        case (.extended, .up): return "m7b5"
        case (.extended, .upRight): return "9"
        case (.extended, .right): return "7sus4"
        case (.extended, .downRight): return "add11"
        case (.extended, .down): return "add9"
        case (.extended, .downLeft): return "7#9"
        case (.extended, .left): return "m11"
        case (.extended, .upLeft): return "maj9"
        case (.chromatic, .up): return "+1"
        case (.chromatic, .upRight): return "mMaj7"
        case (.chromatic, .right): return "maj13"
        case (.chromatic, .downRight): return "7b9"
        case (.chromatic, .down): return "-1"
        case (.chromatic, .downLeft): return "7alt"
        case (.chromatic, .left): return "6/9"
        case (.chromatic, .upLeft): return "m7b5"
        case (.borrow, .up): return "V7/"
        case (.borrow, .upRight): return "par."
        case (.borrow, .right): return "b maj"
        case (.borrow, .downRight): return "dim7"
        case (.borrow, .down): return "tri"
        case (.borrow, .downLeft): return "bVII7"
        case (.borrow, .left): return "maj"
        case (.borrow, .upLeft): return "V7sus"
        case (.classic, .up): return "maj/min"
        case (.classic, .upRight): return "7"
        case (.classic, .right): return "maj7/m7"
        case (.classic, .downRight): return "9*"
        case (.classic, .down): return "sus4"
        case (.classic, .downLeft): return "sus2"
        case (.classic, .left): return "dim"
        case (.classic, .upLeft): return "aug"
        }
    }
}
