from __future__ import annotations

from pydantic import BaseModel, Field


class ActivityEventIn(BaseModel):
    event_type: str
    duration_sec: int = 0
    client_ts_ms: int | None = None
    meta: dict = Field(default_factory=dict)


class ActivityEventsBatchIn(BaseModel):
    events: list[ActivityEventIn] = Field(default_factory=list, max_length=50)
    page: str = ""


class LiveTestEventIn(BaseModel):
    event_type: str
    question_index: int | None = None
    option_index: int | None = None
    client_ts_ms: int | None = None
    meta: dict = Field(default_factory=dict)


class LiveTestEventsBatchIn(BaseModel):
    session_key: str
    participant_key: str = ""
    events: list[LiveTestEventIn] = Field(default_factory=list, max_length=200)


class AiNarrativeIn(BaseModel):
    period: str = "monthly"
    anchor_date: str | None = None
    language: str = "uz"
