import { useEffect } from 'react'
import { DistrictSearch } from '../features/search/DistrictSearch'
import type { Mode } from '../types/data'
import { useStore } from './store'

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'demand', label: 'Demand', hint: 'What citizens report' },
  { id: 'need', label: 'Need', hint: 'What public data indicates' },
  { id: 'unheard', label: 'Unheard', hint: 'High need, low reporting' },
]

export function TopBar() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const leftPanel = useStore((s) => s.leftPanel)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const demo = useStore((s) => s.demo)
  const setDemo = useStore((s) => s.setDemo)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setLeftPanel('ask')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setLeftPanel])

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark">Unheard</span>
        <span className="brand__sub">India · district intelligence</span>
      </div>

      <div className="modes" role="radiogroup" aria-label="Map mode">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className="modes__btn"
            title={m.hint}
            onClick={() => setMode(m.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const next = MODES[(i + (e.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length]
                setMode(next.id)
                ;(e.currentTarget.parentElement?.children[MODES.indexOf(next)] as HTMLButtonElement)?.focus()
              }
            }}
            tabIndex={mode === m.id ? 0 : -1}
          >
            <span className="modes__n">{String(i + 1).padStart(2, '0')}</span>
            {m.label}
          </button>
        ))}
      </div>

      <div className="topbar__tools">
        <DistrictSearch />
        <button type="button" className="btn btn--ghost btn--sm" aria-pressed={leftPanel === 'ask'} onClick={() => setLeftPanel(leftPanel === 'ask' ? 'ledger' : 'ask')}>
          Ask the map <kbd>Ctrl K</kbd>
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-pressed={leftPanel === 'capture'}
          onClick={() => setLeftPanel(leftPanel === 'capture' ? 'ledger' : 'capture')}
        >
          Capture request
        </button>
        <button type="button" className="btn btn--ghost btn--sm" aria-pressed={demo.active} onClick={() => setDemo({ active: !demo.active, step: 0 })}>
          {demo.active ? 'Exit demo' : 'Demo mode'}
        </button>
        <StatusPill />
      </div>
    </header>
  )
}

function StatusPill() {
  const backend = useStore((s) => s.backend)
  const health = useStore((s) => s.health)
  let label = 'Engine starting…'
  let state = 'starting'
  if (backend === 'offline') {
    label = 'Engine offline · core map works offline'
    state = 'offline'
  } else if (backend === 'online' && health) {
    state = health.gemini_configured ? 'ready' : 'nokey'
    label = health.gemini_configured ? `Gemini ready · ${health.model}` : 'Gemini not configured'
  }
  return (
    <span className="status" data-state={state} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {label}
    </span>
  )
}
