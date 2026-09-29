"""Deterministic WHAT-IF intervention simulator.

All outputs are PROJECTED / MODELLED. Assumptions are returned with every
result so the UI and the policy brief can state them verbatim.

    facilities        = explicit count, or floor(investment_cr / unit_cost_cr)
    people_covered    = min(deficit_population, facilities * capacity)
    deficit_population= population * (1 - primary_indicator / 100)
    new_primary       = primary + people_covered / population * 100
    -> category deficit, need, unheard recomputed with the production scoring
       engine against the same national min/max. Demand is held constant.

The TypeScript mirror (src/features/simulation/simulate.ts) must match this
file; tests/test_parity.py + src/features/simulation/simulate.test.ts share
data/demo/simulation_fixture.json.
"""
from __future__ import annotations

import math
from typing import Any

from . import scoring_service as S


class SimulationUnavailable(Exception):
    pass


def simulate(d: dict[str, Any], meta: dict[str, Any], category: str, facilities: int | None = None,
             capacity_per_facility: int | None = None, investment_cr: float | None = None) -> dict[str, Any]:
    model = meta["model"]
    if d.get("data_status") != "scored":
        raise SimulationUnavailable("No indicator data for this district.")
    pop = d.get("population")
    if not pop:
        raise SimulationUnavailable("Census 2011 population is unavailable for this district boundary, so people covered cannot be modelled.")
    spec = model["interventions"][category]
    key = spec["primary_indicator"]
    primary = d["raw"].get(key)
    if primary is None:
        raise SimulationUnavailable(f"Primary indicator '{key}' is missing for this district.")

    capacity = int(capacity_per_facility or spec["default_capacity"])
    if facilities is None:
        facilities = int(math.floor((investment_cr or 0.0) / spec["unit_cost_cr"] + 1e-9))
    investment = facilities * spec["unit_cost_cr"]

    stats = {k: S.IndicatorStat(k, v["min"], v["max"], v["direction"]) for k, v in meta["stats"]["indicator_stats"].items()}
    deficit_pop = pop * (1 - primary / 100.0)
    covered = min(deficit_pop, float(facilities * capacity))
    new_primary = min(100.0, primary + covered / pop * 100.0)

    raw_after = dict(d["raw"])
    raw_after[key] = new_primary

    cn_before = S.category_needs(d["raw"], model, stats)
    cn_after = S.category_needs(raw_after, model, stats)
    vul, exp = d["vulnerability"], d["exposure"]
    need_cat_after = S.compose_need(cn_after[category], vul, exp, model)
    need_after = S.compose_need(S.overall_category_need(cn_after, model), vul, exp, model)

    demand_cat = d["demand_by_category"][category]
    demand = d["demand_score"]
    before = {
        "primary_value": primary,
        "category_deficit": cn_before[category],
        "need_category": d["need_by_category"][category],
        "need": d["need_score"],
        "unheard_category": d["unheard_by_category"][category],
        "unheard": d["unheard_index"],
        "deficit_population": deficit_pop,
    }
    after = {
        "primary_value": new_primary,
        "category_deficit": cn_after[category],
        "need_category": need_cat_after,
        "need": need_after,
        "unheard_category": S.unheard(need_cat_after, demand_cat),
        "unheard": S.unheard(need_after, demand),
        "deficit_population": deficit_pop - covered,
    }
    return {
        "label": "PROJECTED / MODELLED",
        "district_id": d["id"],
        "category": category,
        "intervention": {
            "label": spec["label"], "unit": spec["unit"], "facilities": facilities, "capacity_per_facility": capacity,
            "investment_cr": round(investment, 2), "unit_cost_cr": spec["unit_cost_cr"], "primary_indicator": key,
        },
        "people_covered": covered,
        "coverage_gain_pct_points": new_primary - primary,
        "before": before,
        "after": after,
        "assumptions": [
            model["intervention_cost_note"],
            f"Each {spec['unit']} serves {capacity:,} people who currently lack the service; coverage is capped at the current deficit population.",
            "Population is Census 2011; growth since 2011 is not modelled.",
            "Citizen-reported demand is held constant; only need changes.",
            "Scores are relative to the 2019-21 range across all scored districts.",
            "Implementation lag, quality and uptake are not modelled.",
        ],
    }
