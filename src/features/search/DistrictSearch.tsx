import { useId, useMemo, useRef, useState } from 'react'
import { useStore } from '../../app/store'
import { normName } from './normalize'

/** Deterministic district finder (offline). Combobox pattern, keyboard complete. */
export function DistrictSearch() {
  const districts = useStore((s) => s.districts)
  const select = useStore((s) => s.select)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const t = normName(q)
    if (t.length < 2) return []
    return districts
      .map((d) => {
        const n = normName(d.name)
        const s = normName(d.state)
        const score = n === t ? 3 : n.startsWith(t) ? 2 : n.includes(t) ? 1 : s.startsWith(t) ? 0.5 : 0
        return { d, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.d.name.localeCompare(b.d.name))
      .slice(0, 8)
      .map((x) => x.d)
  }, [q, districts])

  const choose = (id: string) => {
    select(id)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="search">
      <label className="sr-only" htmlFor={listId + '-input'}>
        Find a district
      </label>
      <input
        ref={inputRef}
        id={listId + '-input'}
        className="field field--search"
        placeholder="Find a district"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(results.length - 1, a + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(0, a - 1))
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            choose(results[active].id)
          } else if (e.key === 'Escape') {
            setQ('')
            setOpen(false)
          }
        }}
      />
      {open && results.length > 0 && (
        <ul className="search__list" id={listId} role="listbox" aria-label="Matching districts">
          {results.map((d, i) => (
            <li
              key={d.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="search__opt"
              onMouseDown={(e) => {
                e.preventDefault()
                choose(d.id)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{d.name}</span>
              <small>{d.state}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
