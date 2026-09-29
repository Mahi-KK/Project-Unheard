# Architecture

UNHEARD separates **what runs today** (prototype runtime) from **how it would run at state/national scale** (production architecture). Nothing in the prototype pretends to be a production service: SQLite is a local store, not BigQuery; the map is local GeoJSON, not Google Maps.

## 1. Prototype runtime

```
+---------------------------- Unheard.exe (Tauri 2, Rust) ----------------------------+
| WebView2                                                                            |
|  React + TypeScript (Vite build)                                                    |
|   - public/data/districts.json       precomputed scores + raw indicators (offline)  |
|   - public/data/districts.topo.json  734 district polygons (offline)                |
|   - MapLibre GL: local GeoJSON only, no tile server, no API key                     |
|   - services/scoring.ts              TS mirror of the scoring engine (parity-tested)|
|   - features/simulation/simulate.ts  TS mirror of the simulator (parity-tested)     |
|                                                                                     |
| Rust (src-tauri/src/lib.rs)                                                         |
|   - picks a free loopback port + random per-launch token                            |
|   - spawns sidecar  unheard-backend.exe --port N   (env UNHEARD_API_TOKEN)          |
|   - command backend_info -> {base_url, token}                                       |
|   - kills sidecar on exit                                                           |
+-------------------------------------------------------------------------------------+
                     | HTTP 127.0.0.1:N, header X-Unheard-Token
+------------ unheard-backend.exe (FastAPI, PyInstaller one-file) -------------+
| services/scoring_service.py     SOURCE OF TRUTH for Need / Demand / Unheard  |
| services/simulation_service.py  deterministic WHAT IF?                       |
| services/district_service.py    dataset, captured-signal overlay, filters,   |
|                                 evidence packets, rule-based interventions   |
| services/gemini_service.py      Gemini calls: schema, retry, timeout, cache  |
| utils/grounding.py              removes generated sentences with unverified  |
|                                 figures                                      |
| services/policy_service.py      ReportLab PDF                                |
| services/cache_service.py       SQLite (%APPDATA%\Unheard\unheard.db)        |
+------------------------------------------------------------------------------+
                     | HTTPS (google-genai SDK)
               Gemini API (AI Studio key)  -- or Vertex AI with ADC
```

### Offline / failure behaviour

| Component down | Still works | Shows |
|---|---|---|
| Gemini (no key, quota, timeout, bad JSON) | Map, modes, Reveal, dossier evidence, simulator, evidence-sheet PDF, manual capture, local keyword query (labelled) | `UNAVAILABLE — <reason>` in each AI panel |
| Backend sidecar | Map, modes, Reveal, dossier evidence, simulator | "Engine offline" banner; capture / AI / PDF unavailable |

### API

| Method | Path | AI? | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | status, Gemini configured, model, dataset version |
| GET | `/api/districts` | – | compact metrics for all districts |
| GET | `/api/district/{id}` | – | full record + evidence packet + interventions + captured signals |
| GET | `/api/unheard?category=&state=&limit=` | – | deterministic ranking |
| GET | `/api/search?q=` | – | fuzzy district search |
| POST | `/api/simulate` | – | WHAT IF? (PROJECTED / MODELLED) |
| GET/POST/DELETE | `/api/signals` | embeddings for duplicate check | captured citizen signals |
| POST | `/api/analyze-request` | yes | text or WAV → structured request analysis |
| POST | `/api/map-query` | yes | NL → structured filter → deterministic results |
| POST | `/api/explain/{id}` | yes | grounded explanation + intervention rationales |
| POST | `/api/cluster-signals` | yes | embedding clustering of a district's requests |
| POST | `/api/policy-brief` | optional | brief JSON + PDF (base64); `evidence_sheet_only` skips AI |

### Security

- Gemini key only in the backend process environment / `.env`; never in frontend source or bundle.
- Sidecar bound to `127.0.0.1`, random port, per-launch token checked on every `/api/*` call (except health); CORS restricted to Tauri + dev origins.
- All inputs validated by Pydantic (length caps, enums, base64 audio size cap).
- Gemini output: schema-validated, control chars / HTML / markdown stripped, rendered as text only, never executed.
- Tauri CSP restricts scripts to the bundle and network to loopback + `*.run.app`.
- Capabilities: only `dialog:allow-save` and `opener:allow-open-path` (`**/*.pdf`). PDFs are written by a Rust command that accepts only `.pdf` paths and `%PDF` content.

## 2. Production-scale architecture (documented, not deployed)

```
 Officers (desktop app / web)            Citizens (IVR, WhatsApp, CSC kiosks, apps)
          |                                            |
          v                                            v
   Firebase Auth --> Cloud Run: unheard-api (same FastAPI image) <-- Pub/Sub <-- grievance feeds
                      |        |            |                               (CPGRAMS, state 1076,
                      |        |            +--> Vertex AI Gemini               municipal helplines)
                      |        |                 (intake, NL query, briefs; asia-south1)
                      |        +--> BigQuery: indicator warehouse (NFHS, UDISE+, PMGSY, Jal Jeevan,
                      |                       HMIS), signal fact table, scheduled scoring job
                      +--> Firestore: case files, officer notes, audit log
                     Google Maps Platform: base map, Places for village geocoding
```

| Prototype | Production |
|---|---|
| `data/processed/districts.json` built by `scripts/build_dataset.py` | BigQuery tables; same scoring code run as a scheduled Cloud Run job, results versioned |
| SQLite signals | Firestore / BigQuery streaming inserts from Pub/Sub |
| SQLite Gemini cache | Memorystore or Firestore TTL cache |
| `GEMINI_API_KEY` | Vertex AI + service account (`GOOGLE_GENAI_USE_VERTEXAI=true`, no code change) |
| Sidecar on loopback | Cloud Run behind IAP / Firebase Auth; desktop app sets `UNHEARD_BACKEND_URL` |
| Local MapLibre GeoJSON | Optional Google Maps Platform base map; district layer unchanged |

## 3. Cross-border adaptation

The engine is jurisdiction-agnostic: a unit is `{id, name, parent, geometry, raw indicators}`; indicators are declared in `model.json` with direction and weight. DHS surveys (90+ countries) publish the same indicator family as NFHS, so a new country needs a boundary file and a `build_dataset.py` adapter — no UI or engine change.
