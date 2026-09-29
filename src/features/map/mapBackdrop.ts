import type { Map as MLMap } from 'maplibre-gl'
import type { MapTheme } from './mapStyle'

/**
 * Living cartographic backdrop drawn *behind* the (transparent) map canvas.
 * Everything is anchored to geography, so it pans and zooms with the map:
 *  - a sea of points on a lat/long lattice with a slow swell, like water
 *  - a graticule (every 5° or 10°) with degree labels, editorial-atlas style
 *  - occasional soft swells rolling in from the south-west (monsoon direction)
 * Land is painted opaquely on top by the map, so the motion lives in the sea
 * and in hatched no-data districts. ~30 fps, paused when hidden, static
 * (redrawn only on camera change) under prefers-reduced-motion.
 */
export function startBackdrop(canvas: HTMLCanvasElement, map: MLMap, getTheme: () => MapTheme): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let raf = 0
  let last = 0
  let dirty = true
  let w = 0
  let h = 0

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    dirty = true
  }

  const draw = (t: number) => {
    const night = getTheme() === 'night'
    ctx.clearRect(0, 0, w, h)
    const b = map.getBounds()
    const west = Math.max(-180, b.getWest() - 2)
    const east = Math.min(180, b.getEast() + 2)
    const south = Math.max(-80, b.getSouth() - 2)
    const north = Math.min(80, b.getNorth() + 2)

    // choose a lattice step that keeps points ~18–40 px apart
    const pxPerDeg = Math.abs(map.project([1, 0]).x - map.project([0, 0]).x) || 1
    const steps = [0.125, 0.25, 0.5, 1, 2, 4]
    const step = steps.find((s) => s * pxPerDeg >= 18) ?? 4

    // --- sea of points (batched into a few alpha buckets: ~8 fill calls per frame)
    const dot = night ? '205,214,226' : '60,63,69'
    const base = night ? 0.14 : 0.12
    const BUCKETS = 8
    const paths = Array.from({ length: BUCKETS }, () => new Path2D())
    const lng0 = Math.floor(west / step) * step
    const lat0 = Math.floor(south / step) * step
    const origin = map.project([lng0, lat0])
    const dx = map.project([lng0 + step, lat0]).x - origin.x
    for (let lat = lat0; lat <= north; lat += step) {
      const rowStart = map.project([lng0, lat])
      for (let i = 0, lng = lng0; lng <= east; lng += step, i++) {
        const x = rowStart.x + i * dx
        const y = rowStart.y
        if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue
        // slow swell + a long wave rolling in from the south-west
        const swell = 0.5 + 0.5 * Math.sin(lng * 0.55 + lat * 0.35 - t * 0.6)
        const roll = Math.max(0, Math.sin((lng + lat) * 0.18 - t * 0.9)) ** 6
        const v = Math.min(1, swell * 0.45 + roll)
        const b = Math.min(BUCKETS - 1, Math.floor(v * BUCKETS))
        const r = 0.9 + v * 1.4
        paths[b].rect(x - r / 2, y - r / 2, r, r)
      }
    }
    for (let b2 = 0; b2 < BUCKETS; b2++) {
      const a = base + (b2 / (BUCKETS - 1)) * (night ? 0.42 : 0.32)
      ctx.fillStyle = `rgba(${dot},${a.toFixed(3)})`
      ctx.fill(paths[b2])
    }

    // --- graticule
    const gStep = pxPerDeg * 5 >= 60 ? 5 : 10
    ctx.strokeStyle = night ? 'rgba(154,160,170,0.18)' : 'rgba(60,63,69,0.16)'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 5])
    ctx.font = '10px "Geist Mono", ui-monospace, monospace'
    ctx.fillStyle = night ? 'rgba(200,205,214,0.45)' : 'rgba(40,42,46,0.5)'
    for (let lng = Math.ceil(west / gStep) * gStep; lng <= east; lng += gStep) {
      const a = map.project([lng, north])
      const z = map.project([lng, south])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(z.x, z.y)
      ctx.stroke()
      if (a.x > 40 && a.x < w - 600) ctx.fillText(`${lng}°E`, a.x + 4, h - 10)
    }
    for (let lat = Math.ceil(south / gStep) * gStep; lat <= north; lat += gStep) {
      const a = map.project([west, lat])
      const z = map.project([east, lat])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(z.x, z.y)
      ctx.stroke()
      if (a.y > 20 && a.y < h - 120) ctx.fillText(`${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'}`, w - 44, a.y - 4)
    }
    ctx.setLineDash([])
  }

  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (document.hidden) return
    if (reduce) {
      if (dirty) {
        draw(0)
        dirty = false
      }
      return
    }
    if (!dirty && now - last < 42) return
    last = now
    dirty = false
    draw(now / 1000)
  }

  const onMove = () => {
    dirty = true
  }
  map.on('move', onMove)
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()
  // start once the map has drawn its first frame so the backdrop never delays map loading
  if (map.loaded()) raf = requestAnimationFrame(loop)
  else map.once('idle', () => (raf = requestAnimationFrame(loop)))
  return () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    map.off('move', onMove)
  }
}
