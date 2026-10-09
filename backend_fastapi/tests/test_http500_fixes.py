"""Foydalanuvchiga 500 ko'rsatgan to'rtta xato (2026-10-07).

Har biri serverdagi haqiqiy log yozuvidan olingan.
"""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import requests
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.api.routes import face_login as face_route
from app.services import file_storage as storage
from app.services.json_sanitize import clean_json, clean_text

# ------------------------------------------------------------------ 1) uzun nom
#
# OSError: [Errno 36] File name too long — taqdimot yuklashda.
# Kirill harfi UTF-8 da ikki bayt, nom esa belgi bo'yicha qirqilardi.

LONG_RU = (
    "2_тема_ОСНОВНЫЕ_"
    "ЗАКОНОДАТЕЛЬНЫЕ_"
    "АКТЫ__ПРИМЕНЯЕМЫЕ_"
    "В_СФЕРЕ_САНИТАРНО-"
    "ЭПИДЕМИОЛОГИЧЕСКОГО_"
    "БЛАГОПОЛУЧИЯ_И_"
    "ОБЩЕСТВЕННОГО_"
    "ЗДРАВООХРАНЕНИЯ.pptx"
)


def _basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def test_a_long_cyrillic_presentation_name_fits_the_filesystem():
    name = _basename(storage.presentation_relative_path("2438::asosiy::l2", "3442112021", LONG_RU))
    assert len(name.encode("utf-8")) <= 255
    assert name.endswith(".pptx")


def test_a_long_handout_name_fits_too():
    name = _basename(storage.handout_relative_path("2438::asosiy::l2", "3442112021", LONG_RU, "ru"))
    assert len(name.encode("utf-8")) <= 255
    assert name.endswith(".pptx")


def test_cutting_never_leaves_half_a_letter():
    name = _basename(storage.presentation_relative_path("t", "u", LONG_RU))
    name.encode("utf-8").decode("utf-8")  # yarim harf qolsa shu yerda yiqilardi


def test_a_name_without_an_extension_still_works():
    assert storage._safe_filename("файл" * 200)
    assert storage._safe_filename("") == "file"


# ------------------------------------------------------- 2) jsonb va nol belgisi
#
# psycopg.errors.UntranslatableCharacter: unsupported Unicode escape sequence


def test_a_null_character_is_removed_before_the_database_sees_it():
    assert clean_text("a\x00b") == "ab"
    assert clean_text("a\\u0000b") == "ab"
    assert clean_text("a\\U00000000b") == "ab"


def test_cleaning_reaches_inside_lists_and_dicts():
    payload = {"q": "savol\\u0000", "options": ["a\x00", {"x": "b\\u0000"}]}
    assert clean_json(payload) == {"q": "savol", "options": ["a", {"x": "b"}]}


def test_normal_text_is_untouched():
    payload = {"q": "Yurak yetishmovchiligi", "n": 5, "ok": True, "none": None}
    assert clean_json(payload) == payload


# ----------------------------------------------- 3) yuz xizmati javob bermaganda
#
# TimeoutError: timed out — `RequestException`ga o'ralmay chiqib ketardi.


def _face_request():
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})


def _frame():
    return SimpleNamespace(file=SimpleNamespace(read=lambda n: b"x" * 10))


@pytest.mark.parametrize("error", [TimeoutError("timed out"), requests.RequestException()])
def test_a_slow_face_service_says_so_instead_of_crashing(error):
    with patch.object(face_route.fl, "identify", side_effect=error), \
         patch.object(face_route, "enforce", lambda *a, **k: None):
        with pytest.raises(HTTPException) as err:
            face_route.face_login(_face_request(), [_frame(), _frame()], MagicMock())
    assert err.value.status_code == 503
    assert "JSHSHIR" in err.value.detail


# ------------------------------------------ 4) bir vaqtda ikki marta saqlanganda
#
# IntegrityError: duplicate key "uniq_live_test_draft_participant"


def test_two_simultaneous_draft_saves_update_instead_of_failing():
    from app.api.routes import live_test

    obj = SimpleNamespace(id=1, closed_at=None, submissions=[], drafts=[], questions=[])
    draft = SimpleNamespace(first_name="", last_name="", answers=[], updated_at=None)
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.side_effect = [None, draft]
    db.commit.side_effect = [IntegrityError("x", {}, Exception()), None]

    payload = SimpleNamespace(first_name="A", last_name="B", answers=[1, 2],
                              participant_key="ot_1")
    with patch.object(live_test, "_get_session", return_value=obj), \
         patch.object(live_test, "_closed", return_value=False):
        out = live_test.upsert_draft(
            "lts_x", payload, db,
            SimpleNamespace(user=SimpleNamespace(username="ot_1"), student_id="1", role="student"),
        )
    assert out == {"ok": True, "answers": [1, 2]}  # saqlangan javoblar qaytadi (2026-10-09)
    # Ikkinchi urinishda BOR qoralama yangilandi.
    assert draft.first_name == "A" and draft.answers == [1, 2]
    db.rollback.assert_called_once()
