"""Tayyor material eskirgan deb belgilanadi — o'chirilmaydi

Klinik bo'lmagan fanlarga bemor ssenariysi bilan yaratilgan keys va testlar
(2026-09-25 auditida 600 ta) katalogdan va "oxirgi saqlangan" yuklanishidan
chiqariladi, lekin bazada va o'qituvchining tarixida qoladi.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-09-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_preparedcontent",
        sa.Column("retired_reason", sa.String(length=64), nullable=False, server_default=""),
    )
    op.add_column(
        "core_preparedcontent",
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("core_preparedcontent", "retired_at")
    op.drop_column("core_preparedcontent", "retired_reason")
