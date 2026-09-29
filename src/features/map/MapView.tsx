import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// Bundle MapLibre's ES-module worker explicitly (offline-safe inside Tauri).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_LABEL, INDIA_BBOX, useStore } from '../../app/store'
import { metricFor, r1 } from '../../services/scoring'
import type { District, Mode } from '../../types/data'
import { startBackdrop } from './mapBackdrop'
import { hatchImage, NEED_STOPS, readPalette, UNHEARD_HIGH, UNHEARD_MID, type MapPalette } from './mapStyle'

maplibregl.setWorkerUrl(workerUrl)

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
type Pad = { top: number; bottom: number; left: number; right: number }

/**
 * Camera padding that keeps districts clear of the floating side panel.
 * Reads the panel's live width (it collapses and shrinks on narrow windows)
 * and never asks for more padding than the map can give.
 */
function padFor(map: MLMap, base = 40): Pad {
  const rail = document.getElementById('rail')
  const railOpen = rail && rail.getAttribute('data-open') !== 'false' && rail.offsetWidth > 0
  const mapRect = map.getContainer().getBoundingClientRect()
  let left = base
  if (railOpen && rail) left = Math.max(base, rail.getBoundingClientRect().right - mapRect.left + base * 0.6)
  const w = mapRect.width
  const h = mapRect.height
  // keep at least 45% of the width / 50% of the height for the geography
  left = Math.min(left, Math.max(base, w * 0.55))
  const right = Math.min(base, w * 0.1)
  const tb = Math.min(base, h * 0.12)
  return { top: tb, bottom: tb, left, right }
}

type Props = { id: string; name: string; state: string; s: number; n: number; d: number; u: number; top: number; cap: number }
type Setter = (layer: string, prop: string, value: unknown) => void

function stepExpr(prop: string, colors: string[], stops: number[]): maplibregl.ExpressionSpecification {
  const expr: unknown[] = ['step', ['get', prop], colors[0]]
  stops.slice(1).forEach((s, i) => expr.push(s, colors[i + 1]))
  return expr as maplibregl.ExpressionSpecification
}

