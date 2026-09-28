"""Kafedralarni HEMIS bilan bog'lash (2026-09-25).

Bizdagi kafedra nomlari yillar davomida turlicha yozilgan ("Mikrobiologiya,
virusologiya,immunologiya"), ba'zilari ikki marta kiritilgan. HEMIS'da esa 33 ta
aniq kafedra bor.

Nom O'ZGARTIRILMAYDI — u fanlar, xodimlar va monitor inventarida kalit sifatida
ishlatiladi. Faqat `hemis_id`/`hemis_code`/`hemis_name` yoziladi, ya'ni "bu bizning
qaysi kafedramiz" savoliga javob paydo bo'ladi.

Bog'lash faqat ISHONCHLI bo'lganda: normallashtirilgandan keyin nom aynan mos
kelsa yoki juda yaqin bo'lsa (0.9), yoxud quyidagi qo'lda tasdiqlangan ro'yxatda
bo'lsa. Shubhali holat bog'lanmaydi — noto'g'ri bog'lash jim xatoga olib keladi.
"""

from __future__ import annotations

import difflib
import logging
import re
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment
from app.services import hemis_client

logger = logging.getLogger(__name__)

AUTO_RATIO = 0.9

# Nomi sezilarli farq qiladigan, lekin ayni kafedra ekani aniq bo'lganlar.
# Chapda — bizdagi nom, o'ngda — HEMIS nomi (ikkalasi ham normallashtiriladi).
#
# Har biri HEMIS dars jadvalidagi kafedra nomi bilan tekshirilgan: "Anatomiya"
# nomli kafedra ham bor, lekin darslar "Yu. Nishonov nomidagi Normal anatomiya"
# nomi ostida yuritiladi.
MANUAL: dict[str, str] = {
    "lotin tili": "lotin tili, pedagogika va psixologiya",
    "umumiy xirurgiya": "umumiy jarrohlik",
    "terapiya uash": "fakultativ terapiya (uash)",
    "normal anatomiya": "yu. nishonov nomidagi normal anatomiya",
    "preventiv": "preventiv tibbiyot asoslari, jamoat salomatligi, jismoniy tarbiya va sport",
    "gospital terapiya": "gospital terapiya (laboratoriya)",
    "endokrinologiya gemotologiya va ftiziatriya": "endokrinologiya, gematologiya kafedrasi",
    "endokrinologiya gematologiya va ftizatriya": "endokrinologiya, gematologiya kafedrasi",
    # 2026-09-26: "Pediatriya 2" avtomatik ravishda (o'xshashlik 0.91) oddiy
    # "Pediatriya"ga bog'lanib qolgan edi — uning 25 xodimi kafedrasiz qolardi.
    "pediatriya 2": "anesteziologiya va reanimotologiya, pediatriya-2",
    "pediatriya 1": "pediatriya",
}


def norm(value: str) -> str:
    s = (value or "").lower()
    for a, b in (("ʻ", "'"), ("‘", "'"), ("’", "'"), ("`", "'"), ("ў", "u"), ("қ", "q"), ("ғ", "g"), ("ҳ", "h")):
        s = s.replace(a, b)
    s = re.sub(r"\b(kafedrasi|kafedra|sillabus)\b", " ", s)
    s = re.sub(r"[^a-z0-9() ]", " ", s)
    return " ".join(s.split())


def hemis_departments(rows: Iterable[dict] | None = None) -> list[dict]:
    source = rows if rows is not None else hemis_client.iter_all("/data/department-list")
    return [d for d in source
            if (d.get("structureType") or {}).get("name") == "Kafedra" and d.get("active")]


def match(name: str, by_norm: dict[str, dict]) -> tuple[dict | None, str]:
    """(HEMIS kafedrasi, qanday topilgani). Ishonch bo'lmasa (None, 'shubhali')."""
    key = norm(name)
    if not key:
        return None, "nomsiz"
    manual = MANUAL.get(key)
    if manual and norm(manual) in by_norm:
        return by_norm[norm(manual)], "qo'lda"
    if key in by_norm:
        return by_norm[key], "aynan"
    close = difflib.get_close_matches(key, list(by_norm), n=1, cutoff=AUTO_RATIO)
    # Raqami farq qiladigan nomlar — BOSHQA kafedra ("Pediatriya 2" ≠ "Pediatriya").
    if close and _digits(close[0]) == _digits(key):
        return by_norm[close[0]], "yaqin"
    return None, "shubhali"


def _digits(text: str) -> set[str]:
    return set(re.findall(r"\d+", text or ""))


def sync(db: Session, rows: Iterable[dict] | None = None) -> dict:
    kaf = hemis_departments(rows)
    by_norm = {norm(d["name"]): d for d in kaf}
    stats = {"hemisda": len(kaf), "aynan": 0, "yaqin": 0, "qo'lda": 0, "shubhali": 0, "nomsiz": 0, "ozgarmadi": 0}
    unmatched: list[str] = []

    for dep in db.execute(select(AcademicDepartment)).scalars():
        found, how = match(dep.name, by_norm)
        if found is None:
            stats[how] += 1
            if dep.is_active:
                unmatched.append(dep.name)
            continue
        values = (str(found.get("id") or ""), str(found.get("code") or ""), str(found.get("name") or ""))
        if (dep.hemis_id, dep.hemis_code, dep.hemis_name) == values:
            stats["ozgarmadi"] += 1
        else:
            dep.hemis_id, dep.hemis_code, dep.hemis_name = values
        stats[how] += 1

    stats["boglanmagan_faol"] = unmatched
    logger.info("HEMIS kafedra bog'lash: %s", {k: v for k, v in stats.items() if k != "boglanmagan_faol"})
    return stats
