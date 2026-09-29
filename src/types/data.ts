export const CATEGORIES = ['water', 'sanitation', 'health', 'education', 'energy'] as const
export type Category = (typeof CATEGORIES)[number]
export type CategoryOrAll = Category | 'all'
export type Mode = 'demand' | 'need' | 'unheard'
export type ByCategory<T> = Record<Category, T>

export interface IndicatorDef {
  key: string
  category?: Category
  label: string
  unit: string
  direction: 'lower_worse' | 'higher_worse'
  weight: number
  source_id: string
  nfhs_no?: number
}

export interface InterventionDef {
  label: string
  primary_indicator: string
  default_capacity: number
  unit_cost_cr: number
  unit: string
}

export interface ModelSpec {
  version: string
  composite_weights: { category_need: number; vulnerability: number; exposure: number }
  category_weights: Record<string, number>
  categories: Record<string, { label: string; available: boolean; unavailable_reason?: string }>
  indicators: IndicatorDef[]
  vulnerability_indicators: IndicatorDef[]
  interventions: ByCategory<InterventionDef>
  intervention_cost_note: string
  synthetic_demand: { seed: number; base_reports_per_100k: ByCategory<number>; note: string }
}

export interface SourceMeta {
  id: string
  short: string
  dataset: string
  publisher: string
  year: string
  coverage: string
  license: string
  notes?: string
  extraction?: string
  official_url?: string
  retrieved_url?: string
}

export interface IndicatorStat {
  min: number
  max: number
  direction: 'lower_worse' | 'higher_worse'
}

export interface SyntheticSample {
  id: string
  category: Category
  language: string
  text: string
  synthetic: true
}

export interface District {
  id: string
  name: string
  state: string
  state_code: string | null
  lng: number
  lat: number
  bbox: [number, number, number, number]
  boundary_year: string
  nfhs_name: string | null
  census_name: string | null
  population: number | null
  population_status: 'census2011' | 'unavailable'
  population_for_rates: number
  population_imputed: boolean
  raw: Record<string, number | null>
  data_status: 'scored' | 'insufficient'
  signals: ByCategory<number>
  category_need: ByCategory<number | null> | null
  vulnerability: number | null
  exposure: number | null
  need_by_category: ByCategory<number | null> | null
  need_score: number | null
  signal_rate: ByCategory<number | null> | null
  demand_by_category: ByCategory<number | null> | null
  unheard_by_category: ByCategory<number | null> | null
  signal_rate_total: number | null
  demand_score: number | null
  unheard_index: number | null
  unheard_rank?: number
  confidence: number
  synthetic_samples: SyntheticSample[]
  sources: string[]
  /** captured-in-app signal counts layered on top of the synthetic baseline */
  captured?: Partial<ByCategory<number>>
}

export interface DatasetMeta {
  model_version: string
  dataset_version: string
  district_count: number
  scored_count: number
  insufficient_count: number
  population_unavailable_count: number
  stats: { indicator_stats: Record<string, IndicatorStat>; pop_log_min: number; pop_log_max: number }
  model: ModelSpec
  sources: Record<string, SourceMeta>
}

export interface Dataset {
  meta: DatasetMeta
  districts: District[]
}

export interface CapturedSignal {
  id: string
  created_at: number
  district_id: string
  category: Category
  source: 'typed' | 'voice' | 'manual' | 'demo'
  language: string | null
  transcript: string
  normalized_request: string | null
  summary: string | null
  urgency: number | null
  duplicate_of: string | null
  synthetic: false
}
