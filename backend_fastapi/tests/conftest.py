"""Testlar orasida jarayon ichidagi keshlar tozalanadi — har test o'z ma'lumotini ko'rsin."""

import pytest


@pytest.fixture(autouse=True)
def _clear_process_caches():
    from app.services import control_report_service, teacher_activity_service

    teacher_activity_service.clear_cache()
    # Nazorat hisoboti keshi testlarda o'chiq: bitta test bir xil sana bilan
    # turli ma'lumotni ketma-ket so'raydi.
    saved = control_report_service.CACHE_SECONDS
    control_report_service.CACHE_SECONDS = 0
    control_report_service.clear_cache()
    yield
    control_report_service.CACHE_SECONDS = saved
    control_report_service.clear_cache()
    teacher_activity_service.clear_cache()


@pytest.fixture
def events_are_full_lessons():
    """Eski hisobot testlari uchun: har "ishlatish" hodisasi — 60 daqiqalik ish.

    2026-10-08 dan dars faqat kamida `MIN_LESSON_MINUTES` daqiqa ishlanganda
    "o'tilgan" hisoblanadi (heartbeat oraliqlari). Bu modullardagi testlar
    undan oldin yozilgan va faqat hodisani (jonli test, QR) beradi — ularning
    ma'nosi "o'qituvchi shu darsni iMentor'da o'tdi". Shu ma'no saqlanadi:
    hodisa vaqtidan boshlab bir soat ishlangan deb olinadi.
    """
    import datetime as dt
    from unittest.mock import patch

    from app.services import monitor_schedule_service as ms

    def fake_spans(db, usernames, start, end):
        events = ms._usage_events(db, usernames, start, end)
        return {
            u: [(when, when + dt.timedelta(minutes=60)) for when, _ in (events.get(u) or [])]
            for u in usernames
        }

    with patch.object(ms, "_work_spans", side_effect=fake_spans):
        yield
