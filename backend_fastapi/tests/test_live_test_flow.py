"""Talaba test yechishi: yopilishda ball, takror qatorlar, yo'qolgan javoblar (2026-10-09).

Serverdagi 7 kunlik ma'lumot: o'qituvchi testni yopganda avtomatik topshirilgan
907 topshiriqning 772 tasi 0 ball, 874 tasi talabaga bog'lanmagan; 308 holatda
bitta talaba bir sessiyada ikki marta chiqqan.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import live_test as lt
from app.schemas.live_test import LiveTestDraftUpsertRequest, LiveTestSubmissionCreateRequest
from app.services import live_test_service as svc

NOW = dt.datetime.now(dt.timezone.utc)


def q(correct):
    return {"question": "?", "options": ["a", "b", "c", "d"], "correctOptionIndex": correct}


def draft(key, answers, *, student="", first="Ali", last="Valiyev", minutes_ago=5):
    return SimpleNamespace(participant_key=key, student_id=student, first_name=first, last_name=last,
                           answers=answers, updated_at=NOW - dt.timedelta(minutes=minutes_ago))


def submission(key="", student="", first="Ali", last="Valiyev"):
    return SimpleNamespace(participant_key=key, student_id=student, first_name=first, last_name=last, answers=[0])


def session(drafts=(), submissions=(), *, closed=False, hours_ago=1.0, questions=3):
    return SimpleNamespace(
        id=7, session_key="lts_x", is_closed=closed, closed_at=None,
        created_at=NOW - dt.timedelta(hours=hours_ago),
        payload={"topic": "T", "questions": [q(1) for _ in range(questions)]},
        drafts=list(drafts), submissions=list(submissions),
    )


def finalize(obj, **kw):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = obj
    added = []
    db.add.side_effect = added.append
    with patch("app.services.analytics_service.create_student_attempt_from_submission"):
        count = svc.finalize_live_test_session(db, obj, **kw)
    return count, added


# ------------------------------------------------------------- test yopilganda


def test_unfinished_student_keeps_the_answers_he_gave():
    """3 savoldan 2 tasini to'g'ri belgilagan talaba 0 emas, 2 ball oladi."""
    obj = session([draft("p1", [1, 1, -1], student="s1")])
    count, added = finalize(obj)
    assert count == 1 and added[0].answers == [1, 1, -1]
    assert svc.score_submission(obj.payload["questions"], added[0].answers) == (2, 3)
    assert added[0].student_id == "s1"          # natija talabaning o'ziga yoziladi


def test_a_student_who_already_submitted_is_not_added_again():
    """Boshqa oynada ochilib qolgan bo'sh qoralama ikkinchi "talaba" bo'lmaydi."""
    obj = session([draft("p2", [-1, -1, -1], student="s1")], [submission("p1", "s1")])
    assert finalize(obj) == (0, [])


def test_two_drafts_of_one_student_give_one_result_with_the_most_answers():
    obj = session([draft("p2", [-1, -1, -1], student="s1", minutes_ago=1),
                   draft("p1", [1, 0, 1], student="s1", minutes_ago=9)])
    count, added = finalize(obj)
    assert count == 1 and added[0].answers == [1, 0, 1]


def test_legacy_draft_without_student_id_is_matched_by_name():
    obj = session([draft("p2", [-1, -1, -1]), draft("p3", [1, 1, 1], first="Vali", last="Aliyev")],
                  [submission("p1", "s1")])
    count, added = finalize(obj)
    assert count == 1 and added[0].first_name == "Vali"


def test_broken_draft_values_do_not_crash_and_count_as_unanswered():
    assert svc.normalize_answers([2, "x", None, True, 9], 4) == [2, -1, -1, -1]
    assert svc.normalize_answers(None, 2) == [-1, -1]


def test_forgotten_session_is_closed_at_its_deadline_with_draft_time():
    """O'qituvchi yopmagan sessiya: natija qoralama saqlangan kunga yoziladi."""
    obj = session([draft("p1", [1, 1, 1], student="s1", minutes_ago=60 * 30)], hours_ago=31)
    deadline = obj.created_at + lt.SESSION_TTL
    count, added = finalize(obj, expired_at=deadline)
    assert count == 1 and added[0].submitted_at == obj.drafts[0].updated_at
    assert obj.is_closed and obj.closed_at == deadline


