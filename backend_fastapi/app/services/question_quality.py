"""Test savolini baholab bo'lmaydigan nuqsonlar (2026-10-19).

Frontend (`frontend/src/utils/testQuality.ts`) yangi savollarni tekshiradi,
lekin bazada tekshiruvdan oldin yaratilgan savollar bor. Ular tashqi
imtihonga (OnlineTest yakuniy test) to'g'ridan-to'g'ri berilardi: talabalar
"A va D bir xil, to'g'ri javob D" kabi savollardan shikoyat qildi.

Bu yerda faqat BAHONI BUZADIGAN nuqsonlar tutiladi — talaba to'g'ri javobni
belgilab ham xato olishi mumkin bo'lgan holatlar:

* ikki variant bir xil (registr, tinish belgisi, bo'shliq hisobga olinmaydi);
* ikki variant bir xil so'zlardan iborat, faqat tartibi boshqa
  ("Sil, emfizem, sarkoidoz" va "Emfizem, sil, sarkoidoz");
* bo'sh yoki to'ldiruvchi variant ("Variant 4");
* "hammasi to'g'ri" / "hech biri" turidagi variant.
"""
from __future__ import annotations

import re
import unicodedata

_APOS = "['‘’ʻʼ`]?"
_ALL_OF_THE_ABOVE = re.compile(
    rf"(hammasi\s+to{_APOS}g{_APOS}ri|barcha\s+javob|yuqoridagilarning\s+hammasi"
    r"|hech\s+biri|все\s+ответы|all\s+of\s+the\s+above|none\s+of\s+the\s+above)",
    re.IGNORECASE,
)
_FILLER = re.compile(r"^(variant|вариант|option)\s*\d+$", re.IGNORECASE)


def _fold(text: str) -> str:
    t = unicodedata.normalize("NFKC", str(text or "")).casefold()
    for ch in "‘’ʻʼ`'":
        t = t.replace(ch, "")
    t = re.sub(r"[^\w%/.,<>-]+", " ", t)
    return re.sub(r"\s+", " ", t).strip(" .,;")


def _word_bag(text: str) -> tuple[str, ...]:
    words = re.findall(r"\w+", _fold(text))
    return tuple(sorted(words))


def ungradable_flaws(options: list) -> list[str]:
    """Bo'sh ro'yxat — savolni baholash mumkin."""
    opts = [str(o or "").strip() for o in (options or [])]
    flaws: list[str] = []
    if len(opts) < 2:
        return ["variant_kam"]
    if any(not o or _FILLER.match(o) for o in opts):
        flaws.append("variant_bosh")
    folded = [_fold(o) for o in opts]
    if len(set(folded)) != len(folded):
        flaws.append("variant_takror")
    else:
        bags = [_word_bag(o) for o in opts]
        # Kamida 3 so'zli variantlar — qisqa nomlarda ("A", "B guruh") tasodifiy
        # mos kelish bo'lmasin.
        long_bags = [b for b in bags if len(b) >= 3]
        if len(set(long_bags)) != len(long_bags):
            flaws.append("variant_tartib_takror")
    if any(_ALL_OF_THE_ABOVE.search(o) for o in opts):
        flaws.append("hammasi_togri")
    return flaws
