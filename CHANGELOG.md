# Changelog

## v3.1 — live Gemini hardening, first packaged release

### Improved
- **Gemini reliability on free-tier keys**: automatic fallback across models (`gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.1-flash-lite`) on rate limits or overload, server-suggested retry delays, a total time budget per request and a concurrency limit. The model that actually answered is shown in the app.
- **Place matching**: requests naming *West Singhbhum*, *Bangalore*, *Mewat* or *Gurgaon* now resolve to Pashchimi Singhbhum, Bengaluru, Nuh and Gurugram (Hindi direction words and survey-era names).
- **Urgency scoring**: explicit rubric so a broken drinking-water source is scored as a basic-service outage, with the reason shown.
- Fixed an event-loop error in request clustering (embeddings).

### Verified live
- 10/10 end-to-end Gemini checks: Kannada, Hindi and English text; Kannada voice; three natural-language map queries; grounded explanation; policy brief PDF; embeddings clustering.

### Release
- Windows installer and portable build, with SHA-256 checksums.

## v3 — free map movement, responsive layout, animated landing and map backdrop

### Fixed
- **Map could not be dragged sideways** and west India was hidden under the side panel on smaller windows: map bounds were too tight. The map now pans freely in every direction and always fits India beside the panel.
- **Layout cut off on smaller windows / high display scaling**: the top bar wraps, the side panel narrows, and the dossier becomes an overlay below 1180 px. Works from 900×600 up; the desktop window minimum is now 900×600.
- An interrupted demo could leave a demo signal on the map; demo signals are now cleared automatically on startup.

### New
- **Living map backdrop**: behind the (now transparent) map, a sea of points anchored to latitude/longitude with a slow swell and long waves rolling in from the south-west, plus a dotted graticule with degree labels. It pans and zooms with the map, follows Night/Day, starts only after the map has drawn, and is batched to a handful of draw calls per frame.
- **Collapsible side panel** (‹ button on the panel; "› Panel" to bring it back).
- **Animated landing page**: a live lattice of points with a slow swell and ripples (a report being heard), pulsing rings on the ten highest-Unheard districts, and a continuously scrolling ticker of real district scores. Respects reduced-motion settings.

### Verified
- New `scripts/qa_responsive.mjs`: at 900×600, 1024×700, 1280×720, 1366×768, 1440×900 and 1920×1080 — India fully visible beside the panel, drag-pan in all four directions, panel collapse/expand, Ask-the-map and dossier fit, no page errors (all pass).
- Voice capture tested inside the packaged desktop app with a simulated microphone: recording → 16 kHz WAV → backend.

## v2 — visual upgrade, search fix, hardening

### Fixed
- **District search dropdown was clipped** by the top bar and showed only a black strip. The results list now renders fully above the map.
- Search now matches **districts and states** (choosing a state zooms the map to it) and older/survey names (e.g. typing `bang` finds *Bengaluru*, listed as *Bangalore* in NFHS-5). Matches are highlighted, each result shows its Unheard index, and an empty-result message is shown.
- Ranked district list stays readable at 125% Windows display scaling (it now scrolls independently instead of being covered by the legend).

### New
- **Intro screen:** India drawn district by district on a dark field; districts with a high Unheard Index light up in orange, strongest first (real data, not decoration).
- **Night / Day map themes** (toggle top-right of the map, remembered between sessions). Night is the default.
- **Colourful, category-aware map:** demand as teal circles, need as a blue→yellow scale, unheard in orange shades with the top 10 outlined and numbered. Selecting a category (water, sanitation, health, education, energy) re-colours the need map in that category's colour.
- Category colours carried through the chips, ranked-list bars, legend and district dossier.
- Map hover card shows Unheard, Need and Demand together with the active mode highlighted.
- Legend is now a colour ramp matching the active theme and category.

### Reliability
- Backend: catch-all error handler — any unexpected error returns a clear JSON message instead of an unhandled failure.
- Map: if WebGL is unavailable the app shows a message and the ranked list, dossier and simulator keep working.
- New `scripts/qa_stress.mjs`: rapid mode/category/theme switching, repeated reveals, many dossiers, window resizes, bad input — asserts no page errors.

### Verified
- Backend test suite (28 tests), TypeScript ↔ Python parity tests, 11 end-to-end UI flow checks and the stress test all pass; the packaged Windows app was rebuilt and checked end to end.
