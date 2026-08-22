from __future__ import annotations

import datetime as dt

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class UserActivityEvent(Base):
    __tablename__ = "core_useractivityevent"
    __table_args__ = (
        Index("core_useractivityevent_owner_occurred_idx", "owner_key", "occurred_at"),
        Index("core_useractivityevent_type_occurred_idx", "event_type", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(32), default="hodim")
    event_type: Mapped[str] = mapped_column(String(64))
    occurred_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)


class UserActivitySession(Base):
    __tablename__ = "core_useractivitysession"
    __table_args__ = (
        Index("core_useractivitysession_owner_started_idx", "owner_key", "started_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(32), default="hodim")
    source: Mapped[str] = mapped_column(String(16), default="web")
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active_minutes: Mapped[int] = mapped_column(Integer, default=0)


class StudentTestAttempt(Base):
    """Immutable talaba jonli test arxivi."""

    __tablename__ = "core_studenttestattempt"
    __table_args__ = (
        Index("core_studenttestattempt_student_idx", "student_id", "submitted_at"),
        Index("core_studenttestattempt_year_idx", "academic_year", "student_id"),
        UniqueConstraint("session_id", "student_id", name="uniq_student_attempt_session"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("core_livetestsession.id", ondelete="CASCADE"))
    student_id: Mapped[str] = mapped_column(String(64))
    participant_key: Mapped[str] = mapped_column(String(64), default="")
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    subject_code: Mapped[str] = mapped_column(String(200), default="")
    topic: Mapped[str] = mapped_column(String(512), default="")
    topic_code: Mapped[str] = mapped_column(String(64), default="")
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    questions_snapshot: Mapped[list] = mapped_column(JSONB, default=list)
    answers_final: Mapped[list] = mapped_column(JSONB, default=list)
    score: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    academic_year: Mapped[str] = mapped_column(String(16), default="")
    submitted_date: Mapped[dt.date] = mapped_column(Date)

    events: Mapped[list["StudentTestAttemptEvent"]] = relationship(
        back_populates="attempt", lazy="selectin", cascade="all, delete-orphan"
    )


class StudentTestAttemptEvent(Base):
    __tablename__ = "core_studenttestattemptevent"
    __table_args__ = (
        Index("core_studenttestattemptevent_attempt_idx", "attempt_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    attempt_id: Mapped[int] = mapped_column(
        ForeignKey("core_studenttestattempt.id", ondelete="CASCADE"), nullable=True
    )
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("core_livetestsession.id", ondelete="CASCADE"), nullable=True
    )
    student_id: Mapped[str] = mapped_column(String(64), default="")
    participant_key: Mapped[str] = mapped_column(String(64), default="")
    event_type: Mapped[str] = mapped_column(String(64))
    question_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    option_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    client_ts_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)

    attempt: Mapped[StudentTestAttempt | None] = relationship(back_populates="events")


class AnalyticsRollupDaily(Base):
    __tablename__ = "core_analyticsrollupdaily"
    __table_args__ = (
        UniqueConstraint("rollup_date", "scope", "scope_key", name="uniq_analytics_rollup_daily"),
        Index("core_analyticsrollupdaily_scope_date_idx", "scope", "rollup_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rollup_date: Mapped[dt.date] = mapped_column(Date)
    scope: Mapped[str] = mapped_column(String(32))
    scope_key: Mapped[str] = mapped_column(String(128), default="")
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
