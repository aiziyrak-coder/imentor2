"""HEMIS (student.fjsti.uz) REST API — FAQAT O'QIYDI (2026-09-25).

Institut dars jadvalining haqiqiy manbasi HEMIS'da: kim, qachon, qaysi
auditoriyada dars o'tishi shu yerda turadi va o'zgarganda darhol yangilanadi.
Monitor bandligi jadvali esa kafedralardan Excel bilan yig'ilardi — u eskirardi
va o'qituvchi ismi bo'yicha taxmin qilinardi.

HEMIS'ga hech narsa YOZILMAYDI. cam.fermi.uz kabi — faqat o'qish.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Iterator

import requests

from app.core.config import get_settings

logger = logging.getLogger(__name__)

PAGE_SIZE = 200
TIMEOUT = 120
# Vaqtinchalik xatolar: HEMIS katta ro'yxatda shulardan birini qaytarishi mumkin.
RETRY_CODES = {429, 500, 502, 503, 504}
RETRIES = 4
RETRY_WAIT = 5
# Bitta so'rovda kelishi mumkin bo'lgan eng ko'p sahifa — cheksiz aylanishdan himoya.
MAX_PAGES = 400


class HemisError(RuntimeError):
    pass


def configured() -> bool:
    s = get_settings()
    return bool((s.hemis_api_url or "").strip() and (s.hemis_api_token or "").strip())


def _get(path: str, params: dict[str, Any]) -> dict:
    s = get_settings()
    base = (s.hemis_api_url or "").strip().rstrip("/")
    token = (s.hemis_api_token or "").strip()
    if not base or not token:
        raise HemisError("HEMIS_API_URL yoki HEMIS_API_TOKEN sozlanmagan.")

    # Katta ro'yxatlarda (7 000 talaba) HEMIS ba'zan 504/502 qaytaradi — bu
    # vaqtinchalik, shuning uchun bir necha marta, orasini ochib qayta so'raymiz.
    last = ""
    for attempt in range(RETRIES):
        try:
            resp = requests.get(
                f"{base}{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                params=params,
                timeout=TIMEOUT,
            )
        except requests.RequestException as exc:
            last = f"aloqa yo'q: {exc}"
        else:
            if resp.status_code == 401:
                raise HemisError("HEMIS tokeni yaroqsiz yoki muddati tugagan.")
            if resp.status_code in RETRY_CODES:
                last = f"HTTP {resp.status_code}"
            elif resp.status_code >= 400:
                raise HemisError(f"HEMIS {path} → HTTP {resp.status_code}")
            else:
                break
        if attempt < RETRIES - 1:
            logger.warning("HEMIS %s (%s) — %d s dan keyin qayta urinaman", path, last, RETRY_WAIT * (attempt + 1))
            time.sleep(RETRY_WAIT * (attempt + 1))
    else:
        raise HemisError(f"HEMIS {path} javob bermadi ({last})")
    try:
        body = resp.json()
    except ValueError as exc:
        raise HemisError(f"HEMIS {path} javobi JSON emas") from exc
    if not body.get("success", True):
        raise HemisError(f"HEMIS {path} → {body.get('error')}")
    return body.get("data") or {}


def iter_all(path: str, **params: Any) -> Iterator[dict]:
    """Sahifama-sahifa hamma yozuvlar. Javob `{items, pagination}` yoki oddiy ro'yxat."""
    page = 1
    while page <= MAX_PAGES:
        data = _get(path, dict(params, page=page, limit=PAGE_SIZE))
        items = data.get("items") if isinstance(data, dict) else data
        if not items:
            return
        yield from items
        pagination = data.get("pagination") if isinstance(data, dict) else None
        if not pagination or page >= int(pagination.get("pageCount") or 1):
            return
        page += 1
    # Never present a truncated import as a complete authoritative snapshot.
    raise HemisError(f"HEMIS {path}: {MAX_PAGES} sahifalik chegara oshdi; to‘liq nusxa olinmadi")


def auditoriums() -> list[dict]:
    return list(iter_all("/data/auditorium-list"))


def teachers() -> list[dict]:
    """Professor-o'qituvchi xodimlar (type=11 — xodim ro'yxati uchun majburiy parametr)."""
    return list(iter_all("/data/employee-list", type=11))


def schedule(education_year: int | str = "") -> list[dict]:
    params: dict[str, Any] = {}
    if education_year:
        params["_education_year"] = education_year
    return list(iter_all("/data/schedule-list", **params))
