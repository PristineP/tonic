import Foundation

/// A monochrome framebuffer for the Heptad OLED (128×64: a 64×32 pixel grid drawn at 2× for legibility).
public struct OLEDFrame: Equatable, Sendable {
    public static let width = 128
    public static let height = 64

    /// Row-major, one byte per pixel (0 or 1).
    public private(set) var pixels: [UInt8]

    public init() {
        pixels = [UInt8](repeating: 0, count: OLEDFrame.width * OLEDFrame.height)
    }

    public func isOn(x: Int, y: Int) -> Bool {
        guard x >= 0, y >= 0, x < OLEDFrame.width, y < OLEDFrame.height else { return false }
        return pixels[y * OLEDFrame.width + x] != 0
    }

    public mutating func clear() {
        for i in pixels.indices { pixels[i] = 0 }
    }

    public mutating func set(_ x: Int, _ y: Int, _ on: Bool = true) {
        guard x >= 0, y >= 0, x < OLEDFrame.width, y < OLEDFrame.height else { return }
        pixels[y * OLEDFrame.width + x] = on ? 1 : 0
    }

    public mutating func fill(x: Int, y: Int, w: Int, h: Int, on: Bool = true) {
        guard w > 0, h > 0 else { return }
        for yy in y..<(y + h) { for xx in x..<(x + w) { set(xx, yy, on) } }
    }

    public mutating func rect(x: Int, y: Int, w: Int, h: Int) {
        guard w > 0, h > 0 else { return }
        for xx in x..<(x + w) { set(xx, y); set(xx, y + h - 1) }
        for yy in y..<(y + h) { set(x, yy); set(x + w - 1, yy) }
    }

    public mutating func invert(x: Int, y: Int, w: Int, h: Int) {
        guard w > 0, h > 0 else { return }
        for yy in y..<(y + h) {
            for xx in x..<(x + w) where xx >= 0 && yy >= 0 && xx < OLEDFrame.width && yy < OLEDFrame.height {
                pixels[yy * OLEDFrame.width + xx] ^= 1
            }
        }
    }

    public mutating func hline(x: Int, y: Int, w: Int) { fill(x: x, y: y, w: w, h: 1) }
    public mutating func vline(x: Int, y: Int, h: Int) { fill(x: x, y: y, w: 1, h: h) }

    public mutating func line(x0: Int, y0: Int, x1: Int, y1: Int) {
        var x0 = x0, y0 = y0
        let dx = abs(x1 - x0), sx = x0 < x1 ? 1 : -1
        let dy = -abs(y1 - y0), sy = y0 < y1 ? 1 : -1
        var err = dx + dy
        while true {
            set(x0, y0)
            if x0 == x1 && y0 == y1 { break }
            let e2 = 2 * err
            if e2 >= dy { err += dy; x0 += sx }
            if e2 <= dx { err += dx; y0 += sy }
        }
    }

    // MARK: Text

    public static func textWidth(_ s: String, scale: Int = 1) -> Int {
        let n = s.count
        return n == 0 ? 0 : (n * (PixelFont.width + 1) - 1) * scale
    }

    public static func textHeight(scale: Int = 1) -> Int { PixelFont.height * scale }

    public mutating func text(_ s: String, x: Int, y: Int, scale: Int = 1) {
        var cx = x
        for c in s {
            let rows = PixelFont.glyph(c)
            for (ry, bits) in rows.enumerated() {
                for rx in 0..<PixelFont.width where bits & (1 << (PixelFont.width - 1 - rx)) != 0 {
                    fill(x: cx + rx * scale, y: y + ry * scale, w: scale, h: scale)
                }
            }
            cx += (PixelFont.width + 1) * scale
        }
    }

    public enum Align { case left, center, right }

    public mutating func text(_ s: String, y: Int, align: Align, scale: Int = 1, inset: Int = 0) {
        let w = OLEDFrame.textWidth(s, scale: scale)
        let x: Int
        switch align {
        case .left: x = inset
        case .center: x = (OLEDFrame.width - w) / 2
        case .right: x = OLEDFrame.width - w - inset
        }
        text(s, x: x, y: y, scale: scale)
    }

    /// Draws `s` centred at the largest scale (up to `maxScale`) that fits `maxWidth`. Returns the scale used.
    @discardableResult
    public mutating func fittedText(_ s: String, centerY: Int, maxScale: Int = 3, maxWidth: Int = OLEDFrame.width - 4) -> Int {
        var scale = maxScale
        while scale > 1 && OLEDFrame.textWidth(s, scale: scale) > maxWidth { scale -= 1 }
        let h = OLEDFrame.textHeight(scale: scale)
        text(s, y: centerY - h / 2, align: .center, scale: scale)
        return scale
    }

    /// ASCII-art dump, handy for tests and debugging.
    public var ascii: String {
        var out = ""
        for y in 0..<OLEDFrame.height {
            for x in 0..<OLEDFrame.width { out.append(isOn(x: x, y: y) ? "#" : ".") }
            out.append("\n")
        }
        return out
    }
}