/** Colour every layer for the current theme + category (no geometry change). */
function paint(map: MLMap, p: MapPalette) {
  const sp = map.setPaintProperty.bind(map) as unknown as Setter
  sp('bg', 'background-color', 'rgba(0,0,0,0)') // transparent: the living backdrop shows through the sea
  sp('base', 'fill-color', p.land)
  sp('need', 'fill-color', stepExpr('n', p.need, NEED_STOPS))
  sp('unheard-mid', 'fill-color', p.unheard[0])
  sp('unheard-high', 'fill-color', p.unheard[1])
  sp('district-lines', 'line-color', p.line)
  sp('state-lines', 'line-color', p.state)
  sp('outline', 'line-color', p.outline)
  sp('top10', 'line-color', p.theme === 'night' ? p.unheard[2] : p.ink)
  sp('demand-circles', 'circle-color', p.demand)
  sp('demand-circles', 'circle-stroke-color', p.bg)
  sp('captured', 'circle-stroke-color', p.theme === 'night' ? p.paper : p.ink)
  sp('highlight', 'line-color', p.theme === 'night' ? p.paper : p.ink)
  sp('hover', 'line-color', p.theme === 'night' ? p.paper : p.ink)
  sp('selected', 'line-color', p.theme === 'night' ? p.paper : p.ink)
  if (map.hasImage('hatch')) map.removeImage('hatch')
  map.addImage('hatch', hatchImage(p.hatch))
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const backdrop = useRef<HTMLCanvasElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const timersRef = useRef<number[]>([])
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; d: District } | null>(null)

  const geo = useStore((s) => s.geo)
  const districts = useStore((s) => s.districts)
  const byId = useStore((s) => s.byId)
  const category = useStore((s) => s.category)
  const mode = useStore((s) => s.mode)
  const revealed = useStore((s) => s.revealed)
  const revealSeq = useStore((s) => s.revealSeq)
  const selectedId = useStore((s) => s.selectedId)
  const highlightIds = useStore((s) => s.highlightIds)
  const camera = useStore((s) => s.camera)
  const select = useStore((s) => s.select)
  const theme = useStore((s) => s.mapTheme)
  const setTheme = useStore((s) => s.setMapTheme)

  const top10 = useMemo(() => {
    return districts
      .filter((d) => d.data_status === 'scored')
      .map((d) => ({ d, u: metricFor(d, 'unheard', category) ?? -1 }))
      .sort((a, b) => b.u - a.u || (a.d.id < b.d.id ? -1 : 1))
      .slice(0, 10)
      .map((x) => x.d)
  }, [districts, category])

  // --------------------------------------------------------------- data -> features
  const fc = useMemo(() => {
    if (!geo) return null
    const rank = new Map(top10.map((d, i) => [d.id, i + 1]))
    return {
      type: 'FeatureCollection' as const,
      features: geo.districts.features.map((f) => {
        const d = byId[f.properties.id]
        const scored = d?.data_status === 'scored'
        const props: Props = {
          id: f.properties.id,
          name: f.properties.name,
          state: f.properties.state,
          s: scored ? 1 : 0,
          n: scored ? (metricFor(d, 'need', category) ?? 0) : 0,
          d: scored ? (metricFor(d, 'demand', category) ?? 0) : 0,
          u: scored ? (metricFor(d, 'unheard', category) ?? 0) : 0,
          top: rank.get(f.properties.id) ?? 0,
          cap: d?.captured ? Object.values(d.captured).reduce((a, b) => a + (b ?? 0), 0) : 0,
        }
        return { type: 'Feature' as const, geometry: f.geometry, properties: props }
      }),
    }
  }, [geo, byId, category, top10])

  const centroids = useMemo(() => {
    if (!fc) return null
    return {
      type: 'FeatureCollection' as const,
      features: fc.features
        .filter((f) => f.properties.s === 1)
        .map((f) => {
          const d = byId[f.properties.id]
          return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] }, properties: f.properties }
        }),
    }
  }, [fc, byId])

  // --------------------------------------------------------------- init
  useEffect(() => {
    if (!container.current || !geo || mapRef.current) return
    const st = useStore.getState()
    const p = readPalette(st.mapTheme, st.category)
    let map: MLMap
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } }] },
        bounds: INDIA_BBOX,
        fitBoundsOptions: { padding: 20 },
        minZoom: 2.2,
        maxZoom: 10,
        // generous bounds: free panning in every direction, but India can't be lost off-screen
        maxBounds: [
          [25, -25],
          [140, 60],
        ],
        renderWorldCopies: false,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      })
    } catch (e) {
      // WebGL unavailable: the rest of the product (ranked list, dossier, simulator) still works.
      setFailed((e as Error).message || 'WebGL is not available on this device.')
      return
    }
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()
    map.dragPan.enable()
    map.scrollZoom.enable()
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: 'Boundaries © G. Narula / DataMeet (MIT) · NFHS-5 2019–21 · Census 2011 · MapLibre',
      }),
      'bottom-right',
    )
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __unheardMap: MLMap }).__unheardMap = map
    map.on('error', (e) => console.warn('[map]', e.error?.message ?? e))

    map.on('load', () => {
      map.addImage('hatch', hatchImage(p.hatch))
      map.addSource('districts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' })
      map.addSource('centroids', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('states', { type: 'geojson', data: { type: 'Feature', geometry: geo.stateLines, properties: {} } })
      map.addSource('outline', { type: 'geojson', data: { type: 'Feature', geometry: geo.outline, properties: {} } })

      map.addLayer({ id: 'base', type: 'fill', source: 'districts', paint: { 'fill-color': p.land } })
      map.addLayer({ id: 'insufficient', type: 'fill', source: 'districts', filter: ['==', ['get', 's'], 0], paint: { 'fill-pattern': 'hatch' } })
      map.addLayer({
        id: 'need',
        type: 'fill',
        source: 'districts',
        filter: ['==', ['get', 's'], 1],
        paint: { 'fill-color': stepExpr('n', p.need, NEED_STOPS), 'fill-opacity': 0 },
      })
      map.addLayer({
        id: 'unheard-mid',
        type: 'fill',
        source: 'districts',
        filter: ['all', ['==', ['get', 's'], 1], ['>=', ['get', 'u'], UNHEARD_MID], ['<', ['get', 'u'], UNHEARD_HIGH]],
        paint: { 'fill-color': p.unheard[0], 'fill-opacity': 0 },
      })
      map.addLayer({
        id: 'unheard-high',
        type: 'fill',
        source: 'districts',
        filter: ['all', ['==', ['get', 's'], 1], ['>=', ['get', 'u'], UNHEARD_HIGH]],
        paint: { 'fill-color': p.unheard[1], 'fill-opacity': 0 },
      })
      map.addLayer({ id: 'district-lines', type: 'line', source: 'districts', paint: { 'line-color': p.line, 'line-width': 0.5 } })
      map.addLayer({ id: 'state-lines', type: 'line', source: 'states', paint: { 'line-color': p.state, 'line-width': 0.8, 'line-opacity': 0.8 } })
      map.addLayer({ id: 'outline', type: 'line', source: 'outline', paint: { 'line-color': p.outline, 'line-width': 1.1 } })
      map.addLayer({
        id: 'top10',
        type: 'line',
        source: 'districts',
        filter: ['>', ['get', 'top'], 0],
        paint: { 'line-color': p.unheard[2], 'line-width': 1.8, 'line-opacity': 0 },
      })
      map.addLayer({
        id: 'demand-circles',
        type: 'circle',
        source: 'centroids',
        paint: {
          'circle-color': p.demand,
          'circle-opacity': 0.78,
          'circle-stroke-color': p.bg,
          'circle-stroke-width': 0.8,
          'circle-stroke-opacity': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['*', 0.05, ['get', 'd']], 7, ['*', 0.12, ['get', 'd']]],
        },
      })
      map.addLayer({
        id: 'captured',
        type: 'circle',
        source: 'centroids',
        filter: ['>', ['get', 'cap'], 0],
        paint: { 'circle-color': p.unheard[1], 'circle-radius': 6, 'circle-stroke-color': p.paper, 'circle-stroke-width': 2 },
      })
      map.addLayer({
        id: 'highlight',
        type: 'line',
        source: 'districts',
        filter: ['in', ['get', 'id'], ['literal', []]],
        paint: { 'line-color': p.paper, 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({
        id: 'hover',
        type: 'line',
        source: 'districts',
        paint: { 'line-color': p.paper, 'line-width': 1.4, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] },
      })
      map.addLayer({
        id: 'selected',
        type: 'line',
        source: 'districts',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'line-color': p.paper, 'line-width': 3 },
      })
      paint(map, p)
      map.fitBounds(INDIA_BBOX, { padding: padFor(map, 24), duration: 0 })

      let hovered: string | null = null
      map.on('mousemove', 'base', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const id = (f.properties as Props).id
        if (hovered !== id) {
          if (hovered) map.setFeatureState({ source: 'districts', id: hovered }, { hover: false })
          hovered = id
          map.setFeatureState({ source: 'districts', id }, { hover: true })
        }
        map.getCanvas().style.cursor = 'pointer'
        const d = useStore.getState().byId[id]
        if (d) setHover({ x: e.point.x, y: e.point.y, d })
      })
      map.on('mouseleave', 'base', () => {
        if (hovered) map.setFeatureState({ source: 'districts', id: hovered }, { hover: false })
        hovered = null
        map.getCanvas().style.cursor = ''
        setHover(null)
      })
      map.on('click', 'base', (e) => {
        const f = e.features?.[0]
        if (f) select((f.properties as Props).id, false)
      })
      setReady(true)
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container.current)
    return () => {
      ro.disconnect()
      timersRef.current.forEach(clearTimeout)
      clearMarkers(markersRef)
      map.remove()
      mapRef.current = null
    }
  }, [geo, select])

  // --------------------------------------------------------------- living backdrop (sea + graticule)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !backdrop.current) return
    return startBackdrop(backdrop.current, map, () => useStore.getState().mapTheme)
  }, [ready])

  // --------------------------------------------------------------- theme / category colours
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    paint(map, readPalette(theme, category))
  }, [ready, theme, category])

  // --------------------------------------------------------------- data updates
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !fc || !centroids) return
    ;(map.getSource('districts') as GeoJSONSource).setData(fc)
    ;(map.getSource('centroids') as GeoJSONSource).setData(centroids)
  }, [ready, fc, centroids])

  // --------------------------------------------------------------- mode (non-reveal)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (mode === 'unheard' && revealed) return // choreography owns the layers
    applyMode(map, mode, reducedMotion() ? 0 : 300)
    clearMarkers(markersRef)
  }, [ready, mode, revealed])

  // --------------------------------------------------------------- REVEAL UNHEARD choreography
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || revealSeq === 0) return
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    clearMarkers(markersRef)
    const rm = reducedMotion()
    const at = (ms: number, fn: () => void) => {
      if (rm) fn()
      else timersRef.current.push(window.setTimeout(fn, ms))
    }
    const t = (dur: number, delay = 0) => ({ duration: rm ? 0 : dur, delay: rm ? 0 : delay })
    const sp = map.setPaintProperty.bind(map) as unknown as Setter

    // 1. reported demand fades out: the map goes quiet
    sp('demand-circles', 'circle-opacity-transition', t(500))
    sp('demand-circles', 'circle-stroke-opacity-transition', t(500))
    sp('demand-circles', 'circle-opacity', 0)
    sp('demand-circles', 'circle-stroke-opacity', 0)
    sp('unheard-mid', 'fill-opacity', 0)
    sp('unheard-high', 'fill-opacity', 0)
    sp('top10', 'line-opacity', 0)

    // 2. underlying need surfaces
    sp('need', 'fill-opacity-transition', t(800, 350))
    sp('need', 'fill-opacity', 1)

    // 3. need recedes; where need is high and reporting low, the unheard emerge (highest first)
    at(1800, () => {
      sp('need', 'fill-opacity-transition', t(800))
      sp('need', 'fill-opacity', 0)
      sp('unheard-high', 'fill-opacity-transition', t(650, 100))
      sp('unheard-high', 'fill-opacity', 1)
      sp('unheard-mid', 'fill-opacity-transition', t(800, 650))
      sp('unheard-mid', 'fill-opacity', 1)
      sp('top10', 'line-opacity-transition', t(450, 1150))
      sp('top10', 'line-opacity', 1)
    })
    // 4. camera settles on the strongest signals; ranks appear
    at(2600, () => {
      const bb = bboxOf(top10)
      if (bb) map.fitBounds(bb, { padding: padFor(map, 90), duration: rm ? 0 : 1800, maxZoom: 5.4 })
      addRankMarkers(map, top10, markersRef, select, rm)
    })
    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, revealSeq])

  // re-rank markers when category changes while revealed
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !(mode === 'unheard' && revealed)) return
    applyMode(map, 'unheard', 0)
    addRankMarkers(map, top10, markersRef, select, true)
  }, [ready, top10, mode, revealed, select])

  // --------------------------------------------------------------- selection / highlight / camera
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('selected', ['==', ['get', 'id'], selectedId ?? ''])
  }, [ready, selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('highlight', ['in', ['get', 'id'], ['literal', highlightIds]])
    if (highlightIds.length) {
      const bb = bboxOf(highlightIds.map((id) => useStore.getState().byId[id]).filter(Boolean))
      if (bb) map.fitBounds(bb, { padding: padFor(map, 60), duration: reducedMotion() ? 0 : 1200, maxZoom: 6.5 })
    }
  }, [ready, highlightIds])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || camera.seq === 0 || !camera.bbox) return
    const home = camera.bbox === INDIA_BBOX
    map.fitBounds(camera.bbox, {
      padding: padFor(map, home ? 24 : 60),
      duration: reducedMotion() ? 0 : 1100,
      maxZoom: 5.9,
    })
  }, [ready, camera])

  const hoverValue = hover ? metricFor(hover.d, mode, category) : null
  return (
    <div className="map-wrap" data-theme={theme}>
      <canvas ref={backdrop} className="map-backdrop" aria-hidden="true" />
      <div
        ref={container}
        className="map"
        role="application"
        aria-label="Map of India by district. Use arrow keys to pan and plus or minus to zoom. Use the ranked list for keyboard access to districts."
      />
      {failed && (
        <div className="map-failed" role="alert">
          <p className="state__title">MAP UNAVAILABLE</p>
          <p>The map needs WebGL, which this device did not provide ({failed}). Rankings, dossiers and the simulator still work from the list.</p>
        </div>
      )}
      <div className="map-hud" aria-hidden={false}>
        <span className="map-hud__label">
          {mode === 'demand' ? 'Reported demand' : mode === 'need' ? 'Underlying need' : 'Unheard'} · {CATEGORY_LABEL[category]}
        </span>
        <div className="map-theme" role="radiogroup" aria-label="Map appearance">
          {(['night', 'day'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} onClick={() => setTheme(t)}>
              {t === 'night' ? 'Night' : 'Day'}
            </button>
          ))}
        </div>
      </div>
      {hover && (
        <div className="map-tip" style={{ transform: `translate(${hover.x + 16}px, ${hover.y + 16}px)` }} aria-hidden="true">
          <div className="map-tip__name">{hover.d.name}</div>
          <div className="map-tip__state">{hover.d.state}</div>
          {hover.d.data_status === 'scored' ? (
            <>
              <div className="map-tip__row" data-active={mode === 'unheard'}>
                <span>Unheard</span>
                <strong>{r1(metricFor(hover.d, 'unheard', category))}</strong>
              </div>
              <div className="map-tip__row" data-active={mode === 'need'}>
                <span>Need</span>
                <strong>{r1(metricFor(hover.d, 'need', category))}</strong>
              </div>
              <div className="map-tip__row" data-active={mode === 'demand'}>
                <span>Demand</span>
                <strong>{r1(metricFor(hover.d, 'demand', category))}</strong>
              </div>
            </>
          ) : (
            <div className="map-tip__row">
              <span>Insufficient data</span>
            </div>
          )}
          <span className="sr-only">{r1(hoverValue)}</span>
        </div>
      )}
    </div>
  )
}

