"""Raqam ortidagi odamlar ro'yxati (2026-09-28).

Rektor sahifadagi istalgan raqamni bosadi — kim ekani chiqadi. Eng muhim
talab: ro'yxatdagi odamlar soni sahifadagi RAQAM bilan bir xil bo'lsin.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import control_report_service as cr

import pytest

# Hodisa = darsni to'liq iMentor'da o'tgani (50 daqiqa qoidasi, qarang conftest).
pytestmark = pytest.mark.usefixtures("events_are_full_lessons")

DAY = dt.date(2026, 9, 22)


def lesson(pk, *, user="u1", name="AZIZOV A. A.", monitor="MON-001", dep="Fiziologiya", day=DAY, room="204"):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=day, weekday="Seshanba", para="3-para",
        start_time="11:00", end_time="12:20", employee_id="461", teacher_name=name,
        teacher_username=user, department_name=dep, subject_name="Fiziologiya",
        group_name="DI-101", lesson_type="Amaliy", auditorium_name=room,
        building_name="Oq uy binosi", monitor_id=monitor, monitor_room="Oq uy 204-xona",
        monitor_department=dep, auditorium_code="A204", synced_at=None,
    )


def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(rows)
    return db


def run(rows, events, metrics=(), *, engagement=None, profiles=None, leave=()):
    """Hisobot ham, ro'yxat ham AYNI ma'lumotdan quriladi."""
    with patch.object(cr.ms, "_usage_events", return_value=events),          patch.object(cr.ta, "engagement_map", return_value=engagement or {}),          patch.object(cr.ta, "profile_map", return_value=profiles or {}),          patch.object(cr.ta, "materials_map", return_value={}),          patch("app.services.rector_report_service.staff_directory", return_value={}),          patch("app.services.hemis_staff.on_leave_logins", return_value=set(leave)):
        overview = cr.overview(_db(rows), DAY, DAY)
        drills = {m: cr.people(_db(rows), DAY, DAY, metric=m) for m in metrics}
    return overview, drills


def at(hh, mm=0):
    return dt.datetime.combine(DAY, dt.time(hh, mm), tzinfo=cr.ms.TASHKENT)


# --- eng muhim tekshiruv: ro'yxat soni sahifadagi raqam bilan bir xil ---------

def test_every_headline_number_opens_exactly_that_many_people():
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B"),
            lesson(3, user="c", name="C", monitor=""), lesson(4, user="", name="NOMA'LUM")]
    overview, d = run(rows, {"a": [(at(11, 5), 7)], "b": [], "c": [(at(11, 5), 3)]},
                      ["watched", "idle", "blamed", "check_room", "unlinked", "other_used"])
    h = overview["headline"]

    assert d["watched"]["total"] == h["watched_teachers"]
    assert d["idle"]["total"] == h["idle_teachers"]
    assert d["blamed"]["total"] == h["blamed_teachers"]
    assert d["check_room"]["total"] == h["check_room_teachers"]
    assert d["unlinked"]["total"] == h["unlinked_teachers"]
    assert d["other_used"]["total"] == 1  # "c" monitorsiz xonada ishlatgan


def test_quality_numbers_match_their_lists():
    engagement = {
        "a": {"minutes": 40, "active_days": 1, "modules": [{"page": "tests", "label": "Test", "minutes": 40, "opens": 3}],
              "created": {"tests": 2}, "created_total": 2, "depth": "worked", "viewed": {}},
        "b": {"minutes": 30, "active_days": 1, "modules": [], "created": {}, "created_total": 0,
              "depth": "viewed", "viewed": {}},
        "c": {"minutes": 0, "active_days": 0, "modules": [], "created": {}, "created_total": 0,
              "depth": "none", "viewed": {}},
    }
    profiles = {"a": {"percent": 100, "missing": [], "subjects": 2},
                "b": {"percent": 60, "missing": ["Surat"], "subjects": 0}}
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B"), lesson(3, user="c", name="C")]
    overview, d = run(rows, {"a": [(at(11, 5), 1)], "b": [], "c": []},
                      ["worked", "viewed", "never", "no_subject", "profile_incomplete", "teachers"],
                      engagement=engagement, profiles=profiles)
    q = overview["quality"]

    assert d["worked"]["total"] == q["worked"]
    assert d["viewed"]["total"] == q["viewed"]
    assert d["never"]["total"] == q["never"]
    assert d["no_subject"]["total"] == q["no_subject"]
    assert d["profile_incomplete"]["total"] == q["profile_incomplete"]
    assert d["teachers"]["total"] == q["teachers"]
    assert [p["name"] for p in d["worked"]["people"]] == ["A"]


def test_department_row_opens_its_own_teachers():
    rows = [lesson(1, user="a", name="A", dep="Fiziologiya"), lesson(2, user="b", name="B", dep="Fiziologiya"),
            lesson(3, user="c", name="C", dep="Gistologiya")]
    overview, d = run(rows, {"a": [(at(11, 5), 2)], "b": [], "c": []},
                      ["department:Fiziologiya", "department_active:Fiziologiya"])
    dep = next(x for x in overview["departments"] if x["department"] == "Fiziologiya")

    assert d["department:Fiziologiya"]["total"] == dep["teachers"]
    assert d["department_active:Fiziologiya"]["total"] == dep["active_teachers"]
    assert {p["name"] for p in d["department:Fiziologiya"]["people"]} == {"A", "B"}


def test_department_count_matches_when_a_teacher_works_in_two_departments():
    """2026-09-28: ikki kafedrada dars o'tadigan o'qituvchi kafedra sonidan tushib qolardi."""
    rows = [lesson(1, user="a", name="A", dep="Fiziologiya"),
            lesson(2, user="a", name="A", dep="Gistologiya"),
            lesson(3, user="b", name="B", dep="Fiziologiya")]
    overview, d = run(rows, {"a": [(at(11, 5), 2)], "b": []},
                      ["department:Fiziologiya", "department_active:Fiziologiya"])
    dep = next(x for x in overview["departments"] if x["department"] == "Fiziologiya")

    assert dep["teachers"] == 2
    assert d["department:Fiziologiya"]["total"] == dep["teachers"]
    assert d["department_active:Fiziologiya"]["total"] == dep["active_teachers"]


def test_module_count_matches_the_page_number():
    """Sahifadagi "N kishi" faqat jadvalda darsi borlarni sanaydi — ro'yxat ham."""
    engagement = {
        "a": {"minutes": 40, "modules": [{"page": "tests", "label": "Test", "minutes": 40, "opens": 2}],
              "created": {"tests": 1}, "created_total": 1, "depth": "worked", "viewed": {}, "active_days": 1},
        # Jadvalda darsi yo'q xodim — sahifadagi songa ham, ro'yxatga ham kirmaydi.
        "z": {"minutes": 99, "modules": [{"page": "tests", "label": "Test", "minutes": 99, "opens": 9}],
              "created": {"tests": 5}, "created_total": 5, "depth": "worked", "viewed": {}, "active_days": 1},
    }
    rows = [lesson(1, user="a", name="A")]
    overview, d = run(rows, {"a": []}, ["module:tests", "created:tests"], engagement=engagement)
    module = next(m for m in overview["modules"] if m["page"] == "tests")

    assert module["people"] == 1
    assert d["module:tests"]["total"] == module["people"]
    assert [p["name"] for p in d["module:tests"]["people"]] == ["A"]
    assert d["created:tests"]["total"] == 1


