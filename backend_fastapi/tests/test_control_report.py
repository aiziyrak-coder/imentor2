"""Rektor nazorat hisoboti (2026-09-25): monitorli darslar asosiy o'lchov."""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import control_report_service as cr

import pytest

# Hodisa = darsni to'liq iMentor'da o'tgani (50 daqiqa qoidasi, qarang conftest).
pytestmark = pytest.mark.usefixtures("events_are_full_lessons")

DAY = dt.date(2026, 9, 22)


def lesson(pk, *, user="u1", name="AZIZOV A. A.", monitor="MON-001", para="3-para",
           start="11:00", end="12:20", dep="Fiziologiya", room="204", day=DAY):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=day, weekday="Seshanba", para=para,
        start_time=start, end_time=end, employee_id="461", teacher_name=name, teacher_username=user,
        department_name=dep, subject_name="Fiziologiya", group_name="DI-101", lesson_type="Ma'ruza",
        auditorium_name=room, building_name="Oq uy binosi", monitor_id=monitor,
    )


def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(rows)
    return db


def at(hh, mm=0, day=DAY):
    return dt.datetime.combine(day, dt.time(hh, mm), tzinfo=cr.ms.TASHKENT)


def _quiet_activity():
    """Ikkinchi qatlam (daqiqa, profil, material) alohida sinaladi — bu yerda bo'sh."""
    return (
        patch.object(cr.ta, "engagement_map", return_value={}),
        patch.object(cr.ta, "profile_map", return_value={}),
        patch.object(cr.ta, "materials_map", return_value={}),
        patch("app.services.hemis_staff.on_leave_logins", return_value=set()),
    )


def run(rows, events, start=DAY, end=DAY):
    a, b, c, d = _quiet_activity()
    with patch.object(cr.ms, "_usage_events", return_value=events), a, b, c, d:
        return cr.overview(_db(rows), start, end)


def test_headline_counts_only_monitor_rooms():
    """Asosiy foiz monitorli darslardan hisoblanadi; monitorsizlari alohida turadi."""
    rows = [lesson(1, monitor="MON-001"), lesson(2, monitor=""), lesson(3, monitor="", para="6-para", start="16:00", end="17:20")]
    out = run(rows, {"u1": [(at(11, 5), 10)]})
    h = out["headline"]
    assert h["monitor_lessons"] == 1 and h["monitor_used"] == 1 and h["monitor_percent"] == 100
    assert h["other_lessons"] == 2 and h["other_used"] == 1  # monitorsiz darsda ham ishlatgan
    assert h["total_lessons"] == 3


def test_a_teacher_without_a_monitor_room_is_listed_separately():
    """Klinikada yoki masofadan dars o'tadigan o'qituvchi asosiy ro'yxatda EMAS.

    Uni monitor bo'yicha baholab bo'lmaydi, bitta ro'yxatga qo'shilsa esa
    raqamlarni chalkashtiradi (2026-10-06).
    """
    out = run([lesson(1, monitor="")], {"u1": []})
    assert out["teachers"] == []
    (row,) = out["offsite"]["teachers"]
    assert row["monitor_lessons"] == 0 and row["monitor_percent"] is None and row["band"] == "none"
    assert out["headline"]["watched_teachers"] == 0 and out["headline"]["idle_teachers"] == 0
    assert out["headline"]["offsite_teachers"] == 1


def test_the_separate_list_says_where_those_lessons_are():
    """Rektor "qayerda dars o'tilyapti" degan savolga javob olsin."""
    out = run([lesson(1, monitor="", room="Online (Masofaviy)")], {"u1": []})
    places = out["offsite"]["places"]
    assert places and places[0]["lessons"] == 1
    assert "Online (Masofaviy)" in places[0]["place"]
    assert places[0]["teachers"] == 1