function applyMode(map: MLMap, mode: Mode, dur: number) {
  const t = { duration: dur, delay: 0 }
  const sp = map.setPaintProperty.bind(map) as unknown as Setter
  const set = (layer: string, prop: string, v: number) => {
    sp(layer, `${prop}-transition`, t)
    sp(layer, prop, v)
  }
  set('demand-circles', 'circle-opacity', mode === 'demand' ? 0.78 : 0)
  set('demand-circles', 'circle-stroke-opacity', mode === 'demand' ? 0.9 : 0)
  set('need', 'fill-opacity', mode === 'need' ? 1 : 0)
  set('unheard-mid', 'fill-opacity', mode === 'unheard' ? 1 : 0)
  set('unheard-high', 'fill-opacity', mode === 'unheard' ? 1 : 0)
  set('top10', 'line-opacity', mode === 'unheard' ? 1 : 0)
}

function bboxOf(ds: District[]): [number, number, number, number] | null {
  if (!ds.length) return null
  return [
    Math.min(...ds.map((d) => d.bbox[0])),
    Math.min(...ds.map((d) => d.bbox[1])),
    Math.max(...ds.map((d) => d.bbox[2])),
    Math.max(...ds.map((d) => d.bbox[3])),
  ]
}

function clearMarkers(ref: React.MutableRefObject<maplibregl.Marker[]>) {
  ref.current.forEach((m) => m.remove())
  ref.current = []
}

function addRankMarkers(
  map: MLMap,
  top: District[],
  ref: React.MutableRefObject<maplibregl.Marker[]>,
  select: (id: string) => void,
  instant: boolean,
) {
  clearMarkers(ref)
  top.forEach((d, i) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'rank-marker'
    el.style.animationDelay = instant ? '0ms' : `${i * 70}ms`
    el.textContent = String(i + 1).padStart(2, '0')
    el.setAttribute('aria-label', `Rank ${i + 1}: ${d.name}, ${d.state}. Open dossier.`)
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      select(d.id)
    })
    ref.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lng, d.lat]).addTo(map))
  })
}
