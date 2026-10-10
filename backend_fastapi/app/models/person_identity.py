"""Shaxsni tanish uchun JSHSHIR va pasport — parolsiz kirishning asosi.

Manba: cam.fermi.uz `students_staff` (FAQAT O'QILADI). HEMIS'da bu maydonlar
yo'q, shuning uchun u yerdan olinmaydi.

Bu jadval kimligini aniqlaydi, hisobga bog'lamaydi: xodimning iMentor hisobi
ilgaridan `core_staffpinfl` da JSHSHIR orqali bog'lanadi, talaba esa
kontingentdan topiladi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

STAFF = "xodim"
STUDENT = "talaba"


class PersonIdentity(Base):
    __tablename__ = "core_personidentity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    #: cam.fermi.uz `students_staff.id` — qayta sinxronlashda tenglashtirish kaliti.
    source_id: Mapped[str] = mapped_column(String(64), unique=True)
    kind: Mapped[str] = mapped_column(String(16), default="")
    pinfl: Mapped[str] = mapped_column(String(14), default="", index=True)
    passport_series: Mapped[str] = mapped_column(String(4), default="")
    passport_number: Mapped[str] = mapped_column(String(16), default="")
    full_name: Mapped[str] = mapped_column(String(255), default="")
    hemis_id: Mapped[str] = mapped_column(String(64), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    synced_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
