"""Online ta'lim — talaba marshrutlari.

Talaba OnlineTest ID va paroli bilan kiradi. Guruhi TOKENDAN olinadi
(`auth.group_name`), brauzerdan emas — aks holda talaba boshqa guruh nomini
yozib, o'zgalarning darsiga va yopiq mavzulariga kirib olardi.

Mavzu ochiqligini `OnlineLesson.is_opened` belgilaydi: o'qituvchi darsni
o'tkazib ochmaguncha talaba material ko'rmaydi.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.models.online_edu import (
    OnlineGroup,
    OnlineGroupCourse,
    OnlineLesson,
    OnlineMaterial,
    OnlineProgress,
    OnlineSyllabus,
)
from app.schemas.online_edu import OnlineTestSubmitIn, OnlineViewMarkIn
from app.services import online_edu_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()

StudentOnly = Depends(require_roles("student"))

# Talaba ko'radigan material turlari va ularning `OnlineProgress` ustunlari.
VIEW_COLUMNS = {
    "lecture": "lecture_viewed_at",
    "presentation": "presentation_viewed_at",
    "video": "video_viewed_at",
    "handout": "handout_viewed_at",
}


def _group(db: Session, auth: AuthContext) -> OnlineGroup:
    name = (auth.group_name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guruhingiz aniqlanmadi. Qaytadan kiring.",
        )
    group = svc.group_by_name(db, name)
    if group is None or not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"'{name}' guruhi online ta'limga qo'shilmagan. Administratorga murojaat qiling.",
        )
    return group


def _my_course(
    db: Session, group: OnlineGroup, syllabus_id: int, variant_label: str
) -> OnlineSyllabus:
    """Guruh shu fanni o'qiydimi — boshqa fanning materiali ko'rinmasin."""
    rows = db.execute(
        select(OnlineGroupCourse).where(
            OnlineGroupCourse.group_id == group.id,
            OnlineGroupCourse.syllabus_id == syllabus_id,
        )
    ).scalars().all()
    label = (variant_label or "").strip()
    ok = any(not r.variant_label.strip() or r.variant_label.strip() == label for r in rows)
    if not ok:
        raise HTTPException(status_code=403, detail="Bu fan sizning guruhingizda yo'q.")
    syllabus = db.get(OnlineSyllabus, syllabus_id)
    if syllabus is None or not syllabus.is_active:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    return syllabus


# ============================ Fanlar ============================

@router.get("/online/student/subjects/")
def my_subjects(
    db: Session = Depends(get_db), auth: AuthContext = StudentOnly
) -> list[dict]:
    """Talabaga 6-kurs davomida o'tiladigan barcha fanlar."""
    group = _group(db, auth)
    sid = (auth.student_id or "").strip()

    links = svc.courses_for_group(db, group)
    out: list[dict] = []
    for link in links:
        syllabus = db.get(OnlineSyllabus, link.syllabus_id)
        if syllabus is None or not syllabus.is_active:
            continue
        labels = (
            [link.variant_label]
            if link.variant_label.strip()
            else (svc.variant_labels(syllabus) or [""])
        )
        for label in labels:
            topics = svc.topics_for(syllabus, label)
            opened = svc.open_topic_codes(db, group.id, syllabus.id, label)
            done = db.execute(
                select(OnlineProgress).where(
                    OnlineProgress.student_id == sid,
                    OnlineProgress.syllabus_id == syllabus.id,
                    OnlineProgress.variant_label == label,
                    OnlineProgress.test_submitted_at.is_not(None),
                )
            ).scalars().all()
            out.append(
                {
                    "syllabus_id": syllabus.id,
                    "subject_name": syllabus.subject_name,
                    "variant_label": label,
                    "topic_count": len(topics),
                    "open_count": len([t for t in topics if str(t.get("code") or "") in opened]),
                    "done_count": len(done),
                }
            )
    return out


