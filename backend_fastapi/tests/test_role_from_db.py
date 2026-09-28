"""Rol faqat bazadan olinadi (2026-09-26).

Ilgari `db_role or jwt_role or "hodim"` edi: guruhlari olib tashlangan
foydalanuvchi eski tokendagi rol (hatto "admin") bilan ishlayverardi,
rolsiz hisob esa o'qituvchi bo'lib kirardi.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api import deps
from app.services import auth_service


def _user(groups=(), superuser=False):
    return SimpleNamespace(id=5, username="u5", is_active=True, is_superuser=superuser,
                           groups=[SimpleNamespace(name=g) for g in groups])


def _auth(user, jwt_role="admin"):
    db = MagicMock()
    db.get.return_value = user
    creds = SimpleNamespace(credentials="t")
    claims = {"token_type": "access", "user_id": 5, "role": jwt_role}
    with patch.object(deps, "decode_token", return_value=claims):
        return deps._authenticate(creds, db, allow_pending_password=False)


def test_removed_admin_does_not_keep_admin_rights_from_the_token():
    with pytest.raises(HTTPException) as err:
        _auth(_user(groups=()), jwt_role="admin")
    assert err.value.status_code == 403


def test_database_role_wins_over_the_token():
    assert _auth(_user(groups=("hodim",)), jwt_role="admin").role == "hodim"


def test_superuser_is_admin_without_a_group():
    assert _auth(_user(superuser=True), jwt_role="").role == "admin"


def test_login_without_a_role_is_not_a_teacher():
    assert auth_service.resolve_login_role(MagicMock(), _user(groups=()), "") == ""
    assert auth_service.resolve_login_role(MagicMock(), _user(groups=("student",)), "") == "student"
