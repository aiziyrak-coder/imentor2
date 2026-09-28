"""Haftalik monitor bandligi — kafedralar to'ldirgan Excel jadvalidan import.

Bitta qator = bitta monitor, hafta kuni, para va BITTA o'qituvchi (katakda ikki
o'qituvchi yozilsa — sur'at/maxraj — ikki qator). Jadval har hafta takrorlanadi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Date, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class MonitorScheduleEntry(Base):
    __tablename__ = "core_monitorschedule"
    __table_args__ = (
        Index("ix_core_monitorschedule_slot", "monitor_id", "weekday", "para"),
        Index("ix_core_monitorschedule_department", "department"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # interactive_boards.json inventaridagi monitor (MON-001 ...).
    monitor_id: Mapped[str] = mapped_column(String(16))
    # Inventardagi kafedra nomi (fayldagi yozilishi emas) — qayta import shu bo'yicha almashtiradi.
    department: Mapped[str] = mapped_column(String(255))
    room_full: Mapped[str] = mapped_column(String(255), default="")
    weekday: Mapped[str] = mapped_column(String(16))
    para: Mapped[str] = mapped_column(String(16))
    teacher_name: Mapped[str] = mapped_column(String(255), default="")
    # Fayldagi telefon/login (tozalangan raqamlar) — tekshirish uchun.
    teacher_phone: Mapped[str] = mapped_column(String(64), default="")
    # Aniqlangan iMentor hisobi (auth_user.username). Bo'sh — topilmadi.
    teacher_username: Mapped[str] = mapped_column(String(128), default="", index=True)
    subject: Mapped[str] = mapped_column(String(255), default="")
    group_name: Mapped[str] = mapped_column(String(255), default="")
    lesson_type: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(32), default="Band")
    note: Mapped[str] = mapped_column(String(255), default="")
    week_start: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    # HEMIS'dan kelgan yozuv ANIQ kunga tegishli (jadval har hafta o'zgarishi mumkin).
    # Kafedra Excel'i esa haftalik takrorlanadigan jadval — unda bu bo'sh qoladi.
    lesson_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    # HEMIS jadval yozuvining id'si — qayta sinxronda takror yaratmaslik uchun.
    hemis_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    source_file: Mapped[str] = mapped_column(String(255), default="")
    imported_by: Mapped[str] = mapped_column(String(128), default="")
    imported_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
