"""Jonli test sessiyasi 24 soatdan keyin yopiq hisoblanadi (2026-09-26)."""

import datetime as dt
from types import SimpleNamespace

from app.api.routes import live_test as lt

NOW = dt.datetime.now(dt.timezone.utc)


def session(hours_ago: float, closed: bool = False):
    return SimpleNamespace(is_closed=closed, created_at=NOW - dt.timedelta(hours=hours_ago))


def test_lesson_time_session_stays_open():
    assert lt._closed(session(1)) is False
    assert lt._closed(session(12)) is False


def test_forgotten_session_closes_itself_after_a_day():
    assert lt._closed(session(25)) is True


def test_explicitly_closed_session_is_closed():
    assert lt._closed(session(0.1, closed=True)) is True
