"""Generate data/demo/parity_fixture.json — expected outputs from the Python
scoring + simulation engines. The TypeScript mirror is tested against it
(src/services/parity.test.ts), guaranteeing the desktop UI's instant
recomputation equals the backend's numbers.

    python backend/tests/make_fixtures.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import scoring_service as S  # noqa: E402
from app.services.simulation_service import simulate  # noqa: E402

EXTRA = {"karnataka--raichur": {"water": 3}, "chhattisgarh--bijapur": {"health": 50, "education": 7}, "delhi--west-delhi": {"energy": 1}}
SIM_CASES = [
    ("chhattisgarh--bijapur", "sanitation", 40, None),
    ("chhattisgarh--bijapur", "water", 10, None),
    ("karnataka--raichur", "water", 25, 1500),
    ("jharkhand--pashchimi-singhbhum", "health", 8, None),
    ("madhya-pradesh--dindori", "education", 0, None),
    ("odisha--malkangiri", "energy", 60, 5000),
]


def build() -> dict:
    ds = json.loads((ROOT / "data" / "processed" / "districts.json").read_text(encoding="utf-8"))
    scored = [copy.deepcopy(d) for d in ds["districts"] if d["data_status"] == "scored"]
    for d in scored:
        for cat, n in EXTRA.get(d["id"], {}).items():
            d["signals"][cat] += n
    S.apply_demand(scored)
    demand = {d["id"]: {"demand": d["demand_score"], "unheard": d["unheard_index"], "demand_water": d["demand_by_category"]["water"],
                        "unheard_health": d["unheard_by_category"]["health"]} for d in scored}

    by_id = {d["id"]: d for d in ds["districts"]}
    sims = []
    for did, cat, fac, cap in SIM_CASES:
        r = simulate(by_id[did], ds["meta"], cat, fac, cap)
        sims.append({"input": {"district_id": did, "category": cat, "facilities": fac, "capacity": cap},
                     "people_covered": r["people_covered"], "before": r["before"], "after": r["after"]})
    return {"extra": EXTRA, "demand": demand, "simulations": sims}


if __name__ == "__main__":
    out = ROOT / "data" / "demo" / "parity_fixture.json"
    out.write_text(json.dumps(build(), indent=1), encoding="utf-8")
    print("wrote", out)
