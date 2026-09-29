"""HTTP request/response models (validated inputs, explicit shapes)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from .gemini import Explanation, MapQuery, PolicyBriefText, RequestAnalysis

ScoredCategory = Literal["water", "sanitation", "health", "education", "energy"]

MAX_AUDIO_B64 = 4_000_000  # ~ 90 s of 16 kHz mono 16-bit WAV


class AnalyzeRequestIn(BaseModel):
    text: str | None = Field(default=None, max_length=2000)
    audio_base64: str | None = Field(default=None, max_length=MAX_AUDIO_B64)
    audio_mime: Literal["audio/wav"] = "audio/wav"
    hint_language: str | None = Field(default=None, max_length=8)

    @model_validator(mode="after")
    def one_input(self):
        if bool(self.text and self.text.strip()) == bool(self.audio_base64):
            raise ValueError("Provide exactly one of text or audio_base64")
        return self


class DistrictCandidate(BaseModel):
    id: str
    name: str
    state: str
    match_score: float


class AnalyzeRequestOut(BaseModel):
    analysis: RequestAnalysis
    candidates: list[DistrictCandidate]
    model: str
    cached: bool
    input_mode: Literal["text", "voice"]


class SignalIn(BaseModel):
    district_id: str = Field(max_length=120)
    category: ScoredCategory
    source: Literal["typed", "voice", "manual", "demo"]
    language: str | None = Field(default=None, max_length=8)
    transcript: str = Field(max_length=4000)
    normalized_request: str | None = Field(default=None, max_length=2000)
    summary: str | None = Field(default=None, max_length=400)
    urgency: float | None = Field(default=None, ge=0, le=1)
    analysis: dict[str, Any] | None = None


class MapQueryIn(BaseModel):
    query: str = Field(min_length=3, max_length=400)


class MapQueryOut(BaseModel):
    query: MapQuery
    parsed_by: Literal["gemini", "local"]
    results: list[dict[str, Any]]
    total_matching: int
    model: str | None
    cached: bool
    note: str | None = None


class ExplainOut(BaseModel):
    district_id: str
    explanation: Explanation
    removed_statements: list[str]
    model: str
    cached: bool


class SimulateIn(BaseModel):
    district_id: str = Field(max_length=120)
    category: ScoredCategory
    facilities: int | None = Field(default=None, ge=0, le=500)
    capacity_per_facility: int | None = Field(default=None, ge=50, le=200_000)
    investment_cr: float | None = Field(default=None, ge=0, le=10_000)


class PolicyBriefIn(BaseModel):
    district_id: str = Field(max_length=120)
    simulation: SimulateIn | None = None
    evidence_sheet_only: bool = False


class PolicyBriefOut(BaseModel):
    district_id: str
    brief: PolicyBriefText | None
    removed_statements: list[str]
    model: str | None
    cached: bool
    pdf_base64: str
    filename: str
    kind: Literal["policy_brief", "evidence_sheet"]


class ClusterIn(BaseModel):
    district_id: str = Field(max_length=120)
