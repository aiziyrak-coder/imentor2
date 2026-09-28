"""Malaka tinglovchisi kirishi — 2026-09-19 da marshrut yo'qolib, tinglovchilar "Not Found" olgan."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import auth as auth_routes
from app.core.security import decode_token


def test_malaka_login_route_is_registered():
    # `main.py` bu routerni "/api/v1" ostida ulaydi.
    paths = {getattr(r, "path", "") for r in auth_routes.router.routes}
    assert "/auth/malaka-login/" in paths


def _db_with_listener(listener):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = listener
    return db


def _run(password_ok_for, *, pending=True, group_active=True):
    user = SimpleNamespace(id=5, username="AA1111111", password="hash", is_active=True, first_name="A", last_name="B")
    listener = SimpleNamespace(is_active=True, group=SimpleNamespace(name="Tibbiy pedagogika — 1-guruh", is_active=group_active))
    payload = SimpleNamespace(login="aa 1111111", password="aa 1111111")
    with patch.object(auth_routes, "throttle_login_account"), \
         patch.object(auth_routes.auth_service, "get_user_by_username", return_value=user), \
         patch.object(auth_routes.pwd_policy, "must_change", return_value=pending), \
         patch.object(auth_routes, "verify_password", side_effect=lambda pw, h: pw == password_ok_for), \
         patch.object(auth_routes.auth_service, "touch_last_login"), \
         patch.object(auth_routes, "record_activity_event"), \
         patch.object(auth_routes.sp, "staff_photo_url_for_user", return_value=""):
        return auth_routes.malaka_login(payload, MagicMock(), db=_db_with_listener(listener))


def test_first_login_with_passport_written_freely_gets_group_and_must_change_flag():
    r = _run("AA1111111")
    claims = decode_token(r.access)
    assert r.role == "student" and r.must_change_password is True
    assert claims["group_name"] == "Tibbiy pedagogika — 1-guruh" and claims["mcp"] == 1


def test_after_password_change_passport_no_longer_works():
    with pytest.raises(HTTPException) as exc:
        _run("Yangi-parol-77", pending=False)
    assert exc.value.status_code == 401


def test_inactive_group_is_refused():
    with pytest.raises(HTTPException) as exc:
        _run("AA1111111", group_active=False)
    assert exc.value.status_code == 403
