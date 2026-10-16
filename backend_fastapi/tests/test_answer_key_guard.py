"""Javob kaliti va savollar soni himoyasi (2026-10-16).

O'qituvchilar shikoyati: "test ishlab yuborsak, standart A yoki B javobni to'g'ri
deb oladi". Server endi kaliti yaroqsiz savol bilan sessiya ochmaydi, yangi
jonli test va yangi saqlangan test kamida 10 savoldan iborat bo'ladi, eskirgan
tarjima (variantlari boshqa tartibda) mijozga berilmaydi.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.routes import live_test as lt
from app.api.routes import prepared_content as pc
from app.schemas.live_test import LiveTestUpsertRequest
from app.services import case_i18n
from app.services import content_catalog as cc
from app.services import live_test_service as svc


def q(correct=1, text="Savol?"):
    return {"question": text, "options": ["a", "b", "c", "d"], "correctOptionIndex": correct}


def questions(n, correct=1):
    return [q(correct, f"Savol {i}?") for i in range(n)]


# ------------------------------------------------------------- kalit tekshiruvi


def test_valid_key_has_no_problems():
    assert svc.answer_key_problems(questions(10)) == []


@pytest.mark.parametrize("bad", [None, "B", 4, -1, True, 1.0])
def test_key_that_cannot_be_graded_is_reported(bad):
    problems = svc.answer_key_problems([q(bad)])
    assert len(problems) == 1 and problems[0].startswith("1:")


def test_question_without_text_or_options_is_reported():
    assert svc.answer_key_problems([{"question": "", "options": ["a", "b"], "correctOptionIndex": 0}])
    assert svc.answer_key_problems([{"question": "?", "options": ["a"], "correctOptionIndex": 0}])


def test_wrong_answers_never_assume_a_missing_key_is_a():
    """Kalitsiz savolda "xato javob" sifatida A ham tanlanishi mumkin — kalit yo'q."""
    assert svc.build_wrong_answers([{"question": "?", "options": ["a", "b"]}]) == [0]
    assert svc.build_wrong_answers([q(0)]) == [1]


# ------------------------------------------------------------- sessiya ochish


def upsert(payload_questions, existing=None):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = existing
    auth = SimpleNamespace(user=SimpleNamespace(username="teacher1"))
    body = LiveTestUpsertRequest(session_key="lts_new", topic="Mavzu", questions=payload_questions)
    return lt.upsert_live_test(body, db=db, auth=auth), db


def test_new_live_session_needs_at_least_ten_questions():
    with pytest.raises(HTTPException) as err:
        upsert(questions(9))
    assert err.value.status_code == 422 and "10" in err.value.detail


def test_new_live_session_with_bad_key_is_rejected():
    qs = questions(10)
    qs[3]["correctOptionIndex"] = "B"
    with pytest.raises(HTTPException) as err:
        upsert(qs)
    assert err.value.status_code == 422 and "4:" in err.value.detail


def test_existing_short_session_can_still_be_updated():
    """Dars o'rtasida ochilgan eski, 5 savolli sessiya sinxronlanishda uzilmaydi."""
    old = SimpleNamespace(
        owner_key="teacher1", is_closed=False, submissions=[], drafts=[],
        payload={"topic": "Mavzu", "questions": questions(5)}, subject_code="",
        session_key="lts_new", created_at=None, closed_at=None,
    )
    upsert(questions(5), existing=old)
    assert old.payload["questions"] == questions(5)


# ------------------------------------------------------------- saqlash


def test_new_saved_test_needs_ten_questions():
    with pytest.raises(HTTPException) as err:
        pc._reject_short_test("test", {"questions": questions(8)})
    assert err.value.status_code == 422
    pc._reject_short_test("test", {"questions": questions(10)})
    pc._reject_short_test("case", {"questions": questions(3)})  # keys — boshqa qoida


# ------------------------------------------------------------- tarjima


def test_translation_made_before_options_changed_is_not_served():
    old_questions = [{"question": "Savol?", "options": ["a", "b", "c", "d"], "correctOptionIndex": 0}]
    payload = {
        "questions": old_questions,
        "translations": {"ru": {"questions": [{"question": "Вопрос?", "options": ["а", "б", "в", "г"]}]}},
        "i18nSourceHash": case_i18n._source_hash(old_questions, case_i18n.KIND_TEST),
    }
    assert case_i18n.without_stale_translations(payload) is payload

    # Variantlar boshqa tartibda (aralashtirilgan) — tarjima eskirgan.
    reshuffled = {**payload, "questions": [{**old_questions[0], "options": ["c", "a", "d", "b"], "correctOptionIndex": 1}]}
    out = case_i18n.without_stale_translations(reshuffled)
    assert "translations" not in out and "i18nSourceHash" not in out
    assert not case_i18n._valid_block(reshuffled, "ru", case_i18n.KIND_TEST)


def test_legacy_translation_without_hash_is_left_alone():
    payload = {"questions": [q(0)], "translations": {"ru": {"questions": [{"question": "В?"}]}}}
    assert case_i18n.without_stale_translations(payload) is payload


# ------------------------------------------------------------- katalog API


def test_catalog_skips_questions_without_a_valid_key():
    item = SimpleNamespace(
        id=1,
        payload={
            "primaryLanguage": "uz",
            "questions": [
                q(2, "Kalitli savol?"),
                {"question": "Kalitsiz savol?", "options": ["a", "b", "c", "d"]},
                q(9, "Chegaradan tashqari?"),
            ],
        },
    )
    pool, available, _ = cc.collect_unique_questions_from_tests([item], shuffle=False)
    assert available == 1
    assert pool[0]["correctOptionIndex"] == 2
