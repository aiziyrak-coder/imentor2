"""Malaka oshirish dasturi — so'rov sxemalari."""

from __future__ import annotations

from pydantic import BaseModel, Field


class MalakaLoginRequest(BaseModel):
    """Tinglovchi: login — pasport seriyasi va raqami (bo'sh joy ahamiyatsiz)."""

    login: str = Field(min_length=4, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TopicCreateIn(BaseModel):
    syllabus_id: int
    title: str = Field(min_length=2, max_length=1024)


class TopicRenameIn(BaseModel):
    syllabus_id: int
    title: str = Field(min_length=2, max_length=1024)


class MalakaAttemptIn(BaseModel):
    syllabus_id: int
    topic_code: str = Field(min_length=1, max_length=32)
    # test | practical | entry | exit — server mavzu kodidan ham tekshiradi.
    kind: str = Field(max_length=16)
    answers: list[int] = Field(min_length=1, max_length=200)


class TopicMoveIn(BaseModel):
    syllabus_id: int
    direction: str = Field(pattern="^(up|down)$")
