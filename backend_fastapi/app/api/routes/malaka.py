"""Malaka oshirish — o'qituvchi va tinglovchi marshrutlari.

Umumiy online marshrutlar (materiallar, mavzular ro'yxati, ko'rilganlik)
malaka fanlarida ham ishlaydi: ular fanning `program` iga qarab o'z
qoidasini tanlaydi. Bu yerda faqat malakaga XOS amallar — o'qituvchi
mavzu qo'shishi, fayldan test import qilish, ko'p urinishli testlar va
guruh natijalari.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy import text as sa_text
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth, require_roles
from app.api.routes.online_student import _group, _my_course
from app.api.routes.online_teacher import _me, _own_course
from app.core.db import get_db
from app.models.online_edu import (
    MalakaListener,
    MalakaTestAttempt,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineMaterial,
    OnlineProgress,
    OnlineSyllabus,
)
from app.schemas.malaka import MalakaAttemptIn, TopicCreateIn, TopicMoveIn, TopicRenameIn
from app.services import malaka_service as mk
from app.services import online_edu_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()

StudentOnly = Depends(require_roles("student"))

# Test fayli: Word yoki PDF. Rasmli qo'llanma emas, shuning uchun chegara kichik.
IMPORT_MAX_BYTES = 15 * 1024 * 1024

KIND_LABEL = {"test": "test", "practical": "amaliy mashg'ulot"}


def _release_db(db: Session) -> None:
    """DB ulanishini pool'ga qaytaradi (uzoq AI so'rovidan oldin).

    `admin_reports` dagi bir xil nomli yordamchi bilan bir xil vazifa: ochiq
    tranzaksiya AI javobini kutib ulanishni daqiqalab band qilmasin.
    """
    try:
        db.close()
    except Exception:  # noqa: BLE001 — bo'shatish hech qachon so'rovni yiqitmasin
        pass


# ============================ O'qituvchi: mavzular ============================


def _malaka_course(
    db: Session, auth: AuthContext, syllabus_id: int, *, lock: bool = False
) -> OnlineSyllabus:
    teacher = _me(db, auth)
    syllabus = _own_course(db, teacher, syllabus_id, "")
    if not mk.is_malaka(syllabus):
        raise HTTPException(status_code=400, detail="Bu amal faqat malaka oshirish fanlarida bor.")
    if lock:
        # Oltita o'qituvchi bir fanga birdan mavzu qo'shadi. Qulfsiz ikkalasi
        # bir xil ro'yxatni o'qib, bittasining mavzusi yo'qolib ketardi.
        syllabus = db.execute(
            select(OnlineSyllabus)
            .where(OnlineSyllabus.id == syllabus_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()
    return syllabus


def _clean_title(value: str) -> str:
    title = " ".join((value or "").split())
    if len(title) < 2:
        raise HTTPException(status_code=400, detail="Mavzu nomini yozing.")
    return title[:1024]


def _fold(value: object) -> str:
    return " ".join(str(value or "").lower().split())


def _code(t: dict) -> str:
    return str(t.get("code") or "").strip()


def _topic_list(syllabus: OnlineSyllabus) -> list[dict]:
    return [t for t in (syllabus.topics or []) if isinstance(t, dict)]


def _topic_out(t: dict) -> dict:
    return {"code": _code(t), "title": str(t.get("title") or ""), "type": str(t.get("type") or "")}


@router.post("/malaka/teacher/topics/", status_code=status.HTTP_201_CREATED)
def create_topic(
    payload: TopicCreateIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Yangi mavzu — ro'yxat oxiriga. Malakada mavzularni o'qituvchining o'zi kiritadi."""
    syllabus = _malaka_course(db, auth, payload.syllabus_id, lock=True)
    title = _clean_title(payload.title)
    topics = _topic_list(syllabus)
    if any(_fold(t.get("title")) == _fold(title) for t in topics):
        raise HTTPException(status_code=409, detail="Bunday nomli mavzu allaqachon bor.")
    topic = {
        "code": mk.next_topic_code(syllabus, mk.used_topic_codes(db, syllabus.id)),
        "title": title,
        "type": "lecture",
    }
    syllabus.topics = [*topics, topic]
    syllabus.updated_at = svc.now()
    db.commit()
    return _topic_out(topic)


