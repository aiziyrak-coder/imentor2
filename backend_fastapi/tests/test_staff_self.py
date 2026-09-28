"""O'qituvchi sozlamalari (2026-09-24): o'zi bajaradi, lekin boshqalarga tegmaydi."""

import asyncio
import io
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from app.api.routes import staff_self as ss
from app.services import monitor_schedule_service as ms


def auth(username="3442112018", role="hodim"):
    return SimpleNamespace(role=role, user=SimpleNamespace(username=username, first_name="Farog‘at", last_name="Melibayeva"))


# ------------------------------------------------------------ kutubxona: o'chirish ruxsati


def _db_with_book(owner_key):
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=7, owner_key=owner_key, file="books/uploads/x.pdf")
    return db


def test_teacher_deletes_own_upload():
    db = _db_with_book("3442112018")
    with patch.object(ss.storage, "delete_file"):
        ss.delete_library_item(7, db=db, auth=auth())
    db.delete.assert_called_once()


def test_teacher_cannot_delete_colleagues_or_admin_books():
    for owner in ("998911185759", ""):
        db = _db_with_book(owner)
        with pytest.raises(HTTPException) as exc:
            ss.delete_library_item(7, db=db, auth=auth())
        assert exc.value.status_code == 403
        db.delete.assert_not_called()


def test_admin_can_delete_any_book():
    db = _db_with_book("998911185759")
    with patch.object(ss.storage, "delete_file"):
        ss.delete_library_item(7, db=db, auth=auth("admin", role="admin"))
    db.delete.assert_called_once()


# ------------------------------------------------------------ kutubxona: yuklash


def _upload(name, data=b"%PDF-1.4 ...", kind="book"):
    db = MagicMock()
    db.execute.return_value.scalar.return_value = 0
    db.execute.return_value.first.return_value = None
    file = UploadFile(filename=name, file=io.BytesIO(data))
    with patch.object(ss, "_my_department_id", return_value=5), patch.object(ss.storage, "save_upload"):
        return asyncio.run(ss.upload_library_item(MagicMock(), file=file, kind=kind, title="", db=db, auth=auth())), db


def test_upload_goes_to_own_department_and_waits_for_indexing():
    out, db = _upload("DAT qo'llanma.pdf")
    book = db.add.call_args.args[0]
    assert book.department_id == 5 and book.owner_key == "3442112018"
    assert book.status == "processing" and book.is_active is False
    assert out["kind"] == "book" and out["can_delete"] is True


def test_upload_rejects_unknown_formats_and_kinds():
    for name, kind in (("rasm.jpg", "book"), ("fayl.pdf", "boshqa")):
        with pytest.raises(HTTPException) as exc:
            _upload(name, kind=kind)
        assert exc.value.status_code == 400


def test_duplicate_title_in_department_is_refused():
    db = MagicMock()
    db.execute.return_value.scalar.return_value = 0
    db.execute.return_value.first.return_value = (1,)
    file = UploadFile(filename="Botulizm.pdf", file=io.BytesIO(b"%PDF"))
    with patch.object(ss, "_my_department_id", return_value=5), patch.object(ss.storage, "save_upload"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ss.upload_library_item(MagicMock(), file=file, kind="protocol", title="", db=db, auth=auth()))
    assert exc.value.status_code == 409


# ------------------------------------------------------------ monitor jadvali: faqat o'ziniki


def test_import_rows_only_teacher_keeps_own_rows_and_replaces_only_them():
    """Kafedra fayli yuklansa ham faqat o'qituvchining qatori saqlanadi va faqat uniki o'chiriladi."""
    monitor = {
        "monitor_id": "MON-001", "department": "Fiziologiya kafedrasi", "room_full": "3-bino 25 xona",
        "department_keys": [ms._norm("Fiziologiya kafedrasi")],
    }
    header = ["Kafedra", "Monitor/xona", "Hafta kuni", "Para", "O‘qituvchi F.I.Sh", "Fan", "Guruh"]
    rows = [
        header,
        ["Fiziologiya kafedrasi", "3-bino 25 xona", "Dushanba", "1-para", "Melibayeva Farog‘at", "Fiziologiya", "DI-2801"],
        ["Fiziologiya kafedrasi", "3-bino 25 xona", "Dushanba", "2-para", "Ganijonov Polvon", "Fiziologiya", "DI-2802"],
        ["Fiziologiya kafedrasi", "3-bino 25 xona", "Seshanba", "1-para", "", "Fiziologiya", "DI-2803"],
    ]

    def resolve(name, *a, **k):
        return "3442112018" if name.startswith("Melibayeva") else "998951024383"

    db = MagicMock()
    query = db.query.return_value.filter.return_value
    with patch.object(ms, "monitors", return_value=[monitor]), \
         patch.object(ms, "_resolve_teacher", side_effect=resolve), \
         patch("app.services.face_login._face_login_users", return_value=[]), \
         patch("app.services.face_login._account_info", return_value={}):
        out = ms.import_rows(db, rows, only_teacher="3442112018", self_name="Melibayeva Farog‘at")

    added = [c.args[0] for c in db.add.call_args_list]
    assert {(e.weekday, e.para) for e in added} == {("Dushanba", "1-para"), ("Seshanba", "1-para")}
    assert all(e.teacher_username == "3442112018" for e in added)
    assert out["other_teacher_rows"] == 1
    # Eski qatorlarni o'chirish faqat shu o'qituvchi bo'yicha filtrlangan.
    query.filter.assert_called_once()
