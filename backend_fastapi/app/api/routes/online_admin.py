"""Online ta'lim — administrator marshrutlari.

Hammasi `/api/v1/online/admin/...` ostida va faqat `admin` roliga ochiq.
Mavjud iMentor marshrutlariga tegilmaydi.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models.book import BookChunk
from app.models.content import AcademicDepartment
from app.models.staff_location import StaffProfile
from app.models.online_edu import (
    OnlineAttendance,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineLesson,
    OnlineMaterial,
    OnlineProgress,
    OnlineSyllabus,
    OnlineTeacher,
    OnlineTeacherCourse,
)
from app.models.user import User
from app.schemas.online_edu import (
    OnlineGroupCourseIn,
    OnlineGroupIn,
    OnlineGroupOut,
    OnlineSyllabusBrief,
    OnlineSyllabusOut,
    OnlineSyllabusUpsert,
    OnlineTeacherCourseIn,
    OnlineTeacherIn,
    OnlineTeacherOut,
)
from app.services import online_edu_service as svc

router = APIRouter()

AdminOnly = Depends(require_roles("admin"))


def _syllabus_or_404(db: Session, pk: int) -> OnlineSyllabus:
    obj = db.get(OnlineSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    return obj


# ============================ Sillabuslar ============================

@router.get("/online/admin/syllabuses/", response_model=list[OnlineSyllabusBrief])
def list_syllabuses(
    db: Session = Depends(get_db),
    _auth=AdminOnly,
    include_inactive: bool = Query(default=True),
) -> list[OnlineSyllabusBrief]:
    stmt = select(OnlineSyllabus).order_by(
        OnlineSyllabus.sort_order, OnlineSyllabus.subject_name
    )
    if not include_inactive:
        stmt = stmt.where(OnlineSyllabus.is_active.is_(True))
    rows = db.execute(stmt).scalars().all()
    return [
        OnlineSyllabusBrief(
            id=s.id,
            subject_name=s.subject_name,
            subject_code=s.subject_code,
            department_name=s.department_name,
            department_id=s.department_id,
            instruction_language=s.instruction_language,
            topic_count=len(svc.topics_for(s)),
            variant_labels=svc.variant_labels(s),
            is_active=s.is_active,
        )
        for s in rows
    ]


@router.get("/online/admin/syllabuses/{pk}/", response_model=OnlineSyllabusOut)
def get_syllabus(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> OnlineSyllabusOut:
    return OnlineSyllabusOut.model_validate(_syllabus_or_404(db, pk))


@router.post(
    "/online/admin/syllabuses/",
    response_model=OnlineSyllabusOut,
    status_code=status.HTTP_201_CREATED,
)
def create_syllabus(
    payload: OnlineSyllabusUpsert, db: Session = Depends(get_db), _auth=AdminOnly
) -> OnlineSyllabusOut:
    name = payload.subject_name.strip()
    code = svc.unique_subject_code(
        db, payload.subject_code.strip() or svc.slugify_subject(name)
    )

    variants = [v.model_dump() for v in payload.variants]
    topics = payload.topics
    file_name = payload.file_name.strip()
    # Variantli sillabusda umumiy `topics` bo'sh keladi — birinchi variantni
    # ko'rsatish uchun asos qilib olamiz (mavjud iMentor'dagi kabi).
    if variants and not topics:
        topics = variants[0].get("topics") or []
    if variants and not file_name:
        file_name = str(variants[0].get("file_name") or "")
    if not topics:
        raise HTTPException(status_code=400, detail="Sillabusda mavzu yo'q.")

    lang = payload.instruction_language.strip().lower()
    if lang not in ("uz", "ru", "en"):
        lang = "uz"

    now = svc.now()
    obj = OnlineSyllabus(
        subject_name=name,
        subject_code=code,
        department_name=payload.department_name.strip()[:255],
        department_id=payload.department_id,
        description=payload.description.strip()[:512],
        instruction_language=lang,
        file_name=file_name or f"{name}.pdf",
        topics=topics,
        variants=variants,
        name_i18n={},
        topics_i18n={},
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return OnlineSyllabusOut.model_validate(obj)


@router.patch("/online/admin/syllabuses/{pk}/", response_model=OnlineSyllabusOut)
def update_syllabus(
    pk: int, payload: OnlineSyllabusUpsert, db: Session = Depends(get_db), _auth=AdminOnly
) -> OnlineSyllabusOut:
    obj = _syllabus_or_404(db, pk)
    obj.subject_name = payload.subject_name.strip()
    obj.department_name = payload.department_name.strip()[:255]
    if payload.department_id is not None:
        obj.department_id = payload.department_id
    obj.description = payload.description.strip()[:512]
    obj.sort_order = payload.sort_order
    obj.is_active = payload.is_active
    if payload.topics:
        obj.topics = payload.topics
    if payload.variants:
        obj.variants = [v.model_dump() for v in payload.variants]
    obj.updated_at = svc.now()
    db.commit()
    db.refresh(obj)
    return OnlineSyllabusOut.model_validate(obj)


@router.delete(
    "/online/admin/syllabuses/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_syllabus(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> None:
    obj = _syllabus_or_404(db, pk)
    # Materiallar bor bo'lsa o'chirish TAQIQLANADI: CASCADE ularni ham
    # olib ketardi va o'qituvchining oylab yig'gan ishi bir bosishda yo'qolardi.
    used = db.execute(
        select(func.count(OnlineMaterial.id)).where(OnlineMaterial.syllabus_id == pk)
    ).scalar_one()
    if used:
        raise HTTPException(
            status_code=409,
            detail=f"Bu fanda {used} ta material bor. Avval ularni o'chiring yoki fanni nofaol qiling.",
        )
    db.delete(obj)
    db.commit()


# ============================ O'qituvchilar ============================

def _teacher_out(db: Session, t: OnlineTeacher) -> OnlineTeacherOut:
    rows = db.execute(
        select(OnlineTeacherCourse, OnlineSyllabus)
        .join(OnlineSyllabus, OnlineSyllabus.id == OnlineTeacherCourse.syllabus_id)
        .where(OnlineTeacherCourse.teacher_id == t.id)
    ).all()
    return OnlineTeacherOut(
        id=t.id,
        owner_key=t.owner_key,
        full_name=t.full_name,
        is_active=t.is_active,
        courses=[
            {
                "id": tc.id,
                "syllabus_id": s.id,
                "subject_name": s.subject_name,
                "variant_label": tc.variant_label,
            }
            for tc, s in rows
        ],
    )


@router.get("/online/admin/teachers/", response_model=list[OnlineTeacherOut])
def list_teachers(db: Session = Depends(get_db), _auth=AdminOnly) -> list[OnlineTeacherOut]:
    rows = db.execute(
        select(OnlineTeacher).order_by(OnlineTeacher.full_name, OnlineTeacher.owner_key)
    ).scalars().all()
    return [_teacher_out(db, t) for t in rows]


@router.post(
    "/online/admin/teachers/", response_model=OnlineTeacherOut, status_code=status.HTTP_201_CREATED
)
def add_teacher(
    payload: OnlineTeacherIn, db: Session = Depends(get_db), _auth=AdminOnly
) -> OnlineTeacherOut:
    key = payload.owner_key.strip()
    # O'qituvchi mavjud iMentor foydalanuvchisi bo'lishi SHART — bu yerda
    # yangi hisob ochilmaydi, faqat "bu odam online ham o'tadi" deb belgilanadi.
    user = db.execute(select(User).where(User.username == key)).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=404,
            detail="Bunday foydalanuvchi yo'q. O'qituvchi avval iMentor'da ro'yxatdan o'tgan bo'lishi kerak.",
        )

    existing = db.execute(
        select(OnlineTeacher).where(OnlineTeacher.owner_key == key)
    ).scalar_one_or_none()
    if existing is not None:
        existing.is_active = payload.is_active
        if payload.full_name.strip():
            existing.full_name = payload.full_name.strip()[:255]
        db.commit()
        db.refresh(existing)
        return _teacher_out(db, existing)

    name = payload.full_name.strip() or f"{user.first_name} {user.last_name}".strip()
    obj = OnlineTeacher(
        owner_key=key,
        full_name=name[:255],
        is_active=payload.is_active,
        created_at=svc.now(),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _teacher_out(db, obj)


@router.delete(
    "/online/admin/teachers/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def remove_teacher(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> None:
    obj = db.get(OnlineTeacher, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="O'qituvchi topilmadi.")
    db.delete(obj)
    db.commit()


@router.post("/online/admin/teacher-courses/", status_code=status.HTTP_201_CREATED)
def assign_teacher_course(
    payload: OnlineTeacherCourseIn, db: Session = Depends(get_db), _auth=AdminOnly
) -> dict:
    if db.get(OnlineTeacher, payload.teacher_id) is None:
        raise HTTPException(status_code=404, detail="O'qituvchi topilmadi.")
    _syllabus_or_404(db, payload.syllabus_id)
    label = payload.variant_label.strip()

    existing = db.execute(
        select(OnlineTeacherCourse).where(
            OnlineTeacherCourse.teacher_id == payload.teacher_id,
            OnlineTeacherCourse.syllabus_id == payload.syllabus_id,
            OnlineTeacherCourse.variant_label == label,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return {"id": existing.id, "created": False}

    obj = OnlineTeacherCourse(
        teacher_id=payload.teacher_id,
        syllabus_id=payload.syllabus_id,
        variant_label=label,
        created_at=svc.now(),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {"id": obj.id, "created": True}


@router.delete(
    "/online/admin/teacher-courses/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def unassign_teacher_course(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> None:
    obj = db.get(OnlineTeacherCourse, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Biriktiruv topilmadi.")
    db.delete(obj)
    db.commit()


# ============================ Guruhlar ============================

def _group_out(db: Session, g: OnlineGroup) -> OnlineGroupOut:
    rows = db.execute(
        select(OnlineGroupCourse, OnlineSyllabus)
        .join(OnlineSyllabus, OnlineSyllabus.id == OnlineGroupCourse.syllabus_id)
        .where(OnlineGroupCourse.group_id == g.id)
    ).all()
    return OnlineGroupOut(
        id=g.id,
        name=g.name,
        is_active=g.is_active,
        student_count=int(
            db.execute(
                select(func.count(func.distinct(OnlineProgress.student_id))).where(
                    OnlineProgress.group_name == g.name
                )
            ).scalar_one()
        ),
        courses=[
            {
                "id": gc.id,
                "syllabus_id": s.id,
                "subject_name": s.subject_name,
                "variant_label": gc.variant_label,
            }
            for gc, s in rows
        ],
    )


@router.get("/online/admin/groups/", response_model=list[OnlineGroupOut])
def list_groups(db: Session = Depends(get_db), _auth=AdminOnly) -> list[OnlineGroupOut]:
    rows = db.execute(select(OnlineGroup).order_by(OnlineGroup.name)).scalars().all()
    return [_group_out(db, g) for g in rows]


@router.post(
    "/online/admin/groups/", response_model=OnlineGroupOut, status_code=status.HTTP_201_CREATED
)
def add_group(
    payload: OnlineGroupIn, db: Session = Depends(get_db), _auth=AdminOnly
) -> OnlineGroupOut:
    name = payload.name.strip()
    existing = db.execute(select(OnlineGroup).where(OnlineGroup.name == name)).scalar_one_or_none()
    if existing is not None:
        existing.is_active = payload.is_active
        db.commit()
        db.refresh(existing)
        return _group_out(db, existing)
    obj = OnlineGroup(name=name, is_active=payload.is_active, created_at=svc.now())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _group_out(db, obj)


@router.patch("/online/admin/groups/{pk}/", response_model=OnlineGroupOut)
def set_group_active(
    pk: int, payload: OnlineGroupIn, db: Session = Depends(get_db), _auth=AdminOnly
) -> OnlineGroupOut:
    """Guruhni yoqadi yoki o'chiradi.

    Talaba portalga kirishga urinsa, guruhi o'zi nofaol holatda yoziladi —
    admin uni shu yerda bitta bosish bilan yoqadi. Nom qo'lda terilmaydi,
    demak xato ham bo'lmaydi.
    """
    obj = db.get(OnlineGroup, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")
    obj.is_active = payload.is_active
    db.commit()
    db.refresh(obj)
    return _group_out(db, obj)


@router.delete(
    "/online/admin/groups/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
def remove_group(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> None:
    obj = db.get(OnlineGroup, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")
    lessons = db.execute(
        select(func.count(OnlineLesson.id)).where(OnlineLesson.group_id == pk)
    ).scalar_one()
    if lessons:
        raise HTTPException(
            status_code=409,
            detail=f"Bu guruhda {lessons} ta dars yozuvi bor. Guruhni nofaol qiling.",
        )
    db.delete(obj)
    db.commit()


@router.post("/online/admin/group-courses/", status_code=status.HTTP_201_CREATED)
def assign_group_course(
    payload: OnlineGroupCourseIn, db: Session = Depends(get_db), _auth=AdminOnly
) -> dict:
    if db.get(OnlineGroup, payload.group_id) is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")
    _syllabus_or_404(db, payload.syllabus_id)
    label = payload.variant_label.strip()

    existing = db.execute(
        select(OnlineGroupCourse).where(
            OnlineGroupCourse.group_id == payload.group_id,
            OnlineGroupCourse.syllabus_id == payload.syllabus_id,
            OnlineGroupCourse.variant_label == label,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return {"id": existing.id, "created": False}

    obj = OnlineGroupCourse(
        group_id=payload.group_id,
        syllabus_id=payload.syllabus_id,
        variant_label=label,
        created_at=svc.now(),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {"id": obj.id, "created": True}


@router.delete(
    "/online/admin/group-courses/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def unassign_group_course(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> None:
    obj = db.get(OnlineGroupCourse, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Biriktiruv topilmadi.")
    db.delete(obj)
    db.commit()


# ============================ Umumiy ko'rinish ============================

@router.get("/online/admin/overview/")
def overview(db: Session = Depends(get_db), _auth=AdminOnly) -> dict:
    """Admin sahifasining yuqorisidagi raqamlar."""
    def count(model) -> int:
        return int(db.execute(select(func.count(model.id))).scalar_one())

    opened = int(
        db.execute(
            select(func.count(OnlineLesson.id)).where(OnlineLesson.is_opened.is_(True))
        ).scalar_one()
    )
    submitted = int(
        db.execute(
            select(func.count(OnlineProgress.id)).where(
                OnlineProgress.test_submitted_at.is_not(None)
            )
        ).scalar_one()
    )
    return {
        "syllabuses": count(OnlineSyllabus),
        "teachers": count(OnlineTeacher),
        "groups": count(OnlineGroup),
        "materials": count(OnlineMaterial),
        "lessons": count(OnlineLesson),
        "opened_topics": opened,
        "tests_submitted": submitted,
    }


@router.get("/online/admin/lessons/")
def admin_lessons(
    db: Session = Depends(get_db),
    _auth=AdminOnly,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    rows = db.execute(
        select(OnlineLesson, OnlineSyllabus, OnlineGroup)
        .join(OnlineSyllabus, OnlineSyllabus.id == OnlineLesson.syllabus_id)
        .join(OnlineGroup, OnlineGroup.id == OnlineLesson.group_id)
        .order_by(OnlineLesson.created_at.desc())
        .limit(limit)
    ).all()
    out = []
    for lesson, syl, grp in rows:
        present = int(
            db.execute(
                select(func.count(OnlineAttendance.id)).where(
                    OnlineAttendance.lesson_id == lesson.id
                )
            ).scalar_one()
        )
        out.append(
            {
                "id": lesson.id,
                "subject_name": syl.subject_name,
                "variant_label": lesson.variant_label,
                "topic_code": lesson.topic_code,
                "topic_title": svc.topic_title(syl, lesson.variant_label, lesson.topic_code),
                "group_name": grp.name,
                "teacher_owner_key": lesson.teacher_owner_key,
                "scheduled_at": lesson.scheduled_at,
                "started_at": lesson.started_at,
                "ended_at": lesson.ended_at,
                "is_opened": lesson.is_opened,
                "attendance_count": present,
            }
        )
    return out


@router.get("/online/admin/progress/")
def admin_progress(
    db: Session = Depends(get_db),
    _auth=AdminOnly,
    syllabus_id: int | None = Query(default=None),
    group_name: str = Query(default=""),
    limit: int = Query(default=300, ge=1, le=2000),
) -> list[dict]:
    """Talabalar natijalari — fan va guruh bo'yicha filtrlanadi."""
    stmt = select(OnlineProgress, OnlineSyllabus).join(
        OnlineSyllabus, OnlineSyllabus.id == OnlineProgress.syllabus_id
    )
    if syllabus_id:
        stmt = stmt.where(OnlineProgress.syllabus_id == syllabus_id)
    if group_name.strip():
        stmt = stmt.where(OnlineProgress.group_name == group_name.strip())
    rows = db.execute(
        stmt.order_by(OnlineProgress.updated_at.desc()).limit(limit)
    ).all()
    return [
        {
            "student_id": p.student_id,
            "student_name": p.student_name,
            "group_name": p.group_name,
            "subject_name": s.subject_name,
            "variant_label": p.variant_label,
            "topic_code": p.topic_code,
            "topic_title": svc.topic_title(s, p.variant_label, p.topic_code),
            "test_score": p.test_score,
            "test_total": p.test_total,
            "test_submitted_at": p.test_submitted_at,
            "updated_at": p.updated_at,
        }
        for p, s in rows
    ]


