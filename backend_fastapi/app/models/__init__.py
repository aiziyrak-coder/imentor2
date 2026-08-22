"""Barcha SQLAlchemy modellarini shu yerda import qilish — Alembic
autogenerate va `Base.metadata` to'liq sxemani ko'rishi uchun shart."""

from app.models import (  # noqa: F401
    analytics,
    book,
    clinical_group,
    content,
    device_pairing,
    live_test,
    prepared_content,
    staff_location,
    startup,
    syllabus_document,
    topic_content,
    user,
)
