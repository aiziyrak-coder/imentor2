"""Rate limit — tezlik satrini o'qish, IP aniqlash va Redis'siz zaxira.

Eng muhim tekshiruv oxirida: Redis yiqilganda login endpointi cheksiz
urinishga ochilib qolmasin.
"""

import pytest
from fastapi import HTTPException

from app.core import throttling
from app.core.throttling import _MemoryCounter, client_ip, enforce, parse_rate


class TestParseRate:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("20/minute", (20, 60)),
            ("5/m", (5, 60)),
            ("100/hour", (100, 3600)),
            ("3/s", (3, 1)),
            ("1000/day", (1000, 86400)),
            ("  20/MINUTE  ", (20, 60)),
        ],
    )
    def test_togri_formatlar(self, raw, expected):
        assert parse_rate(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        ["", None, "20", "20/", "/minute", "abc/minute", "20/fortnight", "0/minute", "-5/minute"],
    )
    def test_notogri_format_cheklovni_ochiradi(self, raw):
        # (0, 0) — `enforce` bunda hech narsa qilmaydi.
        assert parse_rate(raw) == (0, 0)


class FakeRequest:
    def __init__(self, headers=None, host=None):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})() if host is not None else None


class TestClientIp:
    def test_xforwardedfor_birinchi_ip(self):
        req = FakeRequest({"x-forwarded-for": "10.1.1.5, 172.16.0.1"}, host="127.0.0.1")
        assert client_ip(req) == "10.1.1.5"

    def test_header_yoq_bolsa_soket_ipsi(self):
        assert client_ip(FakeRequest(host="10.2.2.2")) == "10.2.2.2"

    def test_hech_narsa_yoq(self):
        assert client_ip(FakeRequest()) == "unknown"

    def test_bosh_header_soketga_tushadi(self):
        assert client_ip(FakeRequest({"x-forwarded-for": "   "}, host="10.3.3.3")) == "10.3.3.3"


class TestMemoryCounter:
    def test_oyna_ichida_osadi(self):
        c = _MemoryCounter()
        assert [c.incr("k", 60) for _ in range(3)] == [1, 2, 3]

    def test_kalitlar_alohida(self):
        c = _MemoryCounter()
        c.incr("a", 60)
        c.incr("a", 60)
        assert c.incr("b", 60) == 1

    def test_oyna_tugagach_nolga_tushadi(self):
        c = _MemoryCounter()
        # 0 soniyali oyna — keyingi chaqiruvda muddat allaqachon o'tgan.
        assert c.incr("k", 0) == 1
        assert c.incr("k", 0) == 1


class BrokenRedis:
    def incr(self, key):
        raise ConnectionError("Redis o'chgan")

    def expire(self, key, period):
        raise ConnectionError("Redis o'chgan")


class TestEnforceWithoutRedis:
    @pytest.fixture(autouse=True)
    def _broken(self, monkeypatch):
        monkeypatch.setattr(throttling, "_redis", lambda: BrokenRedis())
        monkeypatch.setattr(throttling, "_memory", _MemoryCounter())

    def test_redis_yiqilganda_ham_cheklaydi(self):
        # Ilgari bu yerda hech qanday xato ko'tarilmasdi — brute-force uchun
        # ochiq eshik edi.
        for _ in range(3):
            enforce("throttle:login:10.0.0.1", "3/minute")
        with pytest.raises(HTTPException) as e:
            enforce("throttle:login:10.0.0.1", "3/minute")
        assert e.value.status_code == 429

    def test_boshqa_ip_alohida_hisoblanadi(self):
        for _ in range(3):
            enforce("throttle:login:10.0.0.1", "3/minute")
        enforce("throttle:login:10.0.0.2", "3/minute")  # xato ko'tarmasligi kerak

    def test_cheklov_sozlanmagan_bolsa_otkaziladi(self):
        for _ in range(100):
            enforce("throttle:login:10.0.0.9", "notogri")


class WorkingRedis:
    def __init__(self):
        self.counts = {}
        self.expired = []

    def incr(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, key, period):
        self.expired.append((key, period))


class TestEnforceWithRedis:
    def test_limitgacha_otadi_keyin_429(self, monkeypatch):
        fake = WorkingRedis()
        monkeypatch.setattr(throttling, "_redis", lambda: fake)
        for _ in range(2):
            enforce("k", "2/minute")
        with pytest.raises(HTTPException) as e:
            enforce("k", "2/minute")
        assert e.value.status_code == 429

    def test_birinchi_sorovda_muddat_qoyiladi(self, monkeypatch):
        fake = WorkingRedis()
        monkeypatch.setattr(throttling, "_redis", lambda: fake)
        enforce("k", "10/minute")
        assert fake.expired == [("k", 60)]
        enforce("k", "10/minute")
        assert len(fake.expired) == 1
