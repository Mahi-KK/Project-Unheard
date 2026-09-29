import { useId, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { metricFor, r1 } from '../../services/scoring'
import type { District } from '../../types/data'
import { normName } from './normalize'

type Hit = { kind: 'district'; d: District; score: number } | { kind: 'state'; state: string; count: number; bbox: [number, number, number, number]; score: number }

/** Deterministic, offline district/state finder. ARIA combobox, keyboard complete. */
export function DistrictSearch() {
  const districts = useStore((s) => s.districts)
  const select = useStore((s) => s.select)
  const flyToBbox = useStore((s) => s.flyToBbox)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const states = useMemo(() => {
    const m = new Map<string, District[]>()
    for (const d of districts) m.set(d.state, [...(m.get(d.state) ?? []), d])
    return m
  }, [districts])

  const results = useMemo<Hit[]>(() => {
    const t = normName(q)
    if (t.length < 2) return []
    const hits: Hit[] = []
    for (const d of districts) {
      const n = normName(d.name)
      const alias = normName(d.nfhs_name ?? '') // older / survey name, e.g. Bangalore -> Bengaluru
      const score = n === t || alias === t ? 4 : n.startsWith(t) || alias.startsWith(t) ? 3 : n.includes(t) || alias.includes(t) ? 2 : 0
      if (score) hits.push({ kind: 'district', d, score })
    }
    for (const [state, ds] of states) {
      const n = normName(state)
      if (n.startsWith(t) || (t.length >= 4 && n.includes(t))) {
        hits.push({
          kind: 'state',
          state,
          count: ds.length,
          score: n.startsWith(t) ? 2.5 : 1,
          bbox: [
            Math.min(...ds.map((d) => d.bbox[0])),
            Math.min(...ds.map((d) => d.bbox[1])),
            Math.max(...ds.map((d) => d.bbox[2])),
            Math.max(...ds.map((d) => d.bbox[3])),
          ],
        })
      }
    }
    return hits
      .sort((a, b) => b.score - a.score || label(a).localeCompare(label(b)))
      .slice(0, 8)
  }, [q, districts, states])

  const choose = (h: Hit | undefined) => {
    if (!h) return
    if (h.kind === 'district') select(h.d.id)
    else flyToBbox(h.bbox)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const showList = open && normName(q).length >= 2
  return (
    <div className="search">
      <label className="sr-only" htmlFor={listId + '-input'}>
        Find a district or state
      </label>
      <span className="search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={inputRef}
        id={listId + '-input'}
        className="field field--search"
        placeholder="Find a district or state"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(results.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[active] ?? results[0])
          } else if (e.key === 'Escape') {
            setQ('')
            setOpen(false)
          }
        }}
      />
      {showList && (
        <ul className="search__list" id={listId} role="listbox" aria-label="Matching districts and states">
          {results.length === 0 && (
            <li className="search__empty" role="option" aria-selected="false" aria-disabled="true">
              No district or state matches “{q}”.
            </li>
          )}
          {results.map((h, i) => {
            const u = h.kind === 'district' ? metricFor(h.d, 'unheard', 'all') : null
            return (
              <li
                key={h.kind === 'district' ? h.d.id : 'state:' + h.state}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="search__opt"
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(h)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="search__name">
                  <span>
                    <Highlight text={label(h)} q={q} />
                  </span>
                  <small>
                    {h.kind === 'district'
                      ? h.d.state + (h.d.nfhs_name && normName(h.d.nfhs_name) !== normName(h.d.name) ? ` · also “${h.d.nfhs_name}”` : '')
                      : `State · ${h.count} districts`}
                  </small>
                </span>
                {h.kind === 'district' &&
                  (h.d.data_status === 'scored' ? (
                    <span className="search__score" title="Unheard index">
                      U {r1(u)}
                    </span>
                  ) : (
                    <span className="search__score search__score--na">no data</span>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function label(h: Hit) {
  return h.kind === 'district' ? h.d.name : h.state
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase())
  if (i < 0 || !q.trim()) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.trim().length)}</mark>
      {text.slice(i + q.trim().length)}
    </>
  )
}
