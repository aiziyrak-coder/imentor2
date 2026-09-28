from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

KIND_LECTURE = "lecture"
KIND_PRESENTATION = "presentation"
KIND_CASE = "case"
KIND_TEST = "test"
CATALOG_KINDS = (KIND_CASE, KIND_TEST)


class PreparedContent(Base):
    __tablename__ = "core_preparedcontent"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32))
    topic: Mapped[str] = mapped_column(String(255))
    topic_norm: Mapped[str] = mapped_column(String(255))
    author_display_name: Mapped[str] = mapped_column(String(128), default="")
    subject_name: Mapped[str] = mapped_column(String(255), default="")
    subject_code: Mapped[str] = mapped_column(String(64), default="")
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    topic_code: Mapped[str] = mapped_column(String(32), default="")
    syllabus_id: Mapped[int | None] = mapped_column(
        ForeignKey("core_coursesyllabus.id", ondelete="SET NULL"), nullable=True
    )
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    # Eskirgan material (masalan klinik bo'lmagan fanga bemor ssenariysi bilan
    # yozilgan — `content_domain_audit`). O'CHIRILMAYDI: katalogdan va "oxirgi
    # saqlangan" yuklanishidan chiqadi, o'qituvchi tarixida belgi bilan qoladi.
    retired_reason: Mapped[str] = mapped_column(String(64), default="", server_default="")
    retired_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    syllabus = relationship("CourseSyllabus", lazy="joined")
