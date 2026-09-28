"""Klinik kafedralar ro'yxati — institut hujjati (2026-09-25).

Bu bayroq AI materialning klinik yoki klinik emasligini hal qiladi, shuning
uchun ro'yxatning o'zi ham, nom taqqoslash ham sinaladi.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import clinical_departments as cd


def test_official_list_has_the_fifteen_departments():
    names = [d["name"] for d in cd.official()]
    assert len(names) == 15
    assert "Pediatriya kafedrasi" in names
    assert all(d.get("base") for d in cd.official())


def test_name_matching_ignores_spelling_and_suffix():
    assert cd.is_clinical_name("Pediatriya kafedrasi")
    assert cd.is_clinical_name("Pediatriya")  # "kafedrasi" qo'shimchasisiz
    assert cd.is_clinical_name("Terapiya yo‘nalishidagi fanlar kafedrasi")
    assert cd.is_clinical_name("Terapiya yo'nalishidagi fanlar")  # boshqa tutuq belgisi


def test_basic_science_departments_are_not_clinical():
    for name in ("Yu. Nishonov nomidagi Normal anatomiya", "Fiziologiya",
                 "Tibbiy va biologik kimyo", "O'zbek va xorijiy tillar", "Ijtimoiy fanlar"):
        assert not cd.is_clinical_name(name), name


def test_clinical_base_is_reported():
    assert cd.clinical_base("Pediatriya kafedrasi") == "Viloyat bolalar shifoxonasi"
    assert cd.clinical_base("Fiziologiya") == ""


def test_sync_sets_the_flag_both_ways():
    rows = [
        SimpleNamespace(name="Pediatriya kafedrasi", is_clinical=False),
        SimpleNamespace(name="Fiziologiya", is_clinical=True),   # noto'g'ri qo'yilgan
        SimpleNamespace(name="Umumiy jarrohlik kafedrasi", is_clinical=True),  # allaqachon to'g'ri
    ]
    db = MagicMock()
    db.execute.return_value.scalars.return_value = rows
    stats = cd.sync(db)

    assert rows[0].is_clinical is True
    assert rows[1].is_clinical is False
    assert rows[2].is_clinical is True
    assert stats["kafedra"] == 3 and stats["klinik"] == 2 and stats["ozgardi"] == 2
    # Qolganlari bazada yo'q — ro'yxat ochiq aytiladi. "Pediatriya 2" esa
    # "Pediatriya" ichida ko'rinadi, shuning uchun u yetishmayotgan hisoblanmaydi.
    assert len(stats["royxatda_topilmadi"]) == 12
    db.commit.assert_called_once()


def test_dry_run_changes_nothing():
    row = SimpleNamespace(name="Pediatriya kafedrasi", is_clinical=False)
    db = MagicMock()
    db.execute.return_value.scalars.return_value = [row]
    cd.sync(db, dry_run=True)
    assert row.is_clinical is False
    db.commit.assert_not_called()
