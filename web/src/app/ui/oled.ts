// Draws the OLED framebuffer as glowing pixels on a canvas.
import { OLEDFrame } from '../../core/display/oledFrame'

const S = 4 // canvas pixels per OLED pixel

export function createOLEDCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = OLEDFrame.width * S
  c.height = OLEDFrame.height * S
  c.setAttribute('aria-hidden', 'true')
  return c
}

export function drawOLED(canvas: HTMLCanvasElement, frame: OLEDFrame): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = OLEDFrame.width
  const hgt = OLEDFrame.height
  const px = frame.pixels
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const color = getComputedStyle(document.documentElement).getPropertyValue('--oled').trim() || '#9ef0e6'
  const path = new Path2D()
  const dot = S - 0.6
  for (let y = 0; y < hgt; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) if (px[row + x]) path.rect(x * S, y * S, dot, dot)
  }
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = S * 2.2
  ctx.globalAlpha = 0.6
  ctx.fillStyle = color
  ctx.fill(path)
  ctx.restore()
  ctx.fillStyle = color
  ctx.fill(path)
}
