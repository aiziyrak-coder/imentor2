"""Xodim profilini HEMIS'dan to'ldirish (2026-09-26)."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import hemis_staff as hs


def person(pk, *, status="Ishlamoqda", dep=58, position="Assistent", form="Asosiy ish joyi"):
    return {"id": pk, "employeeStatus": {"name": status}, "department": {"id": dep},
            "staffPosition": {"name": position}, "employmentForm": {"name": form}}


def test_status_is_read_whatever_the_apostrophe():
    assert hs.status_of({"employeeStatus": {"name": "Ta'tilda"}}) == hs.ON_LEAVE
    assert hs.status_of({"employeeStatus": {"name": "Ta’tilda"}}) == hs.ON_LEAVE
    assert hs.status_of({"employeeStatus": {"name": "Bo‘shagan"}}) == hs.LEFT
    assert hs.status_of({"employeeStatus": {"name": "Ishlamoqda"}}) == hs.WORKING


def test_primary_record_prefers_working_main_position():
    left = person(1, status="Bo‘shagan")
    part = person(2, form="O‘rindoshlik")
    main = person(3)
    assert hs.primary_record([left, part, main])["id"] == 3


def _db(profiles, departments, active=("u1",)):
    db = MagicMock()
    calls = iter([
        MagicMock(scalars=MagicMock(return_value=departments)),
        MagicMock(scalars=MagicMock(return_value=profiles)),
        MagicMock(__iter__=lambda self: iter([(a,) for a in active])),
    ])
    db.execute.side_effect = lambda *a, **k: next(calls)
    return db


def test_only_empty_fields_are_filled_and_status_is_kept_fresh():
    dep = SimpleNamespace(id=7, name="Akusherlik va ginekologiya", hemis_id="58", is_active=True)
    filled = SimpleNamespace(owner_key="u1", department="", department_id=None, job_title="", hemis_status="")
    db = _db([filled], [dep])
    stats = hs.sync(db, [person(10)], {10: "u1"})
    assert (filled.department, filled.department_id, filled.job_title) == ("Akusherlik va ginekologiya", 7, "Assistent")
    assert filled.hemis_status == hs.WORKING
    assert stats["kafedra_toldirildi"] == 1 and stats["lavozim_toldirildi"] == 1


def test_teacher_written_values_are_never_overwritten():
    dep = SimpleNamespace(id=7, name="Akusherlik va ginekologiya", hemis_id="58", is_active=True)
    own = SimpleNamespace(owner_key="u1", department="Pediatriya", department_id=3, job_title="Dotsent", hemis_status="")
    db = _db([own], [dep])
    hs.sync(db, [person(10, status="Ta’tilda")], {10: "u1"})
    assert (own.department, own.department_id, own.job_title) == ("Pediatriya", 3, "Dotsent")
    assert own.hemis_status == hs.ON_LEAVE


def test_departed_employee_with_open_account_is_reported():
    db = _db([SimpleNamespace(owner_key="u1", department="X", department_id=1, job_title="Y", hemis_status="")], [])
    stats = hs.sync(db, [person(10, status="Bo‘shagan")], {10: "u1"})
    assert stats["boshagan_faol_hisob"] == ["u1"]
