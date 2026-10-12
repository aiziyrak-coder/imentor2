"""Talaba JSHSHIR bilan: nusxada yo'q bo'lsa cam.fermi.uz'dan jonli qidiriladi (2026-10-12)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.api.routes import auth as auth_routes
from app.services import cam_students

PINFL = "12345678901234"


def settings(url="https://camapi.fermi.uz/api/v1/integration", key="k"):
    return SimpleNamespace(cam_student_api_url=url, cam_student_api_key=key, cam_student_timeout=5.0)


def response(status, body=None):
    return SimpleNamespace(status_code=status, json=lambda: body)


@pytest.fixture
def configured():
    with patch.object(cam_students, "get_settings", return_value=settings()):
        yield


def test_found_student_returns_onlinetest_id(configured):
    with patch.object(cam_students.requests, "post", return_value=response(200, {"pinfl": PINFL, "hemis_id": "3651"})) as post:
        got = cam_students.lookup(PINFL)
    assert got.student_id == "3651"
    assert post.call_args.kwargs["headers"] == {"X-API-Key": "k"}
    assert post.call_args.args[0].endswith("/students/lookup")


def test_not_found_and_invalid_are_none(configured):
    for code in (404, 400):
        with patch.object(cam_students.requests, "post", return_value=response(code, {})):
            assert cam_students.lookup(PINFL) is None


def test_other_persons_pinfl_is_refused(configured):
    with patch.object(cam_students.requests, "post", return_value=response(200, {"pinfl": "99999999999999", "hemis_id": "1"})):
        with pytest.raises(cam_students.CamStudentsUnavailable):
            cam_students.lookup(PINFL)


def test_bad_key_is_unavailable(configured):
    with patch.object(cam_students.requests, "post", return_value=response(401, {})):
        with pytest.raises(cam_students.CamStudentsUnavailable):
            cam_students.lookup(PINFL)


def test_not_configured_health():
    with patch.object(cam_students, "get_settings", return_value=settings(url="", key="")):
        assert cam_students.health()["configured"] is False


def test_login_falls_back_to_contingent_by_pinfl():
    db = MagicMock()
    db.execute.return_value.scalars.return_value.first.return_value = SimpleNamespace(student_id="777")
    user = SimpleNamespace(is_active=True)
    with patch.object(cam_students, "lookup", return_value=cam_students.CamStudent(pinfl=PINFL, student_id="")), \
         patch.object(auth_routes, "_student_by_id", return_value=(user, "777")) as by_id:
        assert auth_routes._student_from_cam(db, PINFL) == (user, "777")
    by_id.assert_called_once_with(db, "777")


def test_cam_down_means_plain_not_found():
    with patch.object(cam_students, "lookup", side_effect=cam_students.CamStudentsUnavailable("x")):
        assert auth_routes._student_from_cam(MagicMock(), PINFL) is None
