import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORY_LABEL, useStore } from '../../app/store'
import { AiBadge, Badge, ErrorState, Loading } from '../../components/States'
import { api, type ClusterOut, type ExplainOut } from '../../services/api'
import { deficit, fmtInt, r1 } from '../../services/scoring'
import { CATEGORIES, type District } from '../../types/data'
import { PolicyBrief } from '../policy/PolicyBrief'
import { WhatIf } from '../simulation/WhatIf'

/** 05 — DISTRICT DOSSIER: evidence first, explanation second, action last. */
export function Dossier() {
  const id = useStore((s) => s.selectedId)
  const d = useStore((s) => (id ? s.byId[id] : null))
  const meta = useStore((s) => s.dataset?.meta)
  const select = useStore((s) => s.select)
  const captured = useStore((s) => s.captured)
  const headRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headRef.current?.focus()
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea,select')) select(null, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [select])

  if (!d || !meta) return null
  const scored = d.data_status === 'scored'
  const mine = captured.filter((s) => s.district_id === d.id)

  return (
    <aside className="dossier" aria-labelledby="dossier-title" key={d.id}>
      <header className="dossier__head">
        <p className="kicker">
          District dossier{scored && d.unheard_rank ? ` · Unheard rank ${d.unheard_rank} of ${meta.scored_count}` : ''}
        </p>
        <h2 id="dossier-title" className="dossier__name" tabIndex={-1} ref={headRef}>
          {d.name}
        </h2>
        <p className="dossier__state">{d.state}</p>
        <button type="button" className="iconbtn dossier__close" onClick={() => select(null, false)} aria-label="Close dossier (Escape)">
          ×
        </button>
      </header>

      {!scored ? (
        <div className="dossier__body">
          <div className="state state--empty">
            <p className="state__title">INSUFFICIENT DATA</p>
            <p className="state__msg">
              No NFHS-5 district factsheet could be matched to this boundary (typically a district created after the 2019–21 survey, or a territory without
              survey coverage). UNHEARD does not estimate or impute a score here.
            </p>
          </div>
        </div>
      ) : (
        <div className="dossier__body">
          <Triad d={d} />
          <CategoryTable d={d} />
          <Evidence d={d} />
          <Exposure d={d} />
          <Signals d={d} mineCount={mine.length} />
          <WhyUnheard d={d} />
          <WhatIf d={d} />
          <PolicyBrief d={d} />
          <Sources d={d} />
        </div>
      )}
    </aside>
  )
}

function Triad({ d }: { d: District }) {
  return (
    <section className="triad" aria-label="Unheard index, need and demand">
      <div className="triad__main">
        <span className="triad__label">Unheard index</span>
        <span className="triad__value">{r1(d.unheard_index)}</span>
        <span className="triad__rule" style={{ width: `${d.unheard_index ?? 0}%` }} aria-hidden="true" />
      </div>
      <div className="triad__bars">
        <Bar label="Need" value={d.need_score} kind="need" note="public indicators" />
        <Bar label="Demand" value={d.demand_score} kind="demand" note="signal-rate percentile · SYNTHETIC baseline" />
      </div>
      <p className="formula mono" aria-label={`Unheard equals need ${r1(d.need_score)} times one minus demand ${r1(d.demand_score)} over 100, equals ${r1(d.unheard_index)}`}>
        {r1(d.need_score)} × (1 − {r1(d.demand_score)} ÷ 100) = {r1(d.unheard_index)}
      </p>
    </section>
  )
}

function Bar({ label, value, kind, note }: { label: string; value: number | null; kind: 'need' | 'demand'; note: string }) {
  return (
    <div className="hbar">
      <div className="hbar__top">
        <span className="hbar__label">{label}</span>
        <span className="hbar__value">{r1(value)}</span>
      </div>
      <span className="hbar__track" aria-hidden="true">
        <span data-kind={kind} style={{ width: `${value ?? 0}%` }} />
      </span>
      <span className="hbar__note">{note}</span>
    </div>
  )
}

