"""Live Gemini smoke test (calls the real API; needs GEMINI_API_KEY).

Not collected by pytest (no test_ prefix). Run:
    backend/.venv/Scripts/python backend/tests/live_smoke.py
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["UNHEARD_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "live.db")  # isolated, no cache reuse

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

c = TestClient(app)
results: list[tuple[str, bool, str]] = []


def check(name: str, fn):
    time.sleep(4)  # stay under per-minute limits on free-tier keys
    t = time.time()
    try:
        detail = fn()
        results.append((name, True, f"{time.time() - t:.1f}s {detail}"))
    except Exception as e:  # noqa: BLE001
        results.append((name, False, f"{type(e).__name__}: {str(e)[:300]}"))


def ok(r):
    if r.status_code != 200:
        raise AssertionError(f"HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


SAMPLES = {
    "kn": "ರಾಯಚೂರು ಜಿಲ್ಲೆಯ ನಮ್ಮ ಹಳ್ಳಿಯಲ್ಲಿ ಬೇಸಿಗೆಯಲ್ಲಿ ಕುಡಿಯುವ ನೀರಿನ ಸಮಸ್ಯೆ ತುಂಬಾ ಆಗುತ್ತದೆ. ಕೊಳವೆ ಬಾವಿ ಕೆಟ್ಟು ಹೋಗಿದೆ.",
    "hi": "पश्चिमी सिंहभूम ज़िले के हमारे गाँव से प्राथमिक स्वास्थ्य केंद्र बहुत दूर है, गर्भवती महिलाओं को बहुत परेशानी होती है।",
    "en": "In Nuh district, girls in our village stop going to school after class 8 because the nearest high school is far away.",
}
EXPECT = {"kn": ("water", "karnataka--raichur"), "hi": ("health", "jharkhand--pashchimi-singhbhum"), "en": ("education", "haryana--nuh")}

print("health:", json.dumps(ok(c.get("/api/health"))))

for lang, text in SAMPLES.items():
    def run(lang=lang, text=text):
        out = ok(c.post("/api/analyze-request", json={"text": text}))
        a = out["analysis"]
        cat, did = EXPECT[lang]
        cand = out["candidates"][0]["id"] if out["candidates"] else None
        assert a["language"] == lang, f"language {a['language']}"
        assert a["category"] == cat, f"category {a['category']}"
        assert cand == did, f"district {cand}"
        return f"lang={a['language']} cat={a['category']} district={cand} urgency={a['urgency']} | {a['normalized_request'][:90]}"
    check(f"analyze text [{lang}]", run)

for q in ["Where is water need highest but citizen demand lowest?", "Show districts with high education need in Bihar", "Sanitation need in Odisha and Jharkhand with little reporting"]:
    def run(q=q):
        out = ok(c.post("/api/map-query", json={"query": q}))
        assert out["parsed_by"] == "gemini", out.get("note")
        f = out["query"]
        return f"mode={f['mode']} cat={f['category']} states={f['states']} → {out['total_matching']} matches, top={out['results'][0]['name'] if out['results'] else '-'}"
    check(f"map-query: {q[:40]}", run)


def explain():
    out = ok(c.post("/api/explain/chhattisgarh--bijapur"))
    e = out["explanation"]
    assert e["need_drivers"], "no drivers"
    return f"drivers={len(e['need_drivers'])} removed={len(out['removed_statements'])} | {e['headline'][:100]}"


check("explain Bijapur", explain)


def brief():
    out = ok(c.post("/api/policy-brief", json={"district_id": "chhattisgarh--bijapur",
                                               "simulation": {"district_id": "chhattisgarh--bijapur", "category": "sanitation", "facilities": 40}}))
    pdf = base64.b64decode(out["pdf_base64"])
    assert out["kind"] == "policy_brief" and pdf.startswith(b"%PDF")
    Path(tempfile.gettempdir(), "unheard-live-brief.pdf").write_bytes(pdf)
    return f"title='{out['brief']['title'][:70]}' pdf={len(pdf) // 1024}KB removed={len(out['removed_statements'])}"


check("policy brief + PDF", brief)


def cluster():
    for t in ["No drinking water in summer, borewell broken", "Borewell has failed and there is no water to drink", "The school has no teachers"]:
        ok(c.post("/api/signals", json={"district_id": "karnataka--raichur", "category": "water", "source": "manual", "transcript": t}))
    out = ok(c.post("/api/cluster-signals", json={"district_id": "karnataka--raichur"}))
    return f"{len(out['clusters'])} clusters from {sum(len(x['members']) for x in out['clusters'])} requests"


check("embeddings: cluster + duplicate check", cluster)


def audio():
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    tts = client.models.generate_content(
        model="gemini-3.8-flash-tts",
        contents="Read aloud in Kannada: " + SAMPLES["kn"],
        config=types.GenerateContentConfig(response_modalities=["AUDIO"],
                                           speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")))),
    )
    pcm = tts.candidates[0].content.parts[0].inline_data.data  # 24 kHz 16-bit mono PCM
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    out = ok(c.post("/api/analyze-request", json={"audio_base64": base64.b64encode(buf.getvalue()).decode()}))
    a = out["analysis"]
    cand = out["candidates"][0]["id"] if out["candidates"] else None
    assert a["language"] == "kn" and a["category"] == "water"
    return f"voice→ lang={a['language']} cat={a['category']} district={cand} transcript='{a['transcript'][:60]}'"


check("voice (Gemini-TTS Kannada WAV → analyze)", audio)

print()
for name, passed, detail in results:
    print(("PASS" if passed else "FAIL"), name, "—", detail)
print(f"\n{sum(p for _, p, _ in results)}/{len(results)} passed")
