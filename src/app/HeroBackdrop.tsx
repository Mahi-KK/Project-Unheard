import { useEffect, useRef } from 'react'

/**
 * Continuous landing backdrop: a quiet lattice of points (one per "place")
 * with a slow travelling swell, and occasional ripples — a report being
 * heard somewhere. Canvas 2D, ~30 fps, pauses when hidden, static under
 * prefers-reduced-motion.
 */
export function HeroBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const GAP = 26
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let last = 0
    const ripples: { x: number; y: number; t0: number; hot: boolean }[] = []

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (tMs: number) => {
      const t = tMs / 1000
      ctx.clearRect(0, 0, w, h)
      if (!reduce && (ripples.length === 0 || t - ripples[ripples.length - 1].t0 > 1.3)) {
        ripples.push({ x: Math.random() * w, y: Math.random() * h, t0: t, hot: Math.random() < 0.45 })
        if (ripples.length > 6) ripples.shift()
      }
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          // slow swell across the field
          const swell = 0.5 + 0.5 * Math.sin(x * 0.006 + t * 0.5) * Math.cos(y * 0.008 - t * 0.35)
          let a = 0.07 + swell * 0.16
          let hot = 0
          for (const r of ripples) {
            const age = t - r.t0
            const radius = age * 150
            const d = Math.hypot(x - r.x, y - r.y)
            const band = Math.exp(-((d - radius) ** 2) / 900) * Math.max(0, 1 - age / 4.5)
            if (r.hot) hot = Math.max(hot, band)
            else a += band * 0.35
          }
          const size = 1.1 + swell * 0.7 + hot * 1.6
          if (hot > 0.05) {
            ctx.fillStyle = `rgba(255,122,23,${Math.min(0.85, 0.15 + hot * 0.7)})`
          } else {
            ctx.fillStyle = `rgba(218,219,223,${Math.min(0.6, a)})`
          }
          ctx.fillRect(x - size / 2, y - size / 2, size, size)
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || now - last < 33) return
      last = now
      draw(now)
    }

    resize()
    const ro = new ResizeObserver(() => {
      resize()
      if (reduce) draw(0)
    })
    ro.observe(canvas)
    if (reduce) draw(0)
    else raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={ref} className="hero-backdrop" aria-hidden="true" />
}
