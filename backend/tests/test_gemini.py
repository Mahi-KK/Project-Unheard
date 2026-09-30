"""Gemini service behaviour with a fake client — no network, no key."""
import asyncio
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.schemas.gemini import MapQuery
from app.services.cache_service import Store
from app.services.gemini_service import GeminiError, GeminiService


class FakeModels:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    async def generate_content(self, **kw):
        self.calls += 1
        self.models_seen = getattr(self, 'models_seen', []) + [kw.get('model')]
        r = self.replies.pop(0) if self.replies else self.replies_last
        if isinstance(r, Exception):
            raise r
        if r == "SLOW":
            await asyncio.sleep(10)
        return SimpleNamespace(text=r)


def make_service(tmp_path: Path, replies, timeout=2.0, retries=1, fallbacks=None):
    s = replace(get_settings(), gemini_api_key="test-key", gemini_timeout_s=timeout, gemini_max_retries=retries,
                gemini_fallback_models=fallbacks or [], gemini_total_budget_s=30)
    svc = GeminiService(s, Store(tmp_path / "t.db"))
    models = FakeModels(replies)
    fake = SimpleNamespace(aio=SimpleNamespace(models=models))
    svc._get_client = lambda: fake
    return svc, models


VALID = json.dumps({"mode": "unheard", "category": "water", "states": [], "sort_by": "unheard", "sort_order": "desc", "limit": 10,
                    "intent_summary": "Water unheard ranking", "need_min": None, "need_max": None, "demand_min": None,
                    "demand_max": 30, "unheard_min": None})


def test_valid_response_is_validated_and_cached(tmp_path):
    svc, models = make_service(tmp_path, [VALID])
    q, cached, _ = asyncio.run(svc.map_query("water need low demand", ["Karnataka"]))
    assert isinstance(q, MapQuery) and q.demand_max == 30 and not cached
    q2, cached2, _ = asyncio.run(svc.map_query("water need low demand", ["Karnataka"]))
    assert cached2 and models.calls == 1


def test_malformed_json_retries_then_fails(tmp_path):
    svc, models = make_service(tmp_path, ["{not json", '{"mode": "bogus"}'], retries=1)
    with pytest.raises(GeminiError) as e:
        asyncio.run(svc.map_query("x" * 5, []))
    assert e.value.code == "gemini_malformed" and models.calls == 2


def test_malformed_then_valid_recovers(tmp_path):
    svc, _ = make_service(tmp_path, ["{oops", VALID], retries=1)
    q, _, _ = asyncio.run(svc.map_query("recover please", []))
    assert q.category == "water"


def test_timeout(tmp_path):
    svc, _ = make_service(tmp_path, ["SLOW"], timeout=0.2, retries=0)
    svc.settings = replace(svc.settings, gemini_timeout_s=0.2)
    with pytest.raises(GeminiError) as e:
        asyncio.run(svc.map_query("slow query", []))
    assert e.value.code == "gemini_timeout"


def test_not_configured(tmp_path):
    s = replace(get_settings(), gemini_api_key=None, use_vertex=False)
    svc = GeminiService(s, Store(tmp_path / "t.db"))
    with pytest.raises(GeminiError) as e:
        asyncio.run(svc.map_query("anything", []))
    assert e.value.code == "gemini_not_configured" and e.value.status == 503


def test_rate_limit_falls_back_to_next_model(tmp_path):
    from google.genai import errors

    quota = errors.ClientError(429, {"error": {"code": 429, "message": "quota exceeded", "status": "RESOURCE_EXHAUSTED"}})
    svc, models = make_service(tmp_path, [quota, VALID], retries=0, fallbacks=["fallback-model"])
    q, cached, used = asyncio.run(svc.map_query("fallback please", []))
    assert q.category == "water" and not cached and used == "fallback-model"
    assert models.models_seen == [svc.settings.gemini_model, "fallback-model"]


def test_retry_delay_parsing():
    from app.services.gemini_service import _retry_delay

    assert _retry_delay("... 'retryDelay': '17s' ...") == 17.0
    assert _retry_delay("no hint") == 0.0
