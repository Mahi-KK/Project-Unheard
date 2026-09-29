import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_LABEL, useStore } from '../../app/store'
import { Badge } from '../../components/States'
import { fmtInt, r1 } from '../../services/scoring'
import { CATEGORIES, type Category, type District } from '../../types/data'
import { simulate, SimulationUnavailable, type SimResult } from './simulate'

/** 06 — WHAT IF? Deterministic intervention simulator (PROJECTED / MODELLED). */
export function WhatIf({ d }: { d: District }) {
  const meta = useStore((s) => s.dataset!.meta)
  const stored = useStore((s) => s.simulation)
  const setSimulation = useStore((s) => s.setSimulation)

  const defaultCat = useMemo<Category>(() => {
    const ranked = CATEGORIES.filter((c) => d.category_need?.[c] !== null).sort((a, b) => (d.category_need?.[b] ?? 0) - (d.category_need?.[a] ?? 0))
    return ranked[0] ?? 'water'
  }, [d])

  const initial = stored && stored.district_id === d.id ? stored : null
  const [category, setCategory] = useState<Category>(initial?.category ?? defaultCat)
  const [facilities, setFacilities] = useState(initial?.intervention.facilities ?? 5)
  const [capacity, setCapacity] = useState(initial?.intervention.capacity_per_facility ?? meta.model.interventions[initial?.category ?? defaultCat].default_capacity)

  // keep in sync when demo mode pushes a preset
  useEffect(() => {
    if (stored && stored.district_id === d.id) {
      setCategory(stored.category)
      setFacilities(stored.intervention.facilities)
      setCapacity(stored.intervention.capacity_per_facility)
    }
  }, [stored, d.id])

  const spec = meta.model.interventions[category]
  const { result, error } = useMemo((): { result: SimResult | null; error: string | null } => {
    try {
      return { result: simulate(d, meta, { category, facilities, capacityPerFacility: capacity }), error: null }
    } catch (e) {
      if (e instanceof SimulationUnavailable) return { result: null, error: e.message }
      throw e
    }
  }, [d, meta, category, facilities, capacity])

  useEffect(() => {
    setSimulation(result)
  }, [result, setSimulation])

  return (
    <section className="dsec whatif" aria-labelledby="sec-whatif">
      <h3 id="sec-whatif" className="dsec__title">
        <span>07</span> What if?
      </h3>
      <p className="dsec__lede">
        <Badge kind="projected">Projected / modelled</Badge> Deterministic simulation. Not a forecast of real-world outcomes.
      </p>
      <div className="whatif__controls">
        <label className="label" htmlFor="wi-cat">
          Intervention
        </label>
        <select
          id="wi-cat"
          className="field field--select"
          value={category}
          onChange={(e) => {
            const c = e.target.value as Category
            setCategory(c)
            setCapacity(meta.model.interventions[c].default_capacity)
          }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]} — {meta.model.interventions[c].label}
            </option>
          ))}
        </select>
        <label className="label" htmlFor="wi-fac">
          {plural(spec.unit)} funded: <strong className="mono">+{facilities}</strong>
        </label>
        <input id="wi-fac" type="range" min={0} max={60} step={1} value={facilities} onChange={(e) => setFacilities(Number(e.target.value))} className="range" />
        <div className="row">
          <label className="label label--inline" htmlFor="wi-cap">
            Capacity (people each)
          </label>
          <input
            id="wi-cap"
            type="number"
            min={50}
            max={200000}
            step={50}
            className="field field--num"
            value={capacity}
            onChange={(e) => setCapacity(Math.max(50, Math.min(200000, Number(e.target.value) || 50)))}
          />
        </div>
        <p className="mono whatif__cost">
          Investment ≈ ₹{(facilities * spec.unit_cost_cr).toFixed(2)} cr at ₹{spec.unit_cost_cr} cr / {spec.unit} (illustrative assumption)
        </p>
      </div>

      {error && (
        <div className="state state--empty">
          <p className="state__title">SIMULATION UNAVAILABLE</p>
          <p className="state__msg">{error}</p>
        </div>
      )}
      {result && (
        <>
          <div className="flow" aria-label="Current, intervention, projected">
            <div className="flow__col">
              <span className="flow__k">Current</span>
              <span className="flow__v">{r1(result.before.unheard)}</span>
              <span className="flow__n">unheard index</span>
              <span className="flow__n mono">need {r1(result.before.need)}</span>
            </div>
            <div className="flow__col flow__col--mid">
              <span className="flow__k">Intervention</span>
              <span className="flow__v flow__v--small">
                +{result.intervention.facilities} {plural(result.intervention.unit)}
              </span>
              <span className="flow__n">{fmtInt(result.people_covered)} people covered</span>
              <span className="flow__n mono">+{r1(result.coverage_gain_pct_points)} pp coverage</span>
            </div>
            <div className="flow__col flow__col--out">
              <span className="flow__k">Projected</span>
              <span className="flow__v">{r1(result.after.unheard)}</span>
              <span className="flow__n">unheard index</span>
              <span className="flow__n mono">need {r1(result.after.need)}</span>
            </div>
          </div>
          <table className="table table--tight">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Current</th>
                <th scope="col">Projected</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{meta.model.indicators.find((i) => i.key === result.intervention.primary_indicator)?.label}</th>
                <td className="mono">{r1(result.before.primary_value)}%</td>
                <td className="mono strong">{r1(result.after.primary_value)}%</td>
              </tr>
              <tr>
                <th scope="row">People lacking the service</th>
                <td className="mono">{fmtInt(result.before.deficit_population)}</td>
                <td className="mono strong">{fmtInt(result.after.deficit_population)}</td>
              </tr>
              <tr>
                <th scope="row">{CATEGORY_LABEL[category]} need</th>
                <td className="mono">{r1(result.before.need_category)}</td>
                <td className="mono strong">{r1(result.after.need_category)}</td>
              </tr>
              <tr>
                <th scope="row">{CATEGORY_LABEL[category]} unheard</th>
                <td className="mono">{r1(result.before.unheard_category)}</td>
                <td className="mono strong">{r1(result.after.unheard_category)}</td>
              </tr>
            </tbody>
          </table>
          <details className="assumptions">
            <summary>Assumptions ({result.assumptions.length})</summary>
            <ul>
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}

function plural(unit: string): string {
  if (unit.endsWith('y')) return unit.slice(0, -1) + 'ies'
  return unit + 's'
}
