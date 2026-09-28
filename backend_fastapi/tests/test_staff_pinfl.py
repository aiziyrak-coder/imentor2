from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.routes import auth as auth_routes
from app.schemas.auth import LocalLoginRequest
from app.services import staff_pinfl as sp


def user(username, last, first):
    return SimpleNamespace(username=username, last_name=last, first_name=first)


def row(pid, full_name, pinfl, position="Kafedra"):
    return {"id": pid, "full_name": full_name, "position": position, "pinfl": pinfl}


P1, P2, P3, P4, P5 = (f"3010199000000{i}" for i in range(1, 6))


def test_face_link_wins_then_unique_name_then_nothing():
    users = [
        user("3442000001", "Karimov", "Ali"),
        user("998900000002", "Rahimova", "Husnidahon"),
        user("3442000003", "Aliyev", "Vali"),
        user("3442000004", "Aliyev", "Vali"),  # ikki hisob — ism bo'yicha bog'lanmaydi
    ]
    rows = [
        row("p-1", "Karimov Alisher Olimovich", P1),  # ismi boshqacha, lekin yuzi bog'langan
        row("p-2", "Raximova Xusnidaxon Valijon qizi", P2),
        row("p-3", "Aliyev Vali Salimovich", P3),
        row("p-4", "Noma'lum Odam", P4),
    ]
    with patch.object(sp.fl, "choose_account", side_effect=lambda c, pos, info: c[0].username if len(c) == 1 else None):
        plan = sp.plan_links(rows, {"p-1": "3442000001"}, users, {}, {})
    assert plan[P1] == ("3442000001", "face")
    assert plan[P2] == ("998900000002", "name")
    assert plan[P3] == ("", "")
    assert plan[P4] == ("", "")


def test_admin_link_is_kept_and_one_account_never_gets_two_pinfls():
    users = [user("3442000001", "Karimov", "Ali")]
    rows = [
        row("p-1", "Karimov Ali Valiyevich", P1),
        row("p-2", "Karimov Ali Olimovich", P2),  # namesake: ikki JSHSHIR bir kalitda
        row("p-5", "Boshqa Odam", P5),
    ]
    plan = sp.plan_links(rows, {}, users, {}, {P5: "3442000001"})
    assert plan[P5] == ("3442000001", "admin")
    assert plan[P1] == ("", "") and plan[P2] == ("", "")


def test_same_person_listed_twice_with_one_pinfl_links_once():
    users = [user("3442000001", "Karimov", "Ali")]
    rows = [row("p-1", "Karimov Ali Valiyevich", P1), row("p-1b", "Karimov Ali Valiyevich", P1)]
    plan = sp.plan_links(rows, {"p-1b": "3442000001"}, users, {}, {})
    assert plan == {P1: ("3442000001", "face")}


def test_is_pinfl():
    assert sp.is_pinfl("30101990000001")
    assert not sp.is_pinfl("3442112068") and not sp.is_pinfl("998901234567") and not sp.is_pinfl("")


def test_pinfl_passes_login_validation_unchanged():
    assert LocalLoginRequest(phone_digits=" 3010 1990 0000 01 ", password="secret1").phone_digits == "30101990000001"


def _login(pinfl, owner, account, password_ok=True):
    payload = SimpleNamespace(phone_digits=pinfl, password="xxxxxx", register=False, role="")
    lookups = {pinfl: None, owner: account}
    with patch.object(auth_routes, "throttle_login_account"), \
         patch.object(auth_routes.auth_service, "get_user_by_username", side_effect=lambda db, u: lookups.get(u)), \
         patch.object(auth_routes.staff_pinfl, "owner_for", return_value=owner), \
         patch.object(auth_routes, "verify_password", return_value=password_ok), \
         patch.object(auth_routes.auth_service, "resolve_login_role", return_value="hodim"), \
         patch.object(auth_routes.auth_service, "touch_last_login"), \
         patch.object(auth_routes, "record_activity_event"), \
         patch.object(auth_routes, "_login_response", return_value="TOKENS") as login_response:
        return auth_routes.local_login(payload, MagicMock(), db=MagicMock()), login_response


def test_login_with_pinfl_uses_linked_account_and_its_own_password():
    account = SimpleNamespace(username="3442000001", password="hash", is_active=True)
    out, login_response = _login(P1, "3442000001", account)
    assert out == "TOKENS" and login_response.call_args.args[1] is account


def test_login_with_pinfl_wrong_password_is_401():
    account = SimpleNamespace(username="3442000001", password="hash", is_active=True)
    with pytest.raises(HTTPException) as exc:
        _login(P1, "3442000001", account, password_ok=False)
    assert exc.value.status_code == 401


def test_unlinked_pinfl_gets_clear_message_and_no_account_is_created():
    with patch.object(auth_routes.auth_service, "create_user") as create_user:
        with pytest.raises(HTTPException) as exc:
            _login(P1, None, None)
    assert exc.value.status_code == 403 and "JSHSHIR" in exc.value.detail
    create_user.assert_not_called()
