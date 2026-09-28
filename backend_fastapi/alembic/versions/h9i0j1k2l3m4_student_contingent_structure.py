"""student contingent structure

Revision ID: h9i0j1k2l3m4
Revises: n4o5p6q7r8s9
Create Date: 2026-09-15
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "h9i0j1k2l3m4"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "core_academicfaculty",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="core_academicfaculty_name_key"),
        sa.UniqueConstraint("code", name="core_academicfaculty_code_key"),
    )
    op.create_table(
        "core_studentcontingent",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("hemis_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("pinfl", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("passport", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("last_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("first_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("middle_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("gender", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("birth_date", sa.Date(), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("institute_name", sa.String(length=255), nullable=False, server_default="Farg'ona jamoat salomatligi tibbiyot instituti"),
        sa.Column("faculty_id", sa.Integer(), sa.ForeignKey("core_academicfaculty.id", ondelete="SET NULL"), nullable=True),
        sa.Column("faculty_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("core_academicdepartment.id", ondelete="SET NULL"), nullable=True),
        sa.Column("department_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("direction_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("direction_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("course", sa.SmallInteger(), nullable=True),
        sa.Column("group_name", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("education_form", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("education_language", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("academic_year", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("core_studentcontingent_student_id_idx", "core_studentcontingent", ["student_id"])
    op.create_index("core_studentcontingent_hemis_id_idx", "core_studentcontingent", ["hemis_id"])
    op.create_index("core_studentcontingent_faculty_idx", "core_studentcontingent", ["faculty_name"])
    op.create_index("core_studentcontingent_department_idx", "core_studentcontingent", ["department_name"])
    op.create_index("core_studentcontingent_direction_idx", "core_studentcontingent", ["direction_name"])
    op.create_index("core_studentcontingent_course_idx", "core_studentcontingent", ["course"])
    op.create_index("core_studentcontingent_group_idx", "core_studentcontingent", ["group_name"])
    op.create_index("core_studentcontingent_status_idx", "core_studentcontingent", ["status"])


def downgrade() -> None:
    op.drop_index("core_studentcontingent_status_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_group_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_course_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_direction_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_department_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_faculty_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_hemis_id_idx", table_name="core_studentcontingent")
    op.drop_index("core_studentcontingent_student_id_idx", table_name="core_studentcontingent")
    op.drop_table("core_studentcontingent")
    op.drop_table("core_academicfaculty")