def test_attention_list_holds_those_who_never_used_a_monitor_room():
    rows = [lesson(1, user="a", name="A"), lesson(2, user="a", name="A", para="4-para", start="13:00", end="14:20"),
            lesson(3, user="b", name="B")]
    out = run(rows, {"a": [], "b": [(at(11, 5), 0)]})
    assert [r["teacher_name"] for r in out["attention"]] == ["A"]
    assert out["attention"][0]["monitor_lessons"] == 2
    assert out["headline"]["idle_teachers"] == 1 and out["headline"]["watched_teachers"] == 2


def test_unlinked_teacher_is_never_blamed():
    """iMentor hisobi yo'q o'qituvchi 'ishlamagan'lar ro'yxatiga tushmaydi."""
    out = run([lesson(1, user="", name="NOMA'LUM X.")], {})
    assert out["attention"] == [] and out["headline"]["unlinked_teachers"] == 1
    assert out["teachers"][0]["band"] == "none"


def test_bands_follow_the_thresholds():
    assert cr._band(100) == "good" and cr._band(70) == "good"
    assert cr._band(69) == "warn" and cr._band(40) == "warn"
    assert cr._band(39) == "bad" and cr._band(0) == "bad"
    assert cr._band(None) == "none"


def test_departments_and_days_are_summarised():
    rows = [lesson(1, user="a", dep="Fiziologiya"), lesson(2, user="b", dep="Fiziologiya"),
            lesson(3, user="c", dep="Gistologiya", day=dt.date(2026, 9, 23))]
    out = run(rows, {"a": [(at(11, 5), 5)], "b": [], "c": []}, end=dt.date(2026, 9, 23))
    dep = {d["department"]: d for d in out["departments"]}
    assert dep["Fiziologiya"]["monitor_lessons"] == 2 and dep["Fiziologiya"]["percent"] == 50
    assert dep["Fiziologiya"]["active_teachers"] == 1 and dep["Fiziologiya"]["teachers"] == 2
    assert dep["Gistologiya"]["band"] == "bad"
    assert [d["date"] for d in out["daily"]] == ["2026-09-22", "2026-09-23"]
    assert out["daily"][0]["percent"] == 50


def test_worst_teachers_come_first():
    rows = [lesson(1, user="good", name="G"), lesson(2, user="bad", name="B"),
            lesson(3, user="bad", name="B", para="4-para", start="13:00", end="14:20")]
    out = run(rows, {"good": [(at(11, 5), 0)], "bad": []})
    assert [r["teacher_name"] for r in out["teachers"]] == ["B", "G"]


def test_teacher_on_leave_is_never_on_the_red_list():
    rows = [lesson(1, user="a", name="A"), lesson(2, user="b", name="B")]
    a, b, c, _ = _quiet_activity()
    with patch.object(cr.ms, "_usage_events", return_value={"a": [], "b": []}), a, b, c,          patch("app.services.hemis_staff.on_leave_logins", return_value={"b"}):
        out = cr.overview(_db(rows), DAY, DAY)
    assert [r["teacher_name"] for r in out["attention"] + out["check_room"]] == ["A"]
    assert out["headline"]["on_leave_teachers"] == 1
    assert next(r for r in out["teachers"] if r["teacher_key"] == "b")["on_leave"] is True


# ------------------------------------------- o'qituvchi kesimi va tugamagan darslar


def _run_spans(rows, spans, *, now=None):
    """Aniq ish oraliqlari bilan: (boshi, oxiri) — necha daqiqa ishlagani muhim."""
    a, b, c, d = _quiet_activity()
    clock = patch.object(cr.lr, "current_time", return_value=now or at(23, 0))
    with patch.object(cr.ms, "_usage_events", return_value={}), \
            patch.object(cr.ms, "_work_spans", return_value=spans), clock, a, b, c, d:
        return cr.overview(_db(rows), DAY, DAY)


