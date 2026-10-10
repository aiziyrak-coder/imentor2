"""Klinik bo'lmagan fanga bemor ssenariysi bilan yozilgan material (2026-09-25).

Domen qoidasi tuzatilgunga qadar iMentor noma'lum fanni "klinik" deb olardi:
fiziologiyaning "Hujayra membranasi" mavzusiga "45 yoshli bemor, qon bosimi
150/95", gigiyenaga "68 yoshli diabetli erkak" chiqardi. Auditda klinik
bo'lmagan kafedralarda 600 ta shunday keys va test topildi.

Ular O'CHIRILMAYDI. `retired_reason` qo'yiladi va:
  * ochiq katalogdan chiqadi (boshqa o'qituvchi qayta ishlatmasin);
  * mavzu ochilganda "oxirgi saqlangan" sifatida avtomatik yuklanmaydi —
    o'qituvchi yangisini yaratadi, u endi to'g'ri domenda yoziladi;
  * o'qituvchining o'z tarixida belgi bilan qoladi.

Qaytarish: `retire(..., undo=True)` — belgi olib tashlanadi.
"""

from __future__ import annotations

import datetime as dt
import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.prepared_content import PreparedContent

REASON = "nonclinical_patient_case"

# "45 yoshli erkak", "bemor 68 yoshda", "12 yoshli bola" — individual bemor.
VIGNETTE = re.compile(
    r"\d{1,3}\s*yosh(li|da|ida)?\b.{0,120}?(bemor|ayol|erkak|bola)"
    r"|(bemor|ayol|erkak)\b.{0,60}?\d{1,3}\s*yosh",
    re.I | re.S,
)
# Faqat klinik vignette'da uchraydigan aniq belgilar.
CLINICAL_MARKERS = re.compile(r"hba1c|metformin|insulin\b|qandli diabet|appenditsit|pnevmoni", re.I)

# Nomining O'ZI klinik bo'lgan fan — kafedra rasmiy klinik ro'yxatda
# bo'lmasa ham bemor ssenariysi O'RINLI. "Xalq tabobati va farmakologiya"
# kafedrasida shunday bitta fan bor: "Klinik farmakologiya" (2026-10-05).
# Frontenddagi `subjectDomain.ts` dagi CLINICAL_SUBJECT_RE bilan bir xil.
CLINICAL_SUBJECT = re.compile(r"(^|\s)klinik|(^|\s)klinika(\s|$)", re.I)


def has_patient_case(payload: dict | None) -> bool:
    text = json.dumps(payload or {}, ensure_ascii=False)
    return bool(VIGNETTE.search(text) or CLINICAL_MARKERS.search(text))


def find_mismatched(db: Session) -> list[tuple[PreparedContent, str]]:
    """Klinik bo'lmagan kafedra fanidagi, bemor ssenariysi bor keys/test.

    Kafedra `is_clinical` bayrog'i institut hujjatidan olinadi
    (`clinical_departments`). Fani bog'lanmagan yozuvlarga tegilmaydi —
    ularning domenini aniq bilib bo'lmaydi.

    Nomi klinik bo'lgan fan ("Klinik farmakologiya") klinik bo'lmagan
    kafedrada tursa ham TEGILMAYDI: u bemor yonidagi dori tanlashga
    o'rgatadi va bemor ssenariysi uning asosiy quroli.
    """
    rows = db.execute(
        select(PreparedContent, AcademicDepartment.name, CourseSyllabus.subject_name)
        .join(CourseSyllabus, CourseSyllabus.id == PreparedContent.syllabus_id)
        .join(AcademicDepartment, AcademicDepartment.id == CourseSyllabus.department_id)
        .where(
            PreparedContent.kind.in_(("case", "test")),
            AcademicDepartment.is_clinical.is_(False),
            PreparedContent.retired_reason == "",
        )
    ).all()
    return [
        (item, dep)
        for item, dep, subject in rows
        if not CLINICAL_SUBJECT.search(subject or "") and has_patient_case(item.payload)
    ]


def retire(db: Session, *, dry_run: bool = True, undo: bool = False) -> dict:
    """Mos kelmagan materialni belgilaydi (yoki belgini olib tashlaydi)."""
    if undo:
        rows = list(db.execute(
            select(PreparedContent).where(PreparedContent.retired_reason == REASON)
        ).scalars())
        if not dry_run:
            for item in rows:
                item.retired_reason = ""
                item.retired_at = None
            db.commit()
        return {"qaytarildi": len(rows), "dry_run": dry_run}

    found = find_mismatched(db)
    by_kind: dict[str, int] = {}
    by_department: dict[str, int] = {}
    now = dt.datetime.now(dt.timezone.utc)
    for item, dep in found:
        by_kind[item.kind] = by_kind.get(item.kind, 0) + 1
        by_department[dep] = by_department.get(dep, 0) + 1
        if not dry_run:
            item.retired_reason = REASON
            item.retired_at = now
    if not dry_run:
        db.commit()
    return {
        "belgilandi": len(found),
        "turi": by_kind,
        "kafedralar": dict(sorted(by_department.items(), key=lambda kv: -kv[1])),
        "dry_run": dry_run,
    }
