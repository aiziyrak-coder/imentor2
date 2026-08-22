"""Super AI Hisobot — telemetry, talaba arxivi, rollup jadvallari.

Revision ID: g7h8i9j0k1l2
Revises: f6a7b8c9d0e1
Create Date: 2026-08-22
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "core_useractivityevent",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_key", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="hodim"),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("core_useractivityevent_owner_occurred_idx", "core_useractivityevent", ["owner_key", "occurred_at"])
    op.create_index("core_useractivityevent_type_occurred_idx", "core_useractivityevent", ["event_type", "occurred_at"])

    op.create_table(
        "core_useractivitysession",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_key", sa.String(length=128), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False, server_default="hodim"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="web"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active_minutes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("core_useractivitysession_owner_started_idx", "core_useractivitysession", ["owner_key", "started_at"])

    op.create_table(
        "core_studenttestattempt",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("core_livetestsession.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.String(length=64), nullable=False),
        sa.Column("participant_key", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("first_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("last_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("subject_code", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("topic", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("topic_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("questions_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("answers_final", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("academic_year", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("submitted_date", sa.Date(), nullable=False),
        sa.UniqueConstraint("session_id", "student_id", name="uniq_student_attempt_session"),
    )
    op.create_index("core_studenttestattempt_student_idx", "core_studenttestattempt", ["student_id", "submitted_at"])
    op.create_index("core_studenttestattempt_year_idx", "core_studenttestattempt", ["academic_year", "student_id"])

    op.create_table(
        "core_studenttestattemptevent",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("core_studenttestattempt.id", ondelete="CASCADE"), nullable=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("core_livetestsession.id", ondelete="CASCADE"), nullable=True),
        sa.Column("student_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("participant_key", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("question_index", sa.Integer(), nullable=True),
        sa.Column("option_index", sa.Integer(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client_ts_ms", sa.BigInteger(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index(
        "core_studenttestattemptevent_attempt_idx",
        "core_studenttestattemptevent",
        ["attempt_id", "occurred_at"],
    )

    op.create_table(
        "core_analyticsrollupdaily",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("rollup_date", sa.Date(), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("scope_key", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("rollup_date", "scope", "scope_key", name="uniq_analytics_rollup_daily"),
    )
    op.create_index("core_analyticsrollupdaily_scope_date_idx", "core_analyticsrollupdaily", ["scope", "rollup_date"])


def downgrade() -> None:
    op.drop_table("core_analyticsrollupdaily")
    op.drop_table("core_studenttestattemptevent")
    op.drop_table("core_studenttestattempt")
    op.drop_table("core_useractivitysession")
    op.drop_table("core_useractivityevent")
