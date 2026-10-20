"""O'qituvchi hisoblarini birlashtirish: tarix jadvali va "bitta hisob — bitta JSHSHIR" cheklovi

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
Create Date: 2026-10-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "i4d5e6f7a8b9"
down_revision: Union[str, None] = "h3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_staffmergelog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("primary_key", sa.String(length=128), nullable=False),
        sa.Column("merged_key", sa.String(length=128), nullable=False),
        sa.Column("pinfl", sa.String(length=14), nullable=False, server_default=""),
        sa.Column("merged_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("moved", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("skipped_duplicates", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actor", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_core_staffmergelog_primary_key", "core_staffmergelog", ["primary_key"])
    op.create_index("ix_core_staffmergelog_merged_key", "core_staffmergelog", ["merged_key"])

    # Mavjud ma'lumotda bir hisobga bir nechta JSHSHIR bog'langan bo'lsa, indeks yaratilmay
    # qoladi. Shuning uchun har hisobda faqat bittasi (admin qo'lda bog'laganlar birinchi, keyin
    # eng yangisi) qoldiriladi; qolganlarining hisobga ulanishi bo'shatiladi — JSHSHIR yozuvi
    # saqlanadi, keyingi sinxronlash yoki admin qayta bog'laydi.
    op.execute(
        """
        UPDATE core_staffpinfl p SET owner_key = '', link_source = ''
        FROM (
            SELECT pinfl, row_number() OVER (
                PARTITION BY owner_key
                ORDER BY (link_source = 'admin') DESC, synced_at DESC, pinfl DESC
            ) AS rn
            FROM core_staffpinfl WHERE owner_key <> '' AND is_active
        ) r
        WHERE r.pinfl = p.pinfl AND r.rn > 1
        """
    )
    op.create_index(
        "uq_core_staffpinfl_owner_key",
        "core_staffpinfl",
        ["owner_key"],
        unique=True,
        postgresql_where=sa.text("owner_key <> '' AND is_active"),
    )


def downgrade() -> None:
    op.drop_index("uq_core_staffpinfl_owner_key", table_name="core_staffpinfl")
    op.drop_index("ix_core_staffmergelog_merged_key", table_name="core_staffmergelog")
    op.drop_index("ix_core_staffmergelog_primary_key", table_name="core_staffmergelog")
    op.drop_table("core_staffmergelog")