@router.get("/online/student/topics/")
def my_topics(
    syllabus_id: int = Query(...),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> list[dict]:
    """Fandagi mavzular — qaysi biri ochiq va qaysi biri hali yopiq."""
    group = _group(db, auth)
    syllabus = _my_course(db, group, syllabus_id, variant_label)
    sid = (auth.student_id or "").strip()

    opened = svc.open_topic_codes(db, group.id, syllabus_id, variant_label)

    progress = {
        p.topic_code: p
        for p in db.execute(
            select(OnlineProgress).where(
                OnlineProgress.student_id == sid,
                OnlineProgress.syllabus_id == syllabus_id,
                OnlineProgress.variant_label == (variant_label or ""),
            )
        ).scalars().all()
    }

    kinds = db.execute(
        select(OnlineMaterial.topic_code, OnlineMaterial.kind).where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
        )
    ).all()
    have: dict[str, set[str]] = {}
    for code, kind in kinds:
        have.setdefault(str(code), set()).add(str(kind))

    out = []
    for t in svc.topics_for(syllabus, variant_label):
        code = str(t.get("code") or "").strip()
        p = progress.get(code)
        is_open = code in opened
        out.append(
            {
                "topic_code": code,
                "title": str(t.get("title") or ""),
                "type": str(t.get("type") or ""),
                "is_open": is_open,
                "opened_at": opened.get(code),
                # Yopiq mavzuda material bor-yo'qligi ham ko'rsatilmaydi —
                # aks holda "nima borligini" bilib olish mumkin bo'lardi.
                "has": {k: (k in have.get(code, set())) for k in
                        ("lecture", "presentation", "video", "handout", "case", "test")}
                if is_open
                else {},
                "test_score": p.test_score if p and p.test_submitted_at else None,
                "test_total": p.test_total if p and p.test_submitted_at else None,
                "test_submitted_at": p.test_submitted_at if p else None,
            }
        )
    return out


@router.get("/online/student/topic/")
def topic_materials(
    syllabus_id: int = Query(...),
    topic_code: str = Query(...),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """Ochiq mavzuning materiallari.

    Test savollaridan TO'G'RI JAVOB olib tashlanadi — busiz talaba brauzer
    tarmoq oynasidan barcha javobni ko'rardi.
    """
    group = _group(db, auth)
    syllabus = _my_course(db, group, syllabus_id, variant_label)
    code = topic_code.strip()

    opened = svc.open_topic_codes(db, group.id, syllabus_id, variant_label)
    if code not in opened:
        raise HTTPException(
            status_code=403,
            detail="Bu mavzu hali ochilmagan. O'qituvchi video dars o'tkazgach ochiladi.",
        )

    rows = db.execute(
        select(OnlineMaterial).where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
            OnlineMaterial.topic_code == code,
        )
    ).scalars().all()

    sid = (auth.student_id or "").strip()
    progress = db.execute(
        select(OnlineProgress).where(
            OnlineProgress.student_id == sid,
            OnlineProgress.syllabus_id == syllabus_id,
            OnlineProgress.variant_label == (variant_label or ""),
            OnlineProgress.topic_code == code,
        )
    ).scalar_one_or_none()
    submitted = progress is not None and progress.test_submitted_at is not None

    materials = []
    for m in rows:
        item: dict = {
            "kind": m.kind,
            "title": m.title,
            "language": m.language,
            "file": f"/media/{m.file}" if m.file else "",
            "file_name": m.file_name,
            "external_url": m.external_url,
        }
        if m.kind == "test":
            questions = (m.payload or {}).get("questions")
            item["questions"] = svc.strip_test_for_student(
                questions if isinstance(questions, list) else []
            )
        elif m.kind in ("lecture", "case"):
            item["text"] = str((m.payload or {}).get("text") or "")
        materials.append(item)

    return {
        "topic_code": code,
        "title": svc.topic_title(syllabus, variant_label, code),
        "subject_name": syllabus.subject_name,
        "opened_at": opened.get(code),
        "materials": materials,
        "test_submitted": submitted,
        "test_score": progress.test_score if submitted else None,
        "test_total": progress.test_total if submitted else None,
    }


# ============================ Belgilash va test ============================

