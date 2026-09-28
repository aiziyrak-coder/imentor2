"""Klinik bo'lmagan fanga yozilgan bemor ssenariysini topish (2026-09-25).

Namunalar serverdagi haqiqiy yozuvlardan olingan (qisqartirilgan).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import content_domain_audit as audit


def test_real_mismatches_are_caught():
    # Fiziologiya, "Hujayra membranasi" mavzusi.
    assert audit.has_patient_case({"question": "45 yoshli bemorda qon bosimi 150/95 mm Hg, yurak urishi 88"})
    # Gigiyena va tibbiy ekologiya.
    assert audit.has_patient_case({"scenario": "### Bemor\nQodir, 68 yosh, erkak, BMI 25, qandli diabet"})
    # Fiziologiya keysi.
    assert audit.has_patient_case({"scenario": "Yosh bemor, 12 yoshda, maktabda o'qiydi"})


def test_patient_free_material_is_left_alone():
    assert not audit.has_patient_case(
        {"question": "Preparatda mitoxondriyalar soni ortgan, ATF sintezi 40% ga oshgan. Qaysi organoid?"}
    )
    assert not audit.has_patient_case(
        {"scenario": "Sanitariya shifokori maktab oshxonasida harorat rejimini tekshirmoqda: +12 °C."}
    )
    assert not audit.has_patient_case(None)


def _db(rows):
    db = MagicMock()
    db.execute.return_value.all.return_value = rows
    db.execute.return_value.scalars.return_value = [r[0] for r in rows]
    return db


def item(pk, kind, text):
    return SimpleNamespace(id=pk, kind=kind, payload={"q": text}, retired_reason="", retired_at=None)


def test_dry_run_reports_but_does_not_touch():
    rows = [(item(1, "test", "45 yoshli erkak bemor"), "Fiziologiya"),
            (item(2, "case", "Preparat tahlili"), "Fiziologiya")]
    db = _db(rows)
    out = audit.retire(db, dry_run=True)
    assert out["belgilandi"] == 1 and out["turi"] == {"test": 1}
    assert rows[0][0].retired_reason == ""
    db.commit.assert_not_called()


def test_apply_marks_and_never_deletes():
    rows = [(item(1, "test", "45 yoshli erkak bemor"), "Fiziologiya"),
            (item(3, "case", "Bemor 68 yoshda, erkak"), "Normal anatomiya")]
    db = _db(rows)
    out = audit.retire(db, dry_run=False)
    assert out["belgilandi"] == 2
    assert out["kafedralar"] == {"Fiziologiya": 1, "Normal anatomiya": 1}
    assert all(r[0].retired_reason == audit.REASON and r[0].retired_at for r in rows)
    db.delete.assert_not_called()
    db.commit.assert_called_once()


def test_undo_restores_everything():
    retired = SimpleNamespace(id=5, retired_reason=audit.REASON, retired_at="x")
    db = MagicMock()
    db.execute.return_value.scalars.return_value = [retired]
    out = audit.retire(db, dry_run=False, undo=True)
    assert out["qaytarildi"] == 1
    assert retired.retired_reason == "" and retired.retired_at is None
