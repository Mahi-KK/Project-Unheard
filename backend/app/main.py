"""UNHEARD FastAPI backend.

Deterministic core (districts, scores, simulation, evidence PDFs) works
without Gemini. Gemini-backed endpoints return a typed error payload
({error_code, message}) when Gemini is unavailable — never a fake answer.
"""
from __future__ import annotations

import base64
import logging
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .schemas.api import (AnalyzeRequestIn, AnalyzeRequestOut, ClusterIn, ExplainOut, MapQueryIn, MapQueryOut, PolicyBriefIn,
                          PolicyBriefOut, SignalIn, SimulateIn)
from .schemas.gemini import MapQuery
from .services import policy_service
from .services.cache_service import Store
from .services.district_service import DistrictService
from .services.gemini_service import GeminiError, GeminiService, cluster, cosine
from .services.simulation_service import SimulationUnavailable, simulate
from .utils.grounding import clean_text, collect_numbers, ground_list, ground_text

log = logging.getLogger("unheard")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_settings()
store = Store(settings.db_path)
districts = DistrictService(settings.data_path, store)
gemini = GeminiService(settings, store)

app = FastAPI(title="UNHEARD API", version="3.1.0", description="Finding the needs no one reported.")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["Content-Type", "X-Unheard-Token"])


@app.middleware("http")
async def token_guard(request: Request, call_next):
    """When launched as the desktop sidecar, a per-launch random token is
    required so other local web pages cannot drive the API."""
    if settings.api_token and request.method != "OPTIONS" and request.url.path.startswith("/api/") and request.url.path != "/api/health":
        if request.headers.get("X-Unheard-Token") != settings.api_token:
            return JSONResponse({"error_code": "unauthorised", "message": "Missing or invalid local API token."}, status_code=401)
    return await call_next(request)


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException):
    body = exc.detail if isinstance(exc.detail, dict) else {"error_code": "http_error", "message": str(exc.detail)}
    return JSONResponse(body, status_code=exc.status_code)


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, exc: Exception):
    # Never crash the engine or leak a stack trace to the UI; log it and answer truthfully.
    log.exception("unhandled error: %s", exc)
    return JSONResponse({"error_code": "internal_error", "message": f"Unexpected engine error ({type(exc).__name__}). The request was not completed."},
                        status_code=500)


@app.exception_handler(GeminiError)
async def gemini_error_handler(_: Request, exc: GeminiError):
    return JSONResponse({"error_code": exc.code, "message": exc.message}, status_code=exc.status)


def _district_or_404(district_id: str) -> dict[str, Any]:
    d = districts.get(district_id)
    if not d:
        raise HTTPException(404, detail={"error_code": "district_not_found", "message": f"Unknown district id '{district_id}'."})
    return d


def _evidence_or_422(district_id: str) -> dict[str, Any]:
    _district_or_404(district_id)
    ev = districts.evidence(district_id)
    if ev is None:
        raise HTTPException(422, detail={"error_code": "insufficient_data", "message": "This district has insufficient indicator data to score."})
    return ev


# ------------------------------------------------------------------ core (no AI)
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "gemini_configured": gemini.configured,
        "gemini_backend": settings.gemini_backend,
        "model": settings.gemini_model,
        "embed_model": settings.gemini_embed_model,
        "dataset_version": districts.meta["dataset_version"],
        "model_version": districts.meta["model_version"],
        "districts": districts.meta["district_count"],
        "scored": districts.meta["scored_count"],
        "captured_signals": len(store.list_signals()),
    }


@app.get("/api/districts")
def list_districts():
    return {"meta": {k: districts.meta[k] for k in ("dataset_version", "model_version", "district_count", "scored_count", "insufficient_count")},
            "districts": districts.metrics()}


@app.get("/api/district/{district_id}")
def get_district(district_id: str):
    d = _district_or_404(district_id)
    return {"district": d, "evidence": districts.evidence(district_id), "interventions": districts.interventions(district_id),
            "captured": store.list_signals(district_id)}


@app.get("/api/unheard")
def unheard(category: str = Query("all", pattern="^(all|water|sanitation|health|education|energy)$"),
            state: str | None = Query(None, max_length=60), limit: int = Query(20, ge=1, le=100)):
    q = MapQuery(mode="unheard", category=category, states=[state] if state else [], sort_by="unheard", sort_order="desc", limit=limit,
                 intent_summary="Highest Unheard Index")
    rows, total = districts.filter(q)
    return {"results": rows, "total": total}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1, max_length=80)):
    return {"results": districts.search(q)}


