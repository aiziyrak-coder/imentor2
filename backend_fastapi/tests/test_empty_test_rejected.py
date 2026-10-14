"""Savolsiz test saqlanmaydi (2026-10-13: bo'sh test -> jonli sessiya 422)."""

import pytest
from fastapi import HTTPException

from app.api.routes.prepared_content import _reject_empty_test


def test_empty_test_is_rejected():
    for payload in ({"questions": []}, {}, None):
        with pytest.raises(HTTPException):
            _reject_empty_test("test", payload)


def test_other_kinds_and_real_tests_pass():
    _reject_empty_test("case", {})
    _reject_empty_test("test", {"questions": [{"question": "Q"}]})
