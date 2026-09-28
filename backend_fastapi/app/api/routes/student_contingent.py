from __future__ import annotations

import datetime as dt
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.student_contingent import AcademicFaculty, StudentContingent
from app.services.pagination import paginate

router = APIRouter()

INSTITUTE_NAME = "Farg'ona jamoat salomatligi tibbiyot instituti"


def _student_name(row: StudentContingent) -> str:
    return " ".join(part for part in [row.last_name, row.first_name, row.middle_name] if part).strip()


def _student_dict(row: StudentContingent) -> dict:
    return {
        "id": row.id,
        "student_id": row.student_id,
        "hemis_id": row.hemis_id,
        "full_name": _student_name(row),
        "last_name": row.last_name,
        "first_name": row.first_name,
        "middle_name": row.middle_name,
        "faculty_name": row.faculty_name or (row.faculty.name if row.faculty else ""),
        "department_name": row.department_name,
        "direction_code": row.direction_code,
        "direction_name": row.direction_name,
        "course": row.course,
        "group_name": row.group_name,
        "status": row.status,
        "academic_year": row.academic_year,
        "source": row.source,
        "synced_at": row.synced_at.isoformat() if row.synced_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _student_filters(
    q: str = "",
    faculty: str = "",
    department: str = "",
    direction: str = "",
    course: int | None = None,
    group: str = "",
    status: str = "",
) -> list:
    filters = []
    if q:
        like = f"%{q.lower()}%"
        filters.append(
            or_(
                func.lower(StudentContingent.student_id).like(like),
                func.lower(StudentContingent.hemis_id).like(like),
                func.lower(StudentContingent.last_name).like(like),
                func.lower(StudentContingent.first_name).like(like),
                func.lower(StudentContingent.middle_name).like(like),
                func.lower(StudentContingent.group_name).like(like),
            )
        )
    if faculty:
        filters.append(StudentContingent.faculty_name == faculty)
    if department:
        filters.append(StudentContingent.department_name == department)
    if direction:
        filters.append(or_(StudentContingent.direction_name == direction, StudentContingent.direction_code == direction))
    if course:
        filters.append(StudentContingent.course == course)
    if group:
        filters.append(StudentContingent.group_name == group)
    if status:
        filters.append(StudentContingent.status == status)
    return filters


@router.get("/admin/students/")
def admin_students_list(
    request: Request,
    q: str = Query(default=""),
    faculty: str = Query(default=""),
    department: str = Query(default=""),
    direction: str = Query(default=""),
    course: int | None = Query(default=None, ge=1, le=6),
    group: str = Query(default=""),
    status: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    filters = _student_filters(q.strip(), faculty.strip(), department.strip(), direction.strip(), course, group.strip(), status.strip())
    query = select(StudentContingent)
    if filters:
        query = query.where(and_(*filters))
    rows = db.execute(
        query.order_by(
            StudentContingent.course.asc().nullslast(),
            StudentContingent.group_name.asc(),
            StudentContingent.last_name.asc(),
            StudentContingent.first_name.asc(),
        )
    ).scalars().all()
    return paginate([_student_dict(row) for row in rows], request, default_page_size=100, max_page_size=1000)


@router.get("/admin/students/facets/")
def admin_students_facets(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    def values(column):
        return [v for (v,) in db.execute(select(column).where(column != "").distinct().order_by(column)).all() if v]

    return {
        "faculties": values(StudentContingent.faculty_name),
        "departments": values(StudentContingent.department_name),
        "directions": values(StudentContingent.direction_name),
        "groups": values(StudentContingent.group_name),
        "statuses": values(StudentContingent.status) or ["active", "academic_leave", "transferred", "expelled", "graduated"],
        "courses": [1, 2, 3, 4, 5, 6],
    }


@router.get("/admin/students/structure/")
def admin_students_structure(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    faculties = db.execute(select(AcademicFaculty).where(AcademicFaculty.is_active.is_(True)).order_by(AcademicFaculty.sort_order, AcademicFaculty.name)).scalars().all()
    student_rows = db.execute(
        select(
            StudentContingent.faculty_name,
            StudentContingent.department_name,
            StudentContingent.direction_name,
            StudentContingent.course,
            StudentContingent.status,
            func.count(StudentContingent.id),
        ).group_by(
            StudentContingent.faculty_name,
            StudentContingent.department_name,
            StudentContingent.direction_name,
            StudentContingent.course,
            StudentContingent.status,
        )
    ).all()

    faculty_map: dict[str, dict] = {}
    for faculty in faculties:
        faculty_map[faculty.name] = {"id": faculty.id, "name": faculty.name, "code": faculty.code, "count": 0, "departments": {}}

    for faculty_name, department_name, direction_name, course, status, count in student_rows:
        fname = faculty_name or "Fakultet belgilanmagan"
        dname = department_name or "Kafedra belgilanmagan"
        dirname = direction_name or "Yo'nalish belgilanmagan"
        fnode = faculty_map.setdefault(fname, {"id": None, "name": fname, "code": "", "count": 0, "departments": {}})
        dnode = fnode["departments"].setdefault(dname, {"name": dname, "count": 0, "directions": {}})
        rnode = dnode["directions"].setdefault(dirname, {"name": dirname, "count": 0, "courses": {}})
        ckey = str(course or "Kurs belgilanmagan")
        cnode = rnode["courses"].setdefault(ckey, {"course": course, "count": 0, "statuses": {}})
        for node in (fnode, dnode, rnode, cnode):
            node["count"] += count
        cnode["statuses"][status or "unknown"] = cnode["statuses"].get(status or "unknown", 0) + count

    syllabus_departments = db.execute(
        select(AcademicDepartment.name, CourseSyllabus.direction_code, func.count(CourseSyllabus.id))
        .join(CourseSyllabus, CourseSyllabus.department_id == AcademicDepartment.id)
        .where(CourseSyllabus.is_active.is_(True), CourseSyllabus.created_by == "")
        .group_by(AcademicDepartment.name, CourseSyllabus.direction_code)
        .order_by(AcademicDepartment.name, CourseSyllabus.direction_code)
    ).all()
    academic_catalog: dict[str, set[str]] = defaultdict(set)
    for dept_name, direction_code, _count in syllabus_departments:
        academic_catalog[dept_name].add(direction_code or "Yo'nalish belgilanmagan")

    def convert_faculty(node: dict) -> dict:
        departments = []
        for dnode in sorted(node["departments"].values(), key=lambda item: item["name"]):
            directions = []
            for rnode in sorted(dnode["directions"].values(), key=lambda item: item["name"]):
                courses = sorted(rnode["courses"].values(), key=lambda item: item["course"] or 99)
                directions.append({**rnode, "courses": courses})
            departments.append({**dnode, "directions": directions})
        return {**node, "departments": departments}

    return {
        "institute": {"name": INSTITUTE_NAME, "expected_faculties": 4, "expected_departments": 29},
        "total_students": db.scalar(select(func.count(StudentContingent.id))) or 0,
        "active_students": db.scalar(select(func.count(StudentContingent.id)).where(StudentContingent.status == "active")) or 0,
        "faculties": [convert_faculty(node) for node in sorted(faculty_map.values(), key=lambda item: item["name"])],
        "academic_catalog": [
            {"department_name": dept, "directions": sorted(directions)}
            for dept, directions in sorted(academic_catalog.items())
        ],
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
