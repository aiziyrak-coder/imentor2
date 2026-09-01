"""Online ta'lim moduli uchun umumiy yordamchilar.

Admin, o'qituvchi va talaba marshrutlari shu funksiyalarni baham ko'radi —
mavzu ro'yxatini o'qish, mavzu ochiqligini aniqlash va talaba holatini
topish mantig'i bir joyda tursin.
"""

from __future__ import annotations

import datetime as dt
import re
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.online_edu import (
    OnlineGroup,
    OnlineGroupCourse,
    OnlineLesson,
    OnlineProgress,
    OnlineSyllabus,
    OnlineTeacher,
    OnlineTeacherCourse,
)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ---------- Sillabus va mavzular ----------

def slugify_subject(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return (base or "fan")[:56]


def unique_subject_code(db: Session, base: str) -> str:
    code = (base or "").strip()[:64] or "fan"
    root = code
    n = 1
    while db.execute(
        select(OnlineSyllabus.id).where(OnlineSyllabus.subject_code == code)
    ).scalar_one_or_none():
        code = f"{root}-{n}"[:64]
        n += 1
    return code


def variant_labels(syllabus: OnlineSyllabus) -> list[str]:
    out: list[str] = []
    for v in syllabus.variants or []:
        if isinstance(v, dict):
            label = str(v.get("label") or "").strip()
            if label and label not in out:
                out.append(label)
    return out


def topics_for(syllabus: OnlineSyllabus, variant_label: str = "") -> list[dict]:
    """Berilgan variantning mavzulari; variant topilmasa umumiy ro'yxat.

    Sillabusda variantlar bo'lmasligi mumkin (bitta yo'nalishli fan) — bunda
    `topics` maydonining o'zi ishlatiladi.
    """
    label = (variant_label or "").strip()
    if label:
        for v in syllabus.variants or []:
            if isinstance(v, dict) and str(v.get("label") or "").strip() == label:
                items = v.get("topics")
                return [t for t in (items or []) if isinstance(t, dict)]
    return [t for t in (syllabus.topics or []) if isinstance(t, dict)]


def topic_by_code(syllabus: OnlineSyllabus, variant_label: str, topic_code: str) -> dict | None:
    code = (topic_code or "").strip()
    for t in topics_for(syllabus, variant_label):
        if str(t.get("code") or "").strip() == code:
            return t
    return None


def topic_title(syllabus: OnlineSyllabus, variant_label: str, topic_code: str) -> str:
    t = topic_by_code(syllabus, variant_label, topic_code)
    return str((t or {}).get("title") or "").strip()


# ---------- Dars xonasi ----------

def new_room_name() -> str:
    """Jitsi xona nomi.

    Nomni taxmin qilib bo'lmasligi kerak: xona nomini bilgan har kim
    darsga qo'shila oladi, shuning uchun tasodifiy qism majburiy.
    """
    return f"imentor-{secrets.token_urlsafe(12).replace('_', '-').replace('-', '')[:16].lower()}"


# ---------- Ruxsatlar ----------

def teacher_for(db: Session, owner_key: str) -> OnlineTeacher | None:
    key = (owner_key or "").strip()
    if not key:
        return None
    return db.execute(
        select(OnlineTeacher).where(
            OnlineTeacher.owner_key == key, OnlineTeacher.is_active.is_(True)
        )
    ).scalar_one_or_none()


def teacher_teaches(db: Session, teacher: OnlineTeacher, syllabus_id: int, variant_label: str) -> bool:
    """O'qituvchi shu fanni (va variantni) o'tadimi.

    Biriktiruvda variant bo'sh bo'lsa — fanning barcha variantlari tushuniladi.
    """
    rows = db.execute(
        select(OnlineTeacherCourse).where(
            OnlineTeacherCourse.teacher_id == teacher.id,
            OnlineTeacherCourse.syllabus_id == syllabus_id,
        )
    ).scalars().all()
    if not rows:
        return False
    label = (variant_label or "").strip()
    return any(not r.variant_label.strip() or r.variant_label.strip() == label for r in rows)


def group_by_name(db: Session, name: str) -> OnlineGroup | None:
    key = (name or "").strip()
    if not key:
        return None
    return db.execute(select(OnlineGroup).where(OnlineGroup.name == key)).scalar_one_or_none()


def courses_for_group(db: Session, group: OnlineGroup) -> list[OnlineGroupCourse]:
    return list(
        db.execute(
            select(OnlineGroupCourse).where(OnlineGroupCourse.group_id == group.id)
        ).scalars().all()
    )


# ---------- Mavzu qulfi ----------

def open_topic_codes(db: Session, group_id: int, syllabus_id: int, variant_label: str) -> dict[str, dt.datetime]:
    """Guruhga ochilgan mavzular: `{topic_code: ochilgan_vaqt}`.

    Mavzu faqat o'qituvchi darsni o'tkazib "ochish" tugmasini bosgach
    ochiladi — ya'ni `OnlineLesson.is_opened` rost bo'lganda.
    """
    rows = db.execute(
        select(OnlineLesson.topic_code, OnlineLesson.opened_at).where(
            OnlineLesson.group_id == group_id,
            OnlineLesson.syllabus_id == syllabus_id,
            OnlineLesson.variant_label == (variant_label or ""),
            OnlineLesson.is_opened.is_(True),
        )
    ).all()
    out: dict[str, dt.datetime] = {}
    for code, opened in rows:
        key = str(code or "").strip()
        if not key:
            continue
        # Bir mavzu bir necha marta o'tilgan bo'lsa — eng ERTA ochilgan vaqt.
        if key not in out or (opened and opened < out[key]):
            out[key] = opened
    return out


# ---------- Talaba holati ----------

def progress_row(
    db: Session,
    *,
    student_id: str,
    student_name: str,
    group_name: str,
    syllabus_id: int,
    variant_label: str,
    topic_code: str,
) -> OnlineProgress:
    """Talabaning shu mavzu bo'yicha qatorini topadi yoki yaratadi."""
    row = db.execute(
        select(OnlineProgress).where(
            OnlineProgress.student_id == student_id,
            OnlineProgress.syllabus_id == syllabus_id,
            OnlineProgress.variant_label == (variant_label or ""),
            OnlineProgress.topic_code == topic_code,
        )
    ).scalar_one_or_none()
    if row is not None:
        return row
    row = OnlineProgress(
        student_id=student_id,
        student_name=student_name or "",
        group_name=group_name or "",
        syllabus_id=syllabus_id,
        variant_label=variant_label or "",
        topic_code=topic_code,
        updated_at=now(),
    )
    db.add(row)
    db.flush()
    return row


def score_answers(questions: list, answers: list) -> tuple[int, int]:
    """To'g'ri javoblar soni.

    `live_test_service.score_submission` bilan bir xil mantiq: model
    qaytargan JSON'da indeks matn bo'lishi yoki savol buzuq bo'lishi
    mumkin — bunda 500 emas, mantiqiy natija qaytadi.
    """
    total = len(questions) if isinstance(questions, list) else 0
    if not total or not isinstance(answers, list):
        return 0, total
    correct = 0
    for i, q in enumerate(questions):
        if i >= len(answers) or not isinstance(q, dict):
            continue
        try:
            if int(q.get("correctOptionIndex", -1)) == int(answers[i]):
                correct += 1
        except (TypeError, ValueError):
            continue
    return correct, total


def strip_test_for_student(questions: list) -> list[dict]:
    """Talabaga ketadigan savol: to'g'ri javob OLIB TASHLANADI.

    Busiz talaba brauzer konsolidan barcha javobni ko'rardi.
    """
    out: list[dict] = []
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        options = q.get("options")
        out.append(
            {
                "question": q.get("question", ""),
                "options": options if isinstance(options, list) else [],
            }
        )
    return out
