import base64

from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)
TOP = "chhattisgarh--bijapur"


def test_health_reports_gemini_state():
    h = c.get("/api/health").json()
    assert h["status"] == "ok" and h["gemini_configured"] is False and h["scored"] == 705


def test_gemini_endpoints_fail_truthfully_without_key():
    r = c.post("/api/analyze-request", json={"text": "water problem"})
    assert r.status_code == 503 and r.json()["error_code"] == "gemini_not_configured"
    r = c.post(f"/api/explain/{TOP}")
    assert r.status_code == 503
    r = c.post("/api/policy-brief", json={"district_id": TOP})
    assert r.status_code == 503


def test_analyze_input_validation():
    assert c.post("/api/analyze-request", json={}).status_code == 422
    assert c.post("/api/analyze-request", json={"text": "a", "audio_base64": "AAAA"}).status_code == 422
    assert c.post("/api/analyze-request", json={"text": "x" * 2001}).status_code == 422


def test_map_query_falls_back_to_labelled_local_parse():
    r = c.post("/api/map-query", json={"query": "Where is water need highest but demand lowest?"}).json()
    assert r["parsed_by"] == "local" and "PARSED LOCALLY" in r["note"]
    assert r["query"]["category"] == "water" and len(r["results"]) == 10


def test_unheard_ranking_and_district():
    r = c.get("/api/unheard?limit=3").json()
    assert r["results"][0]["id"] == TOP
    d = c.get(f"/api/district/{TOP}").json()
    assert d["evidence"]["scores"]["unheard_rank"] == 1
    assert c.get("/api/district/nope").status_code == 404


def test_simulate_and_evidence_sheet_pdf():
    s = c.post("/api/simulate", json={"district_id": TOP, "category": "sanitation", "facilities": 20}).json()
    assert s["label"] == "PROJECTED / MODELLED" and s["after"]["unheard"] < s["before"]["unheard"]
    pb = c.post("/api/policy-brief", json={"district_id": TOP, "evidence_sheet_only": True,
                                           "simulation": {"district_id": TOP, "category": "sanitation", "facilities": 20}}).json()
    assert pb["kind"] == "evidence_sheet" and base64.b64decode(pb["pdf_base64"]).startswith(b"%PDF")


def test_signals_change_demand_and_can_be_removed():
    before = c.get("/api/district/karnataka--raichur").json()["district"]["demand_by_category"]["water"]
    sig = c.post("/api/signals", json={"district_id": "karnataka--raichur", "category": "water", "source": "manual", "transcript": "No water"}).json()
    after = c.get("/api/district/karnataka--raichur").json()["district"]["demand_by_category"]["water"]
    assert after > before
    assert c.delete(f"/api/signals/{sig['signal']['id']}").json()["deleted"] is True
    assert c.get("/api/district/karnataka--raichur").json()["district"]["demand_by_category"]["water"] == before


def test_signal_rejected_for_insufficient_district():
    r = c.post("/api/signals", json={"district_id": "chandigarh--chandigarh", "category": "water", "source": "manual", "transcript": "x"})
    assert r.status_code == 422


def test_place_resolution_handles_direction_words_and_old_names():
    from app.main import districts

    assert districts.resolve("West Singhbhum", "Jharkhand", None)[0]["id"] == "jharkhand--pashchimi-singhbhum"
    assert districts.resolve("East Singhbhum", "Jharkhand", None)[0]["id"] == "jharkhand--purbi-singhbhum"
    assert districts.resolve("Bangalore", "Karnataka", None)[0]["id"] == "karnataka--bengaluru"
    assert districts.resolve("Mewat", None, None)[0]["id"] == "haryana--nuh"
