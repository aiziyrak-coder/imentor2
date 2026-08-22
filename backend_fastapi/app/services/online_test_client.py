from __future__ import annotations

import logging
from typing import Any, Callable
from urllib.parse import urljoin

import requests

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_catalog_cache: dict[str, Any] = {"data": None, "expires_at": 0.0}
ACADEMIC_CATALOG_CACHE_TTL = 300


class OnlineTestAuthError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _online_test_base_urls() -> list[str]:
    settings = get_settings()
    urls: list[str] = []
    for raw in (settings.online_test_api_base_url, settings.online_test_api_fallback_url):
        base = (raw or "").strip().rstrip("/")
        if base and base not in urls:
            urls.append(base)
    return urls


def _try_bases(
    call: Callable[[str], tuple[requests.Response, dict[str, Any] | None]],
    *,
    auth_errors_no_fallback: bool = True,
) -> tuple[requests.Response, dict[str, Any], str]:
    bases = _online_test_base_urls()
    if not bases:
        raise OnlineTestAuthError("ONLINE_TEST_API_BASE_URL sozlanmagan.", status_code=503)

    last_exc: Exception | None = None
    last_res: requests.Response | None = None
    last_body: dict[str, Any] | None = None
    last_base = bases[-1]

    for idx, base in enumerate(bases):
        last_base = base
        try:
            res, body = call(base)
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning("OnlineTest %s network error: %s", base, exc)
            if idx < len(bases) - 1:
                logger.info("OnlineTest fallback: %s", bases[idx + 1])
                continue
            raise OnlineTestAuthError("OnlineTest ga ulanib bo'lmadi.", status_code=502) from exc

        last_res = res
        last_body = body or {}
        if res.status_code in (401, 403) and auth_errors_no_fallback:
            return res, last_body, base
        if res.status_code >= 500 and idx < len(bases) - 1:
            logger.warning(
                "OnlineTest %s HTTP %s — fallback %s",
                base,
                res.status_code,
                bases[idx + 1],
            )
            continue
        return res, last_body, base

    assert last_res is not None
    return last_res, last_body or {}, last_base


def online_test_login(student_id: str, password: str, *, timeout: float = 12.0) -> dict[str, Any]:
    def _call(base: str) -> tuple[requests.Response, dict[str, Any] | None]:
        url = urljoin(base + "/", "api/auth/login")
        res = requests.post(
            url,
            json={"id": student_id, "password": password},
            timeout=timeout,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            body = res.json() if res.content else {}
        except ValueError:
            body = {}
        return res, body if isinstance(body, dict) else {}

    res, body, used_base = _try_bases(_call)
    if used_base != _online_test_base_urls()[0]:
        logger.info("OnlineTest login via fallback: %s", used_base)

    if res.status_code == 401:
        raise OnlineTestAuthError("ID yoki parol noto'g'ri.", status_code=401)
    if res.status_code == 403:
        raise OnlineTestAuthError(str(body.get("error") or "Kirish taqiqlangan."), status_code=403)
    if res.status_code >= 400:
        raise OnlineTestAuthError(str(body.get("error") or "OnlineTest login xatosi."), status_code=502)

    token = str(body.get("token") or "").strip()
    user = body.get("user") if isinstance(body.get("user"), dict) else {}
    if not token or not user.get("id"):
        raise OnlineTestAuthError("OnlineTest javobi noto'g'ri.", status_code=502)
    role = str(user.get("role") or "").strip().lower()
    if role != "student":
        raise OnlineTestAuthError("Faqat talaba akkaunti bilan kirish mumkin.", status_code=403)
    return {"token": token, "user": user}


def fetch_academic_catalog(*, timeout: float = 12.0, use_cache: bool = True) -> dict[str, Any]:
    import time

    if use_cache and _catalog_cache["data"] is not None and _catalog_cache["expires_at"] > time.time():
        return _catalog_cache["data"]

    settings = get_settings()
    api_key = settings.online_test_consumer_api_key.strip()
    if not api_key:
        raise OnlineTestAuthError("ONLINE_TEST_CONSUMER_API_KEY sozlanmagan.", status_code=503)

    def _call(base: str) -> tuple[requests.Response, dict[str, Any] | None]:
        url = urljoin(base + "/", "api/public/academic-catalog/")
        res = requests.get(url, timeout=timeout, headers={"Accept": "application/json", "X-Api-Key": api_key})
        try:
            body = res.json() if res.content else {}
        except ValueError:
            body = {}
        return res, body if isinstance(body, dict) else {}

    res, body, used_base = _try_bases(_call, auth_errors_no_fallback=False)
    if used_base != (_online_test_base_urls()[0] if _online_test_base_urls() else ""):
        logger.info("OnlineTest academic-catalog via fallback: %s", used_base)

    if res.status_code == 403:
        raise OnlineTestAuthError("OnlineTest API kalit rad etildi.", status_code=502)
    if res.status_code >= 400:
        raise OnlineTestAuthError(str(body.get("error") or "OnlineTest academic-catalog xatosi."), status_code=502)
    if "kafedralar" not in body:
        raise OnlineTestAuthError("OnlineTest javobi noto'g'ri.", status_code=502)

    if use_cache:
        _catalog_cache["data"] = body
        _catalog_cache["expires_at"] = time.time() + ACADEMIC_CATALOG_CACHE_TTL
    return body


def split_person_name(full_name: str) -> tuple[str, str]:
    parts = [p for p in str(full_name or "").strip().split() if p]
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[0], " ".join(parts[1:]))
