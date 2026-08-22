"""Uzun amaliy mavzu sarlavhalari (A10/A12) 255 belgidan oshadi.

Revision ID: f6a7b8c9d0e1
Revises: e5f9b02d7c31
Create Date: 2026-08-19
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f9b02d7c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("core_topichandout", "core_topicpresentation", "core_topicvideo")


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(
            table,
            "topic",
            existing_type=sa.String(length=255),
            type_=sa.String(length=1024),
            existing_nullable=False,
        )
        op.alter_column(
            table,
            "title",
            existing_type=sa.String(length=255),
            type_=sa.String(length=1024),
            existing_nullable=False,
            existing_server_default=None,
        )


def downgrade() -> None:
    for table in _TABLES:
        op.alter_column(
            table,
            "title",
            existing_type=sa.String(length=1024),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
        op.alter_column(
            table,
            "topic",
            existing_type=sa.String(length=1024),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
