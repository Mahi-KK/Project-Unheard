# AI architecture

## Division of labour

| Deterministic engine (code) | Gemini (language + reasoning) |
|---|---|
| Need, Demand, Unheard Index | Understand multilingual / spoken requests |
| Percentiles, rankings, filtering | Identify language, extract place / entities / urgency |
| Simulation | Translate a question into a filter spec |
| District resolution from a place name | Explain given numbers in plain language |
| PDF tables | Draft policy-brief narrative |
| Clustering threshold | Produce embeddings for similarity |

Gemini is never asked for a score, and no score is ever read from a Gemini response.

## Calls

All calls go through `backend/app/services/gemini_service.py` using the `google-genai` SDK (Gemini API key, or Vertex AI with `GOOGLE_GENAI_USE_VERTEXAI=true`).

| Task | Model (default, env-configurable) | Input | Output schema |
|---|---|---|---|
| `analyze_request` | `GEMINI_MODEL` (gemini-3.6-flash) | text, or 16 kHz mono WAV (`audio/wav` inline part) | `RequestAnalysis` |
| `map_query` | `GEMINI_MODEL`, temperature 0 | question + list of valid state names | `MapQuery` |
| `explain` | `GEMINI_MODEL` | evidence packet JSON + candidate interventions | `Explanation` |
| `policy_brief` | `GEMINI_MODEL` | evidence + simulation + interventions | `PolicyBriefText` |
| `embed` | `GEMINI_EMBED_MODEL` (gemini-embedding-001) | request texts | vectors → deterministic greedy cosine clustering (0.84), duplicate flag (0.92) |

Schemas: `backend/app/schemas/gemini.py`.

## Reliability pipeline

```
request -> cache lookup (sha256 of task+model+input) --hit--> validate -> return {cached: true}
              | miss
              v
        generate_content(response_mime_type=application/json, response_schema=Model)
              |  hard timeout (GEMINI_TIMEOUT_S): SDK timeout + asyncio.wait_for
              v
        json.loads -> Model.model_validate --fail--> retry with backoff (GEMINI_MAX_RETRIES)
              | ok                                   429 / 5xx / network -> retry
              v                                      401/403/404/400     -> typed error, no retry
        cache_put -> grounding / sanitising (endpoint) -> response
```

Typed errors (`gemini_not_configured`, `gemini_auth`, `gemini_timeout`, `gemini_rate_limited`, `gemini_malformed`, `gemini_model_not_found`, `gemini_unreachable`, …) become HTTP 502/503/504 with `{error_code, message}`. The UI shows `UNAVAILABLE — <title>` with the message and a retry. **No fallback text is ever generated in place of a failed AI call.** The only non-AI fallback is Ask-the-map's keyword parser, which is labelled `PARSED LOCALLY`.

## Grounding

`backend/app/utils/grounding.py` extracts every number from generated text and checks it against every number in the evidence (tolerances for rounding, lakh/million scaling, years and small counts). A sentence with an unverified figure is removed; the count is shown in the UI and the PDF. Explanation `indicator_key`s must exist in the evidence; unknown keys are dropped.

## Multilingual scope

- Designed and demonstrated for: **Kannada, Hindi, English** (text and voice). Verify each with your own key before the demo (`docs/demo-script.md`, pre-flight).
- The model supports many more Indian languages and the pipeline is language-agnostic (ISO code + original-script transcript + English normalisation), but they are *not* claimed as tested.
- UI chrome is English. The PDF is English-only (ReportLab lacks Indic shaping); the in-app transcript preserves the original script.

## Human in the loop

A Gemini analysis never changes the map by itself. The officer confirms category and district (candidates ranked deterministically from the extracted place) before the signal is added. Each captured signal is badged `CAPTURED`, can be deleted, and duplicate suspicions are flagged, not merged.
