import copy
import json

import pytest

from app.services import scoring_service as S
from app.services.simulation_service import SimulationUnavailable, simulate
from conftest import ROOT

DATA = json.loads((ROOT / "data" / "processed" / "districts.json").read_text(encoding="utf-8"))
SCORED = [d for d in DATA["districts"] if d["data_status"] == "scored"]
BY_ID = {d["id"]: d for d in DATA["districts"]}


def test_scores_are_bounded():
    for d in SCORED:
        for k in ("need_score", "demand_score", "unheard_index"):
            assert 0 <= d[k] <= 100, (d["id"], k, d[k])
        for c in S.CATEGORIES:
            v = d["need_by_category"][c]
            assert v is None or 0 <= v <= 100


def test_unheard_formula_holds_for_every_district():
    for d in SCORED:
        assert d["unheard_index"] == pytest.approx(d["need_score"] * (1 - d["demand_score"] / 100), abs=1e-3)


def test_scoring_is_deterministic():
    a = copy.deepcopy(SCORED)
    b = copy.deepcopy(SCORED)
    S.apply_demand(a)
    S.apply_demand(b)
    assert [x["unheard_index"] for x in a] == [x["unheard_index"] for x in b]


def test_insufficient_districts_are_not_scored():
    for d in DATA["districts"]:
        if d["data_status"] == "insufficient":
            assert d["unheard_index"] is None and d["need_score"] is None


def test_percentile_ranks_ties_and_none():
    assert S.percentile_ranks([1, 2, 2, None, 3]) == [12.5, 50.0, 50.0, None, 87.5]
    assert S.percentile_ranks([None]) == [None]


def test_deficit_direction_and_clamp():
    lower = S.IndicatorStat("x", 20, 80, "lower_worse")
    higher = S.IndicatorStat("y", 20, 80, "higher_worse")
    assert S.deficit(20, lower) == 100
    assert S.deficit(80, lower) == 0
    assert S.deficit(80, higher) == 100
    assert S.deficit(120, lower) == 0  # clamped after simulated improvement
    assert S.deficit(None, lower) is None


def test_more_reports_lower_unheard():
    work = copy.deepcopy(SCORED)
    target = next(d for d in work if d["id"] == "karnataka--raichur")
    before = target["unheard_index"]
    target["signals"]["water"] += 500
    S.apply_demand(work)
    assert target["unheard_index"] < before


def test_simulation_monotonic_and_zero():
    d = BY_ID["chhattisgarh--bijapur"]
    prev = None
    for fac in (0, 5, 20, 80):
        r = simulate(d, DATA["meta"], "sanitation", fac)
        if fac == 0:
            assert r["after"]["unheard"] == pytest.approx(r["before"]["unheard"])
            assert r["people_covered"] == 0
        if prev is not None:
            assert r["after"]["unheard"] <= prev + 1e-9
        prev = r["after"]["unheard"]
        assert r["label"] == "PROJECTED / MODELLED"


def test_simulation_caps_at_deficit_population():
    d = BY_ID["chhattisgarh--bijapur"]
    r = simulate(d, DATA["meta"], "water", 10_000)
    assert r["people_covered"] == pytest.approx(r["before"]["deficit_population"])
    assert r["after"]["primary_value"] == pytest.approx(100)


def test_simulation_requires_population():
    d = next(x for x in SCORED if not x["population"])
    with pytest.raises(SimulationUnavailable):
        simulate(d, DATA["meta"], "water", 5)


def test_parity_fixture_is_current():
    """The TS parity test relies on this fixture; regenerate if it drifts."""
    from make_fixtures import build

    fixture = json.loads((ROOT / "data" / "demo" / "parity_fixture.json").read_text(encoding="utf-8"))
    assert build() == fixture
