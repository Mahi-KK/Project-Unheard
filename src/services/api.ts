/**
 * Backend client. The Gemini API key never reaches this code: all AI calls
 * go through the local FastAPI sidecar (or a Cloud Run URL in production).
 */
import type { CapturedSignal, Category } from '../types/data'
import type { SimResult } from '../features/simulation/simulate'

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

interface BackendInfo {
  base_url: string
  token: string | null
}

let infoPromise: Promise<BackendInfo> | null = null

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function backendInfo(): Promise<BackendInfo> {
  if (!infoPromise) {
    infoPromise = (async () => {
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke<BackendInfo>('backend_info')
      }
      return { base_url: (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://127.0.0.1:8765', token: null }
    })()
  }
  return infoPromise
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { base_url, token } = await backendInfo()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['X-Unheard-Token'] = token
  let res: Response
  try {
    res = await fetch(base_url + path, { ...init, headers, signal: ctrl.signal })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new ApiError(
      aborted ? 'timeout' : 'backend_unreachable',
      aborted ? 'The analysis engine did not respond in time.' : 'The local analysis engine is not reachable.',
      0,
    )
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error_code?: string; message?: string; detail?: unknown }
    if (b.error_code) throw new ApiError(b.error_code, b.message ?? 'Request failed.', res.status)
    if (Array.isArray(b.detail)) throw new ApiError('invalid_input', 'The request was rejected by input validation.', res.status)
    throw new ApiError('http_' + res.status, `Request failed (${res.status}).`, res.status)
  }
  return body as T
}

// ---------------------------------------------------------------- types
export interface Health {
  status: 'ok'
  gemini_configured: boolean
  gemini_backend: string
  model: string
  embed_model: string
  dataset_version: string
  model_version: string
  districts: number
  scored: number
  captured_signals: number
}

export interface RequestAnalysis {
  language: string
  language_name: string
  transcript: string
  normalized_request: string
  summary: string
  category: Category | 'roads' | 'other'
  secondary_categories: string[]
  location_mention: string | null
  district: string | null
  state: string | null
  locality: string | null
  urgency: number
  urgency_reason: string
  entities: { type: string; text: string }[]
  confidence: number
}

export interface Candidate {
  id: string
  name: string
  state: string
  match_score: number
}

export interface AnalyzeOut {
  analysis: RequestAnalysis
  candidates: Candidate[]
  model: string
  cached: boolean
  input_mode: 'text' | 'voice'
}

export interface MapQuery {
  mode: 'unheard' | 'need' | 'demand'
  category: 'all' | Category | 'roads'
  need_min: number | null
  need_max: number | null
  demand_min: number | null
  demand_max: number | null
  unheard_min: number | null
  states: string[]
  sort_by: 'unheard' | 'need' | 'demand'
  sort_order: 'desc' | 'asc'
  limit: number
  intent_summary: string
}

export interface MapQueryRow {
  id: string
  name: string
  state: string
  need: number
  demand: number
  unheard: number
  lat: number
  lng: number
  bbox: [number, number, number, number]
}

export interface MapQueryOut {
  query: MapQuery
  parsed_by: 'gemini' | 'local'
  results: MapQueryRow[]
  total_matching: number
  model: string | null
  cached: boolean
  note: string | null
}

export interface Explanation {
  headline: string
  need_drivers: { indicator_key: string; statement: string }[]
  demand_observation: string
  evidence_refs: string[]
  intervention_rationales: { category: Category; rationale: string }[]
  caveats: string[]
}

export interface ExplainOut {
  district_id: string
  explanation: Explanation
  removed_statements: string[]
  model: string
  cached: boolean
}

export interface PolicyBriefText {
  title: string
  executive_summary: string
  problem_signal: string
  evidence: string[]
  affected_population: string
  current_need: string
  observed_demand: string
  why_unheard: string
  potential_intervention: string
  projected_effect: string
  limitations: string[]
}

export interface PolicyBriefOut {
  district_id: string
  brief: PolicyBriefText | null
  removed_statements: string[]
  model: string | null
  cached: boolean
  pdf_base64: string
  filename: string
  kind: 'policy_brief' | 'evidence_sheet'
}

export interface ClusterOut {
  clusters: { members: { id: string; text: string; category: string; synthetic: boolean }[] }[]
  method: string
}

// ---------------------------------------------------------------- calls
export const api = {
  health: () => request<Health>('/api/health', { timeoutMs: 4000 }),
  analyze: (body: { text?: string; audio_base64?: string; hint_language?: string | null }) =>
    request<AnalyzeOut>('/api/analyze-request', { method: 'POST', body: JSON.stringify(body), timeoutMs: 60_000 }),
  signals: () => request<{ signals: CapturedSignal[] }>('/api/signals'),
  addSignal: (body: {
    district_id: string
    category: Category
    source: CapturedSignal['source']
    language?: string | null
    transcript: string
    normalized_request?: string | null
    summary?: string | null
    urgency?: number | null
    analysis?: unknown
  }) =>
    request<{ signal: CapturedSignal; duplicate_check_note: string | null }>('/api/signals', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 30_000,
    }),
  deleteSignal: (id: string) => request<{ deleted: boolean }>(`/api/signals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearSignals: (source?: CapturedSignal['source']) =>
    request<{ deleted: number }>('/api/signals' + (source ? `?source=${source}` : ''), { method: 'DELETE' }),
  mapQuery: (query: string) =>
    request<MapQueryOut>('/api/map-query', { method: 'POST', body: JSON.stringify({ query }), timeoutMs: 45_000 }),
  explain: (districtId: string) =>
    request<ExplainOut>(`/api/explain/${encodeURIComponent(districtId)}`, { method: 'POST', timeoutMs: 60_000 }),
  cluster: (districtId: string) =>
    request<ClusterOut>('/api/cluster-signals', { method: 'POST', body: JSON.stringify({ district_id: districtId }), timeoutMs: 45_000 }),
  simulate: (body: { district_id: string; category: Category; facilities?: number; capacity_per_facility?: number }) =>
    request<SimResult>('/api/simulate', { method: 'POST', body: JSON.stringify(body) }),
  policyBrief: (body: {
    district_id: string
    simulation?: { district_id: string; category: Category; facilities: number; capacity_per_facility: number } | null
    evidence_sheet_only?: boolean
  }) => request<PolicyBriefOut>('/api/policy-brief', { method: 'POST', body: JSON.stringify(body), timeoutMs: 90_000 }),
}
