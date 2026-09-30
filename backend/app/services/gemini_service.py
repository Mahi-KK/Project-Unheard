"""Gemini integration.

Every call:
  * asks for JSON constrained by a Pydantic response schema,
  * re-validates the reply with the same Pydantic model (never trusts it),
  * has a hard timeout and bounded retries with backoff (429 / 5xx / bad JSON),
  * is cached (SQLite) by hash of model + task + input,
  * raises a typed GeminiError on failure — callers surface a truthful
    error state; nothing is ever fabricated as a fallback.

Gemini never computes the Unheard Index. It interprets language, extracts
entities, translates queries into filters, and explains numbers it is given.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import random
import re
import time
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from ..config import Settings
from ..schemas.gemini import Explanation, MapQuery, PolicyBriefText, RequestAnalysis
from .cache_service import Store

log = logging.getLogger("unheard.gemini")
T = TypeVar("T", bound=BaseModel)


class GeminiError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


SYSTEM_BASE = (
    "You are the language and reasoning layer of UNHEARD, a civic-intelligence tool used by Indian "
    "government planners. You never invent statistics. You only use numbers that appear in the provided "
    "evidence. You never claim that an absence of complaints means an absence of need or access. "
    "Prefer the phrasing: 'public indicators suggest elevated need while observed citizen-reported demand "
    "is comparatively low'. Citizen-signal baselines are SYNTHETIC DEMONSTRATION SIGNALS; say so when you "
    "refer to them. Output must be valid JSON matching the schema; plain text in string fields (no markdown, no HTML)."
)


class GeminiService:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        # google-genai's async client (and asyncio primitives) belong to one event loop;
        # keep one per loop so the service is safe under any ASGI runner or test client.
        self._clients: dict[int, Any] = {}
        self._gates: dict[int, asyncio.Semaphore] = {}
        self._dead_models: set[str] = set()

    # ------------------------------------------------------------ client
    @property
    def configured(self) -> bool:
        return self.settings.gemini_configured

    def _get_client(self):
        if not self.configured:
            raise GeminiError("gemini_not_configured", "Gemini is not configured. Add GEMINI_API_KEY to .env (see .env.example).", 503)
        loop_id = id(asyncio.get_running_loop())
        client = self._clients.get(loop_id)
        if client is None:
            from google import genai
            from google.genai import types

            opts = types.HttpOptions(timeout=int(self.settings.gemini_timeout_s * 1000))
            if self.settings.gemini_api_key:
                client = genai.Client(api_key=self.settings.gemini_api_key, http_options=opts)
            else:
                client = genai.Client(vertexai=True, http_options=opts)
            self._clients = {loop_id: client}  # drop clients of dead loops
        return client

    def _gate(self) -> asyncio.Semaphore:
        loop_id = id(asyncio.get_running_loop())
        gate = self._gates.get(loop_id)
        if gate is None:
            gate = asyncio.Semaphore(self.settings.gemini_concurrency)
            self._gates = {loop_id: gate}
        return gate

    def _models(self) -> list[str]:
        chain = [self.settings.gemini_model, *self.settings.gemini_fallback_models]
        out: list[str] = []
        for m in chain:
            if m and m not in out and m not in self._dead_models:
                out.append(m)
        return out

    # ------------------------------------------------------------ core call
    async def _generate(self, task: str, schema: type[T], contents: list[Any], cache_payload: Any, system: str,
                        temperature: float = 0.2, use_cache: bool = True) -> tuple[T, bool, str]:
        """Returns (validated result, served_from_cache, model_that_answered).

        Transient failures (rate limit, 5xx, timeout, network, malformed JSON)
        fall through the model chain, then back off (honouring the server's
        retry delay) and try again, all within a total time budget."""
        primary = self.settings.gemini_model
        key = self.store.cache_key(task, primary, cache_payload)
        if use_cache:
            hit = self.store.cache_get(key)
            if hit is not None:
                try:
                    body = hit.get("__result__", hit) if isinstance(hit, dict) else hit
                    model_used = hit.get("__model__", primary) if isinstance(hit, dict) else primary
                    return schema.model_validate(body), True, model_used
                except ValidationError:
                    pass  # schema changed since cached: refetch

        client = self._get_client()
        from google.genai import errors, types

        cfg = types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
        )
        started = time.monotonic()
        budget = self.settings.gemini_total_budget_s
        last: GeminiError | None = None
        retry_hint = 0.0
        rounds = self.settings.gemini_max_retries + 1
        for rnd in range(rounds):
            for model in self._models():
                remaining = budget - (time.monotonic() - started)
                if remaining < 3:
                    break
                try:
                    async with self._gate():
                        resp = await asyncio.wait_for(
                            client.aio.models.generate_content(model=model, contents=contents, config=cfg),
                            timeout=min(self.settings.gemini_timeout_s + 2, remaining),
                        )
                    text = (resp.text or "").strip()
                    if not text:
                        raise GeminiError("gemini_empty", "Gemini returned an empty response (possibly blocked by safety filters).")
                    result = schema.model_validate(json.loads(text))
                    self.store.cache_put(key, task, primary, {"__model__": model, "__result__": result.model_dump(mode="json")})
                    if model != primary:
                        log.info("gemini task=%s answered by fallback model %s", task, model)
                    return result, False, model
                except asyncio.TimeoutError:
                    last = GeminiError("gemini_timeout", f"Gemini did not respond within {self.settings.gemini_timeout_s:.0f}s.", 504)
                    log.warning("gemini timeout task=%s model=%s", task, model)
                except (json.JSONDecodeError, ValidationError) as e:
                    last = GeminiError("gemini_malformed", f"Gemini returned output that failed schema validation: {str(e)[:300]}")
                    log.warning("gemini malformed task=%s model=%s: %s", task, model, str(e)[:200])
                except errors.ClientError as e:
                    code = getattr(e, "code", 400)
                    if code == 429:
                        last = GeminiError("gemini_rate_limited", "Gemini rate limit reached on every configured model. Try again in a minute.", 503)
                        retry_hint = max(retry_hint, _retry_delay(str(e)))
                        log.warning("gemini 429 task=%s model=%s", task, model)
                    elif code in (401, 403):
                        raise GeminiError("gemini_auth", "Gemini rejected the API key (401/403). Check GEMINI_API_KEY.", 503) from e
                    elif code == 404:
                        self._dead_models.add(model)
                        last = GeminiError("gemini_model_not_found", f"Model '{model}' is not available for this key. Set GEMINI_MODEL.", 503)
                        log.warning("gemini model unavailable: %s", model)
                    else:
                        raise GeminiError("gemini_bad_request", f"Gemini rejected the request ({code}): {str(e)[:300]}") from e
                except errors.ServerError as e:
                    last = GeminiError("gemini_server_error", f"Gemini service error ({getattr(e, 'code', 500)}).", 503)
                    log.warning("gemini %s task=%s model=%s", getattr(e, "code", 500), task, model)
                except GeminiError as e:
                    last = e
                except Exception as e:  # network errors etc.
                    last = GeminiError("gemini_unreachable", f"Could not reach Gemini: {type(e).__name__}: {str(e)[:200]}", 503)
            if rnd < rounds - 1:
                wait = min(12.0, max(retry_hint, (2 ** rnd) + random.random()))
                if budget - (time.monotonic() - started) < wait + 4:
                    break
                await asyncio.sleep(wait)
        raise last or GeminiError("gemini_unreachable", "Gemini did not answer within the time budget.", 503)

    # ------------------------------------------------------------ tasks
    async def analyze_request(self, text: str | None, audio_b64: str | None, hint_language: str | None) -> tuple[RequestAnalysis, bool, str]:
        instr = (
            "Analyse this citizen development request from India. Identify the language (ISO 639-1) and give the "
            "verbatim transcript in the original script. Provide a faithful English rendering (normalized_request) without "
            "adding facts. Classify the primary infrastructure/service category. Extract any place mentioned; give "
            "district and state as romanised English names only if mentioned or unambiguous from the place, otherwise null. "
            "Score urgency 0..1 from what is said, using this rubric: 0.1-0.3 inconvenience or request for improvement; "
            "0.4-0.6 a basic service (drinking water, sanitation, power, schooling) is missing or broken for a household or community; "
            "0.7-0.9 the gap creates a health or safety risk, or affects pregnant women, children, elderly or many people; "
            "1.0 immediate danger to life. Explain the score in urgency_reason. Do not guess beyond the text."
        )
        if hint_language:
            instr += f" The user indicated the language may be '{hint_language}', but detect it yourself."
        if audio_b64:
            from google.genai import types

            audio = base64.b64decode(audio_b64, validate=True)
            if len(audio) < 2000:
                raise GeminiError("audio_too_short", "Recording is too short to analyse.", 422)
            contents = [instr + " The request is in the attached audio recording.", types.Part.from_bytes(data=audio, mime_type="audio/wav")]
            payload = {"audio_sha": self.store.cache_key("audio", "", audio_b64)}
        else:
            contents = [instr + "\n\nRequest:\n" + (text or "")]
            payload = {"text": text, "hint": hint_language}
        return await self._generate("analyze_request", RequestAnalysis, contents, payload, SYSTEM_BASE)

    async def map_query(self, query: str, states: list[str]) -> tuple[MapQuery, bool, str]:
        instr = (
            "Translate the planner's question into a structured filter for a district map. Scores are 0-100. "
            "'need' = public-indicator need, 'demand' = citizen-reported demand percentile, 'unheard' = high need with low demand. "
            "Use mode 'unheard' and sort_by 'unheard' when the question contrasts need with low reporting/demand. "
            "Use thresholds only if the question implies them ('high' ~ >= 60, 'low' ~ <= 30). "
            "Use category 'roads' if asked about roads/connectivity (that data is unavailable; the app will say so). "
            "Only use state names from this list: " + ", ".join(states) + ". Default limit 10."
            "\n\nQuestion: " + query
        )
        return await self._generate("map_query", MapQuery, [instr], {"q": query}, SYSTEM_BASE, temperature=0.0)

    async def explain(self, evidence: dict[str, Any], interventions: list[dict[str, Any]]) -> tuple[Explanation, bool, str]:
        instr = (
            "Explain why this district appears in the Unheard view, using ONLY the evidence JSON. "
            "need_drivers: up to 4 indicators with the highest deficit, each statement citing the indicator's value, unit "
            "and source year exactly as given (indicator_key must be one of the evidence keys). "
            "demand_observation: describe the observed demand percentile and state that baseline signals are synthetic. "
            "intervention_rationales: for each candidate intervention category given, one grounded sentence. "
            "caveats: data vintage, synthetic demand, what the index does not prove. Be concise and neutral. "
            "Never say that no complaints means no access.\n\nEVIDENCE:\n" + json.dumps(evidence, ensure_ascii=False)
            + "\n\nCANDIDATE INTERVENTIONS:\n" + json.dumps(interventions, ensure_ascii=False)
        )
        return await self._generate("explain", Explanation, [instr], {"e": evidence, "i": interventions}, SYSTEM_BASE)

    async def policy_brief(self, evidence: dict[str, Any], simulation: dict[str, Any] | None, interventions: list[dict[str, Any]]) -> tuple[PolicyBriefText, bool, str]:
        instr = (
            "Write a concise policy brief for a district planning officer, using ONLY the evidence, simulation and "
            "interventions JSON below. Every number you write must appear in that JSON. Label simulated figures as "
            "PROJECTED / MODELLED and synthetic signals as SYNTHETIC. If no simulation is given, projected_effect must say "
            "that no intervention was modelled. limitations must include data vintage (NFHS-5 2019-21, Census 2011), "
            "synthetic demand baseline, relative (not absolute) scoring, and that the index flags where to look, not what is true on the ground."
            "\n\nEVIDENCE:\n" + json.dumps(evidence, ensure_ascii=False)
            + "\n\nSIMULATION:\n" + json.dumps(simulation, ensure_ascii=False)
            + "\n\nINTERVENTIONS:\n" + json.dumps(interventions, ensure_ascii=False)
        )
        return await self._generate("policy_brief", PolicyBriefText, [instr], {"e": evidence, "s": simulation, "i": interventions}, SYSTEM_BASE, temperature=0.3)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        model = self.settings.gemini_embed_model
        out: list[list[float] | None] = [self.store.emb_get(self.store.cache_key("emb", model, t)) for t in texts]
        missing = [i for i, v in enumerate(out) if v is None]
        if missing:
            client = self._get_client()
            try:
                async with self._gate():
                    resp = await asyncio.wait_for(
                        client.aio.models.embed_content(model=model, contents=[texts[i] for i in missing]),
                        timeout=self.settings.gemini_timeout_s,
                    )
            except asyncio.TimeoutError as e:
                raise GeminiError("gemini_timeout", "Embedding request timed out.", 504) from e
            except Exception as e:
                raise GeminiError("gemini_embed_failed", f"Embedding failed: {type(e).__name__}: {str(e)[:200]}", 503) from e
            vecs = [list(e.values) for e in (resp.embeddings or [])]
            if len(vecs) != len(missing):
                raise GeminiError("gemini_embed_failed", "Embedding response size mismatch.")
            for i, v in zip(missing, vecs):
                out[i] = v
                self.store.emb_put(self.store.cache_key("emb", model, texts[i]), model, v)
        return [v for v in out if v is not None]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


def cluster(vectors: list[list[float]], threshold: float = 0.84) -> list[list[int]]:
    """Deterministic greedy single-pass clustering (input order)."""
    clusters: list[list[int]] = []
    for i, v in enumerate(vectors):
        for c in clusters:
            if cosine(vectors[c[0]], v) >= threshold:
                c.append(i)
                break
        else:
            clusters.append([i])
    return clusters


def _retry_delay(message: str) -> float:
    """Extract the server-suggested retry delay (e.g. 'retryDelay': '17s')."""
    m = re.search(r"retry[^0-9]{0,24}(\d+(?:\.\d+)?)\s*s", message, re.IGNORECASE)
    return float(m.group(1)) if m else 0.0
