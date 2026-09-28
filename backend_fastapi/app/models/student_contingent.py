from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AcademicFaculty(Base):
    __tablename__ = "core_academicfaculty"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc), onupdate=lambda: dt.datetime.now(dt.timezone.utc))


class StudentContingent(Base):
    __tablename__ = "core_studentcontingent"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), default="")
    hemis_id: Mapped[str] = mapped_column(String(64), default="")
    pinfl: Mapped[str] = mapped_column(String(32), default="")
    passport: Mapped[str] = mapped_column(String(32), default="")
    last_name: Mapped[str] = mapped_column(String(128), default="")
    first_name: Mapped[str] = mapped_column(String(128), default="")
    middle_name: Mapped[str] = mapped_column(String(128), default="")
    gender: Mapped[str] = mapped_column(String(16), default="")
    birth_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    phone: Mapped[str] = mapped_column(String(32), default="")
    institute_name: Mapped[str] = mapped_column(String(255), default="Farg'ona jamoat salomatligi tibbiyot instituti")
    faculty_id: Mapped[int | None] = mapped_column(ForeignKey("core_academicfaculty.id", ondelete="SET NULL"), nullable=True)
    faculty_name: Mapped[str] = mapped_column(String(255), default="")
    department_id: Mapped[int | None] = mapped_column(ForeignKey("core_academicdepartment.id", ondelete="SET NULL"), nullable=True)
    department_name: Mapped[str] = mapped_column(String(255), default="")
    direction_code: Mapped[str] = mapped_column(String(64), default="")
    direction_name: Mapped[str] = mapped_column(String(255), default="")
    course: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    group_name: Mapped[str] = mapped_column(String(64), default="")
    education_form: Mapped[str] = mapped_column(String(64), default="")
    education_language: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(32), default="active")
    academic_year: Mapped[str] = mapped_column(String(16), default="")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    note: Mapped[str] = mapped_column(Text, default="")
    raw: Mapped[dict] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc), onupdate=lambda: dt.datetime.now(dt.timezone.utc))

    faculty: Mapped[AcademicFaculty | None] = relationship(lazy="joined")