@app.post("/api/simulate")
def simulate_ep(body: SimulateIn):
    d = _district_or_404(body.district_id)
    try:
        return simulate(d, districts.meta, body.category, body.facilities, body.capacity_per_facility, body.investment_cr)
    except SimulationUnavailable as e:
        raise HTTPException(422, detail={"error_code": "simulation_unavailable", "message": str(e)}) from e


# ------------------------------------------------------------------ signals
@app.get("/api/signals")
def list_signals(district_id: str | None = Query(None, max_length=120)):
    return {"signals": store.list_signals(district_id)}


@app.post("/api/signals")
async def add_signal(body: SignalIn):
    d = _district_or_404(body.district_id)
    if d["data_status"] != "scored":
        raise HTTPException(422, detail={"error_code": "insufficient_data", "message": "Cannot attach a signal to a district without indicator data."})
    payload = body.model_dump()
    payload["transcript"] = clean_text(payload["transcript"])
    dup_note = None
    existing = [s for s in store.list_signals(body.district_id) if s["category"] == body.category]
    if existing and gemini.configured:
        try:
            texts = [(body.normalized_request or body.transcript)] + [(s["normalized_request"] or s["transcript"]) for s in existing]
            vecs = await gemini.embed(texts)
            best = max(((cosine(vecs[0], v), s["id"]) for v, s in zip(vecs[1:], existing)), default=(0, None))
            if best[0] >= 0.92:
                payload["duplicate_of"] = best[1]
        except GeminiError as e:
            dup_note = f"Duplicate check unavailable: {e.message}"
    sig = store.add_signal(payload)
    districts.refresh()
    return {"signal": sig, "district": districts.metrics_for(body.district_id), "duplicate_check_note": dup_note}


@app.delete("/api/signals/{signal_id}")
def delete_signal(signal_id: str):
    ok = store.delete_signal(signal_id)
    districts.refresh()
    return {"deleted": ok}


@app.delete("/api/signals")
def clear_signals(source: str | None = Query(None, pattern="^(typed|voice|manual|demo)$")):
    n = store.clear_signals(source)
    districts.refresh()
    return {"deleted": n}


# ------------------------------------------------------------------ Gemini-backed
@app.post("/api/analyze-request", response_model=AnalyzeRequestOut)
async def analyze_request(body: AnalyzeRequestIn):
    if body.audio_base64:
        try:
            base64.b64decode(body.audio_base64, validate=True)
        except Exception as e:
            raise HTTPException(422, detail={"error_code": "bad_audio", "message": "audio_base64 is not valid base64."}) from e
    analysis, cached, used = await gemini.analyze_request(body.text.strip() if body.text else None, body.audio_base64, body.hint_language)
    for f in ("transcript", "normalized_request", "summary", "urgency_reason"):
        setattr(analysis, f, clean_text(getattr(analysis, f)))
    candidates = districts.resolve(analysis.district, analysis.state, analysis.location_mention)
    return AnalyzeRequestOut(analysis=analysis, candidates=candidates, model=used, cached=cached,
                             input_mode="voice" if body.audio_base64 else "text")


@app.post("/api/map-query", response_model=MapQueryOut)
async def map_query(body: MapQueryIn, allow_local: bool = Query(True)):
    states = sorted({d["state"] for d in districts.all()})
    note = None
    try:
        q, cached, used = await gemini.map_query(body.query, states)
        parsed_by, model = "gemini", used
    except GeminiError as e:
        if not allow_local:
            raise
        q, cached, parsed_by, model = districts.local_parse(body.query), False, "local", None
        note = f"PARSED LOCALLY — Gemini unavailable ({e.message})"
    q.intent_summary = clean_text(q.intent_summary)
    if q.category == "roads":
        note = ((note + " · ") if note else "") + "Road connectivity data is UNAVAILABLE in this prototype; showing the overall index instead."
    rows, total = districts.filter(q)
    return MapQueryOut(query=q, parsed_by=parsed_by, results=rows, total_matching=total, model=model, cached=cached, note=note)


