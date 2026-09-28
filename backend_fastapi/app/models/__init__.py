"""Barcha SQLAlchemy modellarini shu yerda import qilish — Alembic
autogenerate va `Base.metadata` to'liq sxemani ko'rishi uchun shart."""

from app.models import (  # noqa: F401
    ai_usage,
    analytics,
    book,
    client_error,
    clinical_group,
    content,
    device_pairing,
    face_template,
    hemis_lesson,
    live_test,
    monitor_schedule,
    online_edu,
    password_policy,
    prepared_content,
    staff_location,
    staff_pinfl,
    startup,
    student_contingent,
    syllabus_document,
    topic_content,
    user,
)
