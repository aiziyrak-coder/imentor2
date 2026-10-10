"""Institutning boshqa tizimlari bo'yicha raqamlar (iTest, iCam, iShifo).

Har bir platformaning o'z bazasi alohida konteynerda turadi. iMentor ularga
ULANMAYDI: soatlik skript (`deploy/platforms/platform-stats.sh`) har bazadan
FAQAT O'QIB sanoqlarni oladi va shu jadvalga qo'yadi. Shu sababli boshqa
loyihalarning ishlashiga hech qanday ta'sir yo'q va parollari ham kerak emas.

`payload` — erkin JSON: yangi ko'rsatkich qo'shish uchun migratsiya shart emas.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PlatformStat(Base):
    __tablename__ = "core_platformstat"

    #: "itest", "icam", "ishifo" — qisqa kalit.
    platform: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(128), default="")
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    #: Yig'ish muvaffaqiyatli bo'ldimi. Yolg'on bo'lsa sahifada eski raqam
    #: emas, "ma'lumot kelmadi" deb ko'rsatiladi — eskisi aldamasin.
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str] = mapped_column(String(255), default="")
    collected_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