@app.post("/api/explain/{district_id}", response_model=ExplainOut)
async def explain(district_id: str):
    ev = _evidence_or_422(district_id)
    ivs = districts.interventions(district_id)
    exp, cached, used = await gemini.explain(ev, ivs)
    allowed = collect_numbers(ev) | collect_numbers(ivs)
    removed: list[str] = []
    valid_keys = {i["key"] for i in ev["indicators"]}
    exp.headline = ground_text(exp.headline, allowed, removed) or f"{ev['district']}: elevated need signal"
    drivers = []
    for nd in exp.need_drivers:
        if nd.indicator_key not in valid_keys:
            removed.append(f"{nd.statement} [unknown indicator '{nd.indicator_key}']")
            continue
        nd.statement = ground_text(nd.statement, allowed, removed)
        if nd.statement:
            drivers.append(nd)
    exp.need_drivers = drivers
    exp.demand_observation = ground_text(exp.demand_observation, allowed, removed)
    exp.evidence_refs = [k for k in exp.evidence_refs if k in valid_keys]
    iv_cats = {i["category"] for i in ivs}
    rats = []
    for r in exp.intervention_rationales:
        if r.category in iv_cats:
            r.rationale = ground_text(r.rationale, allowed, removed)
            if r.rationale:
                rats.append(r)
    exp.intervention_rationales = rats
    exp.caveats = ground_list(exp.caveats, allowed, removed)
    return ExplainOut(district_id=district_id, explanation=exp, removed_statements=removed, model=used, cached=cached)


@app.post("/api/cluster-signals")
async def cluster_signals(body: ClusterIn):
    d = _district_or_404(body.district_id)
    items = [{"id": s["id"], "text": s["normalized_request"] or s["transcript"], "category": s["category"], "synthetic": False}
             for s in store.list_signals(body.district_id)]
    items += [{"id": s["id"], "text": s["text"], "category": s["category"], "synthetic": True} for s in d.get("synthetic_samples") or []]
    if len(items) < 2:
        return {"clusters": [{"members": items}] if items else [], "method": "fewer than 2 signals; nothing to cluster"}
    vecs = await gemini.embed([i["text"] for i in items])
    groups = cluster(vecs)
    return {"clusters": [{"members": [items[i] for i in g]} for g in groups],
            "method": f"{settings.gemini_embed_model} embeddings + deterministic greedy cosine clustering (threshold 0.84)"}


@app.post("/api/policy-brief", response_model=PolicyBriefOut)
async def policy_brief(body: PolicyBriefIn):
    d = _district_or_404(body.district_id)
    ev = _evidence_or_422(body.district_id)
    ivs = districts.interventions(body.district_id)
    sim = None
    if body.simulation:
        if body.simulation.district_id != body.district_id:
            raise HTTPException(422, detail={"error_code": "simulation_mismatch", "message": "Simulation is for a different district."})
        try:
            sim = simulate(d, districts.meta, body.simulation.category, body.simulation.facilities,
                           body.simulation.capacity_per_facility, body.simulation.investment_cr)
        except SimulationUnavailable as e:
            raise HTTPException(422, detail={"error_code": "simulation_unavailable", "message": str(e)}) from e

    brief_dict, removed, cached, model = None, [], False, None
    if not body.evidence_sheet_only:
        brief, cached, used = await gemini.policy_brief(ev, _round_sim(sim), ivs)
        allowed = collect_numbers(ev) | collect_numbers(_round_sim(sim)) | collect_numbers(ivs)
        brief_dict = brief.model_dump()
        for k, v in brief_dict.items():
            brief_dict[k] = ground_list(v, allowed, removed) if isinstance(v, list) else ground_text(v, allowed, removed)
        brief_dict["title"] = brief_dict["title"] or f"{d['name']}: policy brief"
        model = used

    pdf = policy_service.build_pdf(fonts_dir=settings.fonts_dir, district=d, evidence=ev, sources=districts.meta["sources"], brief=brief_dict,
                                   simulation=sim, interventions=ivs, model_name=model, removed=removed)
    kind = "policy_brief" if brief_dict else "evidence_sheet"
    fname = f"unheard-{kind.replace('_', '-')}-{re.sub(r'[^a-z0-9]+', '-', d['name'].lower())}.pdf"
    return PolicyBriefOut(district_id=body.district_id, brief=brief_dict, removed_statements=removed, model=model, cached=cached,
                          pdf_base64=base64.b64encode(pdf).decode(), filename=fname, kind=kind)


def _round_sim(sim: dict[str, Any] | None) -> dict[str, Any] | None:
    if sim is None:
        return None

    def rnd(x):
        if isinstance(x, float):
            return round(x, 1)
        if isinstance(x, dict):
            return {k: rnd(v) for k, v in x.items()}
        if isinstance(x, list):
            return [rnd(v) for v in x]
        return x
    return rnd(sim)
