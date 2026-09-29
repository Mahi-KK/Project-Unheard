/** Map colour system, read from CSS tokens (tokens.css) so colours have one source. */
import type { CategoryOrAll } from '../../types/data'

export type MapTheme = 'night' | 'day'

export interface MapPalette {
  theme: MapTheme
  bg: string
  land: string
  line: string
  state: string
  outline: string
  demand: string
  need: string[] // 5 ordered classes, low -> high
  unheard: [string, string, string] // mid band, high band, top-10 outline
  hatch: string
  ink: string
  paper: string
}

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

export function readPalette(theme: MapTheme, category: CategoryOrAll): MapPalette {
  const t = (n: string) => cssVar(`--${theme}-${n}`)
  const land = t('land')
  let need = [0, 1, 2, 3, 4].map((i) => t(`need-${i}`))
  if (category !== 'all') {
    const c = cssVar(`--cat-${category}`)
    need =
      theme === 'night'
        ? [mix(c, land, 0.78), mix(c, land, 0.5), c, mix(c, '#ffffff', 0.35), mix(c, '#ffffff', 0.68)]
        : [mix(c, '#ffffff', 0.85), mix(c, '#ffffff', 0.6), mix(c, '#ffffff', 0.25), c, mix(c, '#000000', 0.4)]
  }
  return {
    theme,
    bg: t('bg'),
    land,
    line: t('line'),
    state: t('state'),
    outline: t('outline'),
    demand: t('demand'),
    need,
    unheard: [t('unheard-1'), t('unheard-2'), t('unheard-3')],
    hatch: theme === 'night' ? t('state') : cssVar('--c-mist'),
    ink: cssVar('--c-ink'),
    paper: cssVar('--c-paper'),
  }
}

/** Linear sRGB-space mix of two hex colours; w = weight of b. */
export function mix(a: string, b: string, w: number): string {
  const pa = parse(a)
  const pb = parse(b)
  const c = pa.map((v, i) => Math.round(v * (1 - w) + pb[i] * w))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? [...h].map((x) => x + x).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number]
}

/** Stepped classes — explicit thresholds, shown verbatim in the legend. */
export const NEED_STEPS = [
  { min: 0, label: '< 30' },
  { min: 30, label: '30–40' },
  { min: 40, label: '40–50' },
  { min: 50, label: '50–60' },
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

export function hatchImage(color: string, size = 8): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4)
  const [r, g, b] = parse(color)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % size === 0
      const i = (y * size + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = on ? 200 : 0
    }
  }
  return { width: size, height: size, data }
}
