import { PixelFont } from './pixelFont'

export enum Align { left, center, right }

/** A monochrome framebuffer emulating the OLED (rendered at 2× the hardware's 64×32 for legibility). */
export class OLEDFrame {
  static readonly width = 128
  static readonly height = 64

  /** Row-major, one byte per pixel (0 or 1). */
  readonly pixels: Uint8Array

  constructor(pixels?: Uint8Array) {
    this.pixels = pixels ? pixels.slice() : new Uint8Array(OLEDFrame.width * OLEDFrame.height)
  }

  /** Value copy (Swift struct semantics). */
  clone(): OLEDFrame { return new OLEDFrame(this.pixels) }

  equals(other: OLEDFrame): boolean {
    const a = this.pixels, b = other.pixels
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  isOn(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= OLEDFrame.width || y >= OLEDFrame.height) return false
    return this.pixels[y * OLEDFrame.width + x] !== 0
  }

  clear(): void { this.pixels.fill(0) }

  set(x: number, y: number, on = true): void {
    if (x < 0 || y < 0 || x >= OLEDFrame.width || y >= OLEDFrame.height) return
    this.pixels[y * OLEDFrame.width + x] = on ? 1 : 0
  }

  fill(x: number, y: number, w: number, h: number, on = true): void {
    if (w <= 0 || h <= 0) return
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, on)
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return
    for (let xx = x; xx < x + w; xx++) { this.set(xx, y); this.set(xx, y + h - 1) }
    for (let yy = y; yy < y + h; yy++) { this.set(x, yy); this.set(x + w - 1, yy) }
  }

  invert(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (xx >= 0 && yy >= 0 && xx < OLEDFrame.width && yy < OLEDFrame.height) {
          this.pixels[yy * OLEDFrame.width + xx] ^= 1
        }
      }
    }
  }

  hline(x: number, y: number, w: number): void { this.fill(x, y, w, 1) }
  vline(x: number, y: number, h: number): void { this.fill(x, y, 1, h) }

  line(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x0, y0)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }

  // MARK: Text

  /** Character count as Swift counts it (grapheme-ish: code points). */
  static textWidth(s: string, scale = 1): number {
    const n = Array.from(s).length
    return n === 0 ? 0 : (n * (PixelFont.width + 1) - 1) * scale
  }

  static textHeight(scale = 1): number { return PixelFont.height * scale }

  /** Draws text at a pixel position. */
  text(s: string, x: number, y: number, scale = 1): void {
    let cx = x
    for (const c of s) {
      const rows = PixelFont.glyph(c)
      rows.forEach((bits, ry) => {
        for (let rx = 0; rx < PixelFont.width; rx++) {
          if ((bits & (1 << (PixelFont.width - 1 - rx))) !== 0) {
            this.fill(cx + rx * scale, y + ry * scale, scale, scale)
          }
        }
      })
      cx += (PixelFont.width + 1) * scale
    }
  }

  /** Swift `text(_:y:align:scale:inset:)`. */
  alignedText(s: string, y: number, align: Align, scale = 1, inset = 0): void {
    const w = OLEDFrame.textWidth(s, scale)
    let x: number
    switch (align) {
      case Align.left: x = inset; break
      case Align.center: x = Math.trunc((OLEDFrame.width - w) / 2); break
      case Align.right: x = OLEDFrame.width - w - inset; break
    }
    this.text(s, x, y, scale)
  }

  /** Draws `s` centred at the largest scale (up to `maxScale`) that fits `maxWidth`. Returns the scale used. */
  fittedText(s: string, centerY: number, maxScale = 3, maxWidth = OLEDFrame.width - 4): number {
    let scale = maxScale
    while (scale > 1 && OLEDFrame.textWidth(s, scale) > maxWidth) scale -= 1
    const h = OLEDFrame.textHeight(scale)
    this.alignedText(s, centerY - Math.trunc(h / 2), Align.center, scale)
    return scale
  }

  /** ASCII-art dump, handy for tests and debugging. */
  get ascii(): string {
    let out = ''
    for (let y = 0; y < OLEDFrame.height; y++) {
      for (let x = 0; x < OLEDFrame.width; x++) out += this.isOn(x, y) ? '#' : '.'
      out += '\n'
    }
    return out
  }
}

export namespace OLEDFrame {
  export const Alignment = Align
}
