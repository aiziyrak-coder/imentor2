"""Rektor hisobotidan chiqarilgan kafedra va fanlar.

Admin "Kafedralar" bo'limida kafedrani yoki uning ichidagi bitta fanni
hisobotdan chiqara oladi (2026-10-10):

* kafedra chiqarilsa — uning BARCHA o'qituvchilari, darslari va fanlari
  rektor hisobotiga tushmaydi;
* fan chiqarilsa — shu fan bo'yicha darslar va testlar hech bir
  o'qituvchining statistikasiga qo'shilmaydi.

Kafedra nomi HEMIS'da boshqacha yozilgan bo'lishi mumkin, shuning uchun
solishtirish `dean_access.match_departments` orqali (dekan cheklovi bilan
bir xil qoida). Fan nomi esa harf/apostrof farqisiz solishtiriladi.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment, CourseSyllabus


def norm_subject(name: str | None) -> str:
    text = (name or "").casefold()
    for ch in "‘’ʻʼ`'′":
        text = text.replace(ch, "")
    return " ".join(re.sub(r"[^\w]+", " ", text).split())


@dataclass
class Exclusions:
    departments: list[str] = field(default_factory=list)
    subject_names: set[str] = field(default_factory=set)
    subject_codes: set[str] = field(default_factory=set)
    _dept_cache: dict[str, bool] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.departments or self.subject_names or self.subject_codes)

    def department_excluded(self, name: str | None) -> bool:
        if not self.departments or not (name or "").strip():
            return False
        hit = self._dept_cache.get(name)
        if hit is None:
            from app.services.dean_access import match_departments

            hit = bool(match_departments(self.departments, [name]))
            self._dept_cache[name] = hit
        return hit

    def subject_excluded(self, name: str | None = None, code: str | None = None) -> bool:
        if code and code in self.subject_codes:
            return True
        return bool(name) and norm_subject(name) in self.subject_names

    def lesson_excluded(self, lesson) -> bool:
        return self.department_excluded(getattr(lesson, "department_name", "")) or self.subject_excluded(
            getattr(lesson, "subject_name", "")
        )


def load(db: Session) -> Exclusions:
    """Chiqarilganlar ro'yxati. Chiqarilgan kafedraning fanlari ham shu yerga qo'shiladi."""
    ex = Exclusions()
    dept_rows = db.execute(
        select(AcademicDepartment.id, AcademicDepartment.name, AcademicDepartment.hemis_name)
        .where(AcademicDepartment.report_excluded.is_(True))
    ).all()
    dept_ids: set[int] = set()
    for r in dept_rows:
        dept_ids.add(r.id)
        for name in (r.name, r.hemis_name):
            if (name or "").strip() and name not in ex.departments:
                ex.departments.append(name)
    subj_rows = db.execute(
        select(CourseSyllabus.subject_name, CourseSyllabus.subject_code, CourseSyllabus.department_id)
        .where(
            (CourseSyllabus.report_excluded.is_(True))
            | (CourseSyllabus.department_id.in_(dept_ids or {-1}))
        )
    ).all()
    for r in subj_rows:
        if r.subject_code:
            ex.subject_codes.add(r.subject_code)
        if r.subject_name:
            ex.subject_names.add(norm_subject(r.subject_name))
    return ex
