"""Dars jadvali bo'yicha nazorat hisoboti (2026-09-25)."""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import lesson_report_service as lr

DAY = dt.date(2026, 9, 22)


def lesson(pk, *, user="3442112018", name="MADOLIMOV A. M.", para="3-para", start="11:00", end="12:20",
           dep="Fiziologiya", monitor="", subject="Fiziologiya", group="DI-101", day=DAY):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=day, weekday="Seshanba", para=para,
        start_time=start, end_time=end, employee_id="461", teacher_name=name, teacher_username=user,
        department_name=dep, subject_name=subject, group_name=group, lesson_type="Ma'ruza",
        auditorium_name="204", building_name="Oq uy binosi", monitor_id=monitor,
    )


def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(rows)
    return db


def at(hh, mm=0, day=DAY):
    return dt.datetime.combine(day, dt.time(hh, mm), tzinfo=lr.ms.TASHKENT)


def test_lesson_counts_as_used_only_inside_its_own_window():
    rows = [lesson(1, para="3-para", start="11:00", end="12:20"),
            lesson(2, para="6-para", start="16:00", end="17:20")]
    db = _db(rows)
    # 11:05 da faollik — faqat 3-paraga tegishli.
    with patch.object(lr.ms, "_usage_events", return_value={"3442112018": [(at(11, 5), 12)]}):
        out = lr.teacher_rows(db, DAY, DAY)
    (row,) = out["results"]
    assert row["lessons"] == 2 and row["used_lessons"] == 1 and row["usage_percent"] == 50
    assert row["students"] == 12


def test_lesson_without_a_monitor_is_still_counted():
    """Asosiy farq: monitorsiz xonadagi dars ham nazoratda."""
    db = _db([lesson(1, monitor=""), lesson(2, monitor="MON-001")])
    with patch.object(lr.ms, "_usage_events", return_value={"3442112018": []}):
        out = lr.teacher_rows(db, DAY, DAY)
    (row,) = out["results"]
    assert row["lessons"] == 2 and row["with_monitor"] == 1
    assert out["totals"]["lessons"] == 2


def test_teacher_without_an_imentor_account_is_shown_separately():
    db = _db([lesson(1, user="", name="NOMA'LUM X. Y.")])
    with patch.object(lr.ms, "_usage_events", return_value={}):
        out = lr.teacher_rows(db, DAY, DAY)
    (row,) = out["results"]
    assert row["linked"] is False and row["teacher_name"] == "NOMA'LUM X. Y."
    assert row["used_lessons"] == 0
    assert out["totals"]["teachers"] == 1 and out["totals"]["linked_teachers"] == 0


def test_rows_are_sorted_worst_first_and_never_used_is_counted():
    rows = [
        lesson(1, user="a", name="A"),
        lesson(2, user="b", name="B"),
        lesson(3, user="b", name="B", para="6-para", start="16:00", end="17:20"),
    ]
    db = _db(rows)
    # B faqat 3-parada ishlatgan, 6-parasini o'tkazib yuborgan; A umuman ishlatmagan.
    with patch.object(lr.ms, "_usage_events", return_value={"a": [], "b": [(at(11, 5), 3)]}):
        out = lr.teacher_rows(db, DAY, DAY)
    assert [r["teacher_name"] for r in out["results"]] == ["A", "B"]
    assert [r["usage_percent"] for r in out["results"]] == [0, 50]
    assert out["totals"]["never_used"] == 1
    assert out["totals"]["usage_percent"] == 33  # 3 darsdan 1 tasi


def test_departments_are_summarised():
    rows = [lesson(1, dep="Fiziologiya", user="a"), lesson(2, dep="Fiziologiya", user="b"),
            lesson(3, dep="Gistologiya", user="c")]
    db = _db(rows)
    with patch.object(lr.ms, "_usage_events", return_value={"a": [(at(11, 5), 0)], "b": [], "c": []}):
        out = lr.department_rows(db, DAY, DAY)
    by_name = {r["department"]: r for r in out}
    assert by_name["Fiziologiya"]["lessons"] == 2 and by_name["Fiziologiya"]["usage_percent"] == 50
    assert by_name["Fiziologiya"]["teachers"] == 2 and by_name["Fiziologiya"]["active_teachers"] == 1
    assert by_name["Gistologiya"]["usage_percent"] == 0


def test_lesson_list_can_show_only_the_missed_ones():
    db = _db([lesson(1), lesson(2, para="6-para", start="16:00", end="17:20")])
    with patch.object(lr.ms, "_usage_events", return_value={"3442112018": [(at(11, 5), 0)]}):
        rows = lr.lesson_rows(db, DAY, DAY, only_missed=True)
    assert [r["para"] for r in rows] == ["6-para"]
    assert rows[0]["used"] is False


def test_window_falls_back_to_the_pair_timetable_when_time_is_missing():
    start, end = lr._window(lesson(1, start="", end=""))
    assert start.hour == 10 and start.minute == 45  # 11:00 - 15 daqiqa
    assert end.hour == 12 and end.minute == 25
