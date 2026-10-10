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
    OnlineAttendance,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineLesson,
    OnlineMaterial,
    OnlineProgress,
    OnlineSyllabus,
)
from app.core.config import get_settings
from app.schemas.online_edu import (
    OnlineCaseSubmitIn,
    OnlineTestSubmitIn,
    OnlineViewMarkIn,
)
from app.services.json_loose import parse_json_loose
from app.services.openai_client import generate_openai_text
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
    """Talabaning guruhi. Noma'lum guruh AVTOMATIK ro'yxatga olinadi.

    Ilgari admin guruh nomini qo'lda terardi va u OnlineTest'dagi nom bilan
    harfma-harf mos kelishi kerak edi. Bitta xato harf — talaba kira olmasdi
    va sababi hech qayerda ko'rinmasdi.

    Endi talaba kirishga urinsa, guruhi `is_active=False` holatida yoziladi:
    admin uni ro'yxatda ko'radi va bitta bosish bilan yoqadi. Terish ham,
    xato ham yo'q. Nofaol guruh talabaga hech narsa ochmaydi.
    """
    name = (auth.group_name or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guruhingiz aniqlanmadi. Tizimdan chiqib, qaytadan kiring.",
        )
    group = svc.group_by_name(db, name)
    if group is None:
        group = OnlineGroup(name=name[:255], is_active=False, created_at=svc.now())
        db.add(group)
        db.commit()
        db.refresh(group)
    if not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"'{name}' guruhi hali online ta'limga ulanmagan. "
                "Guruhingiz ro'yxatga olindi — administrator tasdiqlagach fanlaringiz ochiladi."
            ),
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
                    "department_name": syllabus.department_name,
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

    # Video va tarqatma bitta mavzuda bir nechta bo'lishi mumkin, shuning
    # uchun tartib barqaror bo'lsin — talaba har ochganda ro'yxat
    # o'rin almashib turmasin.
    rows = db.execute(
        select(OnlineMaterial)
        .where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
            OnlineMaterial.topic_code == code,
        )
        .order_by(OnlineMaterial.kind, OnlineMaterial.sort_order, OnlineMaterial.id)
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
            # Bir turdan bir nechta bo'lgani uchun ro'yxatda `kind` endi
            # yagona kalit emas.
            "id": m.id,
            "kind": m.kind,
            "title": m.title,
            "language": m.language,
            "file": f"/media/{m.file}" if m.file else "",
            "file_name": m.file_name,
            "external_url": m.external_url,
        }
        if m.kind == "test":
            questions = (m.payload or {}).get("questions")
            questions = questions if isinstance(questions, list) else []
            if submitted:
                # Topshirgandan keyin talaba xatosini ko'rsin. Qayta
                # topshirish 409 bilan to'siladi, ya'ni javobni ochish
                # ballni oshirishga imkon bermaydi.
                item["questions"] = svc.review_test_for_student(questions)
                item["my_answers"] = list(progress.test_answers or [])
            else:
                item["questions"] = svc.strip_test_for_student(questions)
        elif m.kind == "case":
            # Yechim javob yuborilgunga qadar brauzerga UMUMAN ketmaydi.
            task, solution = svc.split_case(m.payload)
            item["text"] = task
            if progress is not None and progress.case_submitted_at is not None:
                item["solution"] = solution
                item["my_answer"] = progress.case_answer or ""
                item["review"] = progress.case_review or {}
            item["submitted"] = (
                progress is not None and progress.case_submitted_at is not None
            )
        elif m.kind == "lecture":
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
        # Talaba qaysi materialni ochganini o'zi ham ko'rsin — nimani
        # o'qib bo'lgani esida qolmasligi mumkin.
        "viewed": {
            kind: getattr(progress, column) is not None if progress else False
            for kind, column in VIEW_COLUMNS.items()
        },
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


@router.get("/online/student/attendance/")
def my_attendance(
    db: Session = Depends(get_db), auth: AuthContext = StudentOnly
) -> list[dict]:
    """Talabaning o'z davomati.

    Davomat baholashga ta'sir qiladi, shuning uchun talaba uni ko'ra olishi
    kerak: qaysi darsda bo'lgan, qanchasini o'tkazib yuborgan. Ilgari bu
    ma'lumot faqat admin panelida turardi va talaba o'zi haqidagi yozuvni
    ko'ra olmasdi.
    """
    group = _group(db, auth)
    sid = (auth.student_id or "").strip()

    lessons = db.execute(
        select(OnlineLesson)
        .where(
            OnlineLesson.group_id == group.id,
            OnlineLesson.started_at.is_not(None),
        )
        .order_by(OnlineLesson.started_at.desc())
        .limit(200)
    ).scalars().all()
    if not lessons:
        return []

    present = {
        a.lesson_id: a
        for a in db.execute(
            select(OnlineAttendance).where(
                OnlineAttendance.student_id == sid,
                OnlineAttendance.lesson_id.in_([lo.id for lo in lessons]),
            )
        ).scalars().all()
    }

    out = []
    for lo in lessons:
        syllabus = db.get(OnlineSyllabus, lo.syllabus_id)
        row = present.get(lo.id)
        out.append(
            {
                "lesson_id": lo.id,
                "subject_name": syllabus.subject_name if syllabus else "",
                "topic_code": lo.topic_code,
                "topic_title": svc.topic_title(syllabus, lo.variant_label, lo.topic_code)
                if syllabus
                else "",
                "started_at": lo.started_at,
                "ended_at": lo.ended_at,
                "was_present": row is not None,
                "minutes": round((row.total_seconds or 0) / 60) if row else 0,
            }
        )
    return out


# ============================ Vaziyatli masala ============================