@router.get("/online/admin/attendance/{lesson_id}/")
def admin_attendance(
    lesson_id: int, db: Session = Depends(get_db), _auth=AdminOnly
) -> list[dict]:
    rows = db.execute(
        select(OnlineAttendance)
        .where(OnlineAttendance.lesson_id == lesson_id)
        .order_by(OnlineAttendance.joined_at)
    ).scalars().all()
    return [
        {
            "student_id": a.student_id,
            "student_name": a.student_name,
            "joined_at": a.joined_at,
            "left_at": a.left_at,
            "total_seconds": a.total_seconds,
            "source": a.source,
        }
        for a in rows
    ]

@router.get("/online/admin/report/")
def admin_report(
    db: Session = Depends(get_db),
    _auth=AdminOnly,
    syllabus_id: int | None = Query(default=None),
    group_name: str = Query(default=""),
) -> dict:
    """Guruh kesimida o'zlashtirish va davomat — kim orqada qolgani.

    Talabalar ro'yxati bizda saqlanmaydi (u OnlineTest'da), shuning uchun
    hisobot IZ qoldirganlar bo'yicha quriladi: kim material ochgan, test
    topshirgan yoki darsga kirgan bo'lsa — shu yerda ko'rinadi.
    """
    # 1. Qaysi darslar hisobga olinadi.
    lesson_stmt = select(OnlineLesson)
    if syllabus_id:
        lesson_stmt = lesson_stmt.where(OnlineLesson.syllabus_id == syllabus_id)
    if group_name.strip():
        grp = db.execute(
            select(OnlineGroup).where(OnlineGroup.name == group_name.strip())
        ).scalar_one_or_none()
        if grp is None:
            return {"rows": [], "lessons_total": 0, "topics_opened": 0}
        lesson_stmt = lesson_stmt.where(OnlineLesson.group_id == grp.id)
    lessons = db.execute(lesson_stmt).scalars().all()
    lesson_ids = [x.id for x in lessons]
    held = [x for x in lessons if x.started_at is not None]
    opened_topics = len({(x.syllabus_id, x.variant_label, x.topic_code) for x in lessons if x.is_opened})

    # 2. O'zlashtirish.
    prog_stmt = select(OnlineProgress)
    if syllabus_id:
        prog_stmt = prog_stmt.where(OnlineProgress.syllabus_id == syllabus_id)
    if group_name.strip():
        prog_stmt = prog_stmt.where(OnlineProgress.group_name == group_name.strip())
    progress = db.execute(prog_stmt).scalars().all()

    # 3. Davomat.
    attendance = []
    if lesson_ids:
        attendance = db.execute(
            select(OnlineAttendance).where(OnlineAttendance.lesson_id.in_(lesson_ids))
        ).scalars().all()

    rows: dict[str, dict] = {}

    def slot(sid: str, name: str, group: str) -> dict:
        item = rows.setdefault(
            sid,
            {
                "student_id": sid,
                "student_name": name or sid,
                "group_name": group,
                "topics_touched": 0,
                "tests_taken": 0,
                "score_sum": 0,
                "score_max": 0,
                "lessons_attended": 0,
                "minutes_total": 0,
            },
        )
        if name and not item["student_name"].strip():
            item["student_name"] = name
        if group and not item["group_name"].strip():
            item["group_name"] = group
        return item

    for p in progress:
        item = slot(p.student_id, p.student_name, p.group_name)
        item["topics_touched"] += 1
        if p.test_submitted_at is not None:
            item["tests_taken"] += 1
            item["score_sum"] += p.test_score
            item["score_max"] += p.test_total

    for a in attendance:
        item = slot(a.student_id, a.student_name, "")
        item["lessons_attended"] += 1
        item["minutes_total"] += round(a.total_seconds / 60)

    held_count = len(held)
    out = []
    for item in rows.values():
        item["avg_pct"] = (
            round(100.0 * item["score_sum"] / item["score_max"]) if item["score_max"] else None
        )
        item["attendance_pct"] = (
            round(100.0 * item["lessons_attended"] / held_count) if held_count else None
        )
        out.append(item)
    out.sort(key=lambda r: (-(r["avg_pct"] or -1), r["student_name"]))

    return {
        "rows": out,
        "lessons_total": held_count,
        "topics_opened": opened_topics,
    }

