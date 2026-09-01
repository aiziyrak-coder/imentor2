"""Online ta'lim moduli — 6-kurs masofaviy talabalari uchun.

Modul ATAYLAB butunlay alohida jadvallarda quriladi va mavjud
`core_*` jadvallariga umuman tegmaydi.

Sabab: `TopicHandout`, `TopicVideo`, `TopicPresentation` va
`PreparedContent` ni FILTRSIZ o'qiydigan joylar bor (umumiy katalog va
admin ro'yxatlari). Agar online materiallar o'sha jadvallarda tursa,
ular hozirgi iMentor katalogida ko'rinib qolardi. Alohida jadval bu
xavfni kodni eslab qolishga emas, tuzilmaning o'ziga bog'laydi.

Talaba va o'qituvchi `auth_user` orqali aniqlanadi (yangi foydalanuvchi
turi yaratilmaydi): o'qituvchi telefon raqami, talaba esa OnlineTest ID
bilan. Shu sababli bu yerda `owner_key` / `student_id` matn sifatida
saqlanadi — mavjud kodda ham shu odat.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

# Material turlari — `OnlineMaterial.kind` uchun yagona manba.
MATERIAL_KINDS = ("lecture", "presentation", "video", "handout", "case", "test")


class OnlineSyllabus(Base):
    """6-kurs fani va uning mavzulari.

    Tuzilishi `core_coursesyllabus` bilan bir xil, chunki sillabus faylini
    o'qiydigan mavjud tahlilchi shu shaklda natija qaytaradi — uni qayta
    yozmaymiz, faqat natijani shu jadvalga yozamiz.
    """

    __tablename__ = "online_syllabus"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_name: Mapped[str] = mapped_column(String(255))
    subject_code: Mapped[str] = mapped_column(String(64), unique=True)
    department_name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(String(512), default="")
    instruction_language: Mapped[str] = mapped_column(String(8), default="uz")
    file_name: Mapped[str] = mapped_column(String(512), default="")
    # [{"code": "1", "title": "...", "type": "lecture", "hours": 2}, ...]
    topics: Mapped[list] = mapped_column(JSONB, default=list)
    # [{"label": "asosiy", "topics": [...]}, ...]
    variants: Mapped[list] = mapped_column(JSONB, default=list)
    name_i18n: Mapped[dict] = mapped_column(JSONB, default=dict)
    topics_i18n: Mapped[dict] = mapped_column(JSONB, default=dict)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class OnlineTeacher(Base):
    """Online dars o'tadigan o'qituvchi.

    Umumiy o'qituvchilar ro'yxatidan adminning o'zi belgilaydi. Bu yerda
    yozuv bo'lmasa — o'qituvchi online portalga kira olmaydi.
    """

    __tablename__ = "online_teacher"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128), unique=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class OnlineTeacherCourse(Base):
    """Qaysi o'qituvchi qaysi online fanni o'tadi."""

    __tablename__ = "online_teacher_course"
    __table_args__ = (
        UniqueConstraint(
            "teacher_id", "syllabus_id", "variant_label",
            name="online_teacher_course_uniq",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("online_teacher.id", ondelete="CASCADE")
    )
    syllabus_id: Mapped[int] = mapped_column(
        ForeignKey("online_syllabus.id", ondelete="CASCADE")
    )
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    teacher: Mapped[OnlineTeacher] = relationship(lazy="joined")
    syllabus: Mapped[OnlineSyllabus] = relationship(lazy="joined")


class OnlineGroup(Base):
    """Talabalar guruhi.

    Nom OnlineTest tizimidan keladi (login javobidagi `group_name`), shuning
    uchun bu yerda faqat nom saqlanadi — talabalar ro'yxati OnlineTest'da
    qoladi va biz uni takrorlamaymiz.
    """

    __tablename__ = "online_group"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class OnlineGroupCourse(Base):
    """Qaysi guruh qaysi online fanni o'qiydi."""

    __tablename__ = "online_group_course"
    __table_args__ = (
        UniqueConstraint(
            "group_id", "syllabus_id", "variant_label",
            name="online_group_course_uniq",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("online_group.id", ondelete="CASCADE")
    )
    syllabus_id: Mapped[int] = mapped_column(
        ForeignKey("online_syllabus.id", ondelete="CASCADE")
    )
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    group: Mapped[OnlineGroup] = relationship(lazy="joined")
    syllabus: Mapped[OnlineSyllabus] = relationship(lazy="joined")


class OnlineMaterial(Base):
    """Mavzu materiali — ma'ruza, taqdimot, video, tarqatma, keys yoki test.

    Oltita tur bitta jadvalda turadi, chunki ularning kaliti bir xil
    (fan + variant + mavzu) va talabaga hammasi birga ko'rsatiladi.
    Farqi faqat mazmunda:
      - `payload` — AI yaratgan kontent (ma'ruza matni, test savollari, keys)
      - `file` — yuklangan fayl (tarqatma PDF, taqdimot)
      - `external_url` — tashqi video havolasi
    """

    __tablename__ = "online_material"
    __table_args__ = (
        Index(
            "online_material_topic_idx",
            "syllabus_id", "variant_label", "topic_code", "kind",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    syllabus_id: Mapped[int] = mapped_column(
        ForeignKey("online_syllabus.id", ondelete="CASCADE")
    )
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    topic_code: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(1024), default="")
    language: Mapped[str] = mapped_column(String(8), default="uz")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    file: Mapped[str] = mapped_column(String(512), default="")
    file_name: Mapped[str] = mapped_column(String(512), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    external_url: Mapped[str] = mapped_column(String(1024), default="")
    owner_key: Mapped[str] = mapped_column(String(128))
    author_name: Mapped[str] = mapped_column(String(255), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class OnlineLesson(Base):
    """Video konferensiya darsi va mavzu qulfi.

    Mavzu talabaga SHU yozuv orqali ochiladi: o'qituvchi darsni o'tkazib,
    "dars o'tildi" tugmasini bosgach `is_opened` rost bo'ladi va o'sha
    guruh talabalari mavzu materiallarini ko'ra boshlaydi.
    """

    __tablename__ = "online_lesson"
    __table_args__ = (
        Index(
            "online_lesson_topic_idx",
            "syllabus_id", "variant_label", "topic_code", "group_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    syllabus_id: Mapped[int] = mapped_column(
        ForeignKey("online_syllabus.id", ondelete="CASCADE")
    )
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    topic_code: Mapped[str] = mapped_column(String(32))
    group_id: Mapped[int] = mapped_column(
        ForeignKey("online_group.id", ondelete="CASCADE")
    )
    teacher_owner_key: Mapped[str] = mapped_column(String(128))
    title: Mapped[str] = mapped_column(String(512), default="")
    # Jitsi xona nomi — taxmin qilib bo'lmasligi uchun tasodifiy yaratiladi.
    room_name: Mapped[str] = mapped_column(String(128), unique=True)
    scheduled_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_opened: Mapped[bool] = mapped_column(Boolean, default=False)
    opened_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    group: Mapped[OnlineGroup] = relationship(lazy="joined")
    syllabus: Mapped[OnlineSyllabus] = relationship(lazy="joined")


class OnlineAttendance(Base):
    """Darsda kim qatnashgani.

    Jitsi IFrame API `participantJoined` / `participantLeft` hodisalarini
    yuboradi, shu yerda yig'iladi. `source="manual"` — o'qituvchi qo'lda
    belgilagan holat (masalan talabaning interneti uzilib qolgan).
    """

    __tablename__ = "online_attendance"
    __table_args__ = (
        UniqueConstraint("lesson_id", "student_id", name="online_attendance_uniq"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesson_id: Mapped[int] = mapped_column(
        ForeignKey("online_lesson.id", ondelete="CASCADE")
    )
    student_id: Mapped[str] = mapped_column(String(64))
    student_name: Mapped[str] = mapped_column(String(255), default="")
    joined_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    total_seconds: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(16), default="jitsi")


class OnlineProgress(Base):
    """Talabaning bitta mavzu bo'yicha holati.

    Har mavzu uchun bitta qator: nimani ko'rgani va 10 ta testdan qancha
    to'plagani. Test BIR MARTA topshiriladi — `test_submitted_at` to'lgan
    bo'lsa ikkinchi urinish qabul qilinmaydi.
    """

    __tablename__ = "online_progress"
    __table_args__ = (
        UniqueConstraint(
            "student_id", "syllabus_id", "variant_label", "topic_code",
            name="online_progress_uniq",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64))
    student_name: Mapped[str] = mapped_column(String(255), default="")
    group_name: Mapped[str] = mapped_column(String(255), default="")
    syllabus_id: Mapped[int] = mapped_column(
        ForeignKey("online_syllabus.id", ondelete="CASCADE")
    )
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    topic_code: Mapped[str] = mapped_column(String(32))

    lecture_viewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    presentation_viewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    video_viewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    handout_viewed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    case_answer: Mapped[str] = mapped_column(Text, default="")
    case_submitted_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    test_answers: Mapped[list] = mapped_column(JSONB, default=list)
    test_score: Mapped[int] = mapped_column(Integer, default=0)
    test_total: Mapped[int] = mapped_column(Integer, default=0)
    test_submitted_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
