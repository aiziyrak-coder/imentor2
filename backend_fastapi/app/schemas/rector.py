"""Rektor hisoboti — so'rov sxemalari."""

from __future__ import annotations

from pydantic import BaseModel, Field


class RectorLoginRequest(BaseModel):
    """Rektor: login bo‘sh qolishi mumkin. Dekanlar login + parol bilan kiradi."""

    username: str = Field(default="", max_length=64)
    password: str = Field(min_length=4, max_length=128)
