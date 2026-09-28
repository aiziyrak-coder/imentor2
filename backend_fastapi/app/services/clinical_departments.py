"""Klinik kafedralar — institutning RASMIY ro'yxati (2026-09-25).

Muammo: iMentor hamma fanga klinik material yozardi. "Dinshunoslik" yoki
"Axborot texnologiyalari" mavzusiga ham bemor kartasi, tashxis va dori bilan
keys chiqardi. Sabab — fan klinikmi degan savol faqat nom ichidagi so'zlarga
qarab taxmin qilinardi.

Endi manba aniq: institut hujjatidagi 15 ta klinik kafedra (`app/data/
clinical_departments.json`). Bu kafedralar bemor yonida — shifoxona, dispanser,
tug'ruqxona bazasida dars o'tadi. Qolgan kafedralar (anatomiya, fiziologiya,
kimyo, tillar, ijtimoiy fanlar) bemor ssenariysi bilan ishlamaydi.

Bayroq `core_academicdepartment.is_clinical` da saqlanadi, ya'ni keyinchalik
ro'yxat o'zgarsa kodga tegmasdan yangilanadi.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment
from app.services.staff_department import normalize_department_name

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "clinical_departments.json"


@lru_cache(maxsize=1)
def official() -> list[dict]:
    """Hujjatdagi ro'yxat: nom va klinik baza."""
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return [d for d in data.get("departments", []) if str(d.get("name") or "").strip()]


@lru_cache(maxsize=1)
def _norms() -> dict[str, str]:
    """Normallashtirilgan nom → klinik baza.

    Hujjatdagi yozilish har doim ham bazadagiday emas ("Ichki kasallalliklar"
    va "Ichki kasalliklar"), shuning uchun har yozuv `aliases` bilan keladi.
    """
    out: dict[str, str] = {}
    for d in official():
        base = d.get("base", "")
        for name in [d["name"], *(d.get("aliases") or [])]:
            norm = normalize_department_name(name)
            if norm:
                out[norm] = base
    return out


def is_clinical_name(name: str) -> bool:
    """Nom rasmiy klinik ro'yxatga tushadimi.

    Taqqoslash `normalize_department_name` bilan: "kafedrasi" qo'shimchasi,
    apostrof va imlo farqi ahamiyatsiz. Aniq moslik topilmasa, ro'yxatdagi
    nom kafedra nomining ichida (yoki teskarisi) bo'lishi ham yetarli —
    HEMIS va iMentor nomlari har doim ham bir xil yozilmagan.
    """
    target = normalize_department_name(name or "")
    if not target:
        return False
    norms = _norms()
    if target in norms:
        return True
    return any(n and (n in target or target in n) for n in norms)


def clinical_base(name: str) -> str:
    """Kafedra qaysi klinik bazada dars o'tadi (bo'lmasa bo'sh)."""
    target = normalize_department_name(name or "")
    for norm, base in _norms().items():
        if target == norm or (norm and (norm in target or target in norm)):
            return base
    return ""


def sync(db: Session, *, dry_run: bool = False) -> dict:
    """`is_clinical` bayrog'ini rasmiy ro'yxat bo'yicha qo'yadi.

    Kafedra NOMI o'zgarmaydi — faqat bayroq. Ro'yxatda yo'q kafedra
    klinik emas deb belgilanadi: hisobot ham, AI ham shu bayroqqa tayanadi.
    """
    stats = {"kafedra": 0, "klinik": 0, "ozgardi": 0, "royxatda_topilmadi": []}
    seen: set[str] = set()
    for dep in db.execute(select(AcademicDepartment)).scalars():
        stats["kafedra"] += 1
        want = is_clinical_name(dep.name)
        if want:
            stats["klinik"] += 1
            seen.add(normalize_department_name(dep.name))
        if bool(dep.is_clinical) != want:
            stats["ozgardi"] += 1
            if not dry_run:
                dep.is_clinical = want
    for d in official():
        # Hujjatdagi yozilish bazada bo'lmasligi mumkin, lekin aliaslaridan biri
        # topilgan bo'lsa — kafedra baribir bog'langan, "topilmadi" deyilmaydi.
        norms = [normalize_department_name(n) for n in [d["name"], *(d.get("aliases") or [])]]
        if not any(n and (n in s or s in n) for n in norms for s in seen):
            stats["royxatda_topilmadi"].append(d["name"])
    if not dry_run:
        db.commit()
    return stats
