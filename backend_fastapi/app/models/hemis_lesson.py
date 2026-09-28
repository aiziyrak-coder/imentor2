"""HEMIS dars jadvalining to'liq nusxasi (2026-09-25).

`core_monitorschedule` faqat monitorli xonalardagi darslarni saqlaydi — 13 800
darsdan atigi 2 600 tasi. Rektor esa HAMMA darsni nazorat qilishi kerak:
o'qituvchining monitorsiz xonadagi darsi ham dars.

Shuning uchun jadval shu yerda to'liq saqlanadi, monitor esa bor-yo'q bo'lishi
mumkin bo'lgan qo'shimcha ma'lumot.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Date, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class HemisLesson(Base):
    __tablename__ = "core_hemislesson"
    __table_args__ = (
        Index("ix_core_hemislesson_day_teacher", "lesson_date", "teacher_username"),
        Index("ix_core_hemislesson_department", "department_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # HEMIS jadval yozuvining id'si — qayta sinxronda takror yaratmaslik uchun.
    hemis_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)

    lesson_date: Mapped[dt.date] = mapped_column(Date, index=True)
    weekday: Mapped[str] = mapped_column(String(16), default="")
    para: Mapped[str] = mapped_column(String(16), default="")
    start_time: Mapped[str] = mapped_column(String(8), default="")
    end_time: Mapped[str] = mapped_column(String(8), default="")

    # HEMIS xodim id va uning iMentor hisobi (topilmasa bo'sh).
    employee_id: Mapped[str] = mapped_column(String(32), default="")
    teacher_name: Mapped[str] = mapped_column(String(255), default="")
    teacher_username: Mapped[str] = mapped_column(String(128), default="", index=True)

    department_name: Mapped[str] = mapped_column(String(255), default="")
    subject_name: Mapped[str] = mapped_column(String(255), default="")
    group_name: Mapped[str] = mapped_column(String(128), default="")
    lesson_type: Mapped[str] = mapped_column(String(64), default="")

    auditorium_name: Mapped[str] = mapped_column(String(255), default="")
    building_name: Mapped[str] = mapped_column(String(255), default="")
    # HEMIS auditoriya kodi — dalil: xona AYNAN qaysi yozuv ekani ko'rinadi.
    auditorium_code: Mapped[str] = mapped_column(String(32), default="")
    # Shu xonada monitor bo'lsa — uning ID'si; aks holda bo'sh.
    monitor_id: Mapped[str] = mapped_column(String(16), default="")
    # Inventardagi xona yozuvi va kafedrasi — «monitor yo'q edi» degan gapni
    # tekshirish uchun hisobotning o'zida turadi.
    monitor_room: Mapped[str] = mapped_column(String(255), default="")
    monitor_department: Mapped[str] = mapped_column(String(255), default="")

    synced_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