function CategoryTable({ d }: { d: District }) {
  return (
    <section className="dsec" aria-labelledby="sec-cat">
      <h3 id="sec-cat" className="dsec__title">
        <span>01</span> By category
      </h3>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Need</th>
            <th scope="col">Demand</th>
            <th scope="col">Unheard</th>
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c}>
              <th scope="row">{CATEGORY_LABEL[c]}</th>
              <td className="mono">{r1(d.need_by_category?.[c])}</td>
              <td className="mono">{r1(d.demand_by_category?.[c])}</td>
              <td className="mono strong">{r1(d.unheard_by_category?.[c])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Roads</th>
            <td colSpan={3}>
              <Badge kind="unavailable">Unavailable — not integrated</Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function Evidence({ d }: { d: District }) {
  const meta = useStore((s) => s.dataset!.meta)
  const stats = meta.stats.indicator_stats
  const groups = [...CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABEL[c], defs: meta.model.indicators.filter((i) => i.category === c) })), { key: 'vulnerability', label: 'Vulnerability', defs: meta.model.vulnerability_indicators }]
  return (
    <section className="dsec" aria-labelledby="sec-ev">
      <h3 id="sec-ev" className="dsec__title">
        <span>02</span> Evidence
      </h3>
      <p className="dsec__lede">Raw public values. The bar is the district's deficit relative to the worst (100) and best (0) scored district.</p>
      {groups.map((g) => (
        <div className="evgroup" key={g.key}>
          <p className="evgroup__title">{g.label}</p>
          <ul className="evlist">
            {g.defs.map((def) => {
              const v = d.raw[def.key]
              const df = deficit(v, stats[def.key])
              const src = meta.sources[def.source_id]
              return (
                <li key={def.key} className="ev">
                  <span className="ev__label">{def.label}</span>
                  <span className="ev__value mono">{v === null || v === undefined ? 'n/a' : `${r1(v)}${def.unit}`}</span>
                  <span className="ev__bar" aria-label={`deficit ${r1(df)} of 100`}>
                    <span style={{ width: `${df ?? 0}%` }} />
                  </span>
                  <span className="ev__src">{src.short.includes(src.year) ? src.short : `${src.short} ${src.year}`}</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}

function Exposure({ d }: { d: District }) {
  return (
    <section className="dsec" aria-labelledby="sec-pop">
      <h3 id="sec-pop" className="dsec__title">
        <span>03</span> Population & confidence
      </h3>
      <dl className="kv kv--grid">
        <dt>Population</dt>
        <dd>{d.population ? `${fmtInt(d.population)} (Census 2011)` : 'UNAVAILABLE — boundary changed after Census 2011'}</dd>
        <dt>Vulnerability</dt>
        <dd className="mono">{r1(d.vulnerability)} / 100</dd>
        <dt>Exposure</dt>
        <dd className="mono">{d.exposure === null ? 'n/a' : `${r1(d.exposure)} / 100`}</dd>
        <dt>Data completeness</dt>
        <dd className="mono">{Math.round(d.confidence * 100)}% of inputs present</dd>
        {d.population_imputed && (
          <>
            <dt>Rate denominator</dt>
            <dd>State median population used for signal rates (imputed, flagged).</dd>
          </>
        )}
      </dl>
    </section>
  )
}

function Signals({ d, mineCount }: { d: District; mineCount: number }) {
  const allCaptured = useStore((s) => s.captured)
  const captured = useMemo(() => allCaptured.filter((c) => c.district_id === d.id), [allCaptured, d.id])
  const [clusters, setClusters] = useState<ClusterOut | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const total = CATEGORIES.reduce((s, c) => s + (d.signals[c] ?? 0), 0)
  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      setClusters(await api.cluster(d.id))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="dsec" aria-labelledby="sec-sig">
      <h3 id="sec-sig" className="dsec__title">
        <span>04</span> Citizen signals
      </h3>
      <p className="dsec__lede">
        {fmtInt(total - mineCount)} baseline signals <Badge kind="synthetic">Synthetic demonstration signal</Badge>
        {mineCount > 0 && (
          <>
            {' '}
            + {mineCount} <Badge kind="captured">Captured in this session</Badge>
          </>
        )}
        · {r1(d.signal_rate_total)} per 100,000 people.
      </p>
      <ul className="sigcounts">
        {CATEGORIES.map((c) => (
          <li key={c}>
            <span>{CATEGORY_LABEL[c]}</span>
            <span className="mono">{fmtInt(d.signals[c])}</span>
          </li>
        ))}
      </ul>
      <ul className="siglist">
        {captured.map((s) => (
          <li key={s.id} className="sig">
            <Badge kind="captured">Captured · {s.source}</Badge>
            <p lang={s.language ?? undefined}>{s.transcript}</p>
            {s.normalized_request && s.language !== 'en' && <p className="sig__norm">{s.normalized_request}</p>}
            {s.duplicate_of && <p className="fineprint">Possible duplicate of an earlier captured request (Gemini embedding similarity ≥ 0.92).</p>}
          </li>
        ))}
        {d.synthetic_samples.map((s) => (
          <li key={s.id} className="sig">
            <Badge kind="synthetic">Synthetic · {CATEGORY_LABEL[s.category]}</Badge>
            <p lang={s.language}>{s.text}</p>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void run()} disabled={busy}>
        Group related requests (Gemini embeddings)
      </button>
      {busy && <Loading label="Embedding and clustering…" />}
      {err !== null && <ErrorState error={err} compact onRetry={run} />}
      {clusters && (
        <div className="clusters">
          <p className="fineprint">{clusters.method}</p>
          {clusters.clusters.map((c, i) => (
            <p key={i} className="cluster">
              <span className="mono">Group {i + 1}</span> · {c.members.length} request{c.members.length > 1 ? 's' : ''}: {c.members.map((m) => m.category).join(', ')}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}

function WhyUnheard({ d }: { d: District }) {
  const meta = useStore((s) => s.dataset!.meta)
  const [out, setOut] = useState<ExplainOut | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const labelOf = (k: string) => [...meta.model.indicators, ...meta.model.vulnerability_indicators].find((i) => i.key === k)?.label ?? k

  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      setOut(await api.explain(d.id))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const cats = CATEGORIES.map((c) => ({ c, v: d.category_need?.[c] ?? null }))
    .filter((x) => x.v !== null)
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0))
    .slice(0, 3)

  return (
    <>
      <section className="dsec" aria-labelledby="sec-why">
        <h3 id="sec-why" className="dsec__title">
          <span>05</span> Why unheard?
        </h3>
        {!out && !busy && (
          <button type="button" className="btn btn--dark" onClick={() => void run()}>
            Explain with Gemini
          </button>
        )}
        {busy && <Loading label="Gemini is reading the evidence packet…" />}
        {err !== null && <ErrorState error={err} onRetry={run} />}
        {out && (
          <div className="why" aria-live="polite">
            <AiBadge model={out.model} cached={out.cached} />
            <p className="why__headline">{out.explanation.headline}</p>
            <ul className="why__drivers">
              {out.explanation.need_drivers.map((nd) => (
                <li key={nd.indicator_key}>
                  <span className="mono">{labelOf(nd.indicator_key)}</span>
                  <p>{nd.statement}</p>
                </li>
              ))}
            </ul>
            <p>{out.explanation.demand_observation}</p>
            {out.explanation.caveats.length > 0 && (
              <ul className="caveats">
                {out.explanation.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            {out.removed_statements.length > 0 && (
              <p className="note">
                Grounding check removed {out.removed_statements.length} generated statement(s) citing figures not present in the evidence.
              </p>
            )}
          </div>
        )}
      </section>
      <section className="dsec" aria-labelledby="sec-int">
        <h3 id="sec-int" className="dsec__title">
          <span>06</span> Possible interventions
        </h3>
        <p className="dsec__lede">Rule-based: the three categories with the highest indicator deficit. Rationale text appears after a Gemini explanation.</p>
        <ol className="interventions">
          {cats.map(({ c, v }) => (
            <li key={c}>
              <p className="interventions__label">{meta.model.interventions[c].label}</p>
              <p className="mono">
                {CATEGORY_LABEL[c]} deficit {r1(v)} / 100
              </p>
              {out?.explanation.intervention_rationales.find((r) => r.category === c) && <p>{out.explanation.intervention_rationales.find((r) => r.category === c)!.rationale}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}

function Sources({ d }: { d: District }) {
  const meta = useStore((s) => s.dataset!.meta)
  return (
    <section className="dsec" aria-labelledby="sec-src">
      <h3 id="sec-src" className="dsec__title">
        <span>09</span> Data sources
      </h3>
      <ul className="sources">
        {d.sources.map((sid) => {
          const s = meta.sources[sid]
          return (
            <li key={sid}>
              <p className="sources__name">{s.dataset}</p>
              <p>
                {s.publisher} · {s.year}
              </p>
              <p className="fineprint">
                {s.coverage}. Licence: {s.license}
              </p>
            </li>
          )
        })}
      </ul>
      <p className="fineprint">
        Model {meta.model_version} · dataset {meta.dataset_version} · boundary vintage {d.boundary_year}
        {d.nfhs_name && d.nfhs_name !== d.name ? ` · NFHS-5 name “${d.nfhs_name}”` : ''}
      </p>
    </section>
  )
}
