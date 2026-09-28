"""Kafedralarni HEMIS bilan bog'lash (2026-09-25)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import hemis_departments as hd

HEMIS = [
    {"id": 14, "code": "344-198-03", "name": "Mikrobiologiya, virusologiya va immunologiya",
     "structureType": {"name": "Kafedra"}, "active": True},
    {"id": 20, "code": "344-199-05", "name": "Umumiy jarrohlik", "structureType": {"name": "Kafedra"}, "active": True},
    {"id": 31, "code": "344-199-13", "name": "Yu. Nishonov nomidagi Normal anatomiya",
     "structureType": {"name": "Kafedra"}, "active": True},
    {"id": 40, "code": "344-198", "name": "Davolash ishi fakulteti", "structureType": {"name": "Fakultet"}, "active": True},
    {"id": 41, "code": "344-190", "name": "Yopilgan kafedra", "structureType": {"name": "Kafedra"}, "active": False},
]


def test_only_active_departments_are_taken():
    out = hd.hemis_departments(HEMIS)
    assert [d["id"] for d in out] == [14, 20, 31]


def by_norm():
    return {hd.norm(d["name"]): d for d in hd.hemis_departments(HEMIS)}


def test_names_written_differently_still_match():
    found, how = hd.match("Mikrobiologiya,virusologiya,immunologiya kafedrasi", by_norm())
    assert found["id"] == 14 and how in ("aynan", "yaqin")


def test_manual_list_covers_the_renamed_ones():
    assert hd.match("Umumiy xirurgiya", by_norm())[0]["id"] == 20
    assert hd.match("Normal anatomiya", by_norm())[0]["id"] == 31


def test_a_doubtful_name_is_left_unlinked():
    found, how = hd.match("Terapiya yo'nalishidagi fanlar", by_norm())
    assert found is None and how == "shubhali"


def test_sync_writes_the_link_but_never_the_name():
    dep = SimpleNamespace(name="Mikrobiologiya,virusologiya,immunologiya", is_active=True,
                          hemis_id="", hemis_code="", hemis_name="")
    db = MagicMock()
    db.execute.return_value.scalars.return_value = [dep]
    stats = hd.sync(db, HEMIS)
    assert dep.hemis_id == "14" and dep.hemis_code == "344-198-03"
    assert dep.name == "Mikrobiologiya,virusologiya,immunologiya"  # nom tegilmagan
    assert stats["hemisda"] == 3 and stats["boglanmagan_faol"] == []


def test_unmatched_active_department_is_reported():
    dep = SimpleNamespace(name="Terapiya yo'nalishidagi fanlar", is_active=True,
                          hemis_id="", hemis_code="", hemis_name="")
    db = MagicMock()
    db.execute.return_value.scalars.return_value = [dep]
    stats = hd.sync(db, HEMIS)
    assert dep.hemis_id == "" and stats["boglanmagan_faol"] == ["Terapiya yo'nalishidagi fanlar"]
