# Data sources

Machine-readable metadata: `data/metadata/sources.json`. Raw files: `data/raw/` (fetched by `scripts/fetch_data.py`). Build: `scripts/build_dataset.py` (deterministic). Join audit: `data/processed/match_report.json`.

## 1. NFHS-5 District Fact Sheets — need indicators

- **Publisher:** International Institute for Population Sciences (IIPS) & Ministry of Health and Family Welfare, Government of India
- **Year:** fieldwork 2019–21 · **Coverage:** 705 districts, 28 States + 8 UTs
- **Retrieved via:** machine-readable extract `github.com/jvargh7/nfhs5_factsheets` (MIT). The maintainer notes values were transcribed from PDFs and not exhaustively cross-checked.
- **Missing values:** `*` (small sample) and `na` stay missing; components are re-weighted and confidence reduced. Nothing is imputed.

| Key | NFHS # | Indicator | Direction | Category |
|---|---|---|---|---|
| water_improved | 8 | Population with improved drinking-water source | lower worse | water |
| sanitation_improved | 9 | Population using improved sanitation | lower worse | sanitation |
| electricity | 7 | Population with electricity | lower worse | energy |
| clean_fuel | 10 | Households using clean cooking fuel | lower worse | energy |
| women_literate | 14 | Women literate | lower worse | education |
| women_10yrs_school | 15 | Women with 10+ years schooling | lower worse | education |
| female_ever_school | 1 | Females 6+ who ever attended school | lower worse | education |
| preprimary | 13 | Children age 5 in pre-primary (2019-20) | lower worse | education |
| institutional_births | 42 | Institutional births | lower worse | health |
| fully_vaccinated | 49 | Children 12–23 m fully vaccinated | lower worse | health |
| health_insurance | 12 | Households with health insurance/financing | lower worse | health |
| stunting | 73 | Children under 5 stunted | higher worse | health |
| anaemia_women | 84 | Women 15–49 anaemic | higher worse | health |
| under15 | 2 | Population below 15 | higher worse | vulnerability |

## 2. Census of India 2011 — population, vulnerability, water distance

- **Publisher:** Office of the Registrar General & Census Commissioner, India · **Year:** 2011 · 640 districts
- **Retrieved via:** `github.com/nishusharma1608/India-Census-2011-Analysis` (compilation of official tables; the repository has no licence, the figures are official)
- **Fields used:** population; SC + ST share (vulnerability); rural household share (vulnerability); households whose drinking-water source is *away* from premises (water need); households with a phone (only as the *digital access* input to the synthetic demand generator).
- **Join rule:** by name within state, **only to boundaries unchanged since 2011** (boundary `year == 2011_c`). Districts created or reshaped later show population **UNAVAILABLE** (111 polygons) rather than an apportioned estimate. Hand-reviewed overrides: Leh, Kargil → Ladakh; Allahabad → Prayagraj; Garhwal → Pauri Garhwal; Puducherry; Jaintia Hills deliberately not joined (split after 2011).

## 3. District boundaries

- `github.com/guneetnarula/indian-district-boundaries` — 734 districts recognised in 2019, TopoJSON, MIT, based on DataMeet community maps. Depicts the full territorial extent of India as shown by the Government of India. Visualisation-grade, not a survey boundary.
- **NFHS join:** exact normalised name within state (641) → 44 hand-reviewed renames (`data/metadata/name_overrides.json`) → strict fuzzy match ≥ 0.86 within state, ambiguous matches refused (20). **0 NFHS districts unmatched; no polygon matched twice.**
- **29 polygons have no NFHS-5 data** (districts created after the survey, e.g. Kallakurichi, Tenkasi, Mulugu; Chandigarh; Lakshadweep; territory without survey coverage). Shown hatched as INSUFFICIENT DATA.

## 4. SYNTHETIC DEMONSTRATION SIGNAL — citizen demand baseline

There is no public, district-level, category-tagged grievance dataset for all of India. Rather than fake one silently, UNHEARD generates a clearly labelled synthetic baseline so the pipeline can be demonstrated end-to-end:

```
propensity  = (0.35 + 1.3 × phone_share_2011) × (0.7 + 0.6 × urban_share_2011)
need_factor = 0.8 + 0.4 × category_deficit / 100
λ_category  = base_rate_category × population/100k × propensity × need_factor
count       = Poisson(λ)   (seeded per district: 20260929 XOR sha256(district_id))
```

**Caveat (also stated in-app):** because the generator assumes reporting rises with digital access, the synthetic baseline partly *produces* the pattern UNHEARD looks for. It demonstrates the method; it is **not** evidence that any district under-reports. Sample request texts in dossiers come from `data/demo/synthetic_templates.json`, written by the team and badged SYNTHETIC.

Production replacement: state grievance exports (CPGRAMS, 1076 / CM helplines, municipal apps), ingested per district and category.

## 5. Not integrated (shown as UNAVAILABLE)

- Road connectivity (PMGSY / OMMAS habitation connectivity) — the category exists in the schema; the UI marks it unavailable.
- UDISE+ school infrastructure, HMIS facility data, Jal Jeevan Mission tap connections — natural next indicators.

## Scoring model

`data/metadata/model.json` (weights editable, versioned `unheard-model-1.0`):

- deficit_i = direction-corrected min–max across scored districts (0 best … 100 worst)
- category need = weighted mean of available deficits
- need = 0.75 × mean(category needs) + 0.15 × vulnerability + 0.10 × exposure (log10 population)
- demand = mid-rank percentile of signals per 100,000 (Census 2011 population; post-2011 boundaries use the state median, flagged as imputed)
- **unheard = need × (1 − demand / 100)**
- confidence = share of inputs present