def test_a_module_opened_for_zero_minutes_still_counts():
    """Sahifadagi "N kishi" bo'limni ochgan hammani sanaydi — ro'yxat ham."""
    engagement = {
        "a": {"minutes": 0, "modules": [{"page": "tests", "label": "Test", "minutes": 0, "opens": 3}],
              "created": {}, "created_total": 0, "depth": "visit", "viewed": {}, "active_days": 1},
    }
    rows = [lesson(1, user="a", name="A")]
    overview, d = run(rows, {"a": []}, ["module:tests"], engagement=engagement)
    module = next(m for m in overview["modules"] if m["page"] == "tests")
    assert d["module:tests"]["total"] == module["people"] == 1


def test_daily_bar_opens_that_day_only():
    other = dt.date(2026, 9, 23)
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B", day=other)]
    with patch.object(cr.ms, "_usage_events", return_value={"a": [], "b": []}), \
         patch.object(cr.ta, "engagement_map", return_value={}), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.hemis_staff.on_leave_logins", return_value=set()):
        out = cr.people(_db(rows), DAY, other, metric=f"day:{other.isoformat()}")
    assert [p["name"] for p in out["people"]] == ["B"]


def test_room_opens_its_teachers_and_the_idle_ones():
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B")]
    _, d = run(rows, {"a": [(at(11, 5), 4)], "b": []}, ["room:MON-001", "room_idle:MON-001"])
    assert {p["name"] for p in d["room:MON-001"]["people"]} == {"A", "B"}
    assert [p["name"] for p in d["room_idle:MON-001"]["people"]] == ["B"]