# ------------------------------------------------------------------ topshirish


def _auth(student="s1"):
    return SimpleNamespace(student_id=student, user=SimpleNamespace(first_name="Ali", last_name="Valiyev"))


def _submit(obj, db=None, student="s1", key="p1"):
    payload = LiveTestSubmissionCreateRequest(participant_key=key, first_name="Ali", last_name="Valiyev",
                                              answers=[1, 1, 1])
    with patch.object(lt, "_get_session", return_value=obj):
        return lt.submit_answer("lts_x", payload, db=db or MagicMock(), auth=_auth(student), _=None)


def test_a_real_save_error_is_reported_not_hidden():
    """Ilgari har qanday xato "allaqachon topshirilgan" bo'lib, talaba aldanardi."""
    db = MagicMock()
    with patch.object(lt, "create_student_attempt_from_submission", side_effect=RuntimeError("baza")):
        with pytest.raises(HTTPException) as err:
            _submit(session(), db)
    assert err.value.status_code == 500
    db.rollback.assert_called_once()


def test_student_auto_submitted_at_close_sees_accepted_not_an_error():
    obj = session(submissions=[submission("p9", "s1")], closed=True)
    assert _submit(obj) == {"ok": True, "already_submitted": True}


def test_closed_session_rejects_a_student_who_has_no_result():
    with pytest.raises(HTTPException) as err:
        _submit(session(closed=True))
    assert err.value.status_code == 403


def test_submitting_removes_every_draft_of_that_student():
    mine, other_tab, stranger = draft("p1", [1], student="s1"), draft("p2", [], student="s1"), draft("p3", [1], student="s2")
    db = MagicMock()
    with patch.object(lt, "create_student_attempt_from_submission"):
        assert _submit(session([mine, other_tab, stranger]), db) == {"ok": True}
    assert [c.args[0] for c in db.delete.call_args_list] == [mine, other_tab]


# -------------------------------------------------------------------- qoralama


def _save_draft(existing, answers, key="p2"):
    payload = LiveTestDraftUpsertRequest(participant_key=key, answers=answers)
    with patch.object(lt, "_get_session", return_value=session()), \
            patch.object(lt, "_find_draft", return_value=existing):
        return lt.upsert_draft("lts_x", payload, db=MagicMock(), auth=_auth(), _=None)


def test_reopening_the_page_does_not_wipe_saved_answers():
    """Sahifa qayta ochilganda brauzer bo'sh javob yuboradi — saqlangani qoladi va qaytadi."""
    saved = draft("p1", [1, 2, -1], student="s1")
    out = _save_draft(saved, [-1, -1, -1])
    assert saved.answers == [1, 2, -1] and out["answers"] == [1, 2, -1]


def test_new_answers_replace_the_draft_and_bind_it_to_the_student():
    saved = draft("p1", [1, -1, -1], first="", last="")
    _save_draft(saved, [1, 2, -1])
    assert saved.answers == [1, 2, -1] and saved.student_id == "s1"
    assert (saved.first_name, saved.last_name) == ("Ali", "Valiyev")


def test_second_student_on_the_same_phone_is_not_blocked():
    """Bitta telefon, bir xil brauzer kaliti: ikkinchi talaba ham topshira oladi."""
    obj = session(submissions=[submission("p1", "s1")])
    db = MagicMock()
    added = []
    db.add.side_effect = added.append
    with patch.object(lt, "create_student_attempt_from_submission"):
        assert _submit(obj, db, student="s2", key="p1") == {"ok": True}
    assert added[0].student_id == "s2" and added[0].participant_key == "ss2_p1"
