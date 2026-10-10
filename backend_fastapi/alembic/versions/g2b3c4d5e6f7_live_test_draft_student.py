"""Jonli test qoralamasi talabaga bog'lanadi

Qoralama faqat brauzer kaliti (`participant_key`) bilan saqlanardi. O'qituvchi
testni yopganda yechib ulgurmagan talabaning qoralamasi topshiriqqa aylanadi,
lekin u KIMNIKI ekani noma'lum edi: 7 kunda 907 ta avtomatik topshiriqning
874 tasi talaba hisobiga bog'lanmagan, boshqa oynada ochilgan bo'sh qoralama
esa topshirib bo'lgan talabani ikkinchi marta 0 ball bilan qo'shardi
(2026-10-09).

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-10-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "g2b3c4d5e6f7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_livetestdraft",
        sa.Column("student_id", sa.String(length=64), nullable=False, server_default=""),
    )
    op.create_index("ix_core_livetestdraft_student", "core_livetestdraft", ["session_id", "student_id"])


def downgrade() -> None:
    op.drop_index("ix_core_livetestdraft_student", table_name="core_livetestdraft")
    op.drop_column("core_livetestdraft", "student_id")
