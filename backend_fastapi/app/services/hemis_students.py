"""HEMIS talabalar kontingenti → `core_studentcontingent` (2026-09-25).

Kontingent jadvali bor edi-yu, hech qachon to'ldirilmagan: talaba haqidagi
yagona ma'lumot OnlineTest hisobidan (`ot_<id>`) va yuz shablonidan kelardi,
guruh/kurs/fakultet esa hech qayerda aniq turmasdi.

HEMIS talaba raqami (`student_id_number`) `ot_` loginidagi raqam bilan AYNAN
bir xil (1 301 hisobdan 1 289 tasi mos), shuning uchun mavjud hisoblar
kontingentga to'g'ridan-to'g'ri bog'lanadi.

FAQAT o'quv jarayoniga kerak bo'lgan maydonlar olinadi. Yashash manzili,
to'lov shakli, ijtimoiy toifa va shunga o'xshash shaxsiy ma'lumotlar
iMentor'ga kerak emas — ular SAQLANMAYDI.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.student_contingent import StudentContingent
from app.services import hemis_client

logger = logging.getLogger(__name__)

SOURCE = "hemis"


def _name(value: Any) -> str:
    return str((value or {}).get("name") or "").strip()


def _course(level: Any) -> int | None:
    """"1-kurs" → 1."""
    m = re.match(r"\s*(\d+)", _name(level))
    return int(m.group(1)) if m else None


def _birth_date(value: Any) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.datetime.fromtimestamp(int(value), dt.timezone.utc).date()
    except (TypeError, ValueError, OSError):
        return None


def _status(student: dict) -> str:
    return "active" if (student.get("studentStatus") or {}).get("code") == "11" else "inactive"


def fields(student: dict) -> dict:
    """HEMIS yozuvidan bizga keraklisi. Shaxsiy/moliyaviy maydonlar olinmaydi."""
    group = student.get("group") or {}
    return {
        "hemis_id": str(student.get("id") or ""),
        "student_id": str(student.get("student_id_number") or "").strip(),
        "last_name": str(student.get("second_name") or "").strip()[:128],
        "first_name": str(student.get("first_name") or "").strip()[:128],
        "middle_name": str(student.get("third_name") or "").strip()[:128],
        "gender": _name(student.get("gender"))[:16],
        "birth_date": _birth_date(student.get("birth_date")),
        # HEMIS'da talaba `department` deb fakultetni beradi (structureType = Fakultet).
        "faculty_name": _name(student.get("department"))[:255],
        "direction_code": str((student.get("specialty") or {}).get("code") or "")[:64],
        "direction_name": _name(student.get("specialty"))[:255],
        "course": _course(student.get("level")),
        "group_name": _name(group)[:64],
        "education_form": _name(student.get("educationForm"))[:64],
        "education_language": _name(group.get("educationLang"))[:32],
        "status": _status(student),
        "academic_year": _name(student.get("educationYear"))[:16],
        "source": SOURCE,
    }


def sync(db: Session, students: Iterable[dict] | None = None) -> dict:
    """Kontingentni HEMIS bilan tenglashtiradi.

    Qo'lda kiritilgan yozuvlarga (`source != 'hemis'`) tegilmaydi. HEMIS'dan
    tushib qolgan talaba o'chirilmaydi — `status='inactive'` bo'ladi, chunki
    uning testlari va yuzi bazada qoladi.
    """
    rows = list(students if students is not None else hemis_client.iter_all("/data/student-list"))
    now = dt.datetime.now(dt.timezone.utc)

    existing = {
        r.hemis_id: r
        for r in db.execute(select(StudentContingent).where(StudentContingent.hemis_id != "")).scalars()
    }
    stats = {"hemisda": len(rows), "yangi": 0, "yangilandi": 0, "ozgarmadi": 0, "chiqib_ketgan": 0}
    seen: set[str] = set()

    for student in rows:
        data = fields(student)
        key = data["hemis_id"]
        if not key or not data["student_id"]:
            continue
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = StudentContingent(**data, synced_at=now)
            db.add(row)
            stats["yangi"] += 1
            continue
        changed = [f for f, v in data.items() if getattr(row, f) != v]
        if changed:
            for field, value in data.items():
                setattr(row, field, value)
            stats["yangilandi"] += 1
        else:
            stats["ozgarmadi"] += 1
        row.synced_at = now

    for key, row in existing.items():
        if key not in seen and row.source == SOURCE and row.status == "active":
            row.status = "inactive"
            row.synced_at = now
            stats["chiqib_ketgan"] += 1

    logger.info("HEMIS kontingent: %s", stats)
    return stats
