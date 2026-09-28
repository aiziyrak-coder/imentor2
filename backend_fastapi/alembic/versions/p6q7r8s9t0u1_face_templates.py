"""Yuz orqali kirish: core_facetemplate

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-09-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "p6q7r8s9t0u1"
down_revision: Union[str, None] = "o5p6q7r8s9t0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_facetemplate",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_person_id", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("position", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("embedding", sa.Text(), nullable=False),
        sa.Column("owner_key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("link_source", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_core_facetemplate_source_person_id", "core_facetemplate", ["source_person_id"], unique=True)
    op.create_index("ix_core_facetemplate_owner_key", "core_facetemplate", ["owner_key"])


def downgrade() -> None:
    op.drop_index("ix_core_facetemplate_owner_key", table_name="core_facetemplate")
    op.drop_index("ix_core_facetemplate_source_person_id", table_name="core_facetemplate")
    op.drop_table("core_facetemplate")
