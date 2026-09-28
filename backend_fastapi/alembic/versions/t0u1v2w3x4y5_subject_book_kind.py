"""Protokollar: core_subjectbook.kind

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-09-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "t0u1v2w3x4y5"
down_revision: Union[str, None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_subjectbook", sa.Column("kind", sa.String(length=16), nullable=False, server_default="book"))
    op.create_index("ix_core_subjectbook_dept_kind", "core_subjectbook", ["department_id", "kind"])


def downgrade() -> None:
    op.drop_index("ix_core_subjectbook_dept_kind", table_name="core_subjectbook")
    op.drop_column("core_subjectbook", "kind")
