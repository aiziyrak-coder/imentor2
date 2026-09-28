"""O'qituvchi o'zi yuklagan fan: `core_coursesyllabus.created_by`.

Bo'sh — admin (yoki skript) yaratgan umumiy fan. To'ldirilgan bo'lsa — shu
`owner_key` Excel'dan o'zi yuklagan shaxsiy fan: faqat u ko'radi va faqat u
o'chira oladi. Faqat ustun qo'shadi, mavjud 480+ fanga tegmaydi.

Revision ID: o5p6q7r8s9t0
Revises: h9i0j1k2l3m4
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "o5p6q7r8s9t0"
down_revision: Union[str, None] = "h9i0j1k2l3m4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_coursesyllabus",
        sa.Column("created_by", sa.String(length=128), nullable=False, server_default=""),
    )
    op.create_index(
        "core_coursesyllabus_created_by_idx", "core_coursesyllabus", ["created_by"]
    )


def downgrade() -> None:
    op.drop_index("core_coursesyllabus_created_by_idx", table_name="core_coursesyllabus")
    op.drop_column("core_coursesyllabus", "created_by")
