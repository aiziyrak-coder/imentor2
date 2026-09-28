"""Kafedra nomining tarjimalari.

fermi.uz sayti uch tilda ishlaydi va tashqi API dan kafedra nomini ham
o'z tilida so'raydi. Sillabusda `name_i18n` allaqachon bor edi, kafedrada
esa yo'q — natijada ruscha saytda kafedra nomi o'zbekcha ko'rinardi.

Shakl sillabusdagi bilan bir xil: {"ru": "...", "en": "..."}. Asosiy
`name` ustuni o'zbekcha manba bo'lib qoladi va u KALIT sifatida
ishlatiladi, shuning uchun tegilmaydi.

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "k1l2m3n4o5p6"
down_revision: Union[str, None] = "j0k1l2m3n4o5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_academicdepartment",
        sa.Column(
            "name_i18n",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("core_academicdepartment", "name_i18n")
