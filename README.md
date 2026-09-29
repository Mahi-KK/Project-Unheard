<div align="center">

# PROJECT UNHEARD

### Finding the needs no one reported.

AI-powered civic intelligence for discovering potential high-need, low-reported regions across India.

<br>

<img src="https://cdn.simpleicons.org/google/4285F4" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/react/61DAFB" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/typescript/3178C6" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/tauri/FFC131" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/rust/000000" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/python/3776AB" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/fastapi/009688" height="28"/>
&nbsp;&nbsp;
<img src="https://cdn.simpleicons.org/googlecloud/4285F4" height="28"/>

<br><br>

![Google AI](https://img.shields.io/badge/Google%20AI-Gemini-4285F4?style=flat-square&logo=google)
![React](https://img.shields.io/badge/React-TypeScript-61DAFB?style=flat-square&logo=react)
![Tauri](https://img.shields.io/badge/Tauri-Desktop-FFC131?style=flat-square&logo=tauri)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?style=flat-square&logo=fastapi)
![License](https://img.shields.io/badge/License-MIT-000000?style=flat-square)

</div>

---

## The Idea

What citizens report is not necessarily the complete picture of what communities need.

**Project Unheard** combines citizen requests with demographic, infrastructure, and public-data indicators to identify locations where:

> **Underlying need appears high while reported demand is comparatively low.**

These locations become **Unheard signals** — areas that may warrant further investigation, validation, and policy attention.

The system does not assume that low reporting means poor access. It uses multiple indicators to surface patterns that may otherwise remain difficult to see.

---

## How It Works

```text
                    CITIZEN SIGNAL
                    Voice / Text
                         │
                         ▼
                 ┌───────────────┐
                 │   GEMINI AI   │
                 │               │
                 │ Understand    │
                 │ Classify      │
                 │ Extract       │
                 │ Summarize     │
                 └───────┬───────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │       PUBLIC DATA LAYER        │
        │                                │
        │ Demographics · Infrastructure  │
        │ Service Indicators · Demand    │
        └───────────────┬────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │ UNHEARD ENGINE│
                │               │
                │ Need          │
                │ Demand        │
                │ Unheard Index │
                └───────┬───────┘
                        │
            ┌───────────┼────────────┐
            ▼           ▼            ▼
          REVEAL     DISTRICT     WHAT IF?
         UNHEARD    INTELLIGENCE  SIMULATION
            │           │            │
            └───────────┼────────────┘
                        ▼
                  POLICY BRIEF
```

---

## Core Capabilities

<table>
<tr>
<td width="50%">

### Reveal Unheard

Visualize locations where high underlying need intersects with comparatively low reported demand.

</td>
<td width="50%">

### Ask the Map

Ask natural-language questions such as:

> "Where is water need highest but demand lowest?"

</td>
</tr>

<tr>
<td>

### District Intelligence

Explore need, demand, infrastructure indicators, population exposure, citizen signals, evidence, and data sources.

</td>
<td>

### Intervention Simulator

Model potential interventions and examine projected changes in coverage, population affected, and need indicators.

</td>
</tr>

<tr>
<td>

### Multilingual Intelligence

Process citizen requests through voice or text with language detection, classification, location extraction, and summarization.

</td>
<td>

### Policy Brief

Generate evidence-grounded policy briefs containing the signal, evidence, potential intervention, projected effect, sources, and limitations.

</td>
</tr>
</table>

---

## Unheard Index

The **Unheard Index** is a deterministic analytical signal built from the relationship between underlying need and reported demand.

```text
                PUBLIC INDICATORS
                       │
                       ▼
                 ┌───────────┐
                 │ NEED SCORE│
                 └─────┬─────┘
                       │
                       │
CITIZEN SIGNALS ──► DEMAND SCORE
                       │
                       ▼
               ┌───────────────┐
               │ UNHEARD INDEX │
               └───────┬───────┘
                       │
                       ▼
             HIGH NEED / LOW DEMAND
```

The numerical score is calculated by the application's deterministic scoring engine.

**Gemini does not invent or directly determine the score.**

Gemini is used to interpret inputs, explain evidence, understand natural-language queries, and generate grounded outputs.

---

## Google AI Integration

Google Gemini is a core intelligence layer of Project Unheard.

| AI Capability | Gemini |
|---|:---:|
| Language detection | ✓ |
| Citizen request understanding | ✓ |
| Classification | ✓ |
| Location / entity extraction | ✓ |
| Request summarization | ✓ |
| Natural-language map queries | ✓ |
| Evidence-grounded explanations | ✓ |
| Intervention recommendations | ✓ |
| Policy brief generation | ✓ |

The AI layer is integrated into the actual product workflow rather than being presented as a standalone chatbot.

---

## Product Flow

```text
CAPTURE
   ↓
UNDERSTAND
   ↓
MEASURE
   ↓
REVEAL
   ↓
EXPLAIN
   ↓
SIMULATE
   ↓
ACT
```

A citizen request can become a structured signal, combine with public indicators, surface an Unheard location, open a district intelligence view, test a potential intervention, and produce a policy brief.

---

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│                 UNHEARD DESKTOP                     │
│                                                      │
│       React + TypeScript + Tauri + MapLibre         │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                    FASTAPI                           │
│                                                      │
│  Gemini Service │ Scoring │ Simulation │ Reporting  │
└───────────────┬──────────────────────┬───────────────┘
                │                      │
                ▼                      ▼
        ┌──────────────┐       ┌────────────────┐
        │ Gemini API   │       │ Public / Local │
        │              │       │ Data Sources   │
        └──────────────┘       └────────────────┘
```

### Production Scale Architecture

```text
Desktop / Client
       │
       ▼
   Cloud Run
       │
 ┌─────┼───────────┐
 ▼     ▼           ▼
Gemini BigQuery  Firebase
 │
 ▼
Google Maps Platform
```

The local prototype and production-scale architecture are kept separate so that the project never represents planned cloud infrastructure as already deployed infrastructure.

---

## Technology

| Layer | Technology |
|---|---|
| Desktop | Tauri 2 + Rust |
| Frontend | React + TypeScript + Vite |
| Geospatial | MapLibre / WebGL |
| Backend | Python + FastAPI |
| AI | Google Gemini API |
| Data | SQLite / Public Indian datasets |
| Reports | ReportLab |
| Production | Vertex AI · BigQuery · Firebase · Cloud Run |

---

## Data

Project Unheard is designed around Indian public and realistic datasets.

Potential sources include:

- data.gov.in
- Indian government open-data portals
- Census / demographic datasets
- NFHS datasets
- UDISE+ datasets
- PMGSY and infrastructure datasets
- Other appropriately licensed public datasets

Each dataset is associated with source and coverage metadata.

### Synthetic Demonstration Data

Where real citizen-request data is unavailable, synthetic signals may be used for demonstration.

Synthetic signals are explicitly labelled:

`SYNTHETIC DEMONSTRATION SIGNAL`

They are never presented as real citizen complaints.

---

## Built for India

Project Unheard is designed around:

- District-level intelligence
- Indian public datasets
- Multilingual citizen interaction
- State-agnostic schemas
- Geospatial infrastructure analysis
- Diverse linguistic and demographic regions

The architecture is designed to expand from individual datasets and prototype regions toward nationwide deployment.

---

## Responsible AI

The Unheard Index is an **analytical signal, not proof** that a location is underserved.

The system:

- distinguishes reported demand from inferred need
- exposes supporting indicators
- identifies data sources
- labels synthetic data
- labels projected outcomes
- avoids presenting generated text as verified fact
- surfaces limitations alongside recommendations

Human validation remains necessary before real-world policy decisions.

---

## Desktop Application

Project Unheard is built as a native Windows desktop application using Tauri.

```text
Project Unheard
      │
      └── Unheard.exe
```

The core map, district intelligence, deterministic scoring, and simulation experience are designed to remain usable even when AI services are temporarily unavailable.

---

## Project Structure

```text
Project-Unheard/
│
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── map/
│   │   ├── capture/
│   │   ├── dossier/
│   │   ├── simulation/
│   │   ├── policy/
│   │   └── search/
│   ├── services/
│   ├── data/
│   ├── styles/
│   └── types/
│
├── src-tauri/
│
├── backend/
│   └── app/
│       ├── services/
│       ├── models/
│       ├── schemas/
│       └── data/
│
├── data/
│   ├── districts/
│   ├── indicators/
│   ├── demo/
│   └── metadata/
│
├── docs/
│
├── .env.example
├── THIRD_PARTY.md
└── README.md
```

---

## Getting Started

### Requirements

- Node.js
- npm
- Python 3.x
- Rust
- Tauri prerequisites for Windows

### Install

```bash
git clone <repository-url>
cd Project-Unheard
npm install
```

### Backend

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

### Environment

Create `.env` from:

```text
.env.example
```

Never commit API keys or credentials.

### Run Backend

```bash
uvicorn backend.app.main:app --reload
```

### Run Desktop Application

```bash
npm run tauri dev
```

### Build Windows Application

```bash
npm run tauri build
```

---

## Hackathon

### Build with AI: Code for Communities — Second Edition

**Google Cloud**

Project Unheard addresses the challenge of combining citizen development requests with demographic, infrastructure, and public-data signals to surface potential development priorities.

The project integrates Google AI through Gemini and is designed for multilingual, India-scale deployment.

---

## Roadmap

```text
[✓] Core intelligence model
[✓] Deterministic Unheard Index
[✓] Geospatial intelligence architecture
[✓] Gemini integration architecture

[ ] Expanded Indian datasets
[ ] Additional Indian languages
[ ] Messaging-platform ingestion
[ ] Large-scale BigQuery deployment
[ ] Vertex AI production deployment
[ ] Government workflow integrations
```

---

## License

This project is licensed under the **MIT License**.

See [LICENSE](LICENSE) for details.

---

<div align="center">

## PROJECT UNHEARD

**Finding the needs no one reported.**

Built for India. Designed to scale.

</div>
