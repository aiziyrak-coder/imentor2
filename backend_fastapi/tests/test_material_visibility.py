"""O'qituvchi faqat O'ZI yuklagan materialni ko'radi (2026-09-24 talabi)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import prepared_content as pc
from app.api.routes import topic_content as tc


def auth(role="hodim", username="3442112018"):
    return SimpleNamespace(role=role, user=SimpleNamespace(username=username))


def captured_stmt(db):
    return str(db.execute.call_args.args[0])


def filters_by_owner(sql: str) -> bool:
    """Faqat WHERE shartidagi cheklov muhim — ustunlar ro'yxatida nom baribir uchraydi."""
    return "owner_key = :" in sql.split("WHERE", 1)[-1] if "WHERE" in sql else False


def _list_presentations(role):
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = []
    with patch.object(tc, "_resolve_norms", return_value=["2188::asosiy::l1"]), \
         patch.object(tc, "_check_topic"):
        tc.list_presentations(MagicMock(), topic_norm=["2188::asosiy::l1"], mine=False, db=db, auth=auth(role))
    return captured_stmt(db)


def test_teacher_sees_only_own_presentations():
    assert filters_by_owner(_list_presentations("hodim"))


def test_admin_still_sees_every_presentation():
    assert not filters_by_owner(_list_presentations("admin"))


def test_teacher_sees_only_own_handouts_and_videos():
    for fn, kwargs in ((tc.list_handouts, {"language": ""}), (tc.list_topic_videos, {})):
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = []
        with patch.object(tc, "_resolve_norms", return_value=["2188::asosiy::l1"]), \
             patch.object(tc, "_check_topic"):
            fn(MagicMock(), topic_norm=["2188::asosiy::l1"], db=db, auth=auth(), **kwargs)
        assert filters_by_owner(captured_stmt(db)), fn.__name__


def test_shared_lecture_text_is_no_longer_shown_to_other_teachers():
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = []
    with patch.object(pc, "_topic_lookup_filter", return_value=pc.PreparedContent.id > 0):
        pc.list_my_prepared_content(
            MagicMock(), kind="lecture", topic_norm=["2188::asosiy::l1"], shared=True,
            syllabus_id=None, topic_code="", variant_label="", db=db, auth=auth(),
        )
    assert filters_by_owner(captured_stmt(db))
