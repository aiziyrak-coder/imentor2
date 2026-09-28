"""Malaka oshirish dasturi.

Online portal ichida ikkinchi dastur: fan va guruhga `program` ustuni
("online" | "malaka"), pasport bilan kiradigan tinglovchilar jadvali,
ko'p urinishli testlar jadvali va parolni majburiy almashtirish belgisi.

Mavjud qatorlarning hammasi "online" bo'lib qoladi (server_default) —
6-kurs masofaviy ta'limi o'zgarishsiz ishlayveradi.

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "m3n4o5p6q7r8"
down_revision: Union[str, None] = "l2m3n4o5p6q7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "online_syllabus",
        sa.Column("program", sa.String(16), nullable=False, server_default="online"),
    )
    op.add_column(
        "online_group",
        sa.Column("program", sa.String(16), nullable=False, server_default="online"),
    )

    op.create_table(
        "malaka_listener",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(150), nullable=False, unique=True),
        sa.Column("full_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("passport", sa.String(32), nullable=False, server_default=""),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("online_group.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "malaka_test_attempt",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.String(64), nullable=False),
        sa.Column("student_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(255), nullable=False, server_default=""),
        sa.Column(
            "syllabus_id",
            sa.Integer(),
            sa.ForeignKey("online_syllabus.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("topic_code", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column(
            "answers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "malaka_test_attempt_lookup_idx",
        "malaka_test_attempt",
        ["student_id", "syllabus_id", "topic_code", "kind"],
    )

    op.create_table(
        "user_password_policy",
        sa.Column("username", sa.String(150), primary_key=True),
        sa.Column("must_change", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("user_password_policy")
    op.drop_index("malaka_test_attempt_lookup_idx", table_name="malaka_test_attempt")
    op.drop_table("malaka_test_attempt")
    op.drop_table("malaka_listener")
    op.drop_column("online_group", "program")
    op.drop_column("online_syllabus", "program")
