"""Haftalik monitor bandligi: core_monitorschedule

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-09-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "q7r8s9t0u1v2"
down_revision: Union[str, None] = "p6q7r8s9t0u1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_monitorschedule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("monitor_id", sa.String(length=16), nullable=False),
        sa.Column("department", sa.String(length=255), nullable=False),
        sa.Column("room_full", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("weekday", sa.String(length=16), nullable=False),
        sa.Column("para", sa.String(length=16), nullable=False),
        sa.Column("teacher_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("teacher_phone", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("teacher_username", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("subject", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("lesson_type", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="Band"),
        sa.Column("note", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("week_start", sa.Date(), nullable=True),
        sa.Column("source_file", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("imported_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_monitorschedule_slot", "core_monitorschedule", ["monitor_id", "weekday", "para"])
    op.create_index("ix_core_monitorschedule_department", "core_monitorschedule", ["department"])
    op.create_index("ix_core_monitorschedule_teacher_username", "core_monitorschedule", ["teacher_username"])


def downgrade() -> None:
    op.drop_index("ix_core_monitorschedule_teacher_username", table_name="core_monitorschedule")
    op.drop_index("ix_core_monitorschedule_department", table_name="core_monitorschedule")
    op.drop_index("ix_core_monitorschedule_slot", table_name="core_monitorschedule")
    op.drop_table("core_monitorschedule")
