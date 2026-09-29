import { memo, useMemo } from 'react'
import { useStore } from './store'

/** Continuous ticker of the highest Unheard districts (real scores, not decoration). */
export const HeroTicker = memo(function HeroTicker() {
  const byId = useStore((s) => s.byId)
  const items = useMemo(
    () =>
      Object.values(byId)
        .filter((d) => d.data_status === 'scored' && d.unheard_index !== null)
        .sort((a, b) => (b.unheard_index ?? 0) - (a.unheard_index ?? 0))
        .slice(0, 24),
    [byId],
  )
  if (!items.length) return null
  const row = items.map((d, i) => (
    <span key={d.id} className="ticker__item">
      <span className="ticker__rank">{String(i + 1).padStart(2, '0')}</span>
      {d.name}, {d.state}
      <span className="ticker__val">
        need {d.need_score?.toFixed(1)} · demand {d.demand_score?.toFixed(1)} · unheard <b>{d.unheard_index?.toFixed(1)}</b>
      </span>
    </span>
  ))
  return (
    <div className="ticker" aria-label="Highest Unheard Index districts">
      <div className="ticker__track">
        <div className="ticker__row">{row}</div>
        <div className="ticker__row" aria-hidden="true">
          {row}
        </div>
      </div>
    </div>
  )
})
