"""Monitor jadvali: HEMIS'dan kelgan aniq kun (lesson_date) va manba id (hemis_id)

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-09-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "w3x4y5z6a7b8"
down_revision: Union[str, None] = "v2w3x4y5z6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_monitorschedule", sa.Column("lesson_date", sa.Date(), nullable=True))
    op.add_column(
        "core_monitorschedule",
        sa.Column("hemis_id", sa.String(length=32), nullable=False, server_default=""),
    )
    op.create_index("ix_core_monitorschedule_lesson_date", "core_monitorschedule", ["lesson_date"])
    op.create_index("ix_core_monitorschedule_hemis_id", "core_monitorschedule", ["hemis_id"])


def downgrade() -> None:
    op.drop_index("ix_core_monitorschedule_hemis_id", table_name="core_monitorschedule")
    op.drop_index("ix_core_monitorschedule_lesson_date", table_name="core_monitorschedule")
    op.drop_column("core_monitorschedule", "hemis_id")
    op.drop_column("core_monitorschedule", "lesson_date")
