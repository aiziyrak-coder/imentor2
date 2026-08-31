"""Django `core/throttling.py` ekvivalenti — Redis orqali rate limit.

Redis ishlamasa jarayon ichidagi zaxira hisoblagichga o'tiladi. Ilgari bunday
holatda cheklov butunlay o'chib qolardi — ya'ni Redis yiqilgan payt login
endpointi cheksiz urinishga ochiq bo'lardi. Zaxira hisoblagich har bir
gunicorn worker'ida alohida, shuning uchun amaldagi chegara worker soniga
ko'payadi; bu aniq emas, lekin cheksizdan ko'ra ancha yaxshi.

Kalitlar Django scope nomlari bilan mos.
"""

from __future__ import annotations

import logging
import threading
import time
from functools import lru_cache

import redis
from fastapi import Depends, HTTPException, Request, status

from app.api.deps import AuthContext, get_current_auth
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PERIODS = {
    "s": 1,
    "sec": 1,
    "second": 1,
    "seconds": 1,
    "m": 60,
    "min": 60,
    "minute": 60,
    "minutes": 60,
    "h": 3600,
    "hour": 3600,
    "hours": 3600,
    "d": 86400,
    "day": 86400,
    "days": 86400,
}


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


def parse_rate(rate: str) -> tuple[int, int]:
    """`20/minute` → (20, 60). Noto'g'ri formatda cheklov o'tkazib yuboriladi."""
    raw = (rate or "").strip().lower()
    if "/" not in raw:
        return 0, 0
    num_s, unit = raw.split("/", 1)
    try:
        num = int(num_s)
    except ValueError:
        return 0, 0
    period = _PERIODS.get(unit.strip())
    if not period or num <= 0:
        return 0, 0
    return num, period


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class _MemoryCounter:
    """Redis o'rniga ishlaydigan oddiy oyna hisoblagichi.

    Faqat zaxira sifatida ishlatiladi, shuning uchun aniqligi Redis darajasida
    emas: oyna qat'iy (sliding emas) va har worker o'zinikini yuritadi. Lug'at
    cheksiz o'smasin uchun muddati o'tgan kalitlar chaqiruv paytida tozalanadi.
    """

    _MAX_KEYS = 50_000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[str, tuple[float, int]] = {}

    def incr(self, key: str, period: int) -> int:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > self._MAX_KEYS:
                self._hits = {k: v for k, v in self._hits.items() if v[0] > now}
            started, count = self._hits.get(key, (0.0, 0))
            if started <= now:
                started, count = now + period, 0
            count += 1
            self._hits[key] = (started, count)
            return count


_memory = _MemoryCounter()


def enforce(key: str, rate: str) -> None:
    num, period = parse_rate(rate)
    if num <= 0 or period <= 0:
        return
    try:
        r = _redis()
        n = int(r.incr(key))
        if n == 1:
            r.expire(key, period)
    except Exception:
        logger.warning(
            "Rate limit Redis ishlamadi — jarayon ichidagi zaxira ishlatildi (%s).",
            key,
            exc_info=True,
        )
        n = _memory.incr(key, period)
    if n > num:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Juda ko'p so'rov. Biroz kuting.",
        )


def throttle_login(request: Request) -> None:
    enforce(f"throttle:login:{client_ip(request)}", get_settings().django_login_rate)


def throttle_live_test_anon(request: Request) -> None:
    enforce(f"throttle:live_test_anon:{client_ip(request)}", get_settings().django_live_test_anon_rate)


def throttle_staff_ping(auth: AuthContext = Depends(get_current_auth)) -> None:
    enforce(f"throttle:staff_ping:{auth.user.id}", get_settings().django_staff_ping_rate)


def throttle_education_ai(auth: AuthContext = Depends(get_current_auth)) -> None:
    enforce(f"throttle:education_ai:{auth.user.id}", get_settings().django_ai_education_rate)
