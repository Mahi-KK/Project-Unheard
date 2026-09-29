/** Map colour classes, read from CSS tokens so the palette has one source. */
export interface Palette {
  bg: string
  ink: string
  accent: string
  accentSoft: string
  dim: string
  dim2: string
  line: string
  surface: string
  mist: string
  paper: string
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    bg: v('--c-bg'),
    ink: v('--c-ink'),
    accent: v('--c-accent'),
    accentSoft: v('--c-accent-soft'),
    dim: v('--c-dim'),
    dim2: v('--c-dim-2'),
    line: v('--c-line'),
    surface: v('--c-surface'),
    mist: v('--c-mist'),
    paper: v('--c-paper'),
  }
}

/** Stepped classes — explicit thresholds, shown verbatim in the legend. */
export const NEED_STEPS = [
  { min: 0, label: '0–30' },
  { min: 30, label: '30–45' },
  { min: 45, label: '45–60' },
  { min: 60, label: '60+' },
]
export const UNHEARD_STEPS = [
  { min: 0, label: '< 30' },
  { min: 30, label: '30–45' },
  { min: 45, label: '45+' },
]
export const NEED_STOPS = NEED_STEPS.map((s) => s.min)
export const UNHEARD_MID = UNHEARD_STEPS[1].min
export const UNHEARD_HIGH = UNHEARD_STEPS[2].min

export function needColors(p: Palette) {
  return [p.paper, p.mist, p.dim2, p.ink]
}
export function unheardColors(p: Palette) {
  return [p.surface, p.accentSoft, p.accent]
}

export function hatchImage(p: Palette, size = 8): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4)
  const hex = p.mist.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % size === 0
      const i = (y * size + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = on ? 255 : 0
    }
  }
  return { width: size, height: size, data }
}
