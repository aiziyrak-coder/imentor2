"""O'qituvchi hisoblarini birlashtirish tarixi.

Qoldirilgan (`primary_key`) hisobga qo'shilgan hisob (`merged_key`) o'chirilmaydi:
nofaol qilinadi, ma'lumotlari esa asosiy hisobga ko'chiriladi. Bu jadval "kim, qachon,
nimani ko'chirdi" ni saqlaydi — xato birlashtirilsa, qo'lda tuzatish uchun asos bo'ladi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class StaffMergeLog(Base):
    __tablename__ = "core_staffmergelog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    primary_key: Mapped[str] = mapped_column(String(128), index=True)
    merged_key: Mapped[str] = mapped_column(String(128), index=True)
    pinfl: Mapped[str] = mapped_column(String(14), default="", server_default="")
    merged_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    #: {"jadval.ustun": ko'chirilgan qatorlar soni} — qaysi ma'lumot nimaga ko'chgani.
    moved: Mapped[dict] = mapped_column(JSONB, default=dict)
    #: Asosiy hisobda allaqachon bor bo'lgani uchun qo'shilmagan (takror) qatorlar soni.
    skipped_duplicates: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    actor: Mapped[str] = mapped_column(String(128), default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    merged_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
