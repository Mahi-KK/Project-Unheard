"""Deterministic Unheard Index scoring engine.

This module is the single source of truth for every score shown in UNHEARD.
It never calls an AI model. Gemini may *explain* these numbers; it never
produces them.

Model (weights live in data/metadata/model.json):

    deficit_i        = direction-corrected min-max of indicator i, 0..100
                       (100 = worst district observed in the dataset)
    category_need_c  = weighted mean of available deficits in category c
    vulnerability    = weighted mean of demographic vulnerability deficits
    exposure         = min-max of log10(population), 0..100
    need_c           = w_cat * category_need_c + w_vul * vulnerability + w_exp * exposure
    need             = same, using the category-weighted mean of category needs
    demand_c         = percentile rank (0..100) of signals per 100k population
    unheard_c        = need_c * (1 - demand_c / 100)

Missing components are dropped and remaining weights re-normalised; the
share of components present is reported as `confidence`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

CATEGORIES = ("water", "sanitation", "health", "education", "energy")


def r1(x: float | None) -> float | None:
    """Round to 1 decimal place, half away from zero (matches the TS mirror)."""
    if x is None:
        return None
    return math.copysign(math.floor(abs(x) * 10 + 0.5) / 10, x)


@dataclass(frozen=True)
class IndicatorStat:
    key: str
    min: float
    max: float
    direction: str  # "lower_worse" | "higher_worse"


def indicator_stats(values_by_key: dict[str, list[float | None]], defs: Iterable[dict]) -> dict[str, IndicatorStat]:
    stats: dict[str, IndicatorStat] = {}
    for d in defs:
        vals = [v for v in values_by_key.get(d["key"], []) if v is not None]
        if not vals:
            continue
        stats[d["key"]] = IndicatorStat(d["key"], min(vals), max(vals), d["direction"])
    return stats


def deficit(raw: float | None, stat: IndicatorStat | None) -> float | None:
    """0..100 where 100 is the worst observed value. Values outside the
    observed range (e.g. after a simulated intervention) are clamped."""
    if raw is None or stat is None:
        return None
    span = stat.max - stat.min
    if span <= 0:
        return 0.0
    x = (raw - stat.min) / span
    if stat.direction == "lower_worse":
        x = 1.0 - x
    return max(0.0, min(100.0, x * 100.0))


def weighted_mean(pairs: Iterable[tuple[float | None, float]]) -> float | None:
    num = 0.0
    den = 0.0
    for value, weight in pairs:
        if value is None or weight <= 0:
            continue
        num += value * weight
        den += weight
    return None if den == 0 else num / den


def category_needs(raw: dict[str, float | None], model: dict, stats: dict[str, IndicatorStat]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for cat in CATEGORIES:
        defs = [d for d in model["indicators"] if d["category"] == cat]
        out[cat] = weighted_mean((deficit(raw.get(d["key"]), stats.get(d["key"])), d["weight"]) for d in defs)
    return out


def vulnerability(raw: dict[str, float | None], model: dict, stats: dict[str, IndicatorStat]) -> float | None:
    return weighted_mean(
        (deficit(raw.get(d["key"]), stats.get(d["key"])), d["weight"]) for d in model["vulnerability_indicators"]
    )


def exposure(population: float | None, pop_log_min: float, pop_log_max: float) -> float | None:
    if not population or population <= 0 or pop_log_max <= pop_log_min:
        return None
    x = (math.log10(population) - pop_log_min) / (pop_log_max - pop_log_min)
    return max(0.0, min(100.0, x * 100.0))


def compose_need(cat_need: float | None, vul: float | None, exp: float | None, model: dict) -> float | None:
    w = model["composite_weights"]
    if cat_need is None:
        return None  # no evidence of need at all: refuse to score
    return weighted_mean(((cat_need, w["category_need"]), (vul, w["vulnerability"]), (exp, w["exposure"])))


def overall_category_need(cat_needs: dict[str, float | None], model: dict) -> float | None:
    cw = model["category_weights"]
    return weighted_mean((cat_needs.get(c), cw.get(c, 1.0)) for c in CATEGORIES)


def percentile_ranks(values: list[float | None]) -> list[float | None]:
    """Mid-rank percentile, 0..100. Deterministic, tie-aware."""
    present = sorted(v for v in values if v is not None)
    n = len(present)
    out: list[float | None] = []
    for v in values:
        if v is None or n == 0:
            out.append(None)
            continue
        below = _bisect_left(present, v)
        equal = _bisect_right(present, v) - below
        out.append(100.0 * (below + 0.5 * equal) / n)
    return out


def _bisect_left(a: list[float], x: float) -> int:
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo


def _bisect_right(a: list[float], x: float) -> int:
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if x < a[mid]:
            hi = mid
        else:
            lo = mid + 1
    return lo


def unheard(need: float | None, demand: float | None) -> float | None:
    if need is None or demand is None:
        return None
    return need * (1.0 - demand / 100.0)


def signal_rate(count: int, population: float | None) -> float | None:
    if not population or population <= 0:
        return None
    return count / population * 100_000.0


def score_all(districts: list[dict[str, Any]], model: dict) -> dict[str, Any]:
    """Score every district in place. Each district needs:
        raw: {indicator_key: value|None}  (indicators + vulnerability keys)
        population: float|None, population_for_rates: float|None
        signals: {category: int}
    Returns the model statistics used (stored alongside the dataset so the
    UI and the simulator can recompute identically)."""
    all_defs = list(model["indicators"]) + list(model["vulnerability_indicators"])
    values_by_key: dict[str, list[float | None]] = {d["key"]: [] for d in all_defs}
    for d in districts:
        for k in values_by_key:
            values_by_key[k].append(d["raw"].get(k))
    stats = indicator_stats(values_by_key, all_defs)

    pops = [math.log10(d["population"]) for d in districts if d.get("population")]
    pop_log_min, pop_log_max = (min(pops), max(pops)) if pops else (0.0, 0.0)

    for d in districts:
        cn = category_needs(d["raw"], model, stats)
        vul = vulnerability(d["raw"], model, stats)
        exp = exposure(d.get("population"), pop_log_min, pop_log_max)
        d["category_need"] = cn
        d["vulnerability"] = vul
        d["exposure"] = exp
        d["need_by_category"] = {c: compose_need(cn[c], vul, exp, model) for c in CATEGORIES}
        d["need_score"] = compose_need(overall_category_need(cn, model), vul, exp, model)

    apply_demand(districts)

    total_components = len(all_defs) + 1  # + population
    for d in districts:
        present = sum(1 for k in values_by_key if d["raw"].get(k) is not None) + (1 if d.get("population") else 0)
        d["confidence"] = present / total_components

    return {
        "indicator_stats": {k: {"min": s.min, "max": s.max, "direction": s.direction} for k, s in stats.items()},
        "pop_log_min": pop_log_min,
        "pop_log_max": pop_log_max,
    }


def apply_demand(districts: list[dict[str, Any]]) -> None:
    """(Re)compute demand percentiles + unheard. Called at build time and
    again whenever captured signals change the counts."""
    for cat in CATEGORIES:
        rates = [signal_rate(d["signals"].get(cat, 0), d.get("population_for_rates")) for d in districts]
        ranks = percentile_ranks(rates)
        for d, rate, rank in zip(districts, rates, ranks):
            d.setdefault("signal_rate", {})[cat] = rate
            d.setdefault("demand_by_category", {})[cat] = rank
            d.setdefault("unheard_by_category", {})[cat] = unheard(d["need_by_category"][cat], rank)
    totals = [signal_rate(sum(d["signals"].values()), d.get("population_for_rates")) for d in districts]
    for d, rate, rank in zip(districts, totals, percentile_ranks(totals)):
        d["signal_rate_total"] = rate
        d["demand_score"] = rank
        d["unheard_index"] = unheard(d["need_score"], rank)
