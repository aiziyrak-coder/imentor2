"""Parolsiz kirish marshruti: JSHSHIR yoki pasport (2026-10-02).

Parol yo'q, shuning uchun eng muhim talab — topilmagan yoki bog'lanmagan
odamga HECH QANDAY token berilmasin va xabar qaysi raqam xato ekanini
oshkor qilmasin.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import auth as auth_routes
from app.models.person_identity import STAFF, STUDENT


def _person(kind, *, pinfl="12345678901234", source_id="p1", hemis_id=""):
    return SimpleNamespace(kind=kind, pinfl=pinfl, source_id=source_id,
                           hemis_id=hemis_id, full_name="AZIZOV A.")


def _req():
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})


def _payload(**kw):
    return SimpleNamespace(pinfl=kw.get("pinfl", "12345678901234"),
                           passport_series=kw.get("passport_series", ""),
                           passport_number=kw.get("passport_number", ""),
                           institute_id=kw.get("institute_id", ""))


def _call(**patches):
    base = {
        "throttle_login_account": lambda *a, **k: None,
        "record_activity_event": lambda *a, **k: None,
    }
    base.update(patches)
    ctx = [patch.object(auth_routes, name, value if callable(value) else MagicMock(return_value=value))
           for name, value in base.items()]
    for c in ctx:
        c.start()
    try:
        return auth_routes.id_login(_payload(), _req(), MagicMock())
    finally:
        for c in ctx:
            c.stop()


def test_an_unknown_number_is_refused():
    with patch.object(auth_routes.pid, "find", return_value=None), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None):
        with pytest.raises(HTTPException) as err:
            auth_routes.id_login(_payload(), _req(), MagicMock())
    assert err.value.status_code == 401


def test_the_message_does_not_say_which_number_was_wrong():
    """Aks holda bu oyna JSHSHIR tekshirgichiga aylanardi."""
    text = auth_routes.ID_DENIED.lower()
    assert "topilmadi" in text
    for leak in ("jshshir noto", "pasport noto", "bunday jshshir", "bunday pasport"):
        assert leak not in text


def test_a_staff_member_without_an_imentor_account_gets_no_token():
    with patch.object(auth_routes.pid, "find", return_value=_person(STAFF)), \
         patch.object(auth_routes, "_staff_owner", return_value=""), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None):
        with pytest.raises(HTTPException) as err:
            auth_routes.id_login(_payload(), _req(), MagicMock())
    assert err.value.status_code == 401


def test_a_student_who_is_not_in_the_contingent_gets_no_token():
    with patch.object(auth_routes.pid, "find", return_value=_person(STUDENT)), \
         patch.object(auth_routes, "_student_user", return_value=None), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None):
        with pytest.raises(HTTPException) as err:
            auth_routes.id_login(_payload(), _req(), MagicMock())
    assert err.value.status_code == 401


def test_a_linked_staff_member_signs_in_without_a_password():
    user = SimpleNamespace(id=7, username="3442012012", is_active=True,
                           first_name="A", last_name="AZIZOV")
    with patch.object(auth_routes.pid, "find", return_value=_person(STAFF)), \
         patch.object(auth_routes, "_staff_owner", return_value=user.username), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None), \
         patch.object(auth_routes, "record_activity_event", lambda *a, **k: None), \
         patch.object(auth_routes.auth_service, "get_user_by_username", return_value=user), \
         patch.object(auth_routes.auth_service, "resolve_user_role_from_db", return_value="hodim"), \
         patch.object(auth_routes.auth_service, "touch_last_login", lambda *a, **k: None), \
         patch.object(auth_routes, "_login_response", return_value="TOKEN") as resp:
        out = auth_routes.id_login(_payload(), _req(), MagicMock())
    assert out == "TOKEN"
    assert resp.call_args.args[2] == "hodim"


def test_a_student_signs_in_and_keeps_the_id_their_results_are_stored_under():
    user = SimpleNamespace(id=9, username="ot_344261200064", is_active=True,
                           first_name="B", last_name="SOBIROV")
    with patch.object(auth_routes.pid, "find", return_value=_person(STUDENT)), \
         patch.object(auth_routes, "_student_user", return_value=(user, "344261200064")), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None), \
         patch.object(auth_routes, "record_activity_event", lambda *a, **k: None), \
         patch.object(auth_routes.auth_service, "touch_last_login", lambda *a, **k: None), \
         patch.object(auth_routes, "_login_response", return_value="TOKEN") as resp:
        out = auth_routes.id_login(_payload(), _req(), MagicMock())
    assert out == "TOKEN"
    assert resp.call_args.args[2] == "student"
    assert resp.call_args.kwargs["student_id"] == "344261200064"


def test_the_series_list_is_offered_to_the_login_screen():
    out = auth_routes.passport_series()
    assert "AD" in out["series"] and "AA" in out["series"]


# ---------------- Institut raqami bilan kirish (2026-10-05) ----------------
#
# JSHSHIR va pasport faqat cam.fermi.uz da bor, u esa biometrik ro'yxatdan
# o'tgandan keyin to'ladi. Yangi kelgan va xorijiy talaba u yerda hali yo'q
# va KIRA OLMASDI. Kontingent esa HEMIS'dan keladi va hammasini qamraydi.


def test_a_student_who_is_not_in_the_face_system_signs_in_with_the_student_id():
    user = SimpleNamespace(id=11, username="ot_344261200064", is_active=True,
                           first_name="B", last_name="SOBIROV")
    with patch.object(auth_routes.pid, "find", return_value=None) as person_lookup, \
         patch.object(auth_routes, "_staff_by_id", return_value=None), \
         patch.object(auth_routes, "_student_by_id", return_value=(user, "344261200064")), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None), \
         patch.object(auth_routes, "_issue", return_value="TOKEN") as issue:
        out = auth_routes.id_login(
            _payload(pinfl="", institute_id="344261200064"), _req(), MagicMock())
    assert out == "TOKEN"
    assert issue.call_args.args[2] == "student"
    assert issue.call_args.args[3] == "344261200064"
    # cam.fermi.uz ro'yxatiga umuman murojaat qilinmaydi.
    person_lookup.assert_not_called()


def test_a_staff_member_signs_in_with_the_staff_id():
    user = SimpleNamespace(id=12, username="3442012012", is_active=True,
                           first_name="A", last_name="AZIZOV")
    with patch.object(auth_routes, "_staff_by_id", return_value=user), \
         patch.object(auth_routes.auth_service, "resolve_user_role_from_db", return_value="hodim"), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None), \
         patch.object(auth_routes, "_issue", return_value="TOKEN") as issue:
        out = auth_routes.id_login(
            _payload(pinfl="", institute_id="3442012012"), _req(), MagicMock())
    assert out == "TOKEN"
    assert issue.call_args.args[2] == "hodim"


def test_an_unknown_institute_id_is_refused():
    with patch.object(auth_routes, "_staff_by_id", return_value=None), \
         patch.object(auth_routes, "_student_by_id", return_value=None), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None):
        with pytest.raises(HTTPException) as err:
            auth_routes.id_login(
                _payload(pinfl="", institute_id="000000000000"), _req(), MagicMock())
    assert err.value.status_code == 401


def test_the_student_id_path_does_not_open_a_staff_account():
    """Talaba hisobiga bu yo'ldan kirilsa ham roli o'zgarmasin."""
    student = SimpleNamespace(id=13, username="ot_1", is_active=True,
                              first_name="", last_name="")
    with patch.object(auth_routes, "_staff_by_id", return_value=None), \
         patch.object(auth_routes, "_student_by_id", return_value=(student, "1")), \
         patch.object(auth_routes, "throttle_login_account", lambda *a, **k: None), \
         patch.object(auth_routes, "_issue", return_value="TOKEN") as issue:
        auth_routes.id_login(_payload(pinfl="", institute_id="1"), _req(), MagicMock())
    assert issue.call_args.args[2] == "student"