# ============================ Tanlagichlar ============================

@router.get("/online/admin/departments/")
def pick_departments(db: Session = Depends(get_db), _auth=AdminOnly) -> list[dict]:
    """Kafedralar va ularda nechta darslik parchasi borligi.

    Fan qaysi kafedraga tegishli ekani AI uchun muhim: ma'ruza va test
    o'sha kafedra darsliklaridan yoziladi. Shuning uchun ro'yxatda parcha
    soni ham ko'rsatiladi — kafedra bo'sh bo'lsa, buni oldindan bilib
    olish kerak.
    """
    counts = dict(
        db.execute(
            select(BookChunk.department_id, func.count(BookChunk.id)).group_by(
                BookChunk.department_id
            )
        ).all()
    )
    rows = db.execute(
        select(AcademicDepartment)
        .where(AcademicDepartment.is_active.is_(True))
        .order_by(AcademicDepartment.sort_order, AcademicDepartment.name)
    ).scalars().all()
    return [
        {
            "id": d.id,
            "name": d.name,
            "code": d.code,
            "book_chunks": int(counts.get(d.id, 0)),
        }
        for d in rows
    ]


@router.get("/online/admin/staff/")
def pick_staff(
    db: Session = Depends(get_db),
    _auth=AdminOnly,
    q: str = Query(default="", max_length=120),
) -> list[dict]:
    """O'qituvchi tanlash uchun mavjud iMentor xodimlari.

    Ilgari admin telefon raqamini yoddan yozardi. Endi ism bo'yicha
    qidiriladi va ro'yxatdan tanlanadi.
    """
    from app.models.user import Group as UserGroup, user_groups

    stmt = (
        select(User)
        .join(user_groups, user_groups.c.user_id == User.id)
        .join(UserGroup, UserGroup.id == user_groups.c.group_id)
        .where(UserGroup.name.in_(("admin", "klinika_admin", "hodim")))
        .distinct()
    )
    term = q.strip().lower()
    if term:
        like = f"%{term}%"
        stmt = stmt.where(
            func.lower(User.first_name).like(like)
            | func.lower(User.last_name).like(like)
            | User.username.like(like)
        )
    users = db.execute(stmt.order_by(User.first_name, User.last_name).limit(60)).scalars().all()

    already = {
        t.owner_key
        for t in db.execute(select(OnlineTeacher)).scalars().all()
    }
    profiles = {
        pr.owner_key: pr
        for pr in db.execute(
            select(StaffProfile).where(
                StaffProfile.owner_key.in_([u.username for u in users] or [""])
            )
        ).scalars().all()
    }
    out = []
    for u in users:
        pr = profiles.get(u.username)
        out.append(
            {
                "owner_key": u.username,
                "full_name": f"{u.first_name} {u.last_name}".strip() or u.username,
                "department": (pr.department if pr else "") or "",
                "is_online_teacher": u.username in already,
            }
        )
    return out


