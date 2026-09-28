from __future__ import annotations

from pydantic import BaseModel, Field


class ActivityEventIn(BaseModel):
    event_type: str
    #: Bir bo'lakdagi vaqt. Yuqori chegara MARSHRUTDA qirqiladi (`MAX_EVENT_SEC`),
    #: bu yerda emas: chegaradan oshgan bitta hodisa butun to'plamni 422 ga
    #: olib borar va o'sha daqiqadagi barcha vaqt yo'qolardi.
    duration_sec: int = Field(default=0, ge=0)
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
