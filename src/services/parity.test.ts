/**
 * TS <-> Python parity: the desktop UI recomputes demand/unheard and runs the
 * simulator locally; these must equal the backend engine exactly.
 * Fixture: data/demo/parity_fixture.json (backend/tests/make_fixtures.py).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { simulate } from '../features/simulation/simulate'
import type { ByCategory, Category, Dataset } from '../types/data'
import { applyDemand } from './scoring'

const ds = JSON.parse(readFileSync('data/processed/districts.json', 'utf8')) as Dataset
const fx = JSON.parse(readFileSync('data/demo/parity_fixture.json', 'utf8')) as {
  extra: Record<string, Partial<ByCategory<number>>>
  demand: Record<string, { demand: number; unheard: number; demand_water: number; unheard_health: number | null }>
  simulations: {
    input: { district_id: string; category: Category; facilities: number; capacity: number | null }
    people_covered: number
    before: Record<string, number>
    after: Record<string, number>
  }[]
}

describe('parity with Python scoring engine', () => {
  const scored = ds.districts.filter((d) => d.data_status === 'scored')
  const out = applyDemand(scored, fx.extra)

  it('demand percentiles and unheard index match for every district', () => {
    expect(out.length).toBe(Object.keys(fx.demand).length)
    for (const d of out) {
      const e = fx.demand[d.id]
      expect(d.demand_score).toBeCloseTo(e.demand, 9)
      expect(d.unheard_index).toBeCloseTo(e.unheard, 9)
      expect(d.demand_by_category!.water).toBeCloseTo(e.demand_water, 9)
      if (e.unheard_health === null) expect(d.unheard_by_category!.health).toBeNull()
      else expect(d.unheard_by_category!.health).toBeCloseTo(e.unheard_health, 9)
    }
  })

  it('simulator matches', () => {
    const byId = Object.fromEntries(ds.districts.map((d) => [d.id, d]))
    for (const c of fx.simulations) {
      const r = simulate(byId[c.input.district_id], ds.meta, {
        category: c.input.category,
        facilities: c.input.facilities,
        capacityPerFacility: c.input.capacity,
      })
      expect(r.people_covered).toBeCloseTo(c.people_covered, 6)
      for (const side of ['before', 'after'] as const)
        for (const [k, v] of Object.entries(c[side])) expect((r[side] as unknown as Record<string, number>)[k]).toBeCloseTo(v, 9)
    }
  })
})
