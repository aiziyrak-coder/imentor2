from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, field_validator


class PreparedContentIn(BaseModel):
    kind: str
    topic: str
    topic_norm: str = ""
    author_display_name: str = ""
    subject_name: str = ""
    subject_code: str = ""
    variant_label: str = ""
    topic_code: str = ""
    payload: dict

    @field_validator("topic")
    @classmethod
    def _validate_topic(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("topic is too short.")
        return v


class PreparedContentPayloadIn(BaseModel):
    """Mavjud yozuvning payload'ini almashtirish (PATCH).

    Test bo'limi avval asosiy tildagi testni darrov saqlaydi (ish yo'qolmasin),
    keyin fonda tarjima/manbalar tayyor bo'lgach SHU yozuvni yangilaydi —
    aks holda Bazada bir testning ikkita nusxasi paydo bo'lardi.
    """

    payload: dict


class PreparedContentOut(BaseModel):
    id: int
    owner_key: str
    kind: str
    topic: str
    topic_norm: str
    author_display_name: str
    subject_name: str
    subject_code: str
    variant_label: str
    topic_code: str
    payload: dict
    created_at: dt.datetime


class PreparedContentLatestOut(BaseModel):
    payload: dict | None = None


class PreparedContentSummaryOut(BaseModel):
    """Tarix ro'yxati uchun — to'liq payload'siz, yengil."""

    id: int
    kind: str
    topic: str
    topic_norm: str
    subject_name: str
    # Ro'yxatda muallif ko'rsatiladi (kim yaratgan).
    author_display_name: str = ""
    created_at: dt.datetime
    can_delete: bool = False
