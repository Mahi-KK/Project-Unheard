import { useEffect, useMemo, useState } from 'react'
import { commitSignal } from '../../app/actions'
import { CATEGORY_LABEL, useStore } from '../../app/store'
import { AiBadge, Badge, ErrorState, Loading } from '../../components/States'
import { api } from '../../services/api'
import { r1 } from '../../services/scoring'
import { CATEGORIES, type Category } from '../../types/data'
import { normName } from '../search/normalize'
import { useRecorder } from './useRecorder'

export const SAMPLES = [
  {
    lang: 'kn',
    label: 'ಕನ್ನಡ · Kannada',
    text: 'ರಾಯಚೂರು ಜಿಲ್ಲೆಯ ನಮ್ಮ ಹಳ್ಳಿಯಲ್ಲಿ ಬೇಸಿಗೆಯಲ್ಲಿ ಕುಡಿಯುವ ನೀರಿನ ಸಮಸ್ಯೆ ತುಂಬಾ ಆಗುತ್ತದೆ. ಕೊಳವೆ ಬಾವಿ ಕೆಟ್ಟು ಹೋಗಿದೆ.',
  },
  {
    lang: 'hi',
    label: 'हिन्दी · Hindi',
    text: 'पश्चिमी सिंहभूम ज़िले के हमारे गाँव से प्राथमिक स्वास्थ्य केंद्र बहुत दूर है, गर्भवती महिलाओं को बहुत परेशानी होती है।',
  },
  {
    lang: 'en',
    label: 'English',
    text: 'In Nuh district, girls in our village stop going to school after class 8 because the nearest high school is far away.',
  },
]

const HINTS = [
  { v: '', l: 'Auto-detect' },
  { v: 'kn', l: 'Kannada' },
  { v: 'hi', l: 'Hindi' },
  { v: 'en', l: 'English' },
]

