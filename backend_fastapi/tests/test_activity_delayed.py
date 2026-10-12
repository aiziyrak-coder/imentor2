"""Navbatdan kechikib kelgan faollik qaydi asl vaqtiga yoziladi (2026-10-12)."""

import datetime as dt

from app.api.routes.analytics import _occurred_at

NOW = dt.datetime(2026, 10, 12, 10, 0, tzinfo=dt.timezone.utc)


def test_delayed_event_goes_back_by_its_delay_regardless_of_client_clock():
    # Kompyuter soati 3 soat orqada — farq baribir 20 daqiqa.
    skewed = 1_000_000_000_000
    got = _occurred_at(skewed, skewed + 20 * 60_000, NOW)
    assert got == NOW - dt.timedelta(minutes=20)


def test_fresh_or_unstamped_event_uses_server_time():
    assert _occurred_at(None, None, NOW) == NOW
    assert _occurred_at(1000, 1000 + 2_000, NOW) == NOW  # oddiy yuborish


def test_too_old_or_negative_delay_is_ignored():
    assert _occurred_at(0 + 1, 1 + 25 * 3600_000, NOW) == NOW
    assert _occurred_at(10_000_000, 1_000, NOW) == NOW