CASE_SYSTEM = "\n".join(
    [
        "Siz tibbiyot instituti 6-kurs talabasining vaziyatli masala javobini",
        "baholayotgan tajribali klinik o'qituvchisiz. Talabaning javobini",
        "etalon yechim bilan solishtiring.",
        "",
        "Qat'iy qoidalar:",
        "- Baho FAQAT tibbiy mazmunga qarab qo'yiladi; imlo va uslub baholanmaydi.",
        "- Talaba boshqa so'z bilan aytgan bo'lsa ham, mohiyati to'g'ri bo'lsa — to'g'ri.",
        "- Xato bo'lsa, nimasi xatoligini aniq ayting: qaysi tashxis yoki qadam",
        "  noto'g'ri va nega.",
        "- `ideal` maydonida to'liq, tartibli namunaviy javob bering — talaba",
        "  undan o'rgansin.",
        "- Javob TILI: o'zbek tili (lotin yozuvi).",
        "",
        "Faqat JSON qaytaring:",
        '{"verdict":"correct|partial|incorrect","score":0-100,'
        '"feedback":"2-4 gap","strengths":["..."],"missed":["..."],"ideal":"..."}',
    ]
)

NO_SOLUTION_HINT = "(o'qituvchi yechim yozmagan — vaziyatning o'zidan kelib chiqing)"


def _evaluate_case(task: str, solution: str, answer: str) -> dict:
    """AI bahosi.

    Xatolik bo'lsa istisno ko'tariladi va javob SAQLANMAYDI — talabaning
    yagona urinishi xizmat ishlamagani uchun behuda ketmasin.
    """
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI tahlil xizmati sozlanmagan. Administratorga murojaat qiling.",
        )

    prompt = "\n\n".join(
        [
            "VAZIYAT:\n" + task,
            "ETALON YECHIM:\n" + (solution or NO_SOLUTION_HINT),
            "TALABA JAVOBI:\n" + answer,
        ]
    )

    try:
        raw = generate_openai_text(
            api_key,
            user_text=prompt,
            system_instruction=CASE_SYSTEM,
            model=(getattr(settings, "openai_model", "") or "gpt-4o"),
            max_tokens=1200,
            temperature=0.2,
            json_only=True,
            usage_kind="online_case_review",
        )
        data = parse_json_loose(raw)
    except Exception as exc:
        logger.exception("Keys tahlili muvaffaqiyatsiz: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Tahlil hozir bajarilmadi. Javobingiz saqlanmadi — "
                "birozdan keyin qayta yuboring."
            ),
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=503, detail="Tahlil tushunarsiz keldi. Qayta yuboring."
        )

    verdict = str(data.get("verdict") or "").strip().lower()
    if verdict not in ("correct", "partial", "incorrect"):
        verdict = "partial"
    try:
        score = max(0, min(100, int(float(data.get("score", 0)))))
    except (TypeError, ValueError):
        score = 0

    def _short_list(key: str) -> list[str]:
        items = data.get(key)
        if not isinstance(items, list):
            return []
        return [str(x).strip() for x in items if str(x).strip()][:6]

    return {
        "verdict": verdict,
        "score": score,
        "feedback": str(data.get("feedback") or "").strip(),
        "strengths": _short_list("strengths"),
        "missed": _short_list("missed"),
        # Namunaviy javob AI dan; u bo'sh kelsa o'qituvchining yechimi qoladi.
        "ideal": str(data.get("ideal") or "").strip() or solution,
    }


@router.post("/online/student/case/")
def submit_case(
    payload: OnlineCaseSubmitIn,
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """Talaba vaziyatli masalaga o'z javobini yuboradi, AI uni tahlil qiladi.

    Yechim serverdan chiqmaydi: talaba javob yozguncha uni ko'rmaydi, javob
    yuborilgach esa tahlil bilan birga namunaviy javobni oladi. Ilgari butun
    matn yechimi bilan birga yuborilardi — ya'ni masala o'qib chiqiladigan
    matn edi, o'ylab ko'riladigan topshiriq emas.
    """
    group = _group(db, auth)
    _my_course(db, group, payload.syllabus_id, payload.variant_label)
    code = payload.topic_code.strip()
    if code not in svc.open_topic_codes(
        db, group.id, payload.syllabus_id, payload.variant_label
    ):
        raise HTTPException(status_code=403, detail="Bu mavzu hali ochilmagan.")

    material = db.execute(
        select(OnlineMaterial).where(
            OnlineMaterial.syllabus_id == payload.syllabus_id,
            OnlineMaterial.variant_label == (payload.variant_label or ""),
            OnlineMaterial.topic_code == code,
            OnlineMaterial.kind == "case",
        )
    ).scalars().first()
    if material is None:
        raise HTTPException(status_code=404, detail="Bu mavzuda vaziyatli masala yo'q.")

    task, solution = svc.split_case(material.payload)
    answer = payload.answer.strip()
    if len(answer) < 20:
        raise HTTPException(
            status_code=400,
            detail="Javob juda qisqa. Tashxisingizni va keyingi qadamlarni yozing.",
        )

    row = svc.progress_row(
        db,
        student_id=(auth.student_id or "").strip(),
        student_name=f"{auth.user.first_name} {auth.user.last_name}".strip(),
        group_name=group.name,
        syllabus_id=payload.syllabus_id,
        variant_label=payload.variant_label,
        topic_code=code,
    )
    if row.case_submitted_at is not None:
        raise HTTPException(
            status_code=409, detail="Siz bu masalaga allaqachon javob bergansiz."
        )

    review = _evaluate_case(task, solution, answer)

    row.case_answer = answer
    row.case_review = review
    row.case_submitted_at = svc.now()
    row.updated_at = svc.now()
    db.commit()

    return {
        "submitted_at": row.case_submitted_at,
        "review": review,
        "solution": solution,
    }
