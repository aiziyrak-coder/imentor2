"""JSHSHIR bilan kirish: core_staffpinfl

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-09-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "r8s9t0u1v2w3"
down_revision: Union[str, None] = "q7r8s9t0u1v2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_staffpinfl",
        sa.Column("pinfl", sa.String(length=14), primary_key=True),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("owner_key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("link_source", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_staffpinfl_owner_key", "core_staffpinfl", ["owner_key"])


def downgrade() -> None:
    op.drop_index("ix_core_staffpinfl_owner_key", table_name="core_staffpinfl")
    op.drop_table("core_staffpinfl")