@router.patch("/malaka/teacher/topics/{code}/")
def rename_topic(
    code: str,
    payload: TopicRenameIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    syllabus = _malaka_course(db, auth, payload.syllabus_id, lock=True)
    title = _clean_title(payload.title)
    key = code.strip()
    topics = _topic_list(syllabus)
    if not any(_code(t) == key for t in topics):
        raise HTTPException(status_code=404, detail="Mavzu topilmadi.")
    if any(_fold(t.get("title")) == _fold(title) and _code(t) != key for t in topics):
        raise HTTPException(status_code=409, detail="Bunday nomli mavzu allaqachon bor.")
    updated = [{**t, "title": title} if _code(t) == key else t for t in topics]
    syllabus.topics = updated
    syllabus.updated_at = svc.now()
    db.commit()
    return next(_topic_out(t) for t in updated if _code(t) == key)


@router.delete(
    "/malaka/teacher/topics/{code}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_topic(
    code: str,
    syllabus_id: int = Query(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> None:
    """Bo'sh mavzuni o'chiradi.

    Materiali bor mavzu o'chirilmaydi: unga bog'langan test natijalari
    tinglovchilarning bahosi, ular bir bosishda yo'qolmasin.
    """
    syllabus = _malaka_course(db, auth, syllabus_id, lock=True)
    key = code.strip()
    count = db.execute(
        select(func.count(OnlineMaterial.id)).where(
            OnlineMaterial.syllabus_id == syllabus.id,
            OnlineMaterial.topic_code == key,
        )
    ).scalar_one()
    if count:
        raise HTTPException(
            status_code=409,
            detail=f"Mavzuda {count} ta material bor. Avval ularni o'chiring.",
        )
    topics = _topic_list(syllabus)
    remaining = [t for t in topics if _code(t) != key]
    if len(remaining) == len(topics):
        raise HTTPException(status_code=404, detail="Mavzu topilmadi.")
    syllabus.topics = remaining
    syllabus.updated_at = svc.now()
    db.commit()


@router.post("/malaka/teacher/topics/{code}/move/")
def move_topic(
    code: str,
    payload: TopicMoveIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    """Mavzuni bir pog'ona yuqoriga yoki pastga suradi."""
    syllabus = _malaka_course(db, auth, payload.syllabus_id, lock=True)
    topics = _topic_list(syllabus)
    idx = next((i for i, t in enumerate(topics) if _code(t) == code.strip()), -1)
    if idx < 0:
        raise HTTPException(status_code=404, detail="Mavzu topilmadi.")
    other = idx - 1 if payload.direction == "up" else idx + 1
    if 0 <= other < len(topics):
        topics[idx], topics[other] = topics[other], topics[idx]
        syllabus.topics = list(topics)
        syllabus.updated_at = svc.now()
        db.commit()
    return [_topic_out(t) for t in topics]


# ============================ O'qituvchi: fayldan test ============================


@router.post("/malaka/teacher/test-import/")
def test_import(
    syllabus_id: int = Form(...),
    text: str = Form(default=""),
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Fayl yoki matndan test savollarini AI bilan ajratadi — SAQLAMAYDI.

    O'qituvchi natijani ko'rib chiqadi, kerak bo'lsa tuzatadi va keyin
    oddiy material sifatida saqlaydi. AI javobni o'zi tanlagan savollar
    belgilab qaytariladi.
    """
    _malaka_course(db, auth, syllabus_id)

    source = "matn"
    if file is not None and (file.filename or "").strip():
        name = file.filename or "fayl"
        if not name.lower().endswith(mk.IMPORT_EXTENSIONS):
            raise HTTPException(
                status_code=400, detail="Word (.docx, .doc), PDF yoki matn (.txt) fayl yuklang."
            )
        content = file.file.read(IMPORT_MAX_BYTES + 1)
        if not content:
            raise HTTPException(status_code=400, detail="Fayl bo'sh.")
        if len(content) > IMPORT_MAX_BYTES:
            raise HTTPException(status_code=400, detail="Fayl juda katta. Chegara 15 MB.")
        try:
            raw = mk.extract_text(name, content)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 — buzuq fayl 500 bermasin
            logger.warning("Malaka test fayli o'qilmadi (%s): %s", name, exc)
            raise HTTPException(
                status_code=400,
                detail="Fayl o'qilmadi. Uni Word (.docx) yoki PDF qilib saqlab, qayta yuklang.",
            ) from exc
        source = name
    else:
        raw = text or ""

    if len(raw.strip()) < 20:
        raise HTTPException(status_code=400, detail="Savollar topilmadi: matn juda qisqa yoki bo'sh.")

    _release_db(db)
    try:
        result = mk.parse_questions(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    result["source"] = source[:255]
    result["chars"] = len(raw)
    return result


# ============================ O'qituvchi: natijalar ============================


def _seen(row: OnlineProgress | None) -> dict[str, bool]:
    return {
        kind: row is not None and getattr(row, f"{kind}_viewed_at") is not None
        for kind in ("lecture", "presentation", "video")
    }


@router.get("/malaka/teacher/progress/")
def malaka_progress(
    syllabus_id: int = Query(...),
    group_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Fan bo'yicha tinglovchilar: kirish/chiqish testi va har mavzuning natijasi.

    Ro'yxat farmoyish bo'yicha — portalga hali kirmaganlar ham ko'rinadi,
    o'qituvchi kim orqada qolganini aynan shu yerdan biladi.
    """
    syllabus = _malaka_course(db, auth, syllabus_id)

    groups = db.execute(
        select(OnlineGroup)
        .join(OnlineGroupCourse, OnlineGroupCourse.group_id == OnlineGroup.id)
        .where(OnlineGroupCourse.syllabus_id == syllabus.id)
        .distinct()
        .order_by(OnlineGroup.name)
    ).scalars().all()
    ids = [g.id for g in groups]
    if group_id is not None:
        if group_id not in ids:
            raise HTTPException(status_code=403, detail="Bu guruh shu fanga biriktirilmagan.")
        selected = [group_id]
    else:
        selected = ids

    counts: dict[int, int] = {}
    listeners: list[MalakaListener] = []
    if ids:
        counts = {
            gid: int(n)
            for gid, n in db.execute(
                select(MalakaListener.group_id, func.count(MalakaListener.id))
                .where(MalakaListener.group_id.in_(ids), MalakaListener.is_active.is_(True))
                .group_by(MalakaListener.group_id)
            ).all()
        }
    if selected:
        listeners = list(
            db.execute(
                select(MalakaListener)
                .where(MalakaListener.group_id.in_(selected), MalakaListener.is_active.is_(True))
                .order_by(MalakaListener.full_name)
            ).scalars()
        )
    usernames = [x.username for x in listeners]

    attempts_by: dict[str, dict[tuple[str, str], list]] = {}
    progress_by: dict[str, dict[str, OnlineProgress]] = {}
    if usernames:
        for row in db.execute(
            select(MalakaTestAttempt)
            .where(
                MalakaTestAttempt.syllabus_id == syllabus.id,
                MalakaTestAttempt.student_id.in_(usernames),
            )
            .order_by(MalakaTestAttempt.attempt_no, MalakaTestAttempt.id)
        ).scalars():
            attempts_by.setdefault(row.student_id, {}).setdefault(
                (row.topic_code, row.kind), []
            ).append(row)
        for p in db.execute(
            select(OnlineProgress).where(
                OnlineProgress.syllabus_id == syllabus.id,
                OnlineProgress.student_id.in_(usernames),
            )
        ).scalars():
            progress_by.setdefault(p.student_id, {})[p.topic_code] = p

    have = mk.material_kinds_by_topic(db, syllabus.id)
    topics = svc.topics_for(syllabus)
    group_names = {g.id: g.name for g in groups}
    entry = mk.subject_test(db, syllabus.id, mk.ENTRY_CODE)
    exit_test = mk.subject_test(db, syllabus.id, mk.EXIT_CODE)

    students = []
    for listener in listeners:
        amap = attempts_by.get(listener.username, {})
        pmap = progress_by.get(listener.username, {})
        rows = []
        grades: list[int] = []
        for t in topics:
            code = _code(t)
            result = mk.topic_result(amap, code, have.get(code, set()))
            if result["grade"] is not None:
                grades.append(result["grade"])
            rows.append(
                {
                    "topic_code": code,
                    "topic_title": str(t.get("title") or ""),
                    "viewed": _seen(pmap.get(code)),
                    **result,
                }
            )
        seen_at = [r.submitted_at for rs in amap.values() for r in rs]
        seen_at += [p.updated_at for p in pmap.values() if p.updated_at]
        students.append(
            {
                "student_id": listener.username,
                "student_name": listener.full_name or listener.username,
                "group_name": group_names.get(listener.group_id, ""),
                "entry": mk.summarize(amap.get((mk.ENTRY_CODE, "entry"), []), "entry"),
                "exit": mk.summarize(amap.get((mk.EXIT_CODE, "exit"), []), "exit"),
                "topics": rows,
                "graded_count": len(grades),
                "average_grade": round(sum(grades) / len(grades)) if grades else None,
                "last_seen": max(seen_at) if seen_at else None,
            }
        )

    return {
        "subject_name": syllabus.subject_name,
        "topic_count": len(topics),
        "has_entry": bool(mk.questions_of(entry)),
        "entry_published": entry is not None and mk.is_published(entry),
        "has_exit": bool(mk.questions_of(exit_test)),
        "exit_published": exit_test is not None and mk.is_published(exit_test),
        "groups": [{"id": g.id, "name": g.name, "count": counts.get(g.id, 0)} for g in groups],
        "students": students,
    }


# ============================ Tinglovchi ============================


def _sid(auth: AuthContext) -> str:
    sid = (auth.student_id or "").strip()
    if not sid:
        raise HTTPException(status_code=403, detail="Tinglovchi aniqlanmadi. Qaytadan kiring.")
    return sid


def _malaka_student_course(db: Session, auth: AuthContext, syllabus_id: int):
    group = _group(db, auth)
    syllabus = _my_course(db, group, syllabus_id, "")
    if not mk.is_malaka(syllabus):
        raise HTTPException(status_code=400, detail="Bu fan malaka oshirish fani emas.")
    return group, syllabus


@router.get("/malaka/student/subject-test/")
def subject_test_view(
    syllabus_id: int = Query(...),
    code: str = Query(..., pattern="^(entry|exit)$"),
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """Fanning kirish yoki chiqish testi — savollar (javobsiz) va urinish holati."""
    _group_row, syllabus = _malaka_student_course(db, auth, syllabus_id)
    sid = _sid(auth)
    tcode = mk.ENTRY_CODE if code == "entry" else mk.EXIT_CODE
    material = mk.subject_test(db, syllabus.id, tcode)
    questions = mk.questions_of(material)
    if material is None or not mk.is_published(material) or not questions:
        raise HTTPException(status_code=404, detail="Bu test hali e'lon qilinmagan.")
    if code == "exit" and not mk.entry_gate_open(db, sid, syllabus.id):
        raise HTTPException(status_code=403, detail="Avval kirish testini topshiring.")
    rows = mk.attempts_for(
        db, student_id=sid, syllabus_id=syllabus.id, topic_code=tcode, kind=code
    )
    return {
        "code": code,
        "title": (material.title or "").strip() or mk.SUBJECT_TEST_TITLE[code],
        "subject_name": syllabus.subject_name,
        **mk.test_view(questions, rows, code),
    }


@router.post("/malaka/student/attempt/")
def submit_attempt(
    payload: MalakaAttemptIn,
    db: Session = Depends(get_db),
    auth: AuthContext = StudentOnly,
) -> dict:
    """Test urinishi: mavzu testi, amaliy mashg'ulot, kirish yoki chiqish testi.

    Urinishlar soni server tomonida sanaladi; to'g'ri javoblar faqat
    urinishlar tugagach ochiladi (qarang: `malaka_service.reveal_answers`).
    """
    group, syllabus = _malaka_student_course(db, auth, payload.syllabus_id)
    sid = _sid(auth)
    code = payload.topic_code.strip()

    if code in mk.SUBJECT_TEST_CODES:
        kind = mk.attempt_kind(code, "test")
        material = mk.subject_test(db, syllabus.id, code)
        if material is None or not mk.is_published(material):
            raise HTTPException(status_code=404, detail="Bu test hali e'lon qilinmagan.")
        if kind == "exit" and not mk.entry_gate_open(db, sid, syllabus.id):
            raise HTTPException(status_code=403, detail="Avval kirish testini topshiring.")
    else:
        kind = (payload.kind or "").strip().lower()
        if kind not in mk.TEST_KINDS:
            raise HTTPException(status_code=400, detail="Noto'g'ri test turi.")
        if code not in mk.open_codes(db, syllabus, sid):
            raise HTTPException(status_code=403, detail="Bu mavzu hali ochilmagan.")
        material = db.execute(
            select(OnlineMaterial)
            .where(
                OnlineMaterial.syllabus_id == syllabus.id,
                OnlineMaterial.variant_label == "",
                OnlineMaterial.topic_code == code,
                OnlineMaterial.kind == kind,
            )
            .order_by(OnlineMaterial.id)
        ).scalars().first()
        if material is None:
            raise HTTPException(status_code=404, detail=f"Bu mavzuda {KIND_LABEL[kind]} yo'q.")

    questions = mk.questions_of(material)
    if not questions:
        raise HTTPException(status_code=404, detail="Test savollari bo'sh.")
    if len(payload.answers) != len(questions):
        # O'qituvchi testni shu orada o'zgartirgan bo'lishi mumkin.
        raise HTTPException(
            status_code=409,
            detail="Test o'zgargan. Sahifani yangilab, qaytadan yeching.",
        )

    db.execute(
        sa_text("SELECT pg_advisory_xact_lock(:k)"),
        {"k": mk.attempt_lock_key(sid, syllabus.id, code, kind)},
    )
    rows = mk.attempts_for(
        db, student_id=sid, syllabus_id=syllabus.id, topic_code=code, kind=kind
    )
    limit = mk.MAX_ATTEMPTS[kind]
    if len(rows) >= limit:
        best = mk.summarize(rows, kind)["best_percent"]
        raise HTTPException(
            status_code=409,
            detail=f"Urinishlar tugagan ({len(rows)}/{limit}). Eng yaxshi natija: {best}%.",
        )

    score, total = svc.score_answers(questions, payload.answers)
    name = f"{auth.user.first_name} {auth.user.last_name}".strip()
    row = MalakaTestAttempt(
        student_id=sid,
        student_name=name[:255],
        group_name=group.name[:255],
        syllabus_id=syllabus.id,
        topic_code=code,
        kind=kind,
        attempt_no=len(rows) + 1,
        answers=list(payload.answers),
        score=score,
        total=total,
        submitted_at=svc.now(),
    )
    db.add(row)
    db.commit()
    rows.append(row)

    return {
        "score": score,
        "total": total,
        "percent": round(score * 100 / total) if total else 0,
        **mk.test_view(questions, rows, kind),
    }
