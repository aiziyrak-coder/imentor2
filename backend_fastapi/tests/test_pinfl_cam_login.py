"""JSHSHIR bilan kirish: cam.fermi.uz tasdiqlasa kiritiladi, hisob bo'lmasa ochiladi (2026-10-08)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
import requests
from fastapi import HTTPException

from app.api.routes import pinfl_login as pl
from app.services import cam_login, cam_verify
from app.services import staff_pinfl as sp

PINFL = "42005954100011"
PERSON = {
    "id": "p-1", "pinfl": PINFL, "full_name": "ABDULLAYEVA ZARNIGOR AZAMAT QIZI",
    "last_name": "ABDULLAYEVA", "first_name": "ZARNIGOR", "middle_name": "AZAMAT QIZI",
    "position": "Assistent", "department": "Patologik fiziologiya va patologik anatomiya",
    "hemis_employee_id": "3442412062", "phone": "",
}


# ------------------------------------------------------------------ cam.fermi.uz javobi


def _settings(url="http://cam:8080", key="k"):
    return SimpleNamespace(cam_verify_url=url, cam_verify_api_key=key, cam_verify_timeout=5.0)


def _response(status=200, body=None):
    res = MagicMock(status_code=status)
    res.json.return_value = body
    return res


def _verify(body, status=200):
    with patch.object(cam_verify, "get_settings", return_value=_settings()), \
            patch.object(cam_verify.requests, "post", return_value=_response(status, body)) as post:
        return cam_verify.verify_staff(PINFL), post


def test_verified_response_returns_person_and_sends_api_key():
    result, post = _verify({"verified": True, "score": 0.7, "person": PERSON})
    assert result.verified and result.person["hemis_employee_id"] == "3442412062"
    assert post.call_args.kwargs["headers"] == {"X-Api-Key": "k"}
    assert post.call_args.args[0] == "http://cam:8080/api/external/imentor/verify-staff"
    assert post.call_args.kwargs["data"]["pinfl"] == PINFL


@pytest.mark.parametrize("body", [
    {"verified": "true", "person": PERSON},             # satr, aniq true emas
    {"verified": 1, "person": PERSON},
    {"verified": True, "person": {**PERSON, "pinfl": "42005954100099"}},  # boshqa odam
    {"verified": False, "reason": "not_found", "person": None},
])
def test_anything_but_exact_true_for_the_same_pinfl_is_not_verified(body):
    result, _ = _verify(body)
    assert result.verified is False and result.person == {}


def test_not_configured_or_unreachable_or_bad_answer_is_unavailable():
    with patch.object(cam_verify, "get_settings", return_value=_settings(key="")), \
            pytest.raises(cam_verify.CamUnavailable):
        cam_verify.verify_staff(PINFL)
    with patch.object(cam_verify, "get_settings", return_value=_settings()), \
            patch.object(cam_verify.requests, "post", side_effect=requests.ConnectionError()), \
            pytest.raises(cam_verify.CamUnavailable):
        cam_verify.verify_staff(PINFL)
    for status in (401, 500):
        with pytest.raises(cam_verify.CamUnavailable):
            _verify({}, status)
    with pytest.raises(cam_verify.CamRateLimited):
        _verify({}, 429)


# ------------------------------------------------------------------ hisob tanlash / ochish


def _user(username, role="hodim", active=True):
    return SimpleNamespace(username=username, is_active=active, password="x", role=role)


def _account(existing: dict, linked_owner=None):
    """`existing`: login → hisob. Qaytaradi: (natija, yaratilgan hisoblar, bog'lanish)."""
    db = MagicMock()
    created = []
    link = SimpleNamespace(link_source="", owner_key="", full_name="", is_active=False, synced_at=None)

    def create(_db, username, password, first, last):
        u = _user(username)
        u.first_name, u.last_name = first, last
        created.append(u)
        existing[username] = u
        return u

    with patch.object(cam_login.staff_pinfl, "owner_for", return_value=linked_owner), \
            patch.object(cam_login.auth_service, "get_user_by_username", side_effect=lambda _db, u: existing.get(u)), \
            patch.object(cam_login.auth_service, "create_user", side_effect=create), \
            patch.object(cam_login.auth_service, "set_user_role_group"), \
            patch.object(cam_login.auth_service, "resolve_user_role_from_db", side_effect=lambda _db, u: u.role), \
            patch.object(cam_login, "_fill_profile"):
        db.get.return_value = link
        out = cam_login.account_for(db, PINFL, PERSON)
    return out, created, link


def test_new_person_gets_account_with_hemis_id_login_no_password_and_cam_link():
    (user, role, is_new), created, link = _account({})
    assert is_new and role == "hodim" and user.username == "3442412062"
    assert user.password == "" and (user.first_name, user.last_name) == ("Zarnigor", "Abdullayeva")
    assert (link.owner_key, link.link_source, link.is_active) == ("3442412062", "cam", True)


def test_already_linked_pinfl_uses_that_account_even_with_phone_login():
    phone = _user("998937803729")
    (user, _, is_new), created, link = _account({"998937803729": phone}, linked_owner="998937803729")
    assert user is phone and not is_new and created == []
    assert link.owner_key == "998937803729"


def test_existing_hemis_id_account_is_reused():
    acc = _user("3442412062")
    (user, _, is_new), created, _ = _account({"3442412062": acc})
    assert user is acc and not is_new and created == []


def test_admin_or_disabled_account_is_never_entered_by_pinfl():
    for acc in (_user("3442412062", role="admin"), _user("3442412062", role="klinika_admin"),
                _user("3442412062", active=False)):
        with pytest.raises(cam_login.CamLoginRefused):
            _account({"3442412062": acc})


# ------------------------------------------------------------------ endpoint


def _call(result=None, error=None, account=None, account_error=None):
    db = MagicMock()
    verify = patch.object(pl.cam_verify, "verify_staff", side_effect=error, return_value=result)
    acc = patch.object(pl.cam_login, "account_for", side_effect=account_error,
                       return_value=account or (_user("3442412062"), "hodim", True))
    with patch.object(pl, "throttle_login_account"), patch.object(pl, "enforce"), verify, acc, \
            patch.object(pl, "record_activity_event") as event, patch.object(pl.auth_service, "touch_last_login"), \
            patch.object(pl, "_login_response", return_value="TOKEN"):
        out = pl.pinfl_login(pl.PinflLoginRequest(pinfl=PINFL), MagicMock(), db=db)
    return out, db, event


def test_verified_pinfl_logs_in_and_is_recorded():
    out, db, event = _call(result=cam_verify.CamResult(True, "", PERSON))
    assert out == "TOKEN"
    db.commit.assert_called_once()
    assert event.call_args.kwargs["meta"]["method"] == "pinfl_cam"


@pytest.mark.parametrize("kw,code", [
    ({"result": cam_verify.CamResult(False, "not_found")}, 401),
    ({"error": cam_verify.CamUnavailable("x")}, 503),
    ({"error": cam_verify.CamRateLimited()}, 429),
    ({"result": cam_verify.CamResult(True, "", PERSON), "account_error": cam_login.CamLoginRefused("admin")}, 403),
])
def test_refusals(kw, code):
    with pytest.raises(HTTPException) as exc:
        _call(**kw)
    assert exc.value.status_code == code


def test_malformed_pinfl_never_reaches_cam():
    with patch.object(pl.cam_verify, "verify_staff") as verify, pytest.raises(HTTPException) as exc:
        pl.pinfl_login(pl.PinflLoginRequest(pinfl="12345"), MagicMock(), db=MagicMock())
    assert exc.value.status_code == 422
    verify.assert_not_called()


# ------------------------------------------------------------------ soatlik sinxron


def test_hourly_sync_keeps_cam_links():
    rows = [{"id": "p-1", "full_name": "Abdullayeva Zarnigor", "position": "", "pinfl": PINFL}]
    plan = sp.plan_links(rows, {}, [], {}, {PINFL: "3442412062"}, {PINFL: "cam"})
    assert plan[PINFL] == ("3442412062", "cam")
