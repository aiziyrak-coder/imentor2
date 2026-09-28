from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import auth as auth_routes


def test_disabled_account_gets_clear_403_not_a_token():
    user = SimpleNamespace(username="3442112024", password="hash", is_active=False)
    payload = SimpleNamespace(phone_digits="3442112024", password="fjsti123", register=False, role="")
    request = MagicMock()
    request.headers = {}
    with patch.object(auth_routes, "throttle_login_account"), \
         patch.object(auth_routes.auth_service, "get_user_by_username", return_value=user), \
         patch.object(auth_routes, "verify_password", return_value=True), \
         patch.object(auth_routes, "_disabled_account_message", return_value="Bu hisob o'chirilgan."), \
         patch.object(auth_routes, "_login_response") as login_response:
        with pytest.raises(HTTPException) as exc:
            auth_routes.local_login(payload, request, db=MagicMock())
    assert exc.value.status_code == 403
    assert "o'chirilgan" in exc.value.detail
    login_response.assert_not_called()


def test_wrong_password_on_disabled_account_still_says_wrong_password():
    user = SimpleNamespace(username="3442112024", password="hash", is_active=False)
    payload = SimpleNamespace(phone_digits="3442112024", password="nope", register=False, role="")
    with patch.object(auth_routes, "throttle_login_account"), \
         patch.object(auth_routes.auth_service, "get_user_by_username", return_value=user), \
         patch.object(auth_routes, "verify_password", return_value=False):
        with pytest.raises(HTTPException) as exc:
            auth_routes.local_login(payload, MagicMock(), db=MagicMock())
    assert exc.value.status_code == 401


def test_masked_login_formats():
    assert auth_routes._mask_login("998939838000") == "+998 93 ••• •• 00"
    assert auth_routes._mask_login("3442012031") == "3442•••031"
    assert auth_routes._mask_login("abc") == "•••"


def test_message_points_to_the_single_active_twin():
    user = SimpleNamespace(id=361, first_name="Mukadas ", last_name="Ashurova", username="3442012031")
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = ["998939838000"]
    msg = auth_routes._disabled_account_message(db, user)
    assert "+998 93 ••• •• 00" in msg and "998939838000" not in msg


def test_message_stays_generic_when_twin_is_ambiguous():
    user = SimpleNamespace(id=1, first_name="Ali", last_name="Valiyev", username="3442000001")
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = ["998900000001", "998900000002"]
    msg = auth_routes._disabled_account_message(db, user)
    assert "•••" not in msg and "o'chirilgan" in msg
