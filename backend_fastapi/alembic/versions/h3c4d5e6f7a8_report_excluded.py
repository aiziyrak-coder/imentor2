"""Kafedra va fanni rektor hisobotidan chiqarish

Ba'zi kafedra va fanlar (masalan, iMentor ishlatilmaydigan) rektor
hisobotida o'qituvchilarni nohaq "ishlatmagan" qilib ko'rsatardi. Admin
ularni "Kafedralar" bo'limida hisobotdan chiqara oladi (2026-10-10).

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-10-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "h3c4d5e6f7a8"
down_revision: Union[str, None] = "g2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("core_academicdepartment", "core_coursesyllabus"):
        op.add_column(
            table,
            sa.Column("report_excluded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    for table in ("core_academicdepartment", "core_coursesyllabus"):
        op.drop_column(table, "report_excluded")