@router.post("/online/student/view/")
def mark_viewed(
    payload: OnlineViewMarkIn,
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """Talaba materialni ko'rgani belgilanadi — o'qituvchi hisobotida ko'rinadi."""
    group = _group(db, auth)
    _my_course(db, group, payload.syllabus_id, payload.variant_label)
    code = payload.topic_code.strip()
    if code not in svc.open_topic_codes(db, group.id, payload.syllabus_id, payload.variant_label):
        raise HTTPException(status_code=403, detail="Bu mavzu hali ochilmagan.")

    column = VIEW_COLUMNS.get(payload.kind)
    if column is None:
        raise HTTPException(status_code=400, detail="Noto'g'ri material turi.")

    row = svc.progress_row(
        db,
        student_id=(auth.student_id or "").strip(),
        student_name=f"{auth.user.first_name} {auth.user.last_name}".strip(),
        group_name=group.name,
        syllabus_id=payload.syllabus_id,
        variant_label=payload.variant_label,
        topic_code=code,
    )
    if getattr(row, column) is None:
        setattr(row, column, svc.now())
    row.updated_at = svc.now()
    db.commit()
    return {"marked": payload.kind}


@router.post("/online/student/test/")
def submit_test(
    payload: OnlineTestSubmitIn,
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """10 ta testni topshiradi va ballni qaytaradi.

    Test BIR MARTA topshiriladi. Ikkinchi urinish 409 bilan rad etiladi —
    aks holda talaba javoblarni bittalab sinab, 10/10 yig'ib olardi.
    """
    group = _group(db, auth)
    _my_course(db, group, payload.syllabus_id, payload.variant_label)
    code = payload.topic_code.strip()
    if code not in svc.open_topic_codes(db, group.id, payload.syllabus_id, payload.variant_label):
        raise HTTPException(status_code=403, detail="Bu mavzu hali ochilmagan.")

    material = db.execute(
        select(OnlineMaterial).where(
            OnlineMaterial.syllabus_id == payload.syllabus_id,
            OnlineMaterial.variant_label == (payload.variant_label or ""),
            OnlineMaterial.topic_code == code,
            OnlineMaterial.kind == "test",
        )
    ).scalar_one_or_none()
    if material is None:
        raise HTTPException(status_code=404, detail="Bu mavzuda test yo'q.")

    questions = (material.payload or {}).get("questions")
    questions = questions if isinstance(questions, list) else []
    if not questions:
        raise HTTPException(status_code=404, detail="Test savollari bo'sh.")

    row = svc.progress_row(
        db,
        student_id=(auth.student_id or "").strip(),
        student_name=f"{auth.user.first_name} {auth.user.last_name}".strip(),
        group_name=group.name,
        syllabus_id=payload.syllabus_id,
        variant_label=payload.variant_label,
        topic_code=code,
    )
    if row.test_submitted_at is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Siz bu testni allaqachon topshirgansiz: {row.test_score}/{row.test_total}.",
        )

    score, total = svc.score_answers(questions, payload.answers)
    row.test_answers = payload.answers
    row.test_score = score
    row.test_total = total
    row.test_submitted_at = svc.now()
    row.updated_at = svc.now()
    db.commit()
    return {"score": score, "total": total, "submitted_at": row.test_submitted_at}


# ============================ Jonli dars ============================

@router.get("/online/student/live-lesson/")
def live_lesson(
    db: Session = Depends(get_db), auth: AuthContext = StudentOnly
) -> dict | None:
    """Guruhda hozir davom etayotgan dars (bo'lsa) — talaba qo'shilishi uchun."""
    group = _group(db, auth)
    lesson = db.execute(
        select(OnlineLesson)
        .where(
            OnlineLesson.group_id == group.id,
            OnlineLesson.started_at.is_not(None),
            OnlineLesson.ended_at.is_(None),
        )
        .order_by(OnlineLesson.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    if lesson is None:
        return None
    syllabus = db.get(OnlineSyllabus, lesson.syllabus_id)
    return {
        "id": lesson.id,
        "room_name": lesson.room_name,
        "subject_name": syllabus.subject_name if syllabus else "",
        "topic_code": lesson.topic_code,
        "topic_title": svc.topic_title(syllabus, lesson.variant_label, lesson.topic_code)
        if syllabus
        else "",
        "started_at": lesson.started_at,
    }
