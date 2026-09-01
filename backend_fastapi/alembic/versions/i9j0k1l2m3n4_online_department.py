"""Online fanni kafedraga bog'lash — AI darsliklardan foydalanishi uchun.

`core_bookchunk` (760 902 parcha) kafedra bo'yicha indekslangan. Online fanda
kafedra bo'lmasa, AI ma'ruza va test yozganda darslikka umuman murojaat qila
olmaydi va faqat o'z xotirasidan yozadi.

Faqat ustun qo'shadi — mavjud jadvallarga tegmaydi.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "online_syllabus",
        sa.Column("department_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "online_syllabus_department_fk",
        "online_syllabus",
        "core_academicdepartment",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("online_syllabus_department_fk", "online_syllabus", type_="foreignkey")
    op.drop_column("online_syllabus", "department_id")
