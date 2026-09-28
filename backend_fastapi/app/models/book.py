from __future__ import annotations

import datetime as dt

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class SubjectBook(Base):
    __tablename__ = "core_subjectbook"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("core_academicdepartment.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(512))
    source_archive: Mapped[str] = mapped_column(String(255), default="")
    file: Mapped[str] = mapped_column(String(512), default="")
    language: Mapped[str] = mapped_column(String(8), default="")
    # "book" — darslik/qo'llanma; "protocol" — milliy klinik protokol, SanPin, SSV buyrug'i.
    # Protokol AI javobida MAJBURIY manba: kafedra fanlarida undan chetga chiqilmaydi (2026-09-24).
    kind: Mapped[str] = mapped_column(String(16), default="book", server_default="book")
    # O'qituvchi sozlamalardan o'zi yuklagan bo'lsa — uning logini ("" — admin/skript yuklagan).
    # O'chirishni faqat shu o'qituvchi yoki admin qila oladi.
    owner_key: Mapped[str] = mapped_column(String(128), default="", server_default="")
    # "ready" | "processing" (fonda indekslanmoqda) | "failed" (matn chiqmadi).
    status: Mapped[str] = mapped_column(String(16), default="ready", server_default="ready")
    status_note: Mapped[str] = mapped_column(String(255), default="", server_default="")
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class BookChunk(Base):
    __tablename__ = "core_bookchunk"

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("core_subjectbook.id", ondelete="CASCADE"))
    department_id: Mapped[int] = mapped_column(ForeignKey("core_academicdepartment.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column(Integer)
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    book: Mapped[SubjectBook] = relationship(lazy="joined")
