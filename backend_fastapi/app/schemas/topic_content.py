from __future__ import annotations

import datetime as dt

from pydantic import BaseModel


class TopicHandoutOut(BaseModel):
    id: int
    owner_key: str
    topic: str
    topic_norm: str
    title: str
    kind: str
    file_name: str
    file_size: int
    author_name: str
    created_at: dt.datetime
    file_url: str
    can_delete: bool
    sort_order: int
    language: str = "uz"


class TopicPresentationOut(BaseModel):
    id: int
    owner_key: str
    topic: str
    topic_norm: str
    title: str
    kind: str
    file_name: str
    file_size: int
    author_name: str
    created_at: dt.datetime
    file_url: str
    can_delete: bool
    sort_order: int


class TopicVideoOut(BaseModel):
    id: int
    topic: str
    topic_norm: str
    title: str
    youtube_id: str
    youtube_url: str
    embed_url: str
    author_name: str
    created_at: dt.datetime


class TopicVideoCreateRequest(BaseModel):
    syllabus_id: int
    variant_label: str
    topic_code: str
    topic: str
    title: str = ""
    youtube_url: str
