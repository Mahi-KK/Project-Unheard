# Demo script (3–5 minutes)

**The one story:** *We normally see what citizens report. UNHEARD shows where public data suggests people may need something even when very little has been reported.*

## Pre-flight (10 minutes before)

1. `%APPDATA%\Unheard\.env` contains `GEMINI_API_KEY=…` (or run backend in dev with `backend/.env`).
2. Launch `Unheard.exe`. Top-right status must read **Gemini ready · <model>**.
3. Run the Kannada sample once (Capture → Kannada → Analyse). This verifies the key and warms the cache. If the demo later reuses it, the badge honestly shows **cached** — it is still a real Gemini response from this machine.
4. Test the microphone once (Windows may ask for permission the first time).
5. Exit demo mode (removes demo signals) so the map starts clean.

## Script

| Time | Screen | Say / do |
|---|---|---|
| 0:00 | Intro (black) | "Citizen demand tells us what people report. Public data tells us what underlying conditions indicate. UNHEARD finds the gap." Click **Enter India**. |
| 0:20 | 01 Demand | "This is what planners usually see: reports per 100,000 people. Big cities are loud." Point out the **SYNTHETIC** label: "This baseline is a synthetic demonstration signal — we say so everywhere." |
| 0:40 | Capture | **Demo mode → step 1**. Kannada request about drinking water in Raichur. Hold-to-speak or the typed sample. |
| 1:00 | Step 2 | Gemini returns: language *Kannada*, transcript, English rendering, category *water*, district *Raichur*, urgency with reason. "Gemini understands; it doesn't score." |
| 1:20 | Step 3 | Signal joins the map: Raichur's water demand percentile moves (before → after shown). "The index recomputes deterministically." |
| 1:40 | **Step 4 — Reveal Unheard** | Pause. Reported demand fades, underlying need surfaces in grey, then the unheard districts emerge in orange with ranks. "Raichur now has a voice. These places didn't." Read the figures strip: top-10 population, median demand percentile. |
| 2:20 | Step 5 — Dossier | Bijapur (Chhattisgarh): Unheard 65.9 = Need 67.3 × (1 − 2.1/100) — the formula is on screen. Evidence rows with NFHS-5 values and years. Click **Explain with Gemini**: need drivers cite the actual indicator values; grounding check noted. |
| 3:10 | Step 6 — What if? | Sanitation facilities slider: CURRENT → INTERVENTION → PROJECTED, labelled PROJECTED / MODELLED, assumptions listed. |
| 3:40 | Step 7 — Policy brief | Gemini drafts (sections shown in-app), ReportLab typesets; **Export PDF** → **Open PDF** in the system viewer. |
| 4:10 | Ask the map | Ctrl+K: "Where is water need highest but citizen demand lowest?" Show the filter chips — "Gemini writes the filter, code applies it." |
| 4:30 | Close | "Built on NFHS-5 and Census 2011 for 705 districts, Gemini for language, deterministic scoring for trust. Swap the synthetic baseline for a real grievance feed and this runs for any state — or any country with DHS-style data." |

## If Gemini fails live

Say it plainly: the panel shows **UNAVAILABLE — reason**. Continue: Demo mode falls back to a *labelled manual classification* for the signal, and every deterministic step (reveal, dossier evidence, simulation, evidence-sheet PDF) still works. That is the reliability story.
