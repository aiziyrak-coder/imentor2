"""AI (OpenAI) sarfi — har chaqiruv bitta qator.

Ilgari sarf faqat logga yozilardi va konteyner qayta ishga tushganda o'chib
ketardi: "token ko'p ketyapti" degan gapni tekshirib ham, tejaganimizni
isbotlab ham bo'lmasdi. Bu jadval shu savolga javob beradi: qaysi funksiya,
qaysi model, qancha token.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class AiUsageLog(Base):
    __tablename__ = "core_aiusagelog"
    __table_args__ = (Index("ix_core_aiusagelog_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Qaysi funksiya: "case_generate", "syllabus_translate", "embedding" ...
    kind: Mapped[str] = mapped_column(String(64), default="")
    model: Mapped[str] = mapped_column(String(64), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    # OpenAI avtomatik keshidan qayta ishlatilgan kirish tokenlari (arzonroq).
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
