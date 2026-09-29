"""Schemas Gemini must fill. They double as `response_schema` for the
Gemini API and as strict Pydantic validators for whatever comes back.
Nothing produced by Gemini is used until it passes these models."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Category = Literal["water", "sanitation", "health", "education", "energy", "roads", "other"]
ScoredCategory = Literal["water", "sanitation", "health", "education", "energy"]


class Entity(BaseModel):
    type: Literal["place", "facility", "organisation", "person_role", "time", "quantity", "other"]
    text: str = Field(max_length=200)


class RequestAnalysis(BaseModel):
    language: str = Field(description="ISO 639-1 code of the citizen's language, e.g. kn, hi, en, ta, te, mr, bn", max_length=8)
    language_name: str = Field(max_length=40)
    transcript: str = Field(description="Verbatim text in the original language and script. For typed input, repeat it unchanged.", max_length=4000)
    normalized_request: str = Field(description="Faithful English rendering of the request. Do not add facts.", max_length=2000)
    summary: str = Field(description="One-sentence neutral English summary.", max_length=400)
    category: Category
    secondary_categories: list[Category] = Field(default_factory=list, max_length=3)
    location_mention: str | None = Field(default=None, description="Place exactly as mentioned, or null if none.", max_length=200)
    district: str | None = Field(default=None, description="District name in English/romanised if explicitly mentioned or unambiguous from a mentioned place; else null.", max_length=100)
    state: str | None = Field(default=None, max_length=100)
    locality: str | None = Field(default=None, description="Village / ward / locality if mentioned.", max_length=150)
    urgency: float = Field(ge=0, le=1, description="0 = routine, 1 = immediate risk to life or health.")
    urgency_reason: str = Field(max_length=300)
    entities: list[Entity] = Field(default_factory=list, max_length=12)
    confidence: float = Field(ge=0, le=1)


class MapQuery(BaseModel):
    mode: Literal["unheard", "need", "demand"]
    category: Literal["all", "water", "sanitation", "health", "education", "energy", "roads"]
    need_min: float | None = Field(default=None, ge=0, le=100)
    need_max: float | None = Field(default=None, ge=0, le=100)
    demand_min: float | None = Field(default=None, ge=0, le=100)
    demand_max: float | None = Field(default=None, ge=0, le=100)
    unheard_min: float | None = Field(default=None, ge=0, le=100)
    states: list[str] = Field(default_factory=list, max_length=36)
    sort_by: Literal["unheard", "need", "demand"]
    sort_order: Literal["desc", "asc"]
    limit: int = Field(ge=1, le=50)
    intent_summary: str = Field(description="One sentence restating what will be computed.", max_length=300)


class NeedDriver(BaseModel):
    indicator_key: str = Field(max_length=60)
    statement: str = Field(max_length=400)


class InterventionRationale(BaseModel):
    category: ScoredCategory
    rationale: str = Field(max_length=500)


class Explanation(BaseModel):
    headline: str = Field(max_length=240)
    need_drivers: list[NeedDriver] = Field(max_length=5)
    demand_observation: str = Field(max_length=600)
    evidence_refs: list[str] = Field(default_factory=list, max_length=12)
    intervention_rationales: list[InterventionRationale] = Field(default_factory=list, max_length=3)
    caveats: list[str] = Field(default_factory=list, max_length=5)


class PolicyBriefText(BaseModel):
    title: str = Field(max_length=160)
    executive_summary: str = Field(max_length=1400)
    problem_signal: str = Field(max_length=1000)
    evidence: list[str] = Field(max_length=8)
    affected_population: str = Field(max_length=700)
    current_need: str = Field(max_length=800)
    observed_demand: str = Field(max_length=800)
    why_unheard: str = Field(max_length=1000)
    potential_intervention: str = Field(max_length=1000)
    projected_effect: str = Field(max_length=900)
    limitations: list[str] = Field(max_length=8)
