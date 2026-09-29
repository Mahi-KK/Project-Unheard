import { lazy, Suspense, useEffect } from 'react'
import { loadDataset } from '../data/loadDataset'
import { CapturePanel } from '../features/capture/CapturePanel'
import { DemoBar } from '../features/demo/DemoBar'
import { Dossier } from '../features/dossier/Dossier'
import { Ledger } from '../features/ledger/Ledger'
import { AskPanel } from '../features/search/AskPanel'
import { api } from '../services/api'
import { refreshCaptured } from './actions'
import { Intro } from './Intro'
import { useStore } from './store'
import { TopBar } from './TopBar'

const MapView = lazy(() => import('../features/map/MapView').then((m) => ({ default: m.MapView })))

export function App() {
  const phase = useStore((s) => s.phase)
  const leftPanel = useStore((s) => s.leftPanel)
  const selectedId = useStore((s) => s.selectedId)
  const backend = useStore((s) => s.backend)
  const railOpen = useStore((s) => s.railOpen)
  const setRailOpen = useStore((s) => s.setRailOpen)

  // offline dataset: the core product never needs the network
  useEffect(() => {
    loadDataset()
      .then(({ dataset, geo }) => useStore.getState().setData(dataset, geo))
      .catch((e) => useStore.getState().setLoadError(`Could not load bundled district data: ${e.message}`))
  }, [])

  // analysis engine health (sidecar may take a few seconds to start)
  useEffect(() => {
    let alive = true
    let timer: number
    let attempts = 0
    const tick = async () => {
      try {
        const h = await api.health()
        if (!alive) return
        const was = useStore.getState().backend
        useStore.getState().setHealth(h, 'online')
        if (was !== 'online') {
          // demo signals are scripted; never let an interrupted demo leave one behind
          void api
            .clearSignals('demo')
            .catch(() => undefined)
            .then(() => refreshCaptured())
            .catch(() => undefined)
        }
        timer = window.setTimeout(tick, 30_000)
      } catch {
        if (!alive) return
        attempts++
        useStore.getState().setHealth(null, attempts < 10 ? 'starting' : 'offline')
        timer = window.setTimeout(tick, attempts < 10 ? 1500 : 10_000)
      }
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  if (phase === 'intro') return <Intro />

  return (
    <div className="app" data-dossier={selectedId ? 'open' : 'closed'}>
      <a href="#rail" className="skip">
        Skip to district list
      </a>
      <TopBar />
      <DemoBar />
      <main className="stage">
        <div className="rail" id="rail" data-open={railOpen} inert={!railOpen}>
          <button type="button" className="rail__collapse" onClick={() => setRailOpen(false)} aria-label="Hide side panel" title="Hide panel">
            ‹
          </button>
          {leftPanel === 'ledger' && <Ledger />}
          {leftPanel === 'capture' && <CapturePanel />}
          {leftPanel === 'ask' && <AskPanel />}
        </div>
        {!railOpen && (
          <button type="button" className="rail__expand" onClick={() => setRailOpen(true)} aria-label="Show side panel">
            <span aria-hidden="true">›</span> Panel
          </button>
        )}
        <Suspense fallback={<div className="map-wrap map-wrap--loading">Loading map…</div>}>
          <MapView />
        </Suspense>
        {selectedId && <Dossier />}
      </main>
      {backend === 'offline' && (
        <p className="offline" role="status">
          Analysis engine offline — map, scores, dossier and simulation work from bundled data. AI features, capture and PDF export are unavailable.
        </p>
      )}
    </div>
  )
}
