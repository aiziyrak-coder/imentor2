"""Talabalar yuzi: core_facetemplate.person_type, group_name

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "s9t0u1v2w3x4"
down_revision: Union[str, None] = "r8s9t0u1v2w3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_facetemplate", sa.Column("person_type", sa.String(length=16), nullable=False, server_default="xodim"))
    op.add_column("core_facetemplate", sa.Column("group_name", sa.String(length=255), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("core_facetemplate", "group_name")
    op.drop_column("core_facetemplate", "person_type")
