"""Material faqat muallifniki (2026-10-07).

Bitta fanni o'zbek va rus guruhlarida o'tadigan o'qituvchilar bir-birining
ma'ruza/taqdimotini ustidan yozib yoki o'chirib yuborardi: fan egasi
o'chira olardi, shu fanni o'tadigan har kim esa ma'ruzani almashtira olardi.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import prepared_content as pc
from app.api.routes import topic_content as tc

AUTHOR = "3442112018"
COLLEAGUE = "998884137755"


def auth(username=COLLEAGUE, role="hodim"):
    return SimpleNamespace(role=role, user=SimpleNamespace(username=username, first_name="A", last_name="B"))


def _lecture(owner=AUTHOR):
    return SimpleNamespace(
        id=5, owner_key=owner, kind="lecture", topic_norm="2470::asosiy::l1", syllabus_id=2470,
        payload={"content": "Ma'ruza"}, topic="Mavzu", author_display_name="", subject_name="",
        subject_code="", variant_label="", topic_code="l1", created_at=dt.datetime.now(dt.timezone.utc),
    )


def _db_with(item):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = item
    return db


def test_colleague_who_teaches_the_subject_cannot_overwrite_lecture():
    item = _lecture()
    db = _db_with(item)
    with patch.object(pc, "_can_view_item", return_value=True), pytest.raises(HTTPException) as exc:
        pc.update_prepared_content_payload(5, SimpleNamespace(payload={"content": "Лекция"}), MagicMock(), db=db, auth=auth())
    assert exc.value.status_code == 403
    assert item.payload == {"content": "Ma'ruza"}
    db.commit.assert_not_called()


def test_author_can_edit_own_lecture():
    item = _lecture()
    db = _db_with(item)
    with patch.object(pc, "_can_view_item", return_value=True):
        pc.update_prepared_content_payload(5, SimpleNamespace(payload={"content": "Yangi"}), MagicMock(),
                                           db=db, auth=auth(AUTHOR))
    assert item.payload == {"content": "Yangi"}


def test_subject_owner_cannot_delete_colleagues_lecture():
    db = _db_with(_lecture())
    with patch.object(pc, "_can_view_item", return_value=True), \
            patch.object(pc.access, "is_subject_owner", return_value=True), \
            pytest.raises(HTTPException) as exc:
        pc.delete_prepared_content(5, db=db, auth=auth())
    assert exc.value.status_code == 403
    db.delete.assert_not_called()


def test_admin_still_deletes_anything():
    db = _db_with(_lecture())
    with patch.object(pc, "_can_view_item", return_value=True):
        pc.delete_prepared_content(5, db=db, auth=auth("admin", role="admin"))
    db.delete.assert_called_once()


@pytest.mark.parametrize("endpoint", ["delete_handout", "delete_presentation", "delete_topic_video"])
def test_subject_owner_cannot_delete_colleagues_uploads(endpoint):
    db = MagicMock()
    db.get.return_value = SimpleNamespace(id=9, owner_key=AUTHOR, topic_norm="2470::asosiy::l1", file="x")
    with patch.object(tc, "_check_topic"), patch.object(tc.storage, "delete_file"), pytest.raises(HTTPException) as exc:
        getattr(tc, endpoint)(9, db=db, auth=auth())
    assert exc.value.status_code == 403
    db.delete.assert_not_called()
