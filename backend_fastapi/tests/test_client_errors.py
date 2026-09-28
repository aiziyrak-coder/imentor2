"""Brauzer xatolari jurnali (2026-09-24)."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes import client_errors as ce


def _request():
    return SimpleNamespace(headers={"user-agent": "Chrome/80"}, client=SimpleNamespace(host="10.0.0.1"))


def _db(existing=None, total=0):
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = existing
    db.execute.return_value.scalar.return_value = total
    return db


def _report(body, db):
    with patch.object(ce, "enforce"):
        return ce.report_client_error(ce.ClientErrorIn(**body), _request(), credentials=None, db=db)


def test_same_error_with_different_numbers_has_one_fingerprint():
    a = ce.fingerprint("Cannot read properties of undefined (reading '12')", "https://imentor.uz/assets/index-a.js:1:200", "")
    b = ce.fingerprint("Cannot read properties of undefined (reading '99')", "https://imentor.uz/assets/index-a.js:1:200", "")
    assert a == b


def test_new_error_is_stored_once():
    db = _db()
    _report({"message": "a.replaceAll is not a function", "source": "index.js:1:5", "page": "/"}, db)
    row = db.add.call_args.args[0]
    assert row.message == "a.replaceAll is not a function" and row.count == 1 and row.user_agent == "Chrome/80"


def test_repeat_increments_and_reopens_resolved():
    row = SimpleNamespace(count=3, users="", username="", resolved_at=object(), app_version="", last_seen=None)
    db = _db(existing=row)
    _report({"message": "boom"}, db)
    assert row.count == 4 and row.resolved_at is None
    db.add.assert_not_called()


def test_noise_and_empty_messages_are_ignored():
    for msg in ("ResizeObserver loop limit exceeded", "Script error.", "", "Failed to fetch dynamically imported module: x"):
        db = _db()
        _report({"message": msg}, db)
        db.add.assert_not_called()


def test_table_size_is_capped():
    db = _db(total=ce.MAX_DISTINCT)
    _report({"message": "new error"}, db)
    db.add.assert_not_called()


def test_long_fields_are_clipped():
    db = _db()
    _report({"message": "x" * 5000, "stack": "y" * 10000, "page": "p" * 900}, db)
    row = db.add.call_args.args[0]
    assert len(row.message) == 500 and len(row.stack) == 4000 and len(row.page) == 300
