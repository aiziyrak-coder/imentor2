"""Online ta'lim — video dars, davomat va mavzu qulfi.

Mavzu talabaga FAQAT o'qituvchi darsni o'tkazib "ochish" tugmasini bosgach
ochiladi. Ya'ni `OnlineLesson.is_opened` — butun modulning qulfi.

Davomat Jitsi IFrame API hodisalaridan yig'iladi: talabaning brauzeri
xonaga kirganda va chiqqanda backendga xabar beradi. Vaqtni SERVER qo'yadi —
brauzerdan kelgan vaqtga ishonilmaydi, aks holda davomatni istalgancha
uzaytirib yozdirish mumkin bo'lardi.
"""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth, require_roles
from app.core.db import get_db
from app.models.online_edu import (
    OnlineAttendance,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineLesson,
    OnlineSyllabus,
    OnlineTeacher,
)
from app.schemas.online_edu import (
    OnlineAttendanceEvent,
    OnlineAttendanceManualIn,
    OnlineLessonIn,
)
from app.services import online_edu_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()


def _me(db: Session, auth: AuthContext) -> OnlineTeacher:
    teacher = svc.teacher_for(db, auth.user.username)
    if teacher is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Siz online ta'lim o'qituvchisi emassiz.",
        )
    return teacher


