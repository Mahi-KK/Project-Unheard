/** Cross-feature actions (used by the UI and by Demo Mode — same code path). */
import { api, type AnalyzeOut } from '../services/api'
import { metricFor } from '../services/scoring'
import type { Category, CapturedSignal } from '../types/data'
import { useStore } from './store'

export async function refreshCaptured(): Promise<void> {
  const { signals } = await api.signals()
  useStore.getState().setCaptured(signals)
}

export async function commitSignal(args: {
  districtId: string
  category: Category
  source: CapturedSignal['source']
  transcript: string
  result?: AnalyzeOut | null
}): Promise<{ note: string | null }> {
  const st = useStore.getState()
  const before = st.byId[args.districtId] ? metricFor(st.byId[args.districtId], 'demand', args.category) : null
  const a = args.result?.analysis
  const out = await api.addSignal({
    district_id: args.districtId,
    category: args.category,
    source: args.source,
    language: a?.language ?? null,
    transcript: args.transcript,
    normalized_request: a?.normalized_request ?? null,
    summary: a?.summary ?? null,
    urgency: a?.urgency ?? null,
    analysis: a ?? null,
  })
  await refreshCaptured()
  const now = useStore.getState()
  const after = now.byId[args.districtId] ? metricFor(now.byId[args.districtId], 'demand', args.category) : null
  now.setLastCaptureDelta({ districtId: args.districtId, before, after })
  now.setCategory(args.category)
  now.select(args.districtId)
  return { note: out.duplicate_check_note }
}