/** 03 — CAPTURE. Voice-first, with a full text alternative and a manual (no-AI) path. */
export function CapturePanel() {
  const capture = useStore((s) => s.capture)
  const setCapture = useStore((s) => s.setCapture)
  const setLeftPanel = useStore((s) => s.setLeftPanel)
  const health = useStore((s) => s.health)
  const districts = useStore((s) => s.districts)
  const byId = useStore((s) => s.byId)
  const lastDelta = useStore((s) => s.lastCaptureDelta)
  const rec = useRecorder()
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState<null | 'analyze' | 'commit'>(null)
  const [error, setError] = useState<unknown>(null)
  const [districtId, setDistrictId] = useState<string>('')
  const [category, setCat] = useState<Category | ''>('')
  const [manual, setManual] = useState(false)
  const [committed, setCommitted] = useState<string | null>(null)
  const [dupNote, setDupNote] = useState<string | null>(null)
  const [pick, setPick] = useState('')

  const result = capture.result
  useEffect(() => {
    if (!result) return
    setDistrictId(result.candidates[0]?.id ?? '')
    const c = result.analysis.category
    setCat((CATEGORIES as readonly string[]).includes(c) ? (c as Category) : '')
  }, [result])

  const analyze = async (payload: { text?: string; audio_base64?: string }) => {
    setBusy('analyze')
    setError(null)
    setCommitted(null)
    setCapture({ result: null })
    try {
      const out = await api.analyze({ ...payload, hint_language: hint || null })
      setCapture({ result: out, text: payload.text ?? out.analysis.transcript })
      setManual(false)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const holdStart = () => {
    if (busy) return
    void rec.start()
  }
  const holdEnd = async () => {
    if (rec.state !== 'recording' && rec.state !== 'starting') return
    const r = await rec.stop()
    if (r) await analyze({ audio_base64: r.base64 })
    else setError(new Error('Recording too short — hold the button while you speak.'))
  }

  const pickResults = useMemo(() => {
    const t = normName(pick)
    if (t.length < 2) return []
    return districts.filter((d) => d.data_status === 'scored' && normName(d.name).startsWith(t)).slice(0, 6)
  }, [pick, districts])

  const commit = async () => {
    if (!districtId || !category) return
    setBusy('commit')
    setError(null)
    try {
      const out = await commitSignal({
        districtId,
        category,
        source: manual ? 'manual' : result?.input_mode === 'voice' ? 'voice' : 'typed',
        transcript: result?.analysis.transcript ?? capture.text,
        result: manual ? null : result,
      })
      setCommitted(districtId)
      setDupNote(out.note)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const a = result?.analysis
  const geminiOk = health?.gemini_configured

  return (
    <section className="panel" aria-labelledby="cap-title">
      <div className="panel__head">
        <p className="kicker">Capture</p>
        <h2 id="cap-title" className="panel__title">
          A request, in any words.
        </h2>
        <p className="panel__body">
          Speak or type a development request. Gemini identifies language, need, place and urgency; you confirm before it joins the signal layer.
        </p>
      </div>

      <div className="voice">
        <button
          type="button"
          className="voice__btn"
          data-state={rec.state}
          aria-label="Hold to speak. Press and hold, or hold the Space key, then release to analyse."
          aria-pressed={rec.state === 'recording'}
          disabled={!!busy || rec.state === 'unsupported'}
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
            holdStart()
          }}
          onPointerUp={() => void holdEnd()}
          onPointerCancel={() => void holdEnd()}
          onKeyDown={(e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              holdStart()
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault()
              void holdEnd()
            }
          }}
        >
          <span className="voice__ring" style={{ transform: `scale(${1 + rec.level * 0.35})` }} aria-hidden="true" />
          <span className="voice__label">{rec.state === 'recording' ? `${rec.seconds.toFixed(1)}s` : 'Hold to speak'}</span>
        </button>
        <div className="voice__meta" aria-live="polite">
          {rec.state === 'recording' && <span>Listening… release to analyse (max {rec.maxSeconds}s)</span>}
          {rec.state === 'starting' && <span>Opening microphone…</span>}
          {rec.state === 'denied' && <span>Microphone permission denied. Use the text box below.</span>}
          {rec.state === 'unsupported' && <span>Microphone capture is not supported here. Use the text box below.</span>}
          {rec.state === 'error' && <span>Microphone error: {rec.error}</span>}
          {rec.state === 'idle' && <span>16 kHz WAV → Gemini audio understanding</span>}
        </div>
      </div>

      <form
        className="typeform"
        onSubmit={(e) => {
          e.preventDefault()
          if (capture.text.trim()) void analyze({ text: capture.text.trim() })
        }}
      >
        <label htmlFor="cap-text" className="label">
          Or type a request
        </label>
        <textarea
          id="cap-text"
          className="field field--area"
          rows={3}
          maxLength={2000}
          value={capture.text}
          onChange={(e) => setCapture({ text: e.target.value })}
          placeholder="ನಮ್ಮ ಊರಲ್ಲಿ… / हमारे गाँव में… / In our village…"
        />
        <div className="samples" aria-label="Sample requests">
          {SAMPLES.map((s) => (
            <button key={s.lang} type="button" className="example" lang={s.lang} onClick={() => setCapture({ text: s.text, result: null })}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="row">
          <label className="label label--inline" htmlFor="cap-hint">
            Language hint
          </label>
          <select id="cap-hint" className="field field--select" value={hint} onChange={(e) => setHint(e.target.value)}>
            {HINTS.map((h) => (
              <option key={h.v} value={h.v}>
                {h.l}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn--dark" disabled={!!busy || !capture.text.trim()}>
            Analyse with Gemini
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!!busy || !capture.text.trim()}
            onClick={() => {
              setCapture({ result: null })
              setError(null)
              setManual(true)
            }}
          >
            Classify manually
          </button>
        </div>
        <p className="fineprint">Tested in this prototype: Kannada, Hindi, English. Other Indian languages are model-supported but untested here.</p>
      </form>

      {busy === 'analyze' && <Loading label="Gemini is reading the request…" />}
      {error !== null && (
        <>
          <ErrorState error={error} />

        </>
      )}

      {a && !manual && (
        <div className="analysis" aria-live="polite">
          <div className="analysis__meta">
            <AiBadge model={result!.model} cached={result!.cached} />
            <span className="mono">{result!.input_mode === 'voice' ? 'voice' : 'text'} · confidence {Math.round(a.confidence * 100)}%</span>
          </div>
          <dl className="kv">
            <dt>Detected language</dt>
            <dd>
              {a.language_name} <span className="mono">({a.language})</span>
            </dd>
            <dt>Transcript</dt>
            <dd lang={a.language}>{a.transcript}</dd>
            <dt>Normalised request</dt>
            <dd>{a.normalized_request}</dd>
            <dt>Summary</dt>
            <dd>{a.summary}</dd>
            <dt>Category</dt>
            <dd>
              {CATEGORY_LABEL[a.category] ?? a.category}
              {a.category === 'roads' && <Badge kind="unavailable">Roads not scored — choose a scored category or discard</Badge>}
            </dd>
            <dt>Location</dt>
            <dd>{[a.locality, a.district, a.state].filter(Boolean).join(', ') || a.location_mention || 'Not mentioned'}</dd>
            <dt>Urgency</dt>
            <dd>
              <span className="meter" aria-hidden="true">
                <span style={{ width: `${a.urgency * 100}%` }} />
              </span>
              <span className="mono">{a.urgency.toFixed(2)}</span> — {a.urgency_reason}
            </dd>
          </dl>
        </div>
      )}

      {(a || manual) && (
        <div className="confirm">
          <p className="label">{manual ? 'Manual classification — no AI involved' : 'Confirm before adding to the signal layer'}</p>
          <label className="label label--inline" htmlFor="cap-cat">
            Category
          </label>
          <select id="cap-cat" className="field field--select" value={category} onChange={(e) => setCat(e.target.value as Category)}>
            <option value="">Choose…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <fieldset className="cands">
            <legend className="label">District</legend>
            {!manual &&
              result?.candidates.map((c) => (
                <label key={c.id} className="cand">
                  <input type="radio" name="cand" checked={districtId === c.id} onChange={() => setDistrictId(c.id)} />
                  {c.name}, {c.state} <span className="mono">match {Math.round(c.match_score * 100)}%</span>
                </label>
              ))}
            {!manual && result && result.candidates.length === 0 && <p className="fineprint">No district could be matched from the request. Pick one:</p>}
            <input className="field" placeholder="Search district…" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Search a district to attach" />
            {pickResults.map((d) => (
              <label key={d.id} className="cand">
                <input type="radio" name="cand" checked={districtId === d.id} onChange={() => setDistrictId(d.id)} />
                {d.name}, {d.state}
              </label>
            ))}
          </fieldset>
          <button type="button" className="btn btn--dark btn--block" disabled={!districtId || !category || busy === 'commit'} onClick={() => void commit()}>
            {busy === 'commit' ? 'Adding…' : 'Add to signal layer'}
          </button>
        </div>
      )}

      {committed && lastDelta && lastDelta.districtId === committed && (
        <div className="delta" role="status">
          <Badge kind="captured">Captured in this session</Badge>
          <p>
            {byId[committed]?.name}: {category ? CATEGORY_LABEL[category].toLowerCase() : ''} demand percentile {r1(lastDelta.before)} → <strong>{r1(lastDelta.after)}</strong>. Unheard index recomputed
            deterministically.
          </p>
          {dupNote && <p className="fineprint">{dupNote}</p>}
        </div>
      )}

      {!geminiOk && health && <p className="note">Gemini is not configured on this machine: analysis will report UNAVAILABLE. Manual classification still works.</p>}
      <button type="button" className="btn btn--ghost btn--block" onClick={() => setLeftPanel('ledger')}>
        Close
      </button>
    </section>
  )
}
