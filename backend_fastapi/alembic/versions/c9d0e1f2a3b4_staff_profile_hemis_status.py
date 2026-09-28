"""Xodim profilida HEMIS'dagi ish holati: ishlamoqda / ta'tilda / bo'shagan

Ta'tildagi o'qituvchi nazorat hisobotida "iMentor ochmagan" deb ayblanmasligi,
ishdan ketgan xodimning ochiq hisobi esa ko'rinib turishi kerak.

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_staffprofile",
        sa.Column("hemis_status", sa.String(length=32), nullable=False, server_default=""),
    )
    op.add_column(
        "core_staffprofile",
        sa.Column("hemis_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("core_staffprofile", "hemis_synced_at")
    op.drop_column("core_staffprofile", "hemis_status")
