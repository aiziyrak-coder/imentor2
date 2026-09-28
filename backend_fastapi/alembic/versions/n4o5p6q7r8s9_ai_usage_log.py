"""AI sarfi jadvali.

Har OpenAI chaqiruvi bitta qator: funksiya, model, kirish/kesh/chiqish
tokenlari. Faqat yangi jadval qo'shadi — mavjud ma'lumotga tegmaydi.

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n4o5p6q7r8s9"
down_revision: Union[str, None] = "m3n4o5p6q7r8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_aiusagelog",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("kind", sa.String(64), nullable=False, server_default=""),
        sa.Column("model", sa.String(64), nullable=False, server_default=""),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_core_aiusagelog_created_at", "core_aiusagelog", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_core_aiusagelog_created_at", table_name="core_aiusagelog")
    op.drop_table("core_aiusagelog")
