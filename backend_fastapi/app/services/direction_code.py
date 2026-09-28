"""OnlineTest Direction.name (DI, TPI, PI, …) ni fayl/fan nomidan aniqlash."""

from __future__ import annotations

import re

# Uzunroq kodlar avval — TPI ichidagi PI, SSBJSS ichidagi S.
DEFAULT_DIRECTION_CODES: tuple[str, ...] = (
    "SSBJSS",
    "TBATM",
    "OHI",
    "TPI",
    "RTT",
    "DI",
    "FT",
    "PI",
    "BM",
    "MD",
    "XT",
    "ЛД",
    "F",
    "S",
    "P",
)


# Yo'nalishning TO'LIQ nomi → kod (2026-09-26). Fan nomlari ko'pincha
# "Davolash ishi 2026-2027 (Milliy) 5-semestr ..." shaklida keladi — qisqa kod
# yo'q, shuning uchun 65 ta fanda yo'nalish bo'sh qolgan edi. Faqat nom
# BOSHIDA tekshiriladi: "Davolash ishi ... Pediatriya" DI bo'lib qolsin.
NAME_PREFIXES: tuple[tuple[str, str], ...] = (
    ("davolash ishi", "DI"),
    ("davolash", "DI"),
    ("pediatriya ishi", "PI"),
    ("pediatriya", "PI"),
    ("tibbiy profilaktika", "TPI"),
    ("stomatologiya", "S"),
    ("farmatsiya", "F"),
    ("biotibbiyot muhandisligi", "BM"),
    ("xalq tabobati", "XT"),
    ("oliy hamshiralik", "OHI"),
)


def _from_name(text: str) -> str:
    head = re.sub(r"[ʻʼ‘’'`]", "", (text or "").strip().lower())
    for prefix, code in NAME_PREFIXES:
        if head.startswith(prefix):
            return code
    return ""


def normalize_direction_code(raw: str | None, allowed: list[str] | None = None) -> str:
    value = (raw or "").strip()[:32]
    if not value:
        return ""
    # Kod o'rniga to'liq nom yozilgan ("Stomatologiya yo'nalishi") — kodga keltiriladi.
    if " " in value and (named := _from_name(value)):
        return named
    pool = [c.strip() for c in (allowed or list(DEFAULT_DIRECTION_CODES)) if c and str(c).strip()]
    if not pool:
        return value
    key = value.casefold()
    for code in pool:
        if code.casefold() == key:
            return code
    return value


def infer_direction_code(text: str, allowed: list[str] | None = None) -> str:
    """`(TPI)` yoki so'z chegarasidagi kodni topadi."""
    pool = [c.strip() for c in (allowed or list(DEFAULT_DIRECTION_CODES)) if c and str(c).strip()]
    if not text or not pool:
        return ""
    base = re.sub(r"\.(pdf|docx?|xlsx?)$", "", text, flags=re.IGNORECASE).strip()
    paren = re.search(r"\(([^)]+)\)\s*$", base)
    if paren:
        hit = normalize_direction_code(paren.group(1), pool)
        if hit.casefold() in {c.casefold() for c in pool}:
            return hit
    pool_sorted = sorted(pool, key=lambda c: len(c), reverse=True)
    for code in pool_sorted:
        pattern = rf"(?<![\w]){re.escape(code)}(?![\w])"
        if re.search(pattern, base, flags=re.IGNORECASE):
            return code
    named = _from_name(base)
    return named if named in pool else ""
