"""Guruhni monitorli xonaga biriktirish — `group_rooms` (2026-10-07).

HEMIS darsni boshqa xonaga yozgan, dars esa amalda kafedraning monitorli
xonasida o'tadi: hisobotda u "monitorsiz" bo'lib qolmasligi kerak.
"""

import datetime as dt
from unittest.mock import patch

from app.services import hemis_schedule as hs
from app.services import monitor_schedule_service as ms

ROOM_108 = "YuKSHQO'B \n(1-qavat) 108- auditoriya"

INVENTORY = {
    "departments": [
        {
            "row": 5,
            "department": "Mikrobiologiya, virusologiya va immunologiya kafedrasi",
            "rooms": ["YuKSHQO'B \n(1-qavat) 106-auditoriya", ROOM_108],
            "aliases": ["Mikrobiologiya,virusologiya,immunologiya"],
            "group_rooms": [{"room": ROOM_108, "groups": ["824-21", "DI 3325"]}],
        },
        {
            "row": 6,
            "department": "Normal anatomiya kafedrasi",
            "rooms": ["Oq uy 2 qavat 204-xona"],
        },
    ]
}


def lesson(**kw):
    base = {
        "id": 1, "auditorium": {"code": 999}, "employee": {"id": 461, "name": "X"},
        "lessonPair": {"name": "2"}, "trainingType": {"name": "Amaliy"},
        "subject": {"name": "Mikrobiologiya"}, "group": {"name": "824-21"},
        "department": {"name": "Mikrobiologiya,virusologiya,immunologiya"},
        "lesson_date": int(dt.datetime(2026, 10, 6, 5, 0, tzinfo=dt.timezone.utc).timestamp()),
    }
    return {**base, **kw}


def _bindings():
    with patch.object(ms, "inventory", return_value=INVENTORY):
        return ms.group_monitors(), ms.monitors()


def test_bound_group_goes_to_its_room_whatever_hemis_says():
    bound, monitors = _bindings()
    room_108 = next(m for m in monitors if "108" in m["room_full"])
    mon = ms.monitor_for_group(bound, "Mikrobiologiya,virusologiya,immunologiya", "824-21")
    assert mon["monitor_id"] == room_108["monitor_id"]
    # Bo'sh joy va katta-kichik harf farqi muhim emas.
    assert ms.monitor_for_group(bound, "Mikrobiologiya, virusologiya va immunologiya kafedrasi", "di3325") is mon


def test_binding_belongs_to_its_department_only():
    bound, _ = _bindings()
    assert ms.monitor_for_group(bound, "Normal anatomiya", "824-21") is None
    assert ms.monitor_for_group(bound, "Mikrobiologiya,virusologiya,immunologiya", "825-21") is None
    assert ms.monitor_for_group(bound, "", "824-21") is None


def test_unknown_room_in_binding_is_ignored():
    inv = {"departments": [{**INVENTORY["departments"][0], "group_rooms": [{"room": "999-xona", "groups": ["824-21"]}]}]}
    with patch.object(ms, "inventory", return_value=inv):
        assert ms.group_monitors() == {}


def test_bound_lesson_becomes_monitor_entry_even_in_room_without_monitor():
    bound, monitors = _bindings()
    room_108 = next(m for m in monitors if "108" in m["room_full"])
    with patch.object(ms, "group_monitors", return_value=bound):
        entries, stats = hs.build_entries(
            [lesson(), lesson(id=2, group={"name": "825-21"})], {}, {461: "3442112018"},
            start=dt.date(2026, 10, 5), end=dt.date(2026, 10, 11),
        )
    assert [e.hemis_id for e in entries] == ["1"]
    assert entries[0].monitor_id == room_108["monitor_id"]
    assert stats["monitorsiz_xona"] == 1
