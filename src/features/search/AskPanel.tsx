import { useEffect, useRef, useState } from 'react'
import { CATEGORY_LABEL, useStore } from '../../app/store'
import { AiBadge, Badge, ErrorState, Loading } from '../../components/States'
import { api } from '../../services/api'
import { r1 } from '../../services/scoring'

const EXAMPLES = [
  'Where is water need highest but citizen demand lowest?',
  'Show districts with high education need.',
  'Which regions have high infrastructure need and low reporting?',
  'Sanitation need in Odisha and Jharkhand with little reporting',
]

/** ASK THE MAP — Gemini turns language into a filter; filtering stays deterministic. */
export function AskPanel() {
  const ask = useStore((s) => s.ask)
  const setAsk = useStore((s) => s.setAsk)
  const setMode = useStore((s) => s.setMode)
  const setCategory = useStore((s) => s.setCategory)
  const select = useStore((s) => s.select)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const run = async (query: string) => {
    if (query.trim().length < 3) return
    setBusy(true)
    setError(null)
    try {
      const out = await api.mapQuery(query.trim())
      setMode(out.query.mode)
      setCategory(out.query.category === 'roads' ? 'all' : out.query.category)
      setAsk(out)
    } catch (e) {
      setError(e)
      setAsk(null)
    } finally {
      setBusy(false)
    }
  }

  const f = ask?.query
  const chips: string[] = f
    ? [
        `mode: ${f.mode}`,
        `category: ${CATEGORY_LABEL[f.category] ?? f.category}`,
        ...(f.need_min !== null ? [`need ≥ ${f.need_min}`] : []),
        ...(f.need_max !== null ? [`need ≤ ${f.need_max}`] : []),
        ...(f.demand_min !== null ? [`demand ≥ ${f.demand_min}`] : []),
        ...(f.demand_max !== null ? [`demand ≤ ${f.demand_max}`] : []),
        ...(f.unheard_min !== null ? [`unheard ≥ ${f.unheard_min}`] : []),
        ...(f.states.length ? [`states: ${f.states.join(', ')}`] : []),
        `sort: ${f.sort_by} ${f.sort_order}`,
        `limit: ${f.limit}`,
      ]
    : []

  return (
    <section className="panel" aria-labelledby="ask-title">
      <div className="panel__head">
        <p className="kicker">Ask the map</p>
        <h2 id="ask-title" className="panel__title">
          Question in, filter out.
        </h2>
        <p className="panel__body">Gemini translates your question into an explicit filter. The filtering and ranking are computed deterministically — every condition is shown below.</p>
      </div>
      <form
        className="askform"
        onSubmit={(e) => {
          e.preventDefault()
          void run(q)
        }}
      >
        <label htmlFor="ask-input" className="sr-only">
          Question about the map
        </label>
        <input
          id="ask-input"
          ref={inputRef}
          className="field"
          value={q}
          maxLength={400}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Where is water need highest but demand lowest?"
        />
        <button type="submit" className="btn btn--dark" disabled={busy || q.trim().length < 3}>
          Ask
        </button>
      </form>
      <div className="examples" aria-label="Example questions">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example"
            onClick={() => {
              setQ(ex)
              void run(ex)
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {busy && <Loading label="Interpreting question with Gemini…" />}
      {error !== null && <ErrorState error={error} onRetry={() => run(q)} />}

      {ask && !busy && (
        <div className="askresult" aria-live="polite">
          <div className="askresult__meta">
            {ask.parsed_by === 'gemini' ? <AiBadge model={ask.model} cached={ask.cached} /> : <Badge kind="local">Parsed locally</Badge>}
            <span className="mono">{ask.total_matching} matching</span>
          </div>
          <p className="askresult__intent">{ask.query.intent_summary}</p>
          {ask.note && <p className="note">{ask.note}</p>}
          <ul className="filterchips" aria-label="Applied filter">
            {chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <ol className="ranklist ranklist--compact">
            {ask.results.map((r, i) => (
              <li key={r.id}>
                <button type="button" className="rankrow" onClick={() => select(r.id)} aria-label={`${r.name}, ${r.state}. Open dossier.`}>
                  <span className="rankrow__n">{String(i + 1).padStart(2, '0')}</span>
                  <span className="rankrow__name">
                    {r.name}
                    <small>{r.state}</small>
                  </span>
                  <span className="rankrow__triple mono">
                    N {r1(r.need)} · D {r1(r.demand)} · U {r1(r.unheard)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {ask.results.length === 0 && <p className="state state--empty">No district satisfies every condition. Loosen a threshold and ask again.</p>}
        </div>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => {
          setAsk(null)
          setLeftPanel('ledger')
        }}
      >
        Close
      </button>
    </section>
  )
}
