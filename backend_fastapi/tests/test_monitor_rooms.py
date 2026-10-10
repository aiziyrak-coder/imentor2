"""Xona holati ayb qaydaligini hal qiladi (2026-09-25).

«U xonada monitor yo'q edi» degan bahona shu yerda tekshiriladi: agar o'sha
xonada boshqa kimdir iMentor ochgan bo'lsa, monitor ishlayapti va bahona
qolmaydi; hech kim ocha olmagan bo'lsa, ayb o'qituvchida emas, xonada.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import control_report_service as cr
from app.services import monitor_room_service as mr

import pytest

# Hodisa = darsni to'liq iMentor'da o'tgani (50 daqiqa qoidasi, qarang conftest).
pytestmark = pytest.mark.usefixtures("events_are_full_lessons")

DAY = dt.date(2026, 9, 22)


def lesson(pk, *, user="u1", monitor="MON-001", room="204", day=DAY, dep="Fiziologiya"):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=day, weekday="Seshanba", para="3-para",
        start_time="11:00", end_time="12:20", employee_id="461", teacher_name=user.upper(),
        teacher_username=user, department_name=dep, subject_name="Fiziologiya",
        group_name="DI-101", lesson_type="Amaliy", auditorium_name=room,
        building_name="Oq uy binosi", monitor_id=monitor,
        monitor_room="Oq uy 2 qavat 204-xona", monitor_department=dep,
        auditorium_code="A204", synced_at=None,
    )


def test_one_recorded_use_proves_the_monitor_works():
    rows = [lesson(1, user="a"), lesson(2, user="b"), lesson(3, user="c")]
    stats = mr.room_stats(rows, {1: (True, 12)})
    assert stats["MON-001"]["status"] == "ok"
    # Ishlatmagan "b" uchun bahona yo'q — xona ishlayotgani isbotlangan.
    assert mr.teacher_excuse([rows[1]], stats) == "none"


def test_a_room_nobody_could_use_is_the_room_s_problem():
    rows = [lesson(i, user=f"u{i % 4}") for i in range(1, 11)]
    stats = mr.room_stats(rows, {})
    assert stats["MON-001"]["status"] == "suspect"
    assert mr.teacher_excuse(rows[:2], stats) == "check_room"


def test_too_little_evidence_is_not_a_verdict():
    """Ikki dars, bitta o'qituvchi — monitor buzuq deb ayblash uchun kam."""
    rows = [lesson(1), lesson(2)]
    stats = mr.room_stats(rows, {})
    assert stats["MON-001"]["status"] == "quiet"


def test_payload_puts_the_rooms_to_check_first():
    rows = [lesson(i, monitor="MON-002", user=f"u{i}") for i in range(1, 12)]
    rows += [lesson(100, monitor="MON-001")]
    stats = mr.room_stats(rows, {100: (True, 3)})
    out = mr.payload(stats)
    assert [r["monitor_id"] for r in out] == ["MON-002", "MON-001"]
    assert out[0]["status_label"] == "tekshirish kerak"
    assert out[1]["percent"] == 100


def test_summary_counts_the_rooms_by_verdict():
    rows = [lesson(i, monitor="MON-002", user=f"u{i}") for i in range(1, 12)] + [lesson(100)]
    stats = mr.room_stats(rows, {100: (True, 1)})
    assert mr.summary(stats) == {"rooms": 2, "ok": 1, "suspect": 1, "quiet": 0, "suspect_lessons": 11}


# ------------------------------------------------------------------ hisobotda


def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(rows)
    return db


def _run(rows, events):
    with patch.object(cr.ms, "_usage_events", return_value=events), \
         patch.object(cr.ta, "engagement_map", return_value={}), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.hemis_staff.on_leave_logins", return_value=set()):
        return cr.overview(_db(rows), DAY, DAY)


def at(hh, mm=0):
    return dt.datetime.combine(DAY, dt.time(hh, mm), tzinfo=cr.ms.TASHKENT)


def test_report_separates_the_blamed_from_the_rooms_to_check():
    # MON-001: "a" ishlatgan, "b" ishlatmagan → "b" ning bahonasi yo'q.
    # MON-002: 10 dars, 4 o'qituvchi, hech kim ishlatmagan → xonani tekshirish kerak.
    rows = [lesson(1, user="a"), lesson(2, user="b")]
    rows += [lesson(10 + i, user=f"c{i % 4}", monitor="MON-002") for i in range(10)]
    out = _run(rows, {"a": [(at(11, 5), 9)]})

    assert [r["teacher_name"] for r in out["attention"]] == ["B"]
    assert out["attention"][0]["proven_lessons"] == 1
    assert {r["teacher_name"] for r in out["check_room"]} == {"C0", "C1", "C2", "C3"}
    assert out["headline"]["blamed_teachers"] == 1 and out["headline"]["check_room_teachers"] == 4
    assert out["room_summary"]["suspect"] == 1 and out["room_summary"]["ok"] == 1


def test_report_carries_its_own_source():
    out = _run([lesson(1)], {"u1": []})
    src = out["source"]
    assert src["lessons"] == 1 and src["teachers"] == 1 and src["unlinked_teachers"] == 0
