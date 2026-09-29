import { create } from 'zustand'
import { applyDemand } from '../services/scoring'
import type { GeoBundle } from '../data/loadDataset'
import type { AnalyzeOut, Health, MapQueryOut } from '../services/api'
import type { SimResult } from '../features/simulation/simulate'
import { CATEGORIES, type ByCategory, type CapturedSignal, type CategoryOrAll, type Dataset, type District, type Mode } from '../types/data'

export type LeftPanel = 'ledger' | 'capture' | 'ask'
export type BackendStatus = 'starting' | 'online' | 'offline'

interface CameraRequest {
  seq: number
  bbox?: [number, number, number, number]
  center?: [number, number]
  zoom?: number
}

interface State {
  phase: 'intro' | 'app'
  loadError: string | null
  dataset: Dataset | null
  geo: GeoBundle | null
  districts: District[]
  byId: Record<string, District>
  captured: CapturedSignal[]

  mode: Mode
  category: CategoryOrAll
  revealed: boolean
  revealSeq: number

  selectedId: string | null
  leftPanel: LeftPanel
  ask: MapQueryOut | null
  highlightIds: string[]
  camera: CameraRequest
  lastCaptureDelta: { districtId: string; before: number | null; after: number | null } | null

  capture: { text: string; result: AnalyzeOut | null }
  simulation: SimResult | null

  health: Health | null
  backend: BackendStatus

  demo: { active: boolean; step: number }

  enter: () => void
  setData: (dataset: Dataset, geo: GeoBundle) => void
  setLoadError: (e: string) => void
  setCaptured: (signals: CapturedSignal[]) => void
  setMode: (m: Mode) => void
  setCategory: (c: CategoryOrAll) => void
  reveal: () => void
  select: (id: string | null, fly?: boolean) => void
  setLeftPanel: (p: LeftPanel) => void
  setAsk: (a: MapQueryOut | null) => void
  flyToBbox: (bbox: [number, number, number, number]) => void
  flyHome: () => void
  setCapture: (c: Partial<State['capture']>) => void
  setSimulation: (s: SimResult | null) => void
  setHealth: (h: Health | null, status: BackendStatus) => void
  setDemo: (d: Partial<State['demo']>) => void
  setLastCaptureDelta: (d: State['lastCaptureDelta']) => void
}

function recompute(dataset: Dataset, captured: CapturedSignal[]): District[] {
  const extra: Record<string, Partial<ByCategory<number>>> = {}
  for (const s of captured) {
    const e = (extra[s.district_id] ??= {})
    e[s.category] = (e[s.category] ?? 0) + 1
  }
  const scored = dataset.districts.filter((d) => d.data_status === 'scored')
  const updated = applyDemand(scored, extra)
  const map = new Map(updated.map((d) => [d.id, d]))
  return dataset.districts.map((d) => map.get(d.id) ?? d)
}

export const INDIA_BBOX: [number, number, number, number] = [68.1, 6.5, 97.4, 37.1]

export const useStore = create<State>((set, get) => ({
  phase: 'intro',
  loadError: null,
  dataset: null,
  geo: null,
  districts: [],
  byId: {},
  captured: [],

  mode: 'demand',
  category: 'all',
  revealed: false,
  revealSeq: 0,

  selectedId: null,
  leftPanel: 'ledger',
  ask: null,
  highlightIds: [],
  camera: { seq: 0 },
  lastCaptureDelta: null,

  capture: { text: '', result: null },
  simulation: null,

  health: null,
  backend: 'starting',

  demo: { active: false, step: 0 },

  enter: () => set({ phase: 'app' }),
  setData: (dataset, geo) => {
    const districts = recompute(dataset, get().captured)
    set({ dataset, geo, districts, byId: Object.fromEntries(districts.map((d) => [d.id, d])) })
  },
  setLoadError: (e) => set({ loadError: e }),
  setCaptured: (captured) => {
    const ds = get().dataset
    if (!ds) return set({ captured })
    const districts = recompute(ds, captured)
    set({ captured, districts, byId: Object.fromEntries(districts.map((d) => [d.id, d])) })
  },
  setMode: (mode) => set({ mode, revealed: mode === 'unheard' ? get().revealed : false }),
  setCategory: (category) => set({ category }),
  reveal: () => set((s) => ({ mode: 'unheard', revealed: true, revealSeq: s.revealSeq + 1, ask: null, highlightIds: [] })),
  select: (id, fly = true) => {
    set({ selectedId: id, simulation: null })
    const d = id ? get().byId[id] : null
    if (d && fly) set((s) => ({ camera: { seq: s.camera.seq + 1, bbox: d.bbox } }))
  },
  setLeftPanel: (leftPanel) => set({ leftPanel }),
  setAsk: (ask) => set({ ask, highlightIds: ask ? ask.results.map((r) => r.id) : [] }),
  flyToBbox: (bbox) => set((s) => ({ camera: { seq: s.camera.seq + 1, bbox } })),
  flyHome: () => set((s) => ({ camera: { seq: s.camera.seq + 1, bbox: INDIA_BBOX } })),
  setCapture: (c) => set((s) => ({ capture: { ...s.capture, ...c } })),
  setSimulation: (simulation) => set({ simulation }),
  setHealth: (health, backend) => set({ health, backend }),
  setDemo: (d) => set((s) => ({ demo: { ...s.demo, ...d } })),
  setLastCaptureDelta: (lastCaptureDelta) => set({ lastCaptureDelta }),
}))

export const CATEGORY_LABEL: Record<string, string> = {
  all: 'All categories',
  water: 'Water',
  sanitation: 'Sanitation',
  health: 'Health',
  education: 'Education',
  energy: 'Energy',
  roads: 'Roads',
}

export { CATEGORIES }