def test_every_teacher_falls_into_exactly_one_bucket():
    """Hammasini o'tgan / qisman / kirgan-o'tmagan / ochmagan — bir-birini qoplamaydi.

    Ilgari "kirgan, dars o'tmagan" va "umuman ishlatmagan" bitta odamni ikki
    marta sanardi va yig'indi nazoratdagilardan oshib ketardi.
    """
    second = dict(para="4-para", start="13:00", end="14:20")
    rows = [
        lesson(1, user="full", name="F"), lesson(2, user="full", name="F", **second),
        lesson(3, user="part", name="P"), lesson(4, user="part", name="P", **second),
        lesson(5, user="peek", name="K"), lesson(6, user="peek", name="K", **second),
        lesson(7, user="none", name="N"),
    ]
    spans = {
        "full": [(at(11, 0), at(12, 20)), (at(13, 0), at(14, 20))],
        "part": [(at(11, 0), at(12, 20))],          # 2 darsdan 1 tasini o'tgan
        "peek": [(at(11, 0), at(11, 10))],          # 10 daqiqa kirib chiqqan
    }
    out = _run_spans(rows, spans)
    h = out["headline"]
    assert h["teacher_buckets"] == {"full": 1, "partial": 1, "opened": 1, "none": 1,
                                    "on_leave": 0, "unlinked": 0}
    assert sum(h["teacher_buckets"].values()) == h["watched_teachers"] == 4
    assert h["teachers_used"] == 2 and h["teacher_percent"] == 50
    assert h["partial_missed_lessons"] == 1
    part = next(r for r in out["teachers"] if r["teacher_key"] == "part")
    assert (part["state"], part["monitor_used"], part["monitor_missed"]) == ("partial", 1, 1)
    # "Qayd yo'q" ro'yxatida faqat umuman ochmagan — kirib chiqqanda qayd bor.
    assert [r["teacher_name"] for r in out["check_room"]] == ["N"]


def test_lessons_that_have_not_ended_yet_are_not_judged():
    """Soat 12:30 da 13:00 dagi dars "ishlatilmagan" emas — u hali boshlanmagan."""
    rows = [lesson(1, user="a", name="A"),
            lesson(2, user="a", name="A", para="4-para", start="13:00", end="14:20"),
            lesson(3, user="b", name="B", para="5-para", start="14:30", end="15:50")]
    out = _run_spans(rows, {"a": [(at(11, 0), at(12, 20))]}, now=at(12, 30))
    h = out["headline"]
    assert (h["monitor_lessons"], h["monitor_used"], h["monitor_percent"]) == (1, 1, 100)
    assert h["watched_teachers"] == 1 and h["teacher_buckets"]["full"] == 1
    assert h["pending"]["monitor_lessons"] == 2 and h["pending"]["teachers"] == 2
    assert out["teachers"][0]["pending_lessons"] == 1
    # Kun tugagach hammasi hisobga kiradi.
    late = _run_spans(rows, {"a": [(at(11, 0), at(12, 20))]})["headline"]
    assert late["monitor_lessons"] == 3 and late["pending"]["lessons"] == 0


def test_report_is_computed_once_within_the_cache_window(monkeypatch):
    """Jonli rejim va bir necha tomoshabin: bir xil so'rov qayta hisoblanmaydi."""
    monkeypatch.setattr(cr, "CACHE_SECONDS", 45)
    rows = [lesson(1, user="a", name="A")]
    a, b, c, d = _quiet_activity()
    with patch.object(cr.ms, "_usage_events", return_value={}), \
            patch.object(cr.ms, "_work_spans", return_value={}) as spans, a, b, c, d:
        first = cr.overview(_db(rows), DAY, DAY)
        first["teachers"] = []                      # yo'l javobni o'zgartirsa ham
        second = cr.overview(_db(rows), DAY, DAY)
        cr.people(_db(rows), DAY, DAY, metric="t_none")
    assert spans.call_count == 1
    assert [r["teacher_name"] for r in second["teachers"]] == ["A"]
