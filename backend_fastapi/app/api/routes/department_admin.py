"""Admin: Kafedralar bo'limi — kafedra va uning fanlari, rektor hisobotidan chiqarish.

Kafedra chiqarilsa uning barcha o'qituvchilari, fan chiqarilsa shu fan
bo'yicha statistika rektor hisobotiga tushmaydi (`report_exclusion`).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.staff_location import StaffProfile
from app.services import control_report_service

router = APIRouter()


class ReportExcludedPatch(BaseModel):
    report_excluded: bool


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


@router.get("/admin/departments/")
def admin_departments(
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin")),
) -> dict:
    departments = db.execute(
        select(AcademicDepartment).order_by(AcademicDepartment.sort_order, AcademicDepartment.name)
    ).scalars().all()
    subjects: dict[int | None, list[dict]] = defaultdict(list)
    for s in db.execute(
        select(CourseSyllabus).order_by(CourseSyllabus.sort_order, CourseSyllabus.subject_name)
    ).scalars():
        subjects[s.department_id].append({
            "id": s.id,
            "subject_name": s.subject_name,
            "subject_code": s.subject_code,
            "is_active": s.is_active,
            "report_excluded": s.report_excluded,
        })
    teachers = dict(db.execute(
        select(StaffProfile.department_id, func.count())
        .where(StaffProfile.department_id.is_not(None))
        .group_by(StaffProfile.department_id)
    ).all())
    return {
        "results": [
            {
                "id": d.id,
                "name": d.name,
                "code": d.code,
                "hemis_name": d.hemis_name,
                "is_active": d.is_active,
                "report_excluded": d.report_excluded,
                "teacher_count": int(teachers.get(d.id, 0)),
                "subjects": subjects.get(d.id, []),
            }
            for d in departments
        ],
        "unassigned_subjects": subjects.get(None, []),
    }


@router.patch("/admin/departments/{pk}/")
def admin_department_patch(
    pk: int,
    body: ReportExcludedPatch,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin")),
) -> dict:
    obj = db.get(AcademicDepartment, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Kafedra topilmadi.")
    obj.report_excluded = body.report_excluded
    obj.updated_at = _now()
    db.commit()
    control_report_service.clear_cache()
    return {"id": obj.id, "report_excluded": obj.report_excluded}


@router.patch("/admin/departments/subjects/{pk}/")
def admin_department_subject_patch(
    pk: int,
    body: ReportExcludedPatch,
    db: Session = Depends(get_db),
    _=Depends(require_roles("admin")),
) -> dict:
    obj = db.get(CourseSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    obj.report_excluded = body.report_excluded
    obj.updated_at = _now()
    db.commit()
    control_report_service.clear_cache()
    return {"id": obj.id, "report_excluded": obj.report_excluded}
