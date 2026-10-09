"""Dars davomida ishlangan vaqt va guruh qatorlari (2026-10-09 tuzatishi).

Jonli ma'lumotda topilgan ikki xato:
* heartbeat oraliqlari boshi bo'yicha tartiblanganda oxirlari tartibsiz qolardi,
  ikkilik qidiruv ba'zilarini tashlab yuborardi — 50,1 daqiqa 49,7 bo'lib chiqardi;
* HEMIS har guruhni alohida qator beradi — bitta ma'ruza 4 marta sanalardi.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import control_report_service as cr
from app.services import lesson_report_service as lr

DAY = dt.date(2026, 10, 8)


def at(hh, mm=0, ss=0):
    return dt.datetime.combine(DAY, dt.time(hh, mm, ss), tzinfo=lr.ms.TASHKENT)


def lesson(pk, *, user="u1", group="DI-101", monitor="MON-1", room="204", start="13:00", end="14:20"):
    return SimpleNamespace(
        id=pk, hemis_id=str(pk), lesson_date=DAY, weekday="Chorshanba", para="4-para",
        start_time=start, end_time=end, employee_id="1", teacher_name="A", teacher_username=user,
        department_name="Fiziologiya", subject_name="Fiziologiya", group_name=group, lesson_type="Ma'ruza",
        auditorium_name=room, building_name="Bino", monitor_id=monitor,
    )


def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(rows)
    return db


def test_overlapping_spans_of_different_length_are_all_counted():
    """Uzun oraliq qisqasidan oldin boshlanib, keyin tugaydi — oxirlar tartibsiz."""
    spans = [
        (at(13, 0), at(13, 15)),   # 15 daq
        (at(13, 5), at(13, 8)),    # ichida (oxiri oldingisidan kichik!)
        (at(13, 14), at(13, 29)),
        (at(13, 29), at(13, 44)),
        (at(13, 44), at(13, 51)),
    ]
    merged = lr._merge_spans(spans)
    assert merged == [(at(13, 0), at(13, 51))]
    start, end = at(12, 45), at(14, 25)
    assert lr._worked_seconds(merged, [b for _, b in merged], start, end) == 51 * 60


def test_unmerged_spans_used_to_lose_time():
    """Xatoning o'zi: tartibsiz oxirlar bilan eski hisob vaqtni yo'qotardi — endi work_map birlashtiradi."""
    spans = {"u1": [(at(12, 40), at(13, 30)), (at(12, 50), at(12, 55)), (at(13, 30), at(13, 50))]}
    with patch.object(lr.ms, "_work_spans", return_value=spans), \
         patch.object(lr.ms, "_usage_events", return_value={"u1": []}):
        work = lr.work_map(MagicMock(), [lesson(1)])
    # Oyna 12:45-14:25: 12:45-13:50 = 65 daqiqa
    assert work[1][0] == 65 * 60


def test_group_rows_of_one_lecture_are_one_lesson():
    rows = [lesson(1, group="FT-1726"), lesson(2, group="FT-1826"), lesson(3, group="FT-1926"),
            lesson(4, group="FT-2026", start="15:00", end="16:20")]
    merged = lr.merge_group_rows(rows)
    assert [x.id for x in merged] == [1, 4]
    assert lr.lesson_groups(merged[0]) == ("FT-1726", "FT-1826", "FT-1926")


def test_different_rooms_or_teachers_are_not_merged():
    rows = [lesson(1), lesson(2, room="205"), lesson(3, user="u2")]
    assert len(lr.merge_group_rows(rows)) == 3


def _overview(rows, spans):
    with patch.object(cr.ms, "_work_spans", return_value=spans), \
         patch.object(cr.ms, "_usage_events", return_value={u: [] for u in spans}), \
         patch.object(cr.ta, "engagement_map", return_value={}), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.hemis_staff.on_leave_logins", return_value=set()):
        return cr.overview(_db(rows), DAY, DAY)


def test_headline_counts_lessons_not_groups_and_splits_short_ones():
    rows = [
        # u1: bitta ma'ruza 3 guruhga, 60 daqiqa — to'liq o'tilgan
        lesson(1, group="G1"), lesson(2, group="G2"), lesson(3, group="G3"),
        # u2: 40 daqiqa — yaqin, lekin yetmagan
        lesson(4, user="u2", room="301"),
        # u3: 10 daqiqa — kirib chiqqan
        lesson(5, user="u3", room="302"),
        # u4: umuman ochmagan
        lesson(6, user="u4", room="303"),
    ]
    spans = {
        "u1": [(at(13, 0), at(14, 0))],
        "u2": [(at(13, 0), at(13, 40))],
        "u3": [(at(13, 0), at(13, 10))],
        "u4": [],
    }
    h = _overview(rows, spans)["headline"]
    assert h["monitor_lessons"] == 4 and h["monitor_used"] == 1
    assert h["work_buckets"] == {"full": 1, "near": 1, "brief": 1, "none": 1}
    assert h["short_lessons"] == 2 and h["short_near_teachers"] == 1 and h["short_brief_teachers"] == 1


def test_short_people_lists_match_the_buckets():
    rows = [lesson(4, user="u2", room="301"), lesson(5, user="u3", room="302")]
    spans = {"u2": [(at(13, 0), at(13, 40))], "u3": [(at(13, 0), at(13, 10))]}
    with patch.object(cr.ms, "_work_spans", return_value=spans), \
         patch.object(cr.ms, "_usage_events", return_value={"u2": [], "u3": []}), \
         patch.object(cr.ta, "engagement_map", return_value={}), \
         patch.object(cr.ta, "profile_map", return_value={}), \
         patch.object(cr.ta, "materials_map", return_value={}), \
         patch("app.services.hemis_staff.on_leave_logins", return_value=set()):
        near = cr.people(_db(rows), DAY, DAY, metric="short_near")
        brief = cr.people(_db(rows), DAY, DAY, metric="short_brief")
    assert near["total"] == 1 and brief["total"] == 1


def test_fractional_seconds_are_not_lost_piece_by_piece():
    """Ilgari har bo'lak butunga qirqilardi: 100 ta 30,6 soniyalik bo'lak 3000 emas 3000-60 bo'lardi."""
    spans, t = [], at(13, 0)
    for _ in range(100):
        b = t + dt.timedelta(seconds=30.6)
        spans.append((t, b))
        t = b + dt.timedelta(milliseconds=1)   # millisoniyalik bo'shliq — oraliqlar birlashmaydi
    merged = lr._merge_spans(spans)
    assert lr._worked_seconds(merged, [b for _, b in merged], at(12, 45), at(14, 25)) == 3060
