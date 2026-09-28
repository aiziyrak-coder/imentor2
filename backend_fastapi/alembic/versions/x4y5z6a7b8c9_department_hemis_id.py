"""Kafedra HEMIS bilan bog'lanadi: core_academicdepartment.hemis_id / hemis_code

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-09-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "x4y5z6a7b8c9"
down_revision: Union[str, None] = "w3x4y5z6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_academicdepartment", sa.Column("hemis_id", sa.String(length=32), nullable=False, server_default=""))
    op.add_column("core_academicdepartment", sa.Column("hemis_code", sa.String(length=64), nullable=False, server_default=""))
    op.add_column("core_academicdepartment", sa.Column("hemis_name", sa.String(length=255), nullable=False, server_default=""))
    op.create_index("ix_core_academicdepartment_hemis_id", "core_academicdepartment", ["hemis_id"])


def downgrade() -> None:
    op.drop_index("ix_core_academicdepartment_hemis_id", table_name="core_academicdepartment")
    op.drop_column("core_academicdepartment", "hemis_name")
    op.drop_column("core_academicdepartment", "hemis_code")
    op.drop_column("core_academicdepartment", "hemis_id")
