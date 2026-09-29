# Pitch deck outline (11 slides)

1. **UNHEARD** — Finding the needs no one reported. (Intro screen visual.)
2. **The problem** — Planning follows complaints. Complaints follow access: phones, literacy, language, trust. The weakest-served districts are often the quietest.
3. **The insight** — Two signals, one gap: *Demand* (what people report) vs *Need* (what public data indicates). High need + low reported demand = potential unheard need. We never say "no complaints = no access".
4. **Demo: capture** — Kannada voice request → Gemini: language, transcript, English rendering, category, place, urgency. Human confirms.
5. **Demo: Reveal Unheard** — The signature moment: reported demand fades, need surfaces, the unheard emerge (screenshot sequence).
6. **Demo: dossier** — Formula on screen (65.9 = 67.3 × (1 − 2.1/100)), NFHS-5 evidence with years, grounded Gemini explanation.
7. **Demo: act** — What if? (PROJECTED / MODELLED) → Gemini policy brief → printable PDF.
8. **Google AI, doing real work** — Multilingual/voice understanding, entity & urgency extraction, embeddings for duplicates, NL → filter, grounded explanation, policy drafting. Gemini never computes the index. Schema validation, retries, cache, grounding check, truthful failure.
9. **Data & honesty** — NFHS-5 (2019–21) × 705 districts, Census 2011, 734 boundaries. Synthetic demand baseline labelled everywhere; roads marked unavailable; languages tested: kn/hi/en.
10. **Architecture & scale** — Today: Tauri desktop + FastAPI sidecar + Gemini API, offline-capable core. Production: Cloud Run + Vertex AI + BigQuery + Firebase + Maps Platform; grievance feeds via Pub/Sub. Cross-border: DHS-style surveys in 90+ countries.
11. **Ask / next steps** — Pilot with one state's grievance feed; add PMGSY, UDISE+, JJM, HMIS; field-verify top-ranked districts; measure whether outreach changes reporting.
