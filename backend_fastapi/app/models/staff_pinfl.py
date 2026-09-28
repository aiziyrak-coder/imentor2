"""Xodim JSHSHIR (PINFL) → iMentor hisobi (JSHSHIR bilan kirish uchun).

JSHSHIR cam.fermi.uz `students_staff.pinfl` ustunidan FAQAT O'QIB nusxalanadi
(`scripts/sync_staff_pinfl.py`, soatlik cron). iMentor hisoblarida JSHSHIR yo'q,
shuning uchun bog'lanish shu jadvalda saqlanadi; parolga tegilmaydi — xodim
JSHSHIR va o'zining hozirgi paroli bilan kiradi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class StaffPinfl(Base):
    __tablename__ = "core_staffpinfl"

    pinfl: Mapped[str] = mapped_column(String(14), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    # Bog'langan iMentor hisobi (`auth_user.username`). Bo'sh — hali bog'lanmagan.
    owner_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    # "face" — shu odamning yuzi bog'langan hisob; "name" — ism-familiya bo'yicha yagona moslik;
    # "admin" — qo'lda bog'langan (sinxronlash o'zgartirmaydi).
    link_source: Mapped[str] = mapped_column(String(16), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    synced_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