@router.get("/online/admin/subject/{pk}/")
def subject_detail(pk: int, db: Session = Depends(get_db), _auth=AdminOnly) -> dict:
    """Bitta fanning TO'LIQ holati — bir ekranda.

    Admin panelning asosiy ko'rinishi shu: fan tanlanadi va uning
    o'qituvchisi, guruhlari, mavzulari va darslari birga ko'rinadi.
    Ilgari bularning har biri alohida bo'limda edi va nima nimaga
    bog'langanini ko'rish uchun bir necha joyni aylanib chiqish kerakdi.
    """
    syllabus = _syllabus_or_404(db, pk)

    teachers = [
        {
            "link_id": tc.id,
            "teacher_id": t.id,
            "owner_key": t.owner_key,
            "full_name": t.full_name,
            "variant_label": tc.variant_label,
        }
        for tc, t in db.execute(
            select(OnlineTeacherCourse, OnlineTeacher)
            .join(OnlineTeacher, OnlineTeacher.id == OnlineTeacherCourse.teacher_id)
            .where(OnlineTeacherCourse.syllabus_id == pk)
        ).all()
    ]

    groups = [
        {
            "link_id": gc.id,
            "group_id": g.id,
            "name": g.name,
            "is_active": g.is_active,
            "variant_label": gc.variant_label,
        }
        for gc, g in db.execute(
            select(OnlineGroupCourse, OnlineGroup)
            .join(OnlineGroup, OnlineGroup.id == OnlineGroupCourse.group_id)
            .where(OnlineGroupCourse.syllabus_id == pk)
            .order_by(OnlineGroup.name)
        ).all()
    ]

    mats = db.execute(
        select(OnlineMaterial.variant_label, OnlineMaterial.topic_code, OnlineMaterial.kind).where(
            OnlineMaterial.syllabus_id == pk
        )
    ).all()
    have: dict[tuple[str, str], set[str]] = {}
    for variant, code, kind in mats:
        have.setdefault((str(variant or ""), str(code)), set()).add(str(kind))

    lessons = db.execute(
        select(OnlineLesson, OnlineGroup)
        .join(OnlineGroup, OnlineGroup.id == OnlineLesson.group_id)
        .where(OnlineLesson.syllabus_id == pk)
        .order_by(OnlineLesson.created_at.desc())
        .limit(50)
    ).all()

    labels = svc.variant_labels(syllabus) or [""]
    variants = []
    for label in labels:
        topics = svc.topics_for(syllabus, label)
        ready = 0
        rows = []
        for t in topics:
            code = str(t.get("code") or "")
            kinds = have.get((label, code), set())
            if len(kinds) == 6:
                ready += 1
            rows.append(
                {
                    "code": code,
                    "title": str(t.get("title") or ""),
                    "ready": len(kinds),
                    "opened_for": [
                        grp.name
                        for lesson, grp in lessons
                        if lesson.is_opened
                        and lesson.topic_code == code
                        and lesson.variant_label == label
                    ],
                }
            )
        variants.append(
            {"label": label, "topic_count": len(topics), "ready_count": ready, "topics": rows}
        )

    return {
        "id": syllabus.id,
        "subject_name": syllabus.subject_name,
        "subject_code": syllabus.subject_code,
        "department_name": syllabus.department_name,
        "department_id": syllabus.department_id,
        "instruction_language": syllabus.instruction_language,
        "is_active": syllabus.is_active,
        "variant_labels": labels,
        "teachers": teachers,
        "groups": groups,
        "variants": variants,
        "lessons": [
            {
                "id": lesson.id,
                "topic_code": lesson.topic_code,
                "variant_label": lesson.variant_label,
                "group_name": grp.name,
                "started_at": lesson.started_at,
                "ended_at": lesson.ended_at,
                "is_opened": lesson.is_opened,
            }
            for lesson, grp in lessons
        ],
    }
