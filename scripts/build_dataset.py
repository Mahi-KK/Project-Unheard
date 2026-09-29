"""Build the UNHEARD district dataset.

Inputs  (data/raw, fetched by scripts/fetch_data.py):
  nfhs5_districts.csv            NFHS-5 district factsheet values (long format)
  census2011_districts.csv       Census 2011 district tables
  india-districts-2019-734.json  District boundaries (TopoJSON)
Metadata (data/metadata): model.json, name_overrides.json, sources.json
Output:
  data/processed/districts.json      full dataset + model stats
  data/processed/match_report.json   every join decision, for audit
  public/data/districts.json         copy for the desktop UI
  public/data/districts.topo.json    boundaries with district ids

Run:  python scripts/build_dataset.py
Everything is deterministic: same inputs -> byte-identical outputs.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT / "backend"))

from app.utils.geo_match import best_fuzzy, norm_district, norm_state  # noqa: E402
from app.services import scoring_service as S  # noqa: E402

RAW = ROOT / "data" / "raw"
META = ROOT / "data" / "metadata"
OUT = ROOT / "data" / "processed"
PUBLIC = ROOT / "public" / "data"
TOPO_KEY = "india-districts-2019-734"


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def fnum(x: str | None) -> float | None:
    if x is None:
        return None
    x = x.strip()
    if x in ("", "NA", "na", "*"):
        return None
    try:
        return float(x)
    except ValueError:
        return None


# ---------------------------------------------------------------- topojson
def decode_arcs(topo: dict) -> list[list[tuple[float, float]]]:
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring_coords(ring: list[int], arcs) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for idx in ring:
        pts = arcs[idx] if idx >= 0 else list(reversed(arcs[~idx]))
        out.extend(pts if not out else pts[1:])
    return out


def polygon_area_centroid(ring):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    a *= 0.5
    if abs(a) < 1e-12:
        xs, ys = zip(*ring)
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return abs(a), cx / (6 * a), cy / (6 * a)


def geometry_summary(geom: dict, arcs) -> dict:
    polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
    best = (0.0, 0.0, 0.0)
    xs, ys = [], []
    for poly in polys:
        outer = ring_coords(poly[0], arcs)
        for x, y in outer:
            xs.append(x)
            ys.append(y)
        area, cx, cy = polygon_area_centroid(outer)
        if area > best[0]:
            best = (area, cx, cy)
    return {"lng": round(best[1], 5), "lat": round(best[2], 5), "bbox": [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]}


# ---------------------------------------------------------------- loaders
def load_nfhs(model: dict) -> dict[tuple[str, str], dict[str, float | None]]:
    wanted = {d["nfhs_no"]: d["key"] for d in model["indicators"] + model["vulnerability_indicators"] if d.get("nfhs_no")}
    out: dict[tuple[str, str], dict[str, float | None]] = defaultdict(dict)
    with open(RAW / "nfhs5_districts.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m = re.match(r"^\s*(\d+)\.", row["Indicator"])
            if not m:
                continue
            key = wanted.get(int(m.group(1)))
            rec = out[(row["state"], row["district"])]
            if key and key not in rec:  # first occurrence wins (dataset has a few duplicate rows)
                rec[key] = fnum(row["NFHS5"])
    return out


def load_census() -> list[dict]:
    rows = []
    with open(RAW / "census2011_districts.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pop = fnum(r["Population"])
            hh = fnum(r["Households"])
            sc, st = fnum(r["SC"]), fnum(r["ST"])
            rural = fnum(r["Rural_Households"])
            phone = fnum(r["Households_with_Telephone_Mobile_Phone"])
            away = fnum(r["Location_of_drinking_water_source_Away_Households"])
            rows.append({
                "state": r["State name"],
                "district": r["District name"],
                "population": pop,
                "water_away": (away / hh * 100) if away is not None and hh else None,
                "sc_st_share": ((sc or 0) + (st or 0)) / pop * 100 if pop else None,
                "rural_share": (rural / hh * 100) if rural is not None and hh else None,
                "phone_share": (phone / hh) if phone is not None and hh else None,
            })
    return rows


# ---------------------------------------------------------------- synthetic demand
def stable_seed(base: int, key: str) -> int:
    return base ^ int(hashlib.sha256(key.encode()).hexdigest()[:12], 16)


def poisson_like(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam < 30:  # Knuth
        l, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= rng.random()
            if p <= l:
                return k
            k += 1
    return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))


def generate_signals(d: dict, model: dict, templates: dict, digital: float, urban: float) -> None:
    cfg = model["synthetic_demand"]
    rng = random.Random(stable_seed(cfg["seed"], d["id"]))
    propensity = (0.35 + 1.3 * digital) * (0.7 + 0.6 * urban)
    signals = {}
    for cat in S.CATEGORIES:
        cn = d["category_need"].get(cat)
        need_factor = 0.8 + 0.4 * ((cn if cn is not None else 50.0) / 100.0)
        lam = cfg["base_reports_per_100k"][cat] * (d["population_for_rates"] / 100_000) * propensity * need_factor
        signals[cat] = poisson_like(rng, lam)
    d["signals"] = signals
    langs = templates["language_by_state"].get(d["state"], ["en"])
    ranked = sorted(S.CATEGORIES, key=lambda c: -signals[c])
    samples = []
    for i, cat in enumerate(ranked[:3]):
        lang = langs[i % len(langs)]
        pool = templates["templates"][cat][lang]
        samples.append({"id": f"syn-{d['id']}-{i}", "category": cat, "language": lang, "text": pool[rng.randrange(len(pool))], "synthetic": True})
    d["synthetic_samples"] = samples


# ---------------------------------------------------------------- main
def main() -> None:
    model = load_json(META / "model.json")
    all_overrides = load_json(META / "name_overrides.json")
    overrides = {k: v for k, v in all_overrides.items() if not k.startswith("_")}
    census_overrides = {k: v for k, v in all_overrides.get("_census", {}).items() if not k.startswith("_")}
    templates = load_json(ROOT / "data" / "demo" / "synthetic_templates.json")
    sources = load_json(META / "sources.json")
    topo = load_json(RAW / "india-districts-2019-734.json")
    geoms = topo["objects"][TOPO_KEY]["geometries"]
    arcs = decode_arcs(topo)

    report = {"nfhs_exact": 0, "nfhs_override": [], "nfhs_fuzzy": [], "nfhs_unmatched": [], "census_matched": 0, "census_fuzzy": [], "census_unmatched": [], "boundary_without_data": []}

    # boundary index
    by_state: dict[str, dict[str, int]] = defaultdict(dict)
    by_state_name: dict[str, dict[str, int]] = defaultdict(dict)
    for i, g in enumerate(geoms):
        p = g["properties"]
        by_state[norm_state(p["st_nm"])][norm_district(p["district"])] = i
        by_state_name[norm_state(p["st_nm"])][p["district"]] = i

    # NFHS -> boundary
    nfhs = load_nfhs(model)
    nfhs_for: dict[int, tuple[str, str]] = {}
    for (st, dn), vals in sorted(nfhs.items()):
        ns = norm_state(st)
        idx = by_state.get(ns, {}).get(norm_district(dn))
        if idx is not None:
            report["nfhs_exact"] += 1
        elif f"{st}|{dn}" in overrides:
            idx = by_state_name[ns].get(overrides[f"{st}|{dn}"])
            if idx is not None:
                report["nfhs_override"].append([st, dn, geoms[idx]["properties"]["district"]])
        else:
            idx = best_fuzzy(norm_district(dn), by_state.get(ns, {}))
            if idx is not None:
                report["nfhs_fuzzy"].append([st, dn, geoms[idx]["properties"]["district"]])
        if idx is None:
            report["nfhs_unmatched"].append([st, dn])
            continue
        if idx in nfhs_for:
            raise SystemExit(f"Two NFHS districts matched one polygon: {nfhs_for[idx]} and {(st, dn)}")
        nfhs_for[idx] = (st, dn)

    # Census -> boundary (only polygons unchanged since Census 2011)
    census_for: dict[int, dict] = {}
    override_by_name = {k.split("|", 1)[1]: v for k, v in overrides.items()}
    old_state: dict[str, dict[str, int]] = defaultdict(dict)
    for i, g in enumerate(geoms):
        p = g["properties"]
        if p["year"] == "2011_c":
            old_state[norm_state(p["st_nm"])][norm_district(p["district"])] = i
    for row in load_census():
        ckey = f"{row['state']}|{row['district']}"
        if ckey in census_overrides:
            target = census_overrides[ckey]
            idx = None if target is None else old_state.get(norm_state(target[0]), {}).get(norm_district(target[1]))
            if idx is None or idx in census_for:
                report["census_unmatched"].append([row["state"], row["district"]])
            else:
                census_for[idx] = row
                report["census_matched"] += 1
            continue
        ns = norm_state(row["state"].title())
        cands = old_state.get(ns, {})
        idx = cands.get(norm_district(row["district"]))
        if idx is None and row["district"] in override_by_name:
            idx = cands.get(norm_district(override_by_name[row["district"]]))
        if idx is None:
            idx = best_fuzzy(norm_district(row["district"]), cands)
            if idx is not None:
                report["census_fuzzy"].append([row["state"], row["district"], geoms[idx]["properties"]["district"]])
        if idx is None or idx in census_for:
            report["census_unmatched"].append([row["state"], row["district"]])
            continue
        census_for[idx] = row
        report["census_matched"] += 1

    # assemble district records
    districts = []
    for i, g in enumerate(geoms):
        p = g["properties"]
        state = p["st_nm"]
        did = f"{slug(state)}--{slug(p['district'])}"
        c = census_for.get(i)
        n = nfhs_for.get(i)
        raw: dict[str, float | None] = {}
        if n:
            raw.update(nfhs[n])
        for k in ("water_away", "sc_st_share", "rural_share"):
            raw[k] = c[k] if c else None
        for d in model["indicators"] + model["vulnerability_indicators"]:
            raw.setdefault(d["key"], None)
        rec = {
            "id": did,
            "name": p["district"],
            "state": state,
            "state_code": p.get("st_code"),
            **geometry_summary(g, arcs),
            "boundary_year": p["year"],
            "nfhs_name": n[1] if n else None,
            "census_name": c["district"] if c else None,
            "population": c["population"] if c else None,
            "population_status": "census2011" if c else "unavailable",
            "raw": {k: (None if v is None else round(v, 4)) for k, v in raw.items()},
            "_phone": c["phone_share"] if c else None,
            "data_status": "scored" if n else "insufficient",
            "signals": {cat: 0 for cat in S.CATEGORIES},
        }
        if not n:
            report["boundary_without_data"].append([state, p["district"]])
        districts.append(rec)

    # population used as a signal-rate denominator: census where available,
    # otherwise the state median of census districts (flagged as imputed)
    state_pops: dict[str, list[float]] = defaultdict(list)
    for d in districts:
        if d["population"]:
            state_pops[d["state"]].append(d["population"])
    all_pops = [x for v in state_pops.values() for x in v]
    for d in districts:
        if d["population"]:
            d["population_for_rates"] = d["population"]
            d["population_imputed"] = False
        else:
            d["population_for_rates"] = statistics.median(state_pops.get(d["state"]) or all_pops)
            d["population_imputed"] = True

    scored = [d for d in districts if d["data_status"] == "scored"]
    stats = S.score_all(scored, model)  # first pass: need only (signals all zero)

    state_phone: dict[str, list[float]] = defaultdict(list)
    for d in scored:
        if d["_phone"] is not None:
            state_phone[d["state"]].append(d["_phone"])
    all_phone = [x for v in state_phone.values() for x in v]
    for d in scored:
        digital = d["_phone"] if d["_phone"] is not None else statistics.median(state_phone.get(d["state"]) or all_phone)
        rural = d["raw"].get("rural_share")
        urban = 1 - (rural if rural is not None else 75.0) / 100
        generate_signals(d, model, templates, digital, urban)
    S.apply_demand(scored)

    for d in districts:
        d.pop("_phone", None)
        if d["data_status"] != "scored":
            d.update({"category_need": None, "vulnerability": None, "exposure": None, "need_by_category": None, "need_score": None,
                      "signal_rate": None, "demand_by_category": None, "unheard_by_category": None, "signal_rate_total": None,
                      "demand_score": None, "unheard_index": None, "confidence": 0.0, "synthetic_samples": []})
        d["sources"] = ["nfhs5"] * bool(d["nfhs_name"]) + ["census2011"] * bool(d["census_name"]) + ["boundaries", "synthetic_demand"]

    ranked = sorted((d for d in scored), key=lambda d: -d["unheard_index"])
    for rank, d in enumerate(ranked, 1):
        d["unheard_rank"] = rank

    def rnd(x):
        if isinstance(x, float):
            return round(x, 4)
        if isinstance(x, dict):
            return {k: rnd(v) for k, v in x.items()}
        if isinstance(x, list):
            return [rnd(v) for v in x]
        return x

    dataset = {
        "meta": {
            "model_version": model["version"],
            "dataset_version": "2026-09-29",
            "district_count": len(districts),
            "scored_count": len(scored),
            "insufficient_count": len(districts) - len(scored),
            "population_unavailable_count": sum(1 for d in districts if not d["population"]),
            "stats": rnd(stats),
            "model": model,
            "sources": sources,
        },
        "districts": [rnd(d) for d in districts],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    body = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    (OUT / "districts.json").write_text(body, encoding="utf-8")
    (PUBLIC / "districts.json").write_text(body, encoding="utf-8")
    (OUT / "match_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    # boundaries with ids only (keeps the UI payload small)
    for g, d in zip(geoms, districts):
        g["properties"] = {"id": d["id"], "name": d["name"], "state": d["state"]}
    (PUBLIC / "districts.topo.json").write_text(json.dumps(topo, separators=(",", ":")), encoding="utf-8")

    print(f"districts={len(districts)} scored={len(scored)} insufficient={len(districts) - len(scored)}")
    print(f"nfhs exact={report['nfhs_exact']} override={len(report['nfhs_override'])} fuzzy={len(report['nfhs_fuzzy'])} unmatched={len(report['nfhs_unmatched'])}")
    print(f"census matched={report['census_matched']} unmatched={len(report['census_unmatched'])}; population unavailable={dataset['meta']['population_unavailable_count']}")
    print("top 10 unheard:", [(d["name"], d["state"], round(d["unheard_index"], 1)) for d in ranked[:10]])


if __name__ == "__main__":
    main()
