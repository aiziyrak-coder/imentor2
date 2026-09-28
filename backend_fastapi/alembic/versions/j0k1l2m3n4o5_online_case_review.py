"""Vaziyatli masala uchun AI tahlili.

Talaba javobini `online_progress.case_answer` ga yozadi; AI ning bahosi
(to'g'ri/noto'g'ri, izoh va ideal javob) esa saqlanishi kerak — aks holda
talaba mavzuni har ochganda qaytadan hisoblanib, har safar token sarflanardi
va baho ham har safar biroz boshqacha chiqardi.

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "j0k1l2m3n4o5"
down_revision: Union[str, None] = "i9j0k1l2m3n4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "online_progress",
        sa.Column(
            "case_review",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("online_progress", "case_review")
