from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SyllabusVariantIn(BaseModel):
    # Qo'shimcha kalitlar (masalan `code_counters` — mavzu kodlari qayta
    # berilmasligi uchun) admin tahririda tashlab yuborilmasin.
    model_config = ConfigDict(extra="allow")

    label: str = Field(max_length=128)
    file_name: str = Field(max_length=512)
    topics: list[dict] = Field(min_length=1)


class CourseSyllabusUpsertRequest(BaseModel):
    subject_name: str | None = None
    subject_code: str = ""
    department_id: int | None = None
    direction_code: str = ""
    description: str = ""
    file_name: str = ""
    topics: list[dict] = []
    variants: list[SyllabusVariantIn] = []
    sort_order: int = Field(default=0, ge=0, le=9999)
    is_active: bool = True
    append_variants: bool = False
    instruction_language: str = "uz"

    @field_validator("subject_name")
    @classmethod
    def _validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        v = value.strip()
        if len(v) < 2:
            raise ValueError("Fan nomi juda qisqa.")
        return v

    @field_validator("direction_code")
    @classmethod
    def _validate_direction(cls, value: str) -> str:
        return (value or "").strip()[:32]


class CourseSyllabusFullOut(BaseModel):
    id: int
    subject_name: str
    subject_code: str
    department: int | None
    department_name: str
    department_code: str
    #: Kafedra institut hujjatidagi klinik ro'yxatdami — AI material
    #: (keys, test, taqdimot) shu bayroqqa qarab klinik yoki klinik emas.
    department_is_clinical: bool = False
    direction_code: str = ""
    description: str
    instruction_language: str
    file_name: str
    topics: list
    variants: list
    # Ko'rsatish uchun tarjimalar (asl nom o'zgarmaydi):
    #   name_i18n   -> {"ru": "...", "en": "..."}
    #   topics_i18n -> {"ru": {"<asl sarlavha>": "<tarjima>"}, ...}
    name_i18n: dict = {}
    topics_i18n: dict = {}
    # O'qituvchi Excel'dan o'zi yuklagan shaxsiy fan (admin panelda belgilanadi).
    teacher_owned: bool = False
    sort_order: int
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime


OWN_TOPIC_TYPES = ("lecture", "practical", "clinical", "independent", "lab")


class OwnSyllabusTopicIn(BaseModel):
    title: str = Field(min_length=2, max_length=1000)
    type: str

    @field_validator("type")
    @classmethod
    def _validate_type(cls, value: str) -> str:
        v = (value or "").strip().lower()
        if v not in OWN_TOPIC_TYPES:
            raise ValueError("Mashg'ulot turi noto'g'ri.")
        return v


class OwnSyllabusCreateRequest(BaseModel):
    """O'qituvchi Excel namunasidan o'zi yuklagan fan (tahlil brauzerda)."""

    subject_name: str = Field(min_length=2, max_length=255)
    file_name: str = Field(default="", max_length=512)
    instruction_language: str = "uz"
    topics: list[OwnSyllabusTopicIn] = Field(min_length=1, max_length=600)


class OwnSyllabusUpdateRequest(BaseModel):
    """O'z fanini tahrirlash: berilmagan maydon o'zgarmaydi."""

    subject_name: str | None = Field(default=None, min_length=2, max_length=255)
    instruction_language: str | None = None
    file_name: str = Field(default="", max_length=512)
    topics: list[OwnSyllabusTopicIn] | None = Field(default=None, min_length=1, max_length=600)
