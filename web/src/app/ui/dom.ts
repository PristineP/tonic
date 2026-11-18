// Tiny DOM helpers.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg(markup: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg')
  el.setAttribute('viewBox', viewBox)
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = markup
  return el
}

export const icons = {
  help: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.1" fill="currentColor"/>',
  sliders: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></g>',
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  metronome: '<path d="M9.5 3h5l4 18h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 15 17 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  midi: '<g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v8M12 5v8M16 5v8"/></g>',
}

export function iconButton(icon: string, label: string, onClick: () => void, cls = 'iconbtn'): HTMLButtonElement {
  const b = h('button', { class: cls, 'aria-label': label, title: label, onclick: onClick })
  b.append(svg(icon))
  return b
}

let toastTimer = 0
export function toast(text: string): void {
  document.querySelector('.toast')?.remove()
  const t = h('div', { class: 'toast', role: 'status' }, text)
  document.body.append(t)
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => t.remove(), 2600)
}

export function capitalized(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/// Pointer capture that never throws (synthetic or already-ended pointers).
export function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* pointer no longer active */
  }
}
