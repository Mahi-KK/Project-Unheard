import { useEffect, useState } from 'react'
import { useStore } from '../../app/store'
import { AiBadge, Badge, ErrorState, Loading } from '../../components/States'
import { api, isTauri, type PolicyBriefOut } from '../../services/api'
import type { District } from '../../types/data'

function b64ToBlob(b64: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'application/pdf' })
}

async function savePdf(out: PolicyBriefOut): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await save({ defaultPath: out.filename, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!path) return null
    const bin = atob(out.pdf_base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    await invoke('write_pdf', { path, bytes: Array.from(bytes) })
    return path
  }
  const url = URL.createObjectURL(b64ToBlob(out.pdf_base64))
  const a = document.createElement('a')
  a.href = url
  a.download = out.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return out.filename
}

/** 07 — POLICY BRIEF: Gemini narrative (grounding-checked) + deterministic tables, ReportLab PDF. */
export function PolicyBrief({ d }: { d: District }) {
  const sim = useStore((s) => s.simulation)
  const demoBriefSeq = useStore((s) => (s.demo.active && s.demo.step === 6 ? s.demo.step : 0))
  const [out, setOut] = useState<PolicyBriefOut | null>(null)
  const [busy, setBusy] = useState<null | 'brief' | 'sheet'>(null)
  const [err, setErr] = useState<unknown>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => () => void (pdfUrl && URL.revokeObjectURL(pdfUrl)), [pdfUrl])

  const run = async (sheetOnly: boolean) => {
    setBusy(sheetOnly ? 'sheet' : 'brief')
    setErr(null)
    setSaved(null)
    try {
      const simulation =
        sim && sim.district_id === d.id
          ? { district_id: d.id, category: sim.category, facilities: sim.intervention.facilities, capacity_per_facility: sim.intervention.capacity_per_facility }
          : null
      const res = await api.policyBrief({ district_id: d.id, simulation, evidence_sheet_only: sheetOnly })
      setOut(res)
      setPdfUrl(URL.createObjectURL(b64ToBlob(res.pdf_base64)))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (demoBriefSeq) void run(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoBriefSeq])

  const b = out?.brief
  return (
    <section className="dsec" aria-labelledby="sec-brief" id="policy-brief">
      <h3 id="sec-brief" className="dsec__title">
        <span>08</span> Policy brief
      </h3>
      <p className="dsec__lede">
        Narrative by Gemini from this district's evidence{sim && sim.district_id === d.id ? ' and the current WHAT IF? scenario' : ''} only. Every figure is checked
        against the evidence; unverifiable sentences are removed.
      </p>
      <div className="row">
        <button type="button" className="btn btn--dark" disabled={!!busy} onClick={() => void run(false)}>
          Generate policy brief
        </button>
        <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => void run(true)}>
          Evidence sheet (no AI)
        </button>
      </div>
      {busy === 'brief' && <Loading label="Gemini is drafting; ReportLab is typesetting…" />}
      {busy === 'sheet' && <Loading label="Typesetting evidence sheet…" />}
      {err !== null && <ErrorState error={err} onRetry={() => run(false)} />}
      {out && (
        <div className="brief" aria-live="polite">
          <div className="brief__meta">
            {out.kind === 'policy_brief' ? <AiBadge model={out.model} cached={out.cached} /> : <Badge kind="local">Deterministic only</Badge>}
            {out.removed_statements.length > 0 && <span className="mono">{out.removed_statements.length} ungrounded statement(s) removed</span>}
          </div>
          {b && (
            <article className="brief__doc">
              <h4 className="brief__title">{b.title}</h4>
              <p className="brief__lead">{b.executive_summary}</p>
              <BriefPart t="Problem signal" v={b.problem_signal} />
              <BriefPart t="Evidence" v={b.evidence} />
              <BriefPart t="Affected population" v={b.affected_population} />
              <BriefPart t="Current need" v={b.current_need} />
              <BriefPart t="Observed demand" v={b.observed_demand} />
              <BriefPart t="Why the area is unheard" v={b.why_unheard} />
              <BriefPart t="Potential intervention" v={b.potential_intervention} />
              <BriefPart t="Projected effect — projected / modelled" v={b.projected_effect} />
              <BriefPart t="Limitations" v={b.limitations} />
            </article>
          )}
          {/* WebView2's PDF plugin is unreliable inside the desktop shell: preview in-page only in a browser,
              in the desktop app export and open in the system PDF viewer. */}
          {pdfUrl && !isTauri() && <iframe className="brief__pdf" src={pdfUrl} title={`PDF preview: ${out.filename}`} />}
          {isTauri() && (
            <p className="fineprint">
              PDF ready ({Math.round((out.pdf_base64.length * 3) / 4 / 1024)} KB). Export it, then open it in your PDF viewer.
            </p>
          )}
          <button
            type="button"
            className="btn btn--dark btn--block"
            onClick={async () => {
              try {
                setSaved(await savePdf(out))
              } catch (e) {
                setErr(e)
              }
            }}
          >
            Export PDF
          </button>
          {saved && (
            <div className="row">
              <p className="fineprint">Saved: {saved}</p>
              {isTauri() && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={async () => {
                    try {
                      const { openPath } = await import('@tauri-apps/plugin-opener')
                      await openPath(saved)
                    } catch (e) {
                      setErr(e)
                    }
                  }}
                >
                  Open PDF
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function BriefPart({ t, v }: { t: string; v: string | string[] }) {
  if (!v || (Array.isArray(v) && !v.length)) return null
  return (
    <div className="brief__part">
      <p className="brief__h">{t}</p>
      {Array.isArray(v) ? (
        <ul>
          {v.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      ) : (
        <p>{v}</p>
      )}
    </div>
  )
}
