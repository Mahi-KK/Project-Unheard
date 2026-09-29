import { useMemo, useRef } from 'react'
import { CATEGORY_LABEL, useStore } from '../../app/store'
import { fmtInt, metricFor, r1 } from '../../services/scoring'
import { CATEGORIES, type CategoryOrAll, type Mode } from '../../types/data'
import { NEED_STEPS, readPalette, UNHEARD_STEPS } from '../map/mapStyle'

const COPY: Record<Mode, { kicker: string; title: string; body: string }> = {
  demand: {
    kicker: '01 — Reported',
    title: 'What people report.',
    body: 'Citizen-signal rate per 100,000 people, as a percentile across districts. The baseline here is a SYNTHETIC DEMONSTRATION SIGNAL; requests you capture are added on top.',
  },
  need: {
    kicker: '02 — Indicated',
    title: 'What the data indicates.',
    body: 'Weighted deficits across 14 public indicators (NFHS-5 2019–21, Census 2011), plus demographic vulnerability and population exposure. 0–100, relative to all scored districts.',
  },
  unheard: {
    kicker: '03 — Unheard',
    title: 'Where need outpaces reporting.',
    body: 'Unheard = Need × (1 − Demand ÷ 100). Multiple public indicators suggest elevated need while observed citizen-reported demand is comparatively low. It shows where to look — not proof of what is on the ground.',
  },
}

export function Ledger() {
  const districts = useStore((s) => s.districts)
  const mode = useStore((s) => s.mode)
  const category = useStore((s) => s.category)
  const revealed = useStore((s) => s.revealed)
  const setCategory = useStore((s) => s.setCategory)
  const select = useStore((s) => s.select)
  const selectedId = useStore((s) => s.selectedId)
  const reveal = useStore((s) => s.reveal)
  const setMode = useStore((s) => s.setMode)
  const flyHome = useStore((s) => s.flyHome)
  const meta = useStore((s) => s.dataset?.meta)
  const listRef = useRef<HTMLOListElement>(null)

  const ranked = useMemo(() => {
    return districts
      .filter((d) => d.data_status === 'scored')
      .map((d) => ({ d, v: metricFor(d, mode, category) }))
      .filter((x): x is { d: typeof x.d; v: number } => x.v !== null)
      .sort((a, b) => b.v - a.v || (a.d.id < b.d.id ? -1 : 1))
  }, [districts, mode, category])

  const top = ranked.slice(0, 25)
  const top10 = ranked.slice(0, 10)
  const pop10 = top10.reduce((s, x) => s + (x.d.population ?? 0), 0)
  const popMissing = top10.filter((x) => !x.d.population).length
  const demand10 = top10.map((x) => metricFor(x.d, 'demand', category) ?? 0).sort((a, b) => a - b)
  const medianDemand = demand10.length ? demand10[Math.floor(demand10.length / 2)] : null
  const copy = COPY[mode]

  const onKey = (e: React.KeyboardEvent<HTMLOListElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[Math.min(items.length - 1, i + 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[Math.max(0, i - 1)]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
    }
  }

  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <div className="ledger__head">
        <p className="kicker">{copy.kicker}</p>
        <h1 id="ledger-title" className="ledger__title" key={mode}>
          {copy.title}
        </h1>
        <p className="ledger__body">{copy.body}</p>
      </div>

      <div className="chips" role="radiogroup" aria-label="Category">
        {(['all', ...CATEGORIES] as CategoryOrAll[]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className="chip" data-cat={c} onClick={() => setCategory(c)}>
            <i className="chip__dot" aria-hidden="true" />
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          disabled
          aria-disabled="true"
          title={meta?.model.categories.roads.unavailable_reason}
          aria-label="Roads — unavailable. District-level road data is not integrated."
        >
          Roads · unavailable
        </button>
      </div>

      {mode === 'unheard' && (
        <dl className="figures" aria-live="polite">
          <div>
            <dt>Top-10 unheard</dt>
            <dd>{top10.length ? r1(top10[top10.length - 1].v) + '+' : '—'}</dd>
          </div>
          <div>
            <dt>People in them</dt>
            <dd>
              {pop10 ? (pop10 / 1e6).toFixed(1) + 'M' : '—'}
              <small>Census 2011{popMissing ? ` · ${popMissing} n/a` : ''}</small>
            </dd>
          </div>
          <div>
            <dt>Median demand pct.</dt>
            <dd>{r1(medianDemand)}</dd>
          </div>
        </dl>
      )}

      <div className="ledger__listhead">
        <span>
          Ranked by {mode} · {CATEGORY_LABEL[category].toLowerCase()}
        </span>
        <span>{ranked.length} districts</span>
      </div>
      <ol className="ranklist" ref={listRef} onKeyDown={onKey} aria-label={`Districts ranked by ${mode}`}>
        {top.map(({ d, v }, i) => (
          <li key={d.id}>
            <button
              type="button"
              className="rankrow"
              aria-current={selectedId === d.id ? 'true' : undefined}
              onClick={() => select(d.id)}
              aria-label={`${i + 1}. ${d.name}, ${d.state}. ${mode} ${r1(v)}. Open dossier.`}
            >
              <span className="rankrow__n">{String(i + 1).padStart(2, '0')}</span>
              <span className="rankrow__name">
                {d.name}
                <small>{d.state}</small>
              </span>
              <span className="rankrow__bar" aria-hidden="true">
                <span data-mode={mode} data-cat={category} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
              </span>
              <span className="rankrow__v">{r1(v)}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="ledger__foot">
        <Legend mode={mode} />
        {mode === 'unheard' && revealed ? (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => {
              setMode('demand')
              flyHome()
            }}
          >
            Back to reported demand
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--block btn--reveal" onClick={reveal}>
            Reveal unheard
            <span aria-hidden="true">→</span>
          </button>
        )}
        <p className="fineprint">
          {meta ? `${meta.scored_count} districts scored · ${meta.insufficient_count} insufficient data (hatched) · ` : ''}
          Population figures: Census 2011{meta ? ` (${fmtInt(meta.population_unavailable_count)} post-2011 boundaries unavailable)` : ''}.
        </p>
      </div>
    </section>
  )
}

function Legend({ mode }: { mode: Mode }) {
  const theme = useStore((s) => s.mapTheme)
  const category = useStore((s) => s.category)
  const p = readPalette(theme, category)
  if (mode === 'demand')
    return (
      <div className="legend" aria-label="Legend: circle size is the demand percentile">
        <span className="legend__label">Demand percentile · circle size</span>
        <span className="legend__dots" aria-hidden="true">
          {[5, 9, 14].map((s) => (
            <i key={s} style={{ width: s, height: s, background: p.demand }} />
          ))}
        </span>
        <span className="legend__range">0 → 100 · SYNTHETIC baseline</span>
      </div>
    )
  const steps = mode === 'need' ? NEED_STEPS : UNHEARD_STEPS
  const colors = mode === 'need' ? p.need : [p.land, p.unheard[0], p.unheard[1]]
  return (
    <div className="legend" aria-label={`Legend for ${mode}`}>
      <span className="legend__label">{mode === 'need' ? 'Need score' : 'Unheard index'}</span>
      <span className="legend__ramp" aria-hidden="true">
        {colors.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </span>
      <span className="legend__steps">
        {steps.map((s) => (
          <span key={s.label} className="legend__step">
            {s.label}
          </span>
        ))}
        <span className="legend__step">
          <i className="hatch" aria-hidden="true" />
          no data
        </span>
      </span>
    </div>
  )
}
