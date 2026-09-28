"""Brauzer xatolari jurnali: core_clienterrorlog

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-09-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "v2w3x4y5z6a7"
down_revision: Union[str, None] = "u1v2w3x4y5z6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_clienterrorlog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fingerprint", sa.String(length=40), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("stack", sa.Text(), nullable=False, server_default=""),
        sa.Column("page", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("username", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("app_version", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("users", sa.String(length=2600), nullable=False, server_default=""),
        sa.Column("first_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_core_clienterrorlog_fingerprint", "core_clienterrorlog", ["fingerprint"], unique=True)
    op.create_index("ix_core_clienterrorlog_last_seen", "core_clienterrorlog", ["last_seen"])


def downgrade() -> None:
    op.drop_index("ix_core_clienterrorlog_last_seen", table_name="core_clienterrorlog")
    op.drop_index("ix_core_clienterrorlog_fingerprint", table_name="core_clienterrorlog")
    op.drop_table("core_clienterrorlog")
