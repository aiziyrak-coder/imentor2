from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class LiveTestSession(Base):
    __tablename__ = "core_livetestsession"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_key: Mapped[str] = mapped_column(String(160), unique=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSONB)
    # Fan kesimida natijalar/statistika uchun — bo'sh bo'lishi mumkin (eski yozuvlar).
    subject_code: Mapped[str] = mapped_column(String(200), default="")
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    submissions: Mapped[list["LiveTestSubmission"]] = relationship(
        back_populates="session", lazy="selectin"
    )
    drafts: Mapped[list["LiveTestDraft"]] = relationship(back_populates="session", lazy="selectin")


class LiveTestSubmission(Base):
    __tablename__ = "core_livetestsubmission"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("core_livetestsession.id", ondelete="CASCADE"))
    participant_key: Mapped[str] = mapped_column(String(64), default="")
    student_id: Mapped[str] = mapped_column(String(64), default="")
    first_name: Mapped[str] = mapped_column(String(128))
    last_name: Mapped[str] = mapped_column(String(128))
    answers: Mapped[list] = mapped_column(JSONB)
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    session: Mapped[LiveTestSession] = relationship(back_populates="submissions")


class LiveTestDraft(Base):
    __tablename__ = "core_livetestdraft"
    __table_args__ = (
        UniqueConstraint("session_id", "participant_key", name="uniq_live_test_draft_participant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("core_livetestsession.id", ondelete="CASCADE"))
    participant_key: Mapped[str] = mapped_column(String(64))
    # Qoralama KIMNIKI: test yopilganda topshiriq shu talabaga yoziladi.
    student_id: Mapped[str] = mapped_column(String(64), default="", server_default="")
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    answers: Mapped[list] = mapped_column(JSONB, default=list)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    session: Mapped[LiveTestSession] = relationship(back_populates="drafts")
