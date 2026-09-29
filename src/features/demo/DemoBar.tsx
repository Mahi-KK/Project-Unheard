import { useEffect, useState } from 'react'
import { commitSignal } from '../../app/actions'
import { useStore } from '../../app/store'
import { explainError } from '../../components/States'
import { api } from '../../services/api'
import { metricFor } from '../../services/scoring'
import { CATEGORIES, type Category } from '../../types/data'
import { SAMPLES } from '../capture/CapturePanel'
import { simulate } from '../simulation/simulate'

const STEPS = ['Kannada request', 'Gemini reads it', 'Signal joins map', 'Reveal unheard', 'Dossier', 'What if?', 'Policy brief']

const DEMO_DISTRICT = 'karnataka--raichur'

/**
 * DEMO MODE — a scripted path through the real application components.
 * Gemini calls are live (or come from the local cache of an earlier live
 * call, labelled "cached"). Nothing is pre-written or faked.
 */
export function DemoBar() {
  const demo = useStore((s) => s.demo)
  const setDemo = useStore((s) => s.setDemo)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async (step: number) => {
    const st = useStore.getState()
    setBusy(true)
    setNote(null)
    try {
      switch (step) {
        case 0: {
          st.select(null, false)
          st.setMode('demand')
          st.flyHome()
          st.setLeftPanel('capture')
          st.setCapture({ text: SAMPLES[0].text, result: null })
          break
        }
        case 1: {
          st.setLeftPanel('capture')
          try {
            const out = await api.analyze({ text: useStore.getState().capture.text || SAMPLES[0].text, hint_language: null })
            st.setCapture({ result: out })
          } catch (e) {
            const { title, message } = explainError(e)
            setNote(`${title}: ${message} The demo continues with manual classification (labelled).`)
          }
          break
        }
        case 2: {
          const res = useStore.getState().capture.result
          const cat = (res && (CATEGORIES as readonly string[]).includes(res.analysis.category) ? res.analysis.category : 'water') as Category
          const target = res?.candidates[0]?.id ?? DEMO_DISTRICT
          await commitSignal({ districtId: target, category: cat, source: 'demo', transcript: useStore.getState().capture.text || SAMPLES[0].text, result: res })
          st.setMode('demand')
          break
        }
        case 3: {
          st.select(null, false)
          st.setLeftPanel('ledger')
          st.setCategory('all')
          st.reveal()
          break
        }
        case 4: {
          const top = [...useStore.getState().districts]
            .filter((d) => d.data_status === 'scored')
            .sort((a, b) => (b.unheard_index ?? 0) - (a.unheard_index ?? 0))[0]
          st.select(top.id)
          break
        }
        case 5: {
          const now = useStore.getState()
          const d = now.selectedId ? now.byId[now.selectedId] : null
          if (d && now.dataset) {
            const cat = CATEGORIES.filter((c) => d.category_need?.[c] !== null).sort((a, b) => (d.category_need?.[b] ?? 0) - (d.category_need?.[a] ?? 0))[0]
            now.setSimulation(simulate(d, now.dataset.meta, { category: cat, facilities: 40 }))
            setTimeout(() => document.getElementById('sec-whatif')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          }
          break
        }
        case 6: {
          setTimeout(() => document.getElementById('policy-brief')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
          break
        }
      }
      setDemo({ step })
    } catch (e) {
      const { title, message } = explainError(e)
      setNote(`${title}: ${message}`)
      setDemo({ step })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (demo.active) void go(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.active])

  useEffect(() => {
    if (!demo.active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return
      if (e.key === 'ArrowRight' && demo.step < STEPS.length - 1 && !busy) void go(demo.step + 1)
      if (e.key === 'ArrowLeft' && demo.step > 0 && !busy) void go(demo.step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!demo.active) return null
  const d = useStore.getState().byId[useStore.getState().selectedId ?? '']
  return (
    <div className="demobar" role="region" aria-label="Demo mode">
      <div className="demobar__label">
        <strong>Demo mode</strong>
        <span>Live components · synthetic baseline</span>
      </div>
      <ol className="demobar__steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={demo.step === i ? 'step' : undefined}>
            <button type="button" onClick={() => void go(i)} disabled={busy}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span> {s}
            </button>
          </li>
        ))}
      </ol>
      <div className="demobar__nav">
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy || demo.step === 0} onClick={() => void go(demo.step - 1)}>
          ← Prev
        </button>
        <button type="button" className="btn btn--dark btn--sm" disabled={busy || demo.step === STEPS.length - 1} onClick={() => void go(demo.step + 1)}>
          Next →
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={async () => {
            try {
              await api.clearSignals('demo')
              const { signals } = await api.signals()
              useStore.getState().setCaptured(signals)
            } catch {
              /* engine offline: nothing to clear */
            }
            setDemo({ active: false, step: 0 })
          }}
        >
          Exit & remove demo signals
        </button>
      </div>
      {note && (
        <p className="demobar__note" role="status">
          {note}
        </p>
      )}
      {demo.step === 4 && d && <p className="demobar__note">Top Unheard district: {d.name}, {d.state} — unheard {metricFor(d, 'unheard', 'all')?.toFixed(1)}</p>}
    </div>
  )
}
