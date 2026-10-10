"""Boshqa platformalar statistikasi: iTest, iCam, iShifo

Rektor bitta sahifada institutning HAMMA tizimini ko'rishi kerak. Har bir
platformaning bazasi alohida konteynerda, shuning uchun raqamlar soatlik
skript bilan FAQAT O'QIB yig'iladi va shu jadvalga qo'yiladi — iMentor
boshqa loyihalarning xizmatlariga ulanmaydi.

Ustunlar atayin "umumiy": har platformaning o'z ko'rsatkichlari `payload`
ichida, shuning uchun yangi raqam qo'shish migratsiya talab qilmaydi.

Revision ID: f1a2b3c4d5e6
Revises: e6f0a13b7c42
Create Date: 2026-10-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e6f0a13b7c42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_platformstat",
        sa.Column("platform", sa.String(length=32), primary_key=True),
        sa.Column("label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("note", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("collected_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("core_platformstat")
