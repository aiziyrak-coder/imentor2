"""Fanni muayyan o'qituvchilarga cheklash.

Fanlar katalogi ataylab butun institutga ochiq: kafedra yozuvlari ikki
nusxa bo'lib ketgani uchun o'qituvchi o'z fanini boshqa kafedra ostidan
ham topib tanlay olishi kerak edi. Lekin ba'zi fan faqat bitta
o'qituvchiniki — masalan muallif kursi. Ochiq katalogda uni istalgan
hodim qidiruvdan topib, o'ziga biriktirib olardi.

`allowed_owner_keys` — shu fanni ko'ra va tanlay oladigan hodimlar
(`owner_key`) ro'yxati. BO'SH ro'yxat — hammaga ochiq, ya'ni mavjud
fanlarning xatti-harakati o'zgarmaydi. Admin cheklovdan tashqarida:
u baribir hammasini ko'radi va istalgan hodimga biriktira oladi.

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l2m3n4o5p6q7"
down_revision: Union[str, None] = "k1l2m3n4o5p6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_coursesyllabus",
        sa.Column(
            "allowed_owner_keys",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("core_coursesyllabus", "allowed_owner_keys")
