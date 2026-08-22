from __future__ import annotations

from pydantic import BaseModel, Field


class LiveTestUpsertRequest(BaseModel):
    session_key: str = ""
    topic: str = Field(max_length=1024)
    questions: list[dict] = Field(min_length=1, max_length=200)
    created_at_ms: int | None = None
    subject_code: str = ""


class LiveTestPublicOut(BaseModel):
    topic: str
    questions: list[dict]
    created_at_ms: int
    is_closed: bool
    closed_at_ms: int | None = None


class LiveTestSubmissionCreateRequest(BaseModel):
    participant_key: str = ""
    first_name: str
    last_name: str
    answers: list[int] = Field(min_length=1, max_length=200)
    started_at_ms: int | None = None
    duration_sec: int | None = None


class LiveTestDraftUpsertRequest(BaseModel):
    participant_key: str
    first_name: str = ""
    last_name: str = ""
    answers: list[int] = []
