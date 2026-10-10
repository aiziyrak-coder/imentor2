"""JSONB ga yozishdan oldin matnni tozalash.

PostgreSQL `jsonb` NOL belgisini saqlay olmaydi va butun so'rovni rad etadi:
"unsupported Unicode escape sequence". AI javobida u ikki ko'rinishda uchraydi —
haqiqiy nol bayt va matn sifatida yozilgan escape ketma-ketligi. Ikkalasi ham
olib tashlanadi, aks holda o'qituvchi 500 xatosini ko'radi (2026-10-07).
"""

from __future__ import annotations

import re

#: Matn ichida HARF sifatida yozilgan nol belgisi (olti yoki o'n belgi).
#: Uzunrog'i OLDINDA turishi shart: aks holda o'n belgilisidan faqat yarmi
#: olinib, matnda "0000" qolib ketardi.
_ESCAPED_NUL = re.compile(r"\\[uU]0{8}|\\[uU]0{4}")


def clean_text(value: str) -> str:
    return _ESCAPED_NUL.sub("", value.replace("\x00", ""))


def clean_json(value):
    """Lug'at/ro'yxat ichidagi barcha matnni tozalaydi."""
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, dict):
        return {clean_json(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v) for v in value]
    return value
