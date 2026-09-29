/**
 * TypeScript mirror of backend/app/services/simulation_service.py.
 * Deterministic; every output is PROJECTED / MODELLED.
 */
import { categoryNeeds, composeNeed, overallCategoryNeed, unheard } from '../../services/scoring'
import type { Category, DatasetMeta, District } from '../../types/data'

export interface SimInput {
  category: Category
  facilities?: number | null
  capacityPerFacility?: number | null
  investmentCr?: number | null
}

export interface SimSide {
  primary_value: number
  category_deficit: number | null
  need_category: number | null
  need: number | null
  unheard_category: number | null
  unheard: number | null
  deficit_population: number
}

export interface SimResult {
  label: 'PROJECTED / MODELLED'
  district_id: string
  category: Category
  intervention: {
    label: string
    unit: string
    facilities: number
    capacity_per_facility: number
    investment_cr: number
    unit_cost_cr: number
    primary_indicator: string
  }
  people_covered: number
  coverage_gain_pct_points: number
  before: SimSide
  after: SimSide
  assumptions: string[]
}

export class SimulationUnavailable extends Error {}

export function simulate(d: District, meta: DatasetMeta, input: SimInput): SimResult {
  const model = meta.model
  if (d.data_status !== 'scored') throw new SimulationUnavailable('No indicator data for this district.')
  const pop = d.population
  if (!pop)
    throw new SimulationUnavailable(
      'Census 2011 population is unavailable for this district boundary, so people covered cannot be modelled.',
    )
  const spec = model.interventions[input.category]
  const key = spec.primary_indicator
  const primary = d.raw[key]
  if (primary === null || primary === undefined) throw new SimulationUnavailable(`Primary indicator '${key}' is missing for this district.`)

  const capacity = Math.trunc(input.capacityPerFacility || spec.default_capacity)
  let facilities = input.facilities ?? null
  if (facilities === null) facilities = Math.floor((input.investmentCr ?? 0) / spec.unit_cost_cr + 1e-9)
  const investment = facilities * spec.unit_cost_cr

  const stats = meta.stats.indicator_stats
  const deficitPop = pop * (1 - primary / 100)
  const covered = Math.min(deficitPop, facilities * capacity)
  const newPrimary = Math.min(100, primary + (covered / pop) * 100)
  const rawAfter = { ...d.raw, [key]: newPrimary }

  const cnBefore = categoryNeeds(d.raw, model, stats)
  const cnAfter = categoryNeeds(rawAfter, model, stats)
  const needCatAfter = composeNeed(cnAfter[input.category], d.vulnerability, d.exposure, model)
  const needAfter = composeNeed(overallCategoryNeed(cnAfter, model), d.vulnerability, d.exposure, model)

  const demandCat = d.demand_by_category?.[input.category] ?? null
  return {
    label: 'PROJECTED / MODELLED',
    district_id: d.id,
    category: input.category,
    intervention: {
      label: spec.label,
      unit: spec.unit,
      facilities,
      capacity_per_facility: capacity,
      investment_cr: Math.round(investment * 100) / 100,
      unit_cost_cr: spec.unit_cost_cr,
      primary_indicator: key,
    },
    people_covered: covered,
    coverage_gain_pct_points: newPrimary - primary,
    before: {
      primary_value: primary,
      category_deficit: cnBefore[input.category],
      need_category: d.need_by_category?.[input.category] ?? null,
      need: d.need_score,
      unheard_category: d.unheard_by_category?.[input.category] ?? null,
      unheard: d.unheard_index,
      deficit_population: deficitPop,
    },
    after: {
      primary_value: newPrimary,
      category_deficit: cnAfter[input.category],
      need_category: needCatAfter,
      need: needAfter,
      unheard_category: unheard(needCatAfter, demandCat),
      unheard: unheard(needAfter, d.demand_score),
      deficit_population: deficitPop - covered,
    },
    assumptions: [
      model.intervention_cost_note,
      `Each ${spec.unit} serves ${capacity.toLocaleString('en-US')} people who currently lack the service; coverage is capped at the current deficit population.`,
      'Population is Census 2011; growth since 2011 is not modelled.',
      'Citizen-reported demand is held constant; only need changes.',
      'Scores are relative to the 2019-21 range across all scored districts.',
      'Implementation lag, quality and uptake are not modelled.',
    ],
  }
}
