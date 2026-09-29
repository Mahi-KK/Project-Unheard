import { memo, useMemo } from 'react'
import type { Position } from 'geojson'
import { useStore } from './store'

const W = 560
const LNG0 = 68
const LAT0 = 37.6
const COS = Math.cos((22.5 * Math.PI) / 180)
const K = W / ((97.5 - LNG0) * COS)

function project([lng, lat]: Position): [number, number] {
  return [(lng - LNG0) * COS * K, (LAT0 - lat) * K]
}

function ringPath(ring: Position[]): string {
  let d = ''
  let px = -1e9
  let py = -1e9
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = project(ring[i])
    if (i > 0 && i < ring.length - 1 && Math.abs(x - px) + Math.abs(y - py) < 0.9) continue
    d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
    px = x
    py = y
  }
  return d + 'Z'
}

/**
 * Intro hero: every district as a hairline; districts with a high Unheard
 * Index light up, strongest first. Same data as the app — nothing decorative.
 */
export const IntroMap = memo(function IntroMap() {
  const geo = useStore((s) => s.geo)
  const byId = useStore((s) => s.byId)

  const model = useMemo(() => {
    if (!geo) return null
    const ranked = Object.values(byId)
      .filter((d) => d.data_status === 'scored' && (d.unheard_index ?? 0) >= 30)
      .sort((a, b) => (b.unheard_index ?? 0) - (a.unheard_index ?? 0))
    const rank = new Map(ranked.map((d, i) => [d.id, i]))
    let maxY = 0
    const paths = geo.districts.features.map((f) => {
      const g = f.geometry
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      const d = polys.map((poly) => ringPath(poly[0])).join('')
      for (const poly of polys) for (const p of poly[0]) maxY = Math.max(maxY, project(p)[1])
      const r = rank.get(f.properties.id)
      const u = byId[f.properties.id]?.unheard_index ?? 0
      return { id: f.properties.id, d, r, hot: u >= 45 }
    })
    return { paths, h: Math.ceil(maxY) + 4, hotCount: ranked.filter((d) => (d.unheard_index ?? 0) >= 45).length }
  }, [geo, byId])

  if (!model) return <div className="intro-map intro-map--loading" aria-hidden="true" />
  return (
    <figure className="intro-map" aria-label={`Map of India: ${model.hotCount} districts where need is high and reported demand low are highlighted.`}>
      <svg viewBox={`0 0 ${W} ${model.h}`} role="img" aria-hidden="true">
        <g className="intro-map__base">
          {model.paths.map((p) => (
            <path key={p.id} d={p.d} />
          ))}
        </g>
        <g className="intro-map__hot">
          {model.paths
            .filter((p) => p.r !== undefined)
            .map((p) => (
              <path
                key={p.id}
                d={p.d}
                data-hot={p.hot}
                style={{ animationDelay: `${900 + Math.min(p.r!, 180) * 14}ms` }}
              />
            ))}
        </g>
      </svg>
      <figcaption>
        <span className="intro-map__key intro-map__key--hot" /> high need, little reporting
        <span className="intro-map__key intro-map__key--mid" /> elevated
      </figcaption>
    </figure>
  )
})
