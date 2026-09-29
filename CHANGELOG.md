# Changelog

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
