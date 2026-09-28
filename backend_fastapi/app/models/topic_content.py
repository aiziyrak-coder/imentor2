from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TopicHandout(Base):
    __tablename__ = "core_topichandout"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    author_name: Mapped[str] = mapped_column(String(255), default="")
    topic: Mapped[str] = mapped_column(String(1024))
    topic_norm: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(1024), default="")
    kind: Mapped[str] = mapped_column(String(16), default="pdf")
    file: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(512))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str] = mapped_column(String(8), default="uz")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class TopicPresentation(Base):
    __tablename__ = "core_topicpresentation"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    author_name: Mapped[str] = mapped_column(String(255), default="")
    topic: Mapped[str] = mapped_column(String(1024))
    topic_norm: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(1024), default="")
    kind: Mapped[str] = mapped_column(String(16), default="pdf")
    file: Mapped[str] = mapped_column(String(512))
    file_name: Mapped[str] = mapped_column(String(512))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class TopicVideo(Base):
    __tablename__ = "core_topicvideo"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    author_name: Mapped[str] = mapped_column(String(255), default="")
    topic: Mapped[str] = mapped_column(String(1024))
    topic_norm: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(1024), default="")
    youtube_url: Mapped[str] = mapped_column(String(512))
    youtube_id: Mapped[str] = mapped_column(String(32))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
