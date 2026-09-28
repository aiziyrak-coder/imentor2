"""Brauzerda yuz bergan xatolar (2026-09-24).

O'qituvchilar xatoni skrinshot qilib Telegram'da yuborardi ("a.replaceAll is not
a function", "Fanlar yuklanmoqda" osilib qolishi) — ko'pchiligi esa umuman
yetib kelmasdi. Endi sahifa xatoni o'zi yozadi: bir xil xato bitta qator
(`fingerprint`), necha marta va oxirgi marta qachon bo'lgani bilan.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ClientErrorLog(Base):
    __tablename__ = "core_clienterrorlog"
    __table_args__ = (Index("ix_core_clienterrorlog_last_seen", "last_seen"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    message: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(300), default="")
    stack: Mapped[str] = mapped_column(Text, default="")
    page: Mapped[str] = mapped_column(String(300), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    username: Mapped[str] = mapped_column(String(128), default="")
    app_version: Mapped[str] = mapped_column(String(80), default="")
    count: Mapped[int] = mapped_column(Integer, default=1)
    # Nechta turli foydalanuvchida (taxminiy: oxirgi 20 login ichida).
    users: Mapped[str] = mapped_column(String(2600), default="")
    first_seen: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Admin "hal qilindi" deb belgilasa; xato yana chiqsa qayta ochiladi.
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
