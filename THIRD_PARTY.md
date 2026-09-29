# Third-party components

UNHEARD is original code (MIT, see `LICENSE`) built on the open-source components and public data below. Every licence was checked for compatibility with redistribution in a desktop application. No proprietary code is included.

## Frontend (npm)

| Library | Version | Purpose | Licence | Source |
|---|---|---|---|---|
| react, react-dom | 19.3.0 | UI | MIT | https://github.com/facebook/react |
| maplibre-gl | 6.11.2 | WebGL map rendering (no external tiles used) | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js |
| topojson-client | 3.1.0 | Decode bundled district TopoJSON | ISC | https://github.com/topojson/topojson-client |
| zustand | 5.0.15 | App state | MIT | https://github.com/pmndrs/zustand |
| @tauri-apps/api, plugin-shell, plugin-dialog, plugin-opener | 2.x | Desktop bridge, sidecar, save dialog, open exported PDF | MIT OR Apache-2.0 | https://github.com/tauri-apps |
| @fontsource/instrument-serif | 5.3.0 | Instrument Serif font files | OFL-1.1 (font) / MIT (package) | https://github.com/fontsource/font-files |
| @fontsource/geist-sans, @fontsource/geist-mono | 5.3.0 | Geist font files | OFL-1.1 (font) / MIT (package) | https://github.com/vercel/geist-font |

Dev-only: vite (MIT), @vitejs/plugin-react (MIT), vitest (MIT), typescript (Apache-2.0), @tauri-apps/cli (MIT OR Apache-2.0), playwright-core (Apache-2.0, visual QA with the locally installed Edge), @types/* (MIT).

## Desktop shell (Rust crates)

| Crate | Purpose | Licence |
|---|---|---|
| tauri, tauri-build | Native Windows shell (WebView2) | MIT OR Apache-2.0 |
| tauri-plugin-shell / -dialog / -opener | Sidecar process, save dialog, open exported PDF | MIT OR Apache-2.0 |
| serde, serde_json | Serialization | MIT OR Apache-2.0 |
| uuid | Per-launch local API token | MIT OR Apache-2.0 |

Transitive crate licences are the standard Rust ecosystem permissive set (MIT / Apache-2.0 / BSD / Unicode / Zlib).

## Backend (Python)

| Package | Version | Purpose | Licence |
|---|---|---|---|
| fastapi | 0.141.1 | HTTP API | MIT |
| uvicorn | 0.54.0 | ASGI server | BSD-3-Clause |
| pydantic | 2.13.5 | Schema validation (incl. every Gemini response) | MIT |
| google-genai | 2.25.0 | Google Gemini API / Vertex AI SDK | Apache-2.0 |
| reportlab | 5.0.1 | Policy brief PDF | BSD |
| httpx | 0.28.1 | HTTP client | BSD-3-Clause |
| python-dotenv | 1.2.3 | `.env` loading | BSD-3-Clause |

Build/QA only: pyinstaller 6.22.3 (GPL-2.0-or-later **with bootloader exception** — permits distributing the bundled sidecar under any licence), pytest (MIT), pymupdf (AGPL-3.0 — used only locally to render PDFs to images during QA; **not** shipped, excluded from the sidecar build), fonttools (MIT — used once to instance static font weights).

## Fonts embedded in PDFs

Instrument Serif, Geist, Geist Mono — SIL Open Font License 1.1 (`backend/app/assets/fonts/*-OFL.txt`). Static weights were instanced from the Google Fonts variable fonts.

## Data

| Dataset | Use | Terms |
|---|---|---|
| NFHS-5 District Fact Sheets (IIPS / MoHFW, 2019–21), via github.com/jvargh7/nfhs5_factsheets | 13 need indicators + 1 vulnerability indicator | Government of India public statistical release; extraction repository MIT |
| Census of India 2011 district tables (ORGI), via github.com/nishusharma1608/India-Census-2011-Analysis | Population, SC/ST share, rural share, water-source distance, phone access | Government of India public statistical release (compilation repo has no licence; figures are official) |
| Indian district boundaries 2019 (G. Narula, based on DataMeet community maps) | District polygons | MIT (`data/raw/boundaries_LICENSE.txt`); visualisation only, not an authoritative survey boundary |

Full provenance: `data/metadata/sources.json` and `docs/data-sources.md`.

## Design system

Visual tokens (palette, type families, spacing, radius, motion) are taken from the AI Garage design-system extract supplied by the team. No code or imagery from that product is used.