def test_module_and_created_open_the_teachers_behind_them():
    engagement = {
        "a": {"minutes": 40, "active_days": 1, "created": {"tests": 3}, "created_total": 3, "depth": "worked",
              "modules": [{"page": "tests", "label": "Test", "minutes": 40, "opens": 3}], "viewed": {}},
        "b": {"minutes": 10, "active_days": 1, "created": {"tests": 0}, "created_total": 0, "depth": "viewed",
              "modules": [{"page": "cases", "label": "Keys", "minutes": 10, "opens": 1}], "viewed": {}},
    }
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B")]
    with patch.object(cr.ms, "_usage_events", return_value={"a": [], "b": []}), \
         patch.object(cr.ta, "engagement_map", return_value=engagement), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.rector_report_service.staff_directory", return_value={}), \
         patch("app.services.hemis_staff.on_leave_logins", return_value=set()):
        db = _db(rows)
        mod = cr.people(db, DAY, DAY, metric="module:tests")
        made = cr.people(_db(rows), DAY, DAY, metric="created:tests")
    assert [p["name"] for p in mod["people"]] == ["A"] and mod["people"][0]["value"] == 40
    assert [p["name"] for p in made["people"]] == ["A"] and made["people"][0]["value"] == 3


def test_a_teacher_on_leave_is_marked_but_still_findable():
    rows = [lesson(1, user="a", name="A")]
    _, d = run(rows, {"a": []}, ["idle", "on_leave"], leave={"a"})
    assert d["idle"]["total"] == 0          # qizil ro'yxatda yo'q
    assert d["on_leave"]["people"][0]["note"] == "ta’tilda"


def test_unknown_metric_is_rejected():
    with pytest.raises(ValueError):
        cr.people(_db([]), DAY, DAY, metric="yolg'on")


def test_the_offsite_number_matches_its_list():
    """"Monitorsiz joyda ishlaydiganlar" raqami ham bosiladi (2026-10-06).

    Qoida o'zgarmaydi: sahifadagi raqam = ro'yxatdagi odamlar soni.
    """
    rows = [
        lesson(1, user="mon", name="M"),                       # monitorli xonada
        lesson(2, user="klinika", name="K", monitor=""),       # klinikada
        lesson(3, user="masofa", name="S", monitor=""),        # masofaviy
    ]
    overview, drills = run(rows, {}, ["offsite", "watched"])
    assert overview["headline"]["offsite_teachers"] == 2
    assert drills["offsite"]["total"] == 2
    assert {p["name"] for p in drills["offsite"]["people"]} == {"K", "S"}
    # Asosiy ro'yxat ularni O'Z ICHIGA OLMAYDI.
    assert [r["teacher_name"] for r in overview["teachers"]] == ["M"]
    assert drills["watched"]["total"] == overview["headline"]["watched_teachers"] == 1
    assert len(overview["offsite"]["teachers"]) == 2