def _own_lesson(db: Session, teacher: OnlineTeacher, lesson_id: int) -> OnlineLesson:
    lesson = db.get(OnlineLesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Dars topilmadi.")
    if lesson.teacher_owner_key != teacher.owner_key:
        raise HTTPException(status_code=403, detail="Bu dars sizniki emas.")
    return lesson


def _lesson_out(db: Session, lesson: OnlineLesson) -> dict:
    syl = db.get(OnlineSyllabus, lesson.syllabus_id)
    grp = db.get(OnlineGroup, lesson.group_id)
    present = db.execute(
        select(OnlineAttendance).where(OnlineAttendance.lesson_id == lesson.id)
    ).scalars().all()
    return {
        "id": lesson.id,
        "syllabus_id": lesson.syllabus_id,
        "subject_name": syl.subject_name if syl else "",
        "variant_label": lesson.variant_label,
        "topic_code": lesson.topic_code,
        "topic_title": svc.topic_title(syl, lesson.variant_label, lesson.topic_code) if syl else "",
        "group_id": lesson.group_id,
        "group_name": grp.name if grp else "",
        "title": lesson.title,
        "room_name": lesson.room_name,
        "scheduled_at": lesson.scheduled_at,
        "started_at": lesson.started_at,
        "ended_at": lesson.ended_at,
        "is_opened": lesson.is_opened,
        "opened_at": lesson.opened_at,
        "attendance_count": len(present),
    }


# ============================ O'qituvchi ============================

@router.post(
    "/online/teacher/lessons/", status_code=status.HTTP_201_CREATED
)
def create_lesson(
    payload: OnlineLessonIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Mavzu bo'yicha video dars yaratadi va Jitsi xonasini ajratadi."""
    teacher = _me(db, auth)
    syllabus = db.get(OnlineSyllabus, payload.syllabus_id)
    if syllabus is None:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    if not svc.teacher_teaches(db, teacher, payload.syllabus_id, payload.variant_label):
        raise HTTPException(status_code=403, detail="Bu fan sizga biriktirilmagan.")

    group = db.get(OnlineGroup, payload.group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")

    # Guruh shu fanni o'qiydimi — aks holda dars o'tkazib, mavzuni butunlay
    # begona guruhga ochib qo'yish mumkin bo'lardi.
    linked = db.execute(
        select(OnlineGroupCourse).where(
            OnlineGroupCourse.group_id == group.id,
            OnlineGroupCourse.syllabus_id == payload.syllabus_id,
        )
    ).scalars().all()
    if not linked:
        raise HTTPException(
            status_code=400, detail=f"'{group.name}' guruhiga bu fan biriktirilmagan."
        )

    if svc.topic_by_code(syllabus, payload.variant_label, payload.topic_code) is None:
        raise HTTPException(status_code=400, detail="Bunday mavzu yo'q.")

    title = payload.title.strip() or svc.topic_title(
        syllabus, payload.variant_label, payload.topic_code
    )
    lesson = OnlineLesson(
        syllabus_id=payload.syllabus_id,
        variant_label=payload.variant_label or "",
        topic_code=payload.topic_code.strip(),
        group_id=group.id,
        teacher_owner_key=teacher.owner_key,
        title=title[:512],
        room_name=svc.new_room_name(),
        scheduled_at=payload.scheduled_at,
        created_at=svc.now(),
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return _lesson_out(db, lesson)


@router.get("/online/teacher/lessons/")
def my_lessons(
    syllabus_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    teacher = _me(db, auth)
    stmt = select(OnlineLesson).where(OnlineLesson.teacher_owner_key == teacher.owner_key)
    if syllabus_id:
        stmt = stmt.where(OnlineLesson.syllabus_id == syllabus_id)
    rows = db.execute(stmt.order_by(OnlineLesson.created_at.desc()).limit(200)).scalars().all()
    return [_lesson_out(db, r) for r in rows]


@router.post("/online/teacher/lessons/{lesson_id}/start/")
def start_lesson(
    lesson_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Darsni boshlaydi — shundan keyingina talabalar xonaga kira oladi."""
    teacher = _me(db, auth)
    lesson = _own_lesson(db, teacher, lesson_id)
    if lesson.ended_at is not None:
        raise HTTPException(status_code=409, detail="Bu dars allaqachon tugagan.")
    if lesson.started_at is None:
        lesson.started_at = svc.now()
        db.commit()
        db.refresh(lesson)
    return _lesson_out(db, lesson)


@router.post("/online/teacher/lessons/{lesson_id}/end/")
def end_lesson(
    lesson_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Darsni tugatadi va ochiq qolgan davomat yozuvlarini yopadi."""
    teacher = _me(db, auth)
    lesson = _own_lesson(db, teacher, lesson_id)
    if lesson.started_at is None:
        raise HTTPException(status_code=409, detail="Dars hali boshlanmagan.")
    if lesson.ended_at is not None:
        return _lesson_out(db, lesson)

    now = svc.now()
    lesson.ended_at = now
    # Talaba brauzerni yopib qo'ysa `leave` kelmaydi — yozuv ochiq qolardi
    # va davomat vaqti hisoblanmasdi. Dars tugaganda hammasini yopamiz.
    open_rows = db.execute(
        select(OnlineAttendance).where(
            OnlineAttendance.lesson_id == lesson.id,
            OnlineAttendance.left_at.is_(None),
        )
    ).scalars().all()
    for row in open_rows:
        row.left_at = now
        row.total_seconds += max(0, int((now - row.joined_at).total_seconds()))
    db.commit()
    db.refresh(lesson)
    return _lesson_out(db, lesson)


@router.post("/online/teacher/lessons/{lesson_id}/open/")
def open_topic(
    lesson_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Mavzuni guruh talabalariga ochadi.

    Butun modulning kaliti shu yerda: shu bosilmaguncha talaba mavzu
    materiallarini ko'ra olmaydi.
    """
    teacher = _me(db, auth)
    lesson = _own_lesson(db, teacher, lesson_id)
    if lesson.started_at is None:
        raise HTTPException(
            status_code=409,
            detail="Mavzu dars o'tilgandan keyin ochiladi. Avval darsni boshlang.",
        )
    if not lesson.is_opened:
        lesson.is_opened = True
        lesson.opened_at = svc.now()
        db.commit()
        db.refresh(lesson)
    return _lesson_out(db, lesson)


@router.post("/online/teacher/lessons/{lesson_id}/close/")
def close_topic(
    lesson_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Xato ochilgan mavzuni qaytarib yopadi."""
    teacher = _me(db, auth)
    lesson = _own_lesson(db, teacher, lesson_id)
    lesson.is_opened = False
    lesson.opened_at = None
    db.commit()
    db.refresh(lesson)
    return _lesson_out(db, lesson)


@router.get("/online/teacher/lessons/{lesson_id}/attendance/")
def lesson_attendance(
    lesson_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    teacher = _me(db, auth)
    _own_lesson(db, teacher, lesson_id)
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


@router.post("/online/teacher/lessons/{lesson_id}/attendance/")
def mark_attendance(
    lesson_id: int,
    payload: OnlineAttendanceManualIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """O'qituvchi qo'lda belgilaydi — masalan talabaning interneti uzilgan."""
    teacher = _me(db, auth)
    lesson = _own_lesson(db, teacher, lesson_id)
    sid = payload.student_id.strip()

    row = db.execute(
        select(OnlineAttendance).where(
            OnlineAttendance.lesson_id == lesson.id,
            OnlineAttendance.student_id == sid,
        )
    ).scalar_one_or_none()

    if not payload.present:
        if row is not None:
            db.delete(row)
            db.commit()
        return {"student_id": sid, "present": False}

    if row is None:
        now = svc.now()
        row = OnlineAttendance(
            lesson_id=lesson.id,
            student_id=sid,
            student_name=payload.student_name.strip()[:255],
            joined_at=lesson.started_at or now,
            left_at=lesson.ended_at,
            total_seconds=0,
            source="manual",
        )
        db.add(row)
    else:
        row.source = "manual"
        if payload.student_name.strip():
            row.student_name = payload.student_name.strip()[:255]
    db.commit()
    return {"student_id": sid, "present": True}


# ============================ Talaba ============================

@router.post("/online/student/attendance/")
def student_attendance_event(
    payload: OnlineAttendanceEvent,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
) -> dict:
    """Talaba xonaga kirdi yoki chiqdi — Jitsi hodisasidan.

    Vaqtni SERVER qo'yadi. Brauzerdan kelgan vaqtga ishonsak, talaba
    "men uch soat o'tirdim" deb yozdirib qo'yishi mumkin bo'lardi.
    """
    room = payload.room_name.strip()
    lesson = db.execute(
        select(OnlineLesson).where(OnlineLesson.room_name == room)
    ).scalar_one_or_none()
    if lesson is None:
        raise HTTPException(status_code=404, detail="Dars topilmadi.")
    if lesson.started_at is None:
        raise HTTPException(status_code=409, detail="Dars hali boshlanmagan.")
    if lesson.ended_at is not None:
        # Tugagan darsga davomat yozilmaydi.
        return {"recorded": False, "reason": "lesson_ended"}

    sid = (auth.student_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Talaba ID aniqlanmadi.")
    name = f"{auth.user.first_name} {auth.user.last_name}".strip()

    now = svc.now()
    row = db.execute(
        select(OnlineAttendance).where(
            OnlineAttendance.lesson_id == lesson.id,
            OnlineAttendance.student_id == sid,
        )
    ).scalar_one_or_none()

    if payload.event == "join":
        if row is None:
            row = OnlineAttendance(
                lesson_id=lesson.id,
                student_id=sid,
                student_name=name[:255],
                joined_at=now,
                total_seconds=0,
                source="jitsi",
            )
            db.add(row)
        else:
            # Qayta ulanish: yangi oraliq boshlandi.
            row.left_at = None
            row.joined_at = now
        db.commit()
        return {"recorded": True, "event": "join"}

    if row is None:
        return {"recorded": False, "reason": "no_join"}
    if row.left_at is None:
        row.left_at = now
        row.total_seconds += max(0, int((now - row.joined_at).total_seconds()))
        db.commit()
    return {"recorded": True, "event": "leave", "total_seconds": row.total_seconds}


@router.get("/online/config/")
def online_config() -> dict:
    """Portal uchun sozlamalar — Jitsi domeni frontendga shu yerdan beriladi.

    Env orqali beriladi, chunki o'z serverimizdagi Jitsi tayyor bo'lgunga
    qadar ochiq `meet.jit.si` ishlatiladi va almashtirish uchun frontendni
    qayta qurish shart bo'lmasin.
    """
    import os

    return {
        "jitsi_domain": os.environ.get("ONLINE_JITSI_DOMAIN", "meet.jit.si").strip()
        or "meet.jit.si",
    }
