import TonicCore
import SwiftUI

/// Draws the OLED framebuffer as glowing pixels.
struct OLEDView: View {
    let frame: OLEDFrame

    var body: some View {
        Canvas(opaque: true, rendersAsynchronously: false) { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.black))
            let w = OLEDFrame.width
            let h = OLEDFrame.height
            let px = min(size.width / CGFloat(w), size.height / CGFloat(h))
            let ox = (size.width - px * CGFloat(w)) / 2
            let oy = (size.height - px * CGFloat(h)) / 2
            let dot = max(0.6, px * 0.86)
            var lit = Path()
            let pixels = frame.pixels
            for y in 0..<h {
                let row = y * w
                for x in 0..<w where pixels[row + x] != 0 {
                    lit.addRect(CGRect(x: ox + CGFloat(x) * px, y: oy + CGFloat(y) * px, width: dot, height: dot))
                }
            }
            var glow = ctx
            glow.addFilter(.blur(radius: px * 1.2))
            glow.opacity = 0.55
            glow.fill(lit, with: .color(Theme.oled))
            ctx.fill(lit, with: .color(Theme.oled))
        }
        .accessibilityElement()
        .accessibilityLabel("Display")
    }
}

/// The black OLED module with its glass and bezel.
struct OLEDModule: View {
    let frame: OLEDFrame

    var body: some View {
        GeometryReader { geo in
            let s = geo.size
            ZStack {
                RoundedRectangle(cornerRadius: s.width * 0.08, style: .continuous)
                    .fill(Theme.bezel)
                    .shadow(color: .black.opacity(0.35), radius: s.width * 0.02, y: s.width * 0.02)
                OLEDView(frame: frame)
                    .frame(width: s.width * 0.86, height: s.width * 0.86 / 2)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .position(x: s.width / 2, y: s.height * 0.46)
                // Glass reflection
                RoundedRectangle(cornerRadius: s.width * 0.08, style: .continuous)
                    .fill(LinearGradient(colors: [.white.opacity(0.08), .clear, .clear],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
                    .allowsHitTesting(false)
            }
        }
    }
}
