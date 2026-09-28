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
    """Fan kodi IKKALA jadvalda ham noyob bo'ladi.

    Kod RAG uchun kalit: darslik qidiruvi avval `core_coursesyllabus` da,
    keyin `online_syllabus` da qidiradi. Ikkalasida bir xil kod bo'lsa,
    online fanga boshqa kafedraning darsliklari kelib qolardi.
    """
    from app.models.content import CourseSyllabus

    code = (base or "").strip()[:64] or "fan"
    root = code
    n = 1
    while (
        db.execute(
            select(OnlineSyllabus.id).where(OnlineSyllabus.subject_code == code)
        ).scalar_one_or_none()
        or db.execute(
            select(CourseSyllabus.id).where(CourseSyllabus.subject_code == code)
        ).scalar_one_or_none()
    ):
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


def review_test_for_student(questions: list) -> list[dict]:
    """Topshirilgan testni tahlil qilish uchun to'liq shakl.

    Javoblar FAQAT test topshirilgandan keyin ochiladi. Bunda talaba
    ikkinchi marta topshira olmaydi (409), shuning uchun to'g'ri javobni
    ko'rish natijani buzmaydi — aksincha, xatosini tushunmasa test o'quv
    vositasi emas, shunchaki baho bo'lib qoladi.
    """
    out: list[dict] = []
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        options = q.get("options")
        idx = q.get("correctOptionIndex")
        out.append(
            {
                "question": q.get("question", ""),
                "options": options if isinstance(options, list) else [],
                "correct_index": idx if isinstance(idx, int) else -1,
                "explanation": str(q.get("explanation") or ""),
            }
        )
    return out


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


# ---------- Vaziyatli masala ----------

# Yechim boshlanishini bildiruvchi belgilar. O'zbekcha apostrof bir necha xil
# yoziladi, shuning uchun taqqoslashdan oldin hammasi bittaga keltiriladi.
_APOSTROPHES = "'`‘’ʻʼ´"

_SOLUTION_MARKERS = (
    "**yechim",
    "yechim:",
    "### yechim",
    "## yechim",
    "**javob",
    "javob:",
    "### javob",
    "**to'g'ri javob",
    "to'g'ri javob:",
    "**tahlil",
    "tahlil:",
)


def _fold_apostrophes(value: str) -> str:
    out = value.lower()
    for ch in _APOSTROPHES:
        out = out.replace(ch, "'")
    return out


def split_case(payload: dict | None) -> tuple[str, str]:
    """Vaziyatli masalani ikkiga ajratadi: (talabaga ko'rinadigan qism, yechim).

    Talaba avval O'ZI javob yozishi kerak, shuning uchun yechim javob
    yuborilgunga qadar brauzerga umuman ketmaydi. Ilgari butun matn birga
    yuborilardi — ya'ni "vaziyatli masala" o'qib chiqiladigan matn edi,
    o'ylab ko'riladigan topshiriq emas.

    Matn bir nechta vaziyatdan iborat bo'lishi mumkin, shuning uchun birinchi
    "Yechim" da kesib tashlamaymiz: har bir yechim bloki keyingi sarlavhagacha
    davom etadi va faqat o'sha bloklar ajratiladi.
    """
    data = payload or {}
    text = str(data.get("text") or "").strip()

    explicit = str(data.get("solution") or "").strip()
    if explicit:
        return text, explicit

    task_lines: list[str] = []
    solution_lines: list[str] = []
    in_solution = False

    for line in text.splitlines():
        stripped = line.strip()
        folded = _fold_apostrophes(stripped)

        if stripped.startswith("#"):
            # Yangi sarlavha — yechim bloki tugadi.
            in_solution = any(folded.lstrip("# ").startswith(m.lstrip("*# "))
                              for m in _SOLUTION_MARKERS)
        elif any(folded.startswith(m) for m in _SOLUTION_MARKERS):
            in_solution = True

        (solution_lines if in_solution else task_lines).append(line)

    return (
        '\n'.join(task_lines).strip(),
        '\n'.join(solution_lines).strip(),
    )


# ---------- Mavzu bahosi ----------

def topic_grade(row) -> dict:
    """Mavzu uchun yakuniy baho: test va vaziyatli masalaning o'rtachasi.

    Ikkalasi ham 100 ballik shkalada. Test bali savollar sonidan foizga
    aylantiriladi (10 tadan 7 tasi = 70), vaziyatli masalaga esa AI javob
    mazmuniga qarab 0-100 oralig'ida baho qo'yadi.

    Baho FAQAT ikkalasi topshirilgach chiqadi. Bittasi bilan o'rtacha
    chiqarish talabaga yolg'on tasavvur berardi: bitta ish qilib "85 ball"
    ko'rgan odam ikkinchisini bajarishga oshiqmaydi.
    """
    if row is None:
        return {
            "test_percent": None,
            "case_percent": None,
            "grade": None,
            "test_done": False,
            "case_done": False,
        }

    test_done = row.test_submitted_at is not None
    case_done = row.case_submitted_at is not None

    test_percent = None
    if test_done and (row.test_total or 0) > 0:
        test_percent = round((row.test_score or 0) * 100 / row.test_total)
    elif test_done:
        test_percent = 0

    case_percent = None
    if case_done:
        try:
            case_percent = int((row.case_review or {}).get("score") or 0)
        except (TypeError, ValueError):
            case_percent = 0
        case_percent = max(0, min(100, case_percent))

    grade = None
    if test_percent is not None and case_percent is not None:
        grade = round((test_percent + case_percent) / 2)

    return {
        "test_percent": test_percent,
        "case_percent": case_percent,
        "grade": grade,
        "test_done": test_done,
        "case_done": case_done,
    }
