"""Har bir darsning DALILI: HEMIS auditoriya kodi va mos kelgan monitor yozuvi

Hisobotda "monitor yo'q edi", "darsim yo'q edi" degan bahonalarga o'rin
qolmasligi uchun har bir dars qatori qaysi HEMIS auditoriyasiga va inventardagi
qaysi monitorga tegishli ekanini O'ZIDA saqlaydi.

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-09-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z6a7b8c9d0e1"
down_revision: Union[str, None] = "y5z6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ("auditorium_code", sa.String(length=32)),
    ("monitor_room", sa.String(length=255)),
    ("monitor_department", sa.String(length=255)),
)


def upgrade() -> None:
    for name, kind in COLUMNS:
        op.add_column(
            "core_hemislesson",
            sa.Column(name, kind, nullable=False, server_default=""),
        )
    op.create_index("ix_core_hemislesson_monitor", "core_hemislesson", ["monitor_id"])


def downgrade() -> None:
    op.drop_index("ix_core_hemislesson_monitor", table_name="core_hemislesson")
    for name, _ in COLUMNS:
        op.drop_column("core_hemislesson", name)
