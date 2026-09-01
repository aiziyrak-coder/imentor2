"""Online ta'lim moduli uchun jadvallar.

Migratsiya FAQAT yangi jadval qo'shadi — bironta mavjud jadval, ustun yoki
indeksga tegmaydi. Shu sababli mavjud iMentor ishiga ta'sir qilmaydi va
`downgrade` bilan izsiz qaytariladi.

Autogenerate ishlatilmadi: baza dastlab Django tomonidan yaratilgani uchun
`autogenerate` mavjud `core_*` jadvallarida soxta farqlar topib, ularni
o'zgartirishga urinardi.

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, None] = "g7h8i9j0k1l2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "online_syllabus",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_name", sa.String(length=255), nullable=False),
        sa.Column("subject_code", sa.String(length=64), nullable=False),
        sa.Column("department_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("description", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("instruction_language", sa.String(length=8), nullable=False, server_default="uz"),
        sa.Column("file_name", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("topics", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("variants", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("name_i18n", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("topics_i18n", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("subject_code", name="online_syllabus_subject_code_key"),
    )

    op.create_table(
        "online_teacher",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_key", sa.String(length=128), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_key", name="online_teacher_owner_key_key"),
    )

    op.create_table(
        "online_teacher_course",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["teacher_id"], ["online_teacher.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["syllabus_id"], ["online_syllabus.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "teacher_id", "syllabus_id", "variant_label", name="online_teacher_course_uniq"
        ),
    )

    op.create_table(
        "online_group",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="online_group_name_key"),
    )

    op.create_table(
        "online_group_course",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["online_group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["syllabus_id"], ["online_syllabus.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "group_id", "syllabus_id", "variant_label", name="online_group_course_uniq"
        ),
    )

    op.create_table(
        "online_material",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("topic_code", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=1024), nullable=False, server_default=""),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="uz"),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("file", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("file_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("external_url", sa.String(length=1024), nullable=False, server_default=""),
        sa.Column("owner_key", sa.String(length=128), nullable=False),
        sa.Column("author_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["syllabus_id"], ["online_syllabus.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "online_material_topic_idx",
        "online_material",
        ["syllabus_id", "variant_label", "topic_code", "kind"],
    )

    op.create_table(
        "online_lesson",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("topic_code", sa.String(length=32), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("teacher_owner_key", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False, server_default=""),
        sa.Column("room_name", sa.String(length=128), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_opened", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["syllabus_id"], ["online_syllabus.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["online_group.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("room_name", name="online_lesson_room_name_key"),
    )
    op.create_index(
        "online_lesson_topic_idx",
        "online_lesson",
        ["syllabus_id", "variant_label", "topic_code", "group_id"],
    )

    op.create_table(
        "online_attendance",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.String(length=64), nullable=False),
        sa.Column("student_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="jitsi"),
        sa.ForeignKeyConstraint(["lesson_id"], ["online_lesson.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("lesson_id", "student_id", name="online_attendance_uniq"),
    )

    op.create_table(
        "online_progress",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("student_id", sa.String(length=64), nullable=False),
        sa.Column("student_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("group_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("syllabus_id", sa.Integer(), nullable=False),
        sa.Column("variant_label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("topic_code", sa.String(length=32), nullable=False),
        sa.Column("lecture_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("presentation_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("video_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handout_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("case_answer", sa.Text(), nullable=False, server_default=""),
        sa.Column("case_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test_answers", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("test_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("test_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["syllabus_id"], ["online_syllabus.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "student_id", "syllabus_id", "variant_label", "topic_code",
            name="online_progress_uniq",
        ),
    )
    op.create_index(
        "online_progress_student_idx", "online_progress", ["student_id", "syllabus_id"]
    )


def downgrade() -> None:
    op.drop_index("online_progress_student_idx", table_name="online_progress")
    op.drop_table("online_progress")
    op.drop_table("online_attendance")
    op.drop_index("online_lesson_topic_idx", table_name="online_lesson")
    op.drop_table("online_lesson")
    op.drop_index("online_material_topic_idx", table_name="online_material")
    op.drop_table("online_material")
    op.drop_table("online_group_course")
    op.drop_table("online_group")
    op.drop_table("online_teacher_course")
    op.drop_table("online_teacher")
    op.drop_table("online_syllabus")
