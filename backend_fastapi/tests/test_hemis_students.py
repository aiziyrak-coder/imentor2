"""HEMIS kontingenti (2026-09-25)."""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import hemis_students as hstu


def student(**kw):
    base = {
        "id": 11942,
        "student_id_number": "344261101140",
        "first_name": "ALISHER",
        "second_name": "KARIMOV",
        "third_name": "BOTIROVICH",
        "gender": {"code": "11", "name": "Erkak"},
        "birth_date": int(dt.datetime(2007, 5, 14, tzinfo=dt.timezone.utc).timestamp()),
        "department": {"name": "Tibbiy profilaktika va jamoat salomatligi fakulteti"},
        "specialty": {"code": "60910400", "name": "Tibbiy profilaktika ishi"},
        "group": {"id": 1269, "name": "TPI-926", "educationLang": {"name": "Rus"}},
        "level": {"name": "1-kurs"},
        "educationForm": {"name": "Kunduzgi"},
        "educationYear": {"name": "2026-2027"},
        "studentStatus": {"code": "11", "name": "O‘qimoqda"},
        # Quyidagilar OLINMAYDI:
        "paymentForm": {"name": "To‘lov-shartnoma"},
        "province": {"name": "Namangan viloyati"},
        "socialCategory": {"name": "Boshqa"},
        "accommodation": {"name": "Talabalar turar joyida"},
    }
    return {**base, **kw}


def test_fields_take_what_the_study_process_needs():
    f = hstu.fields(student())
    assert f["hemis_id"] == "11942" and f["student_id"] == "344261101140"
    assert (f["last_name"], f["first_name"], f["middle_name"]) == ("KARIMOV", "ALISHER", "BOTIROVICH")
    assert f["group_name"] == "TPI-926" and f["course"] == 1
    assert f["faculty_name"].startswith("Tibbiy profilaktika")
    assert f["direction_code"] == "60910400" and f["education_language"] == "Rus"
    assert f["birth_date"] == dt.date(2007, 5, 14) and f["status"] == "active"
    assert f["source"] == "hemis"


def test_personal_and_financial_details_are_not_stored():
    f = hstu.fields(student())
    stored = " ".join(str(v) for v in f.values())
    for secret in ("To‘lov-shartnoma", "Namangan viloyati", "Talabalar turar joyida"):
        assert secret not in stored
    assert not any(k in f for k in ("paymentForm", "province", "socialCategory", "accommodation"))


def test_graduated_student_is_marked_inactive():
    f = hstu.fields(student(studentStatus={"code": "12", "name": "Bitirgan"}))
    assert f["status"] == "inactive"


def _db(existing=()):
    db = MagicMock()
    db.execute.return_value.scalars.return_value = list(existing)
    return db


def test_new_students_are_added():
    db = _db()
    stats = hstu.sync(db, [student(), student(id=2, student_id_number="344261101141")])
    assert stats["yangi"] == 2 and db.add.call_count == 2


def test_existing_student_is_updated_not_duplicated():
    row = SimpleNamespace(**hstu.fields(student()), synced_at=None)
    db = _db([row])
    stats = hstu.sync(db, [student(group={"name": "TPI-927", "educationLang": {"name": "Rus"}})])
    assert stats == {"hemisda": 1, "yangi": 0, "yangilandi": 1, "ozgarmadi": 0, "chiqib_ketgan": 0}
    assert row.group_name == "TPI-927"
    db.add.assert_not_called()


def test_unchanged_student_is_left_alone():
    row = SimpleNamespace(**hstu.fields(student()), synced_at=None)
    db = _db([row])
    stats = hstu.sync(db, [student()])
    assert stats["ozgarmadi"] == 1 and stats["yangilandi"] == 0


def test_student_missing_from_hemis_is_deactivated_not_deleted():
    row = SimpleNamespace(**hstu.fields(student()), synced_at=None)
    db = _db([row])
    stats = hstu.sync(db, [])
    assert stats["chiqib_ketgan"] == 1 and row.status == "inactive"
    db.delete.assert_not_called()


def test_manual_rows_are_never_touched():
    manual = SimpleNamespace(**{**hstu.fields(student()), "source": "manual"}, synced_at=None)
    db = _db([manual])
    hstu.sync(db, [])
    assert manual.status == "active"
