"""TopicHandout: tarqatma materiali tili (uz/ru/en)

Revision ID: e5f9b02d7c31
Revises: d4e8a91c6b20
Create Date: 2026-08-18
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5f9b02d7c31"
down_revision: Union[str, None] = "d4e8a91c6b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "core_topichandout",
        sa.Column(
            "language",
            sa.String(length=8),
            nullable=False,
            server_default="uz",
        ),
    )
    op.create_index(
        "core_topichandout_topic_lang_idx",
        "core_topichandout",
        ["topic_norm", "language"],
    )


def downgrade() -> None:
    op.drop_index("core_topichandout_topic_lang_idx", table_name="core_topichandout")
    op.drop_column("core_topichandout", "language")
