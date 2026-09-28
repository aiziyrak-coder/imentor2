"""HEMIS dars jadvalining to'liq nusxasi: core_hemislesson

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-09-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "y5z6a7b8c9d0"
down_revision: Union[str, None] = "x4y5z6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_hemislesson",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("hemis_id", sa.String(length=32), nullable=False),
        sa.Column("lesson_date", sa.Date(), nullable=False),
        sa.Column("weekday", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("para", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("start_time", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("end_time", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("employee_id", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("teacher_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("teacher_username", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("department_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("subject_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("lesson_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("auditorium_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("building_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("monitor_id", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_core_hemislesson_hemis_id", "core_hemislesson", ["hemis_id"], unique=True)
    op.create_index("ix_core_hemislesson_lesson_date", "core_hemislesson", ["lesson_date"])
    op.create_index("ix_core_hemislesson_teacher_username", "core_hemislesson", ["teacher_username"])
    op.create_index("ix_core_hemislesson_day_teacher", "core_hemislesson", ["lesson_date", "teacher_username"])
    op.create_index("ix_core_hemislesson_department", "core_hemislesson", ["department_name"])


def downgrade() -> None:
    op.drop_table("core_hemislesson")
