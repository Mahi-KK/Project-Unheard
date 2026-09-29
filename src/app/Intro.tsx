import { useEffect, useRef } from 'react'
import { useStore } from './store'

/** 01 — INTRO. One idea, one action. */
export function Intro() {
  const enter = useStore((s) => s.enter)
  const meta = useStore((s) => s.dataset?.meta)
  const loadError = useStore((s) => s.loadError)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => btn.current?.focus(), [meta])

  return (
    <main className="intro">
      <div className="intro__grid">
        <p className="intro__kicker">Build with AI: Code for Communities · civic intelligence prototype</p>
        <h1 className="intro__title">Unheard</h1>
        <p className="intro__tag">Finding the needs no one reported.</p>
        <div className="intro__split">
          <p>
            <span>Citizen demand</span> tells us what people report.
          </p>
          <p>
            <span>Public data</span> tells us what underlying conditions indicate.
          </p>
          <p>
            <span>Unheard</span> finds the gap between the two.
          </p>
        </div>
        <button ref={btn} type="button" className="btn btn--primary btn--xl" onClick={enter} disabled={!meta}>
          {meta ? 'Enter India' : loadError ? 'Data failed to load' : 'Loading districts…'}
          <span aria-hidden="true">→</span>
        </button>
        {loadError && (
          <p className="intro__error" role="alert">
            {loadError}
          </p>
        )}
        <p className="intro__facts">
          {meta
            ? `${meta.district_count} district boundaries · ${meta.scored_count} scored · 14 public indicators · NFHS-5 2019–21 · Census 2011 · demand baseline: SYNTHETIC`
            : ' '}
        </p>
      </div>
    </main>
  )
}
