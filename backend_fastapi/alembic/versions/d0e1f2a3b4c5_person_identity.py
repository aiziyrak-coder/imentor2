"""Shaxsni tanish: JSHSHIR va pasport (parolsiz kirish uchun)

JSHSHIR va pasport HEMIS'da YO'Q — tekshirildi: talaba yozuvida 62, xodim
yozuvida 33 maydon bor, ikkalasida ham bunday maydon yo'q. Yagona manba —
cam.fermi.uz `students_staff` (passport_series, passport_number, pinfl),
u yerdan FAQAT O'QILADI.

Xodimning hisobga bog'lanishi ilgaridan `core_staffpinfl` da; bu jadval esa
butun ro'yxatni (xodim va talaba) saqlaydi va kirishda shaxsni topish uchun
ishlatiladi.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_personidentity",
        sa.Column("id", sa.Integer(), primary_key=True),
        # cam.fermi.uz `students_staff.id` — qayta sinxronlashda shu bo'yicha topiladi.
        sa.Column("source_id", sa.String(length=64), nullable=False),
        # "xodim" yoki "talaba".
        sa.Column("kind", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("pinfl", sa.String(length=14), nullable=False, server_default=""),
        # Pasport ikki qismda saqlanadi: seriya ro'yxatdan tanlanadi, raqam yoziladi.
        sa.Column("passport_series", sa.String(length=4), nullable=False, server_default=""),
        sa.Column("passport_number", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("hemis_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("source_id", name="core_personidentity_source_uniq"),
    )
    # Kirishda qidiriladigan ikki yo'l. Bo'sh qiymatlar ko'p, shuning uchun
    # qisman indeks: faqat to'ldirilgan qatorlar indekslanadi.
    op.create_index(
        "core_personidentity_pinfl_idx",
        "core_personidentity",
        ["pinfl"],
        postgresql_where=sa.text("pinfl <> ''"),
    )
    op.create_index(
        "core_personidentity_passport_idx",
        "core_personidentity",
        ["passport_series", "passport_number"],
        postgresql_where=sa.text("passport_number <> ''"),
    )


def downgrade() -> None:
    op.drop_index("core_personidentity_passport_idx", table_name="core_personidentity")
    op.drop_index("core_personidentity_pinfl_idx", table_name="core_personidentity")
    op.drop_table("core_personidentity")
