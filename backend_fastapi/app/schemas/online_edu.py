"""Online ta'lim moduli uchun so'rov/javob sxemalari.

Sillabus fayli FRONTENDDA tahlil qilinadi (mavjud iMentor'dagi kabi) va
bu yerga tayyor `topics` / `variants` JSON ko'rinishida keladi — shu sababli
tahlilchi qayta yozilmaydi.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field

from app.models.online_edu import MATERIAL_KINDS


# ---------- Sillabus ----------

class OnlineVariantIn(BaseModel):
    label: str = Field(max_length=128)
    file_name: str = Field(default="", max_length=512)
    topics: list[dict] = Field(min_length=1)


class OnlineSyllabusUpsert(BaseModel):
    subject_name: str = Field(min_length=1, max_length=255)
    subject_code: str = Field(default="", max_length=64)
    department_name: str = Field(default="", max_length=255)
    # Kafedra AI uchun: darslik qidiruvi aynan shu bo'yicha ishlaydi.
    department_id: int | None = None
    description: str = Field(default="", max_length=512)
    instruction_language: str = Field(default="uz", max_length=8)
    file_name: str = Field(default="", max_length=512)
    topics: list[dict] = []
    variants: list[OnlineVariantIn] = []
    sort_order: int = 0
    is_active: bool = True


class OnlineSyllabusOut(BaseModel):
    id: int
    subject_name: str
    subject_code: str
    department_name: str
    department_id: int | None = None
    description: str
    instruction_language: str
    file_name: str
    topics: list
    variants: list
    sort_order: int
    is_active: bool
    created_at: dt.datetime
    updated_at: dt.datetime

    class Config:
        from_attributes = True


class OnlineSyllabusBrief(BaseModel):
    """Ro'yxatlar uchun — mavzular ro'yxatisiz, javob kichik bo'lsin."""

    id: int
    subject_name: str
    subject_code: str
    department_name: str
    department_id: int | None = None
    instruction_language: str
    topic_count: int
    variant_labels: list[str]
    is_active: bool


# ---------- O'qituvchi ----------

class OnlineTeacherIn(BaseModel):
    owner_key: str = Field(min_length=1, max_length=128)
    full_name: str = Field(default="", max_length=255)
    is_active: bool = True


class OnlineTeacherOut(BaseModel):
    id: int
    owner_key: str
    full_name: str
    is_active: bool
    courses: list[dict] = []


class OnlineTeacherCourseIn(BaseModel):
    teacher_id: int
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)


# ---------- Guruh ----------

class OnlineGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    is_active: bool = True


class OnlineGroupOut(BaseModel):
    id: int
    name: str
    is_active: bool
    student_count: int = 0
    courses: list[dict] = []


class OnlineGroupCourseIn(BaseModel):
    group_id: int
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)


# ---------- Material ----------

class OnlineMaterialIn(BaseModel):
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)
    topic_code: str = Field(min_length=1, max_length=32)
    kind: str = Field(max_length=16)
    title: str = Field(default="", max_length=1024)
    language: str = Field(default="uz", max_length=8)
    payload: dict = {}
    external_url: str = Field(default="", max_length=1024)
    sort_order: int = 0

    def validated_kind(self) -> str:
        k = (self.kind or "").strip().lower()
        if k not in MATERIAL_KINDS:
            raise ValueError(f"kind {k!r} noto'g'ri; ruxsat: {', '.join(MATERIAL_KINDS)}")
        return k


class OnlineMaterialOut(BaseModel):
    id: int
    syllabus_id: int
    variant_label: str
    topic_code: str
    kind: str
    title: str
    language: str
    payload: dict
    file: str
    file_name: str
    file_size: int
    external_url: str
    author_name: str
    created_at: dt.datetime
    updated_at: dt.datetime

    class Config:
        from_attributes = True


# ---------- Dars va davomat ----------

class OnlineLessonIn(BaseModel):
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)
    topic_code: str = Field(min_length=1, max_length=32)
    group_id: int
    title: str = Field(default="", max_length=512)
    scheduled_at: dt.datetime | None = None


class OnlineLessonOut(BaseModel):
    id: int
    syllabus_id: int
    subject_name: str = ""
    variant_label: str
    topic_code: str
    topic_title: str = ""
    group_id: int
    group_name: str = ""
    teacher_owner_key: str
    title: str
    room_name: str
    scheduled_at: dt.datetime | None
    started_at: dt.datetime | None
    ended_at: dt.datetime | None
    is_opened: bool
    opened_at: dt.datetime | None
    attendance_count: int = 0


class OnlineAttendanceEvent(BaseModel):
    """Jitsi'dan keladigan hodisa: talaba xonaga kirdi yoki chiqdi."""

    room_name: str = Field(min_length=1, max_length=128)
    event: str = Field(pattern="^(join|leave)$")


class OnlineAttendanceManualIn(BaseModel):
    """O'qituvchi qo'lda belgilagan davomat (masalan internet uzilib qolgan)."""

    student_id: str = Field(min_length=1, max_length=64)
    student_name: str = Field(default="", max_length=255)
    present: bool = True


class OnlineAttendanceOut(BaseModel):
    student_id: str
    student_name: str
    joined_at: dt.datetime
    left_at: dt.datetime | None
    total_seconds: int
    source: str


# ---------- Talaba ----------

class OnlineStudentTopicOut(BaseModel):
    topic_code: str
    title: str
    type: str = ""
    is_open: bool
    opened_at: dt.datetime | None = None
    has: dict = {}
    test_score: int | None = None
    test_total: int | None = None
    test_submitted_at: dt.datetime | None = None


class OnlineStudentSubjectOut(BaseModel):
    syllabus_id: int
    subject_name: str
    variant_label: str
    topic_count: int
    open_count: int
    done_count: int


class OnlineTestSubmitIn(BaseModel):
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)
    topic_code: str = Field(min_length=1, max_length=32)
    answers: list[int] = Field(min_length=1, max_length=50)


class OnlineTestResultOut(BaseModel):
    score: int
    total: int
    submitted_at: dt.datetime


class OnlineViewMarkIn(BaseModel):
    syllabus_id: int
    variant_label: str = Field(default="", max_length=128)
    topic_code: str = Field(min_length=1, max_length=32)
    kind: str = Field(pattern="^(lecture|presentation|video|handout)$")
