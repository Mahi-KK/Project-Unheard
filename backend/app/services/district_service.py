"""District data access, deterministic filtering and evidence packets.

The precomputed dataset (data/processed/districts.json) is loaded once.
Signals captured in the app are layered on top of the synthetic baseline
and demand/unheard are recomputed with the same scoring engine.
"""
from __future__ import annotations

import copy
import difflib
import json
import re
import threading
from pathlib import Path
from typing import Any

from . import scoring_service as S
from ..schemas.gemini import MapQuery
from ..utils.geo_match import norm_district, norm_state


class DistrictService:
    def __init__(self, data_path: Path, store):
        raw = json.loads(Path(data_path).read_text(encoding="utf-8"))
        self.meta: dict[str, Any] = raw["meta"]
        self.model: dict[str, Any] = self.meta["model"]
        self._base: list[dict[str, Any]] = raw["districts"]
        self._store = store
        self._lock = threading.Lock()
        self._by_id: dict[str, dict[str, Any]] = {}
        self.refresh()

    # ------------------------------------------------------------ state
    def refresh(self) -> None:
        """Rebuild working copy: synthetic baseline + captured signals."""
        with self._lock:
            work = copy.deepcopy(self._base)
            captured = self._store.list_signals()
            counts: dict[str, dict[str, int]] = {}
            for s in captured:
                counts.setdefault(s["district_id"], {}).setdefault(s["category"], 0)
                counts[s["district_id"]][s["category"]] += 1
            scored = [d for d in work if d["data_status"] == "scored"]
            for d in scored:
                d["captured_signals"] = counts.get(d["id"], {})
                for cat, n in d["captured_signals"].items():
                    d["signals"][cat] = d["signals"].get(cat, 0) + n
            S.apply_demand(scored)
            for rank, d in enumerate(sorted(scored, key=lambda x: (-x["unheard_index"], x["id"])), 1):
                d["unheard_rank"] = rank
            self._by_id = {d["id"]: d for d in work}
            self._work = work

    # ------------------------------------------------------------ reads
    def all(self) -> list[dict[str, Any]]:
        return self._work

    def get(self, district_id: str) -> dict[str, Any] | None:
        return self._by_id.get(district_id)

    def metrics(self) -> list[dict[str, Any]]:
        keys = ("id", "name", "state", "data_status", "need_score", "demand_score", "unheard_index", "unheard_rank",
                "need_by_category", "demand_by_category", "unheard_by_category", "signals", "confidence", "lat", "lng", "population")
        return [{k: d.get(k) for k in keys} for d in self._work]

    def metrics_for(self, district_id: str) -> dict[str, Any] | None:
        return next((m for m in self.metrics() if m["id"] == district_id), None)

    # ------------------------------------------------------------ filtering (deterministic)
    @staticmethod
    def _value(d: dict[str, Any], metric: str, category: str) -> float | None:
        if category in ("all", "roads"):
            return {"unheard": d.get("unheard_index"), "need": d.get("need_score"), "demand": d.get("demand_score")}[metric]
        field = {"unheard": "unheard_by_category", "need": "need_by_category", "demand": "demand_by_category"}[metric]
        return (d.get(field) or {}).get(category)

    def filter(self, q: MapQuery) -> tuple[list[dict[str, Any]], int]:
        states = {norm_state(s) for s in q.states}
        out = []
        for d in self._work:
            if d["data_status"] != "scored":
                continue
            if states and norm_state(d["state"]) not in states:
                continue
            need = self._value(d, "need", q.category)
            demand = self._value(d, "demand", q.category)
            unh = self._value(d, "unheard", q.category)
            if need is None or demand is None or unh is None:
                continue
            if q.need_min is not None and need < q.need_min:
                continue
            if q.need_max is not None and need > q.need_max:
                continue
            if q.demand_min is not None and demand < q.demand_min:
                continue
            if q.demand_max is not None and demand > q.demand_max:
                continue
            if q.unheard_min is not None and unh < q.unheard_min:
                continue
            out.append({"id": d["id"], "name": d["name"], "state": d["state"], "need": need, "demand": demand, "unheard": unh,
                        "lat": d["lat"], "lng": d["lng"], "bbox": d["bbox"]})
        out.sort(key=lambda r: (r[q.sort_by], r["id"]), reverse=(q.sort_order == "desc"))
        return out[: q.limit], len(out)

    # ------------------------------------------------------------ search / resolve
    def search(self, text: str, limit: int = 8) -> list[dict[str, Any]]:
        t = norm_district(text)
        if not t:
            return []
        scored = []
        for d in self._work:
            n = norm_district(d["name"])
            s = difflib.SequenceMatcher(None, t, n).ratio()
            if n.startswith(t):
                s = max(s, 0.9 + 0.1 * len(t) / max(len(n), 1))
            scored.append((s, d))
        scored.sort(key=lambda x: (-x[0], x[1]["id"]))
        return [{"id": d["id"], "name": d["name"], "state": d["state"], "match_score": round(s, 3)} for s, d in scored[:limit] if s >= 0.5]

    def resolve(self, district: str | None, state: str | None, mention: str | None) -> list[dict[str, Any]]:
        """Deterministic resolution of an AI-extracted place mention to dataset
        districts. Returns ranked candidates; the user confirms."""
        names = [x for x in (district, mention) if x]
        if not names:
            return []
        st = norm_state(state) if state else None
        best: dict[str, tuple[float, dict]] = {}
        for name in names:
            t = norm_district(name)
            if not t:
                continue
            for d in self._work:
                n = norm_district(d["name"])
                s = 1.0 if t == n else difflib.SequenceMatcher(None, t, n).ratio()
                if st and norm_state(d["state"]) == st:
                    s += 0.08
                elif st:
                    s -= 0.08
                if s > best.get(d["id"], (0.0, None))[0]:
                    best[d["id"]] = (s, d)
        ranked = sorted(best.values(), key=lambda x: (-x[0], x[1]["id"]))
        return [{"id": d["id"], "name": d["name"], "state": d["state"], "match_score": round(min(s, 1.0), 3)} for s, d in ranked[:3] if s >= 0.72]

    # ------------------------------------------------------------ local query parser (no AI)
    def local_parse(self, text: str) -> MapQuery:
        t = text.lower()
        cat = "all"
        for c, words in {
            "water": ("water", "drinking", "पानी", "ನೀರ"),
            "sanitation": ("sanitation", "toilet", "शौचालय", "ಶೌಚ"),
            "health": ("health", "hospital", "clinic", "स्वास्थ्य", "ಆರೋಗ್ಯ"),
            "education": ("education", "school", "literacy", "शिक्षा", "ಶಾಲೆ"),
            "energy": ("energy", "fuel", "electricity", "power", "lpg", "बिजली"),
            "roads": ("road", "connectivity", "सड़क", "ರಸ್ತೆ"),
        }.items():
            if any(w in t for w in words):
                cat = c
                break
        mode = "unheard"
        if re.search(r"\bneed\b", t) and not re.search(r"demand|report|complain", t):
            mode = "need"
        elif re.search(r"(demand|complain|report)", t) and not re.search(r"\blow", t):
            mode = "demand"
        states = sorted({d["state"] for d in self._work if d["state"].lower() in t})
        summary = f"Keyword match: {mode} ranking" + (f" for {cat}" if cat != "all" else "") + (f" in {', '.join(states)}" if states else "")
        return MapQuery(mode=mode, category=cat, states=states, sort_by=mode, sort_order="desc", limit=10, intent_summary=summary)

    # ------------------------------------------------------------ evidence + interventions
    def evidence(self, district_id: str) -> dict[str, Any] | None:
        d = self.get(district_id)
        if not d or d["data_status"] != "scored":
            return None
        stats = self.meta["stats"]["indicator_stats"]
        sources = self.meta["sources"]
        inds = []
        for spec in self.model["indicators"] + self.model["vulnerability_indicators"]:
            v = d["raw"].get(spec["key"])
            if v is None:
                continue
            st = stats.get(spec["key"])
            dfc = S.deficit(v, S.IndicatorStat(spec["key"], st["min"], st["max"], st["direction"])) if st else None
            inds.append({
                "key": spec["key"], "category": spec.get("category", "vulnerability"), "label": spec["label"], "value": round(v, 1),
                "unit": spec["unit"], "direction": spec["direction"], "source": sources[spec["source_id"]]["short"],
                "year": sources[spec["source_id"]]["year"],
                "deficit_0_100": None if dfc is None else round(dfc, 1),
                "range_across_districts": [round(st["min"], 1), round(st["max"], 1)] if st else None,
            })

        def r(x):
            return None if x is None else round(x, 1)

        captured = d.get("captured_signals") or {}
        return {
            "district": d["name"], "state": d["state"], "district_id": d["id"],
            "population_census_2011": d["population"],
            "population_status": d["population_status"],
            "scores": {
                "need": r(d["need_score"]), "demand_percentile": r(d["demand_score"]), "unheard_index": r(d["unheard_index"]),
                "unheard_rank": d.get("unheard_rank"), "ranked_districts": self.meta["scored_count"],
                "need_by_category": {k: r(v) for k, v in d["need_by_category"].items()},
                "category_deficit": {k: r(v) for k, v in d["category_need"].items()},
                "demand_by_category": {k: r(v) for k, v in d["demand_by_category"].items()},
                "vulnerability": r(d["vulnerability"]), "exposure": r(d["exposure"]), "confidence_pct": r(d["confidence"] * 100),
            },
            "indicators": inds,
            "signals": {
                "synthetic_baseline_total": sum(d["signals"].values()) - sum(captured.values()),
                "captured_in_app": captured,
                "by_category": d["signals"],
                "rate_per_100k_total": r(d["signal_rate_total"]),
                "note": "Baseline counts are SYNTHETIC DEMONSTRATION SIGNALS, not real complaints.",
            },
            "method": "Need = weighted indicator deficits (0-100, relative to all scored districts); Demand = percentile of signals per 100k; Unheard = Need x (1 - Demand/100).",
            "unavailable": ["Road connectivity (not integrated)"],
        }

    def interventions(self, district_id: str) -> list[dict[str, Any]]:
        d = self.get(district_id)
        if not d or d["data_status"] != "scored":
            return []
        cats = sorted(((c, v) for c, v in d["category_need"].items() if v is not None), key=lambda x: (-x[1], x[0]))
        out = []
        for cat, deficit_value in cats[:3]:
            spec = self.model["interventions"][cat]
            key = spec["primary_indicator"]
            out.append({"category": cat, "label": spec["label"], "primary_indicator": key,
                        "primary_value": d["raw"].get(key), "category_deficit": round(deficit_value, 1),
                        "basis": f"Ranked by category deficit ({deficit_value:.1f} / 100) from public indicators."})
        return out
