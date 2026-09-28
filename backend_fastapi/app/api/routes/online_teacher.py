"""Online ta'lim — o'qituvchi marshrutlari.

O'qituvchi `onlinetalim.fermi.uz` da o'z telefon+paroli bilan kiradi va
FAQAT o'ziga biriktirilgan online fanlarni ko'radi. Hozirgi iMentor'dagi
fanlari, materiallari va talabalari bu yerda umuman ko'rinmaydi.

Har bir yozish amalidan oldin `_own_course` tekshiruvi bajariladi: fan
o'qituvchiga biriktirilmagan bo'lsa 403 qaytadi. Busiz bir o'qituvchi
boshqasining fanini tahrirlab qo'yardi.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth
from app.core.db import get_db
from app.models.online_edu import (
    OnlineAttendance,
    OnlineLesson,
    OnlineMaterial,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineProgress,
    OnlineSyllabus,
    OnlineTeacher,
    OnlineTeacherCourse,
)
from app.schemas.online_edu import OnlineMaterialIn, OnlineMaterialOut
from app.services import file_storage as storage
from app.services import malaka_service as mk
from app.services import online_edu_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()

# Yuklanadigan fayl chegarasi — tarqatma va taqdimot uchun.
UPLOAD_MAX_BYTES = 40 * 1024 * 1024

# Fayl sifatida saqlanadigan turlar; qolganlari `payload` (AI kontenti).
FILE_KINDS = ("handout", "presentation")

# Bitta mavzuda BIR NECHTA bo'lishi mumkin bo'lgan turlar.
#
# Ma'ruza, keys va test bitta bo'lishi kerak — ikkitasi bo'lsa talaba
# qaysi biri haqiqiy ekanini bilmaydi. Video va tarqatma esa boshqacha:
# bitta mavzuga bir nechta yozuv, qo'llanma va ko'rgazma to'g'ri keladi,
# va ularni turli o'qituvchilar to'ldirib boradi.
MULTI_KINDS = ("video", "handout")


def _me(db: Session, auth: AuthContext) -> OnlineTeacher:
    """Kirgan foydalanuvchi online o'qituvchimi.

    Admin ham kira oladi — u dasturni sinab ko'rishi kerak; lekin unga ham
    fan biriktirilgan bo'lishi shart, ya'ni ruxsat qoidasi bir xil.
    """
    teacher = svc.teacher_for(db, auth.user.username)
    if teacher is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Siz online ta'lim o'qituvchisi emassiz. Administratorga murojaat qiling.",
        )
    return teacher


def _own_course(
    db: Session, teacher: OnlineTeacher, syllabus_id: int, variant_label: str
) -> OnlineSyllabus:
    syllabus = db.get(OnlineSyllabus, syllabus_id)
    if syllabus is None:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    if not svc.teacher_teaches(db, teacher, syllabus_id, variant_label):
        raise HTTPException(status_code=403, detail="Bu fan sizga biriktirilmagan.")
    return syllabus


# ============================ Kim men ============================

@router.get("/online/teacher/me/")
def teacher_me(
    # "online" | "malaka" — portal o'z dasturining fanlarini so'raydi.
    # Bo'sh — hammasi (eski mijozlar uchun).
    program: str = Query(default="", max_length=16),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Portalga kirgach birinchi so'rov: men online o'qituvchimanmi va nima o'tayapman."""
    teacher = svc.teacher_for(db, auth.user.username)
    if teacher is None:
        return {"is_online_teacher": False, "courses": []}

    stmt = (
        select(OnlineSyllabus, OnlineTeacherCourse)
        .join(
            OnlineTeacherCourse,
            OnlineTeacherCourse.syllabus_id == OnlineSyllabus.id,
        )
        .where(OnlineTeacherCourse.teacher_id == teacher.id)
        .order_by(OnlineSyllabus.sort_order, OnlineSyllabus.subject_name)
    )
    if program.strip():
        stmt = stmt.where(OnlineSyllabus.program == program.strip().lower())
    rows = db.execute(stmt).all()

    courses = []
    for syl, link in rows:
        # Biriktiruvda variant bo'sh bo'lsa — fanning barcha yo'nalishlari.
        labels = [link.variant_label] if link.variant_label.strip() else (
            svc.variant_labels(syl) or [""]
        )
        for label in labels:
            courses.append(
                {
                    "syllabus_id": syl.id,
                    "subject_name": syl.subject_name,
                    # Kod AI uchun kerak: server u orqali fanning kafedrasini
                    # topadi va darsliklardan o'qiydi.
                    "subject_code": syl.subject_code,
                    "department_name": syl.department_name,
                    "variant_label": label,
                    "topic_count": len(svc.topics_for(syl, label)),
                    "instruction_language": syl.instruction_language,
                    "program": syl.program or "online",
                }
            )
    return {
        "is_online_teacher": True,
        "full_name": teacher.full_name,
        "courses": courses,
    }


# ============================ Fanni o'zi tanlash ============================

# Fanni o'zi oladigan rollar. Talaba bu yerga umuman kira olmasin.
SELF_ASSIGN_ROLES = ("hodim", "admin")


def _staff_or_403(auth: AuthContext) -> None:
    if auth.role not in SELF_ASSIGN_ROLES:
        raise HTTPException(status_code=403, detail="Fanni faqat o'qituvchi tanlay oladi.")


@router.get("/online/teacher/catalog/")
def teacher_catalog(
    program: str = Query(default="online", max_length=16),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    """O'qituvchi o'zi tanlashi mumkin bo'lgan faol fanlar va yo'nalishlari.

    Ilgari fanni faqat administrator biriktirardi — o'qituvchi portalga
    kirib "fan biriktirilmagan" deb to'xtab qolardi.
    """
    _staff_or_403(auth)
    teacher = svc.teacher_for(db, auth.user.username)
    mine: set[tuple[int, str]] = set()
    if teacher is not None:
        for sid, label in db.execute(
            select(OnlineTeacherCourse.syllabus_id, OnlineTeacherCourse.variant_label).where(
                OnlineTeacherCourse.teacher_id == teacher.id
            )
        ).all():
            mine.add((sid, label.strip()))

    rows = db.execute(
        select(OnlineSyllabus)
        .where(
            OnlineSyllabus.is_active.is_(True),
            OnlineSyllabus.program == (program.strip().lower() or "online"),
        )
        .order_by(OnlineSyllabus.sort_order, OnlineSyllabus.subject_name)
    ).scalars().all()

    out = []
    for syl in rows:
        labels = svc.variant_labels(syl) or [""]
        whole = (syl.id, "") in mine
        out.append(
            {
                "syllabus_id": syl.id,
                "subject_name": syl.subject_name,
                "department_name": syl.department_name,
                "variants": [
                    {
                        "label": label,
                        "topic_count": len(svc.topics_for(syl, label)),
                        "mine": whole or (syl.id, label) in mine,
                    }
                    for label in labels
                ],
            }
        )
    return out


@router.post("/online/teacher/courses/", status_code=status.HTTP_201_CREATED)
def teacher_take_course(
    payload: dict,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """O'qituvchi fanni o'ziga biriktiradi (kerak bo'lsa online o'qituvchi yozuvi ochiladi)."""
    _staff_or_403(auth)
    try:
        syllabus_id = int(payload.get("syllabus_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Fan tanlanmagan.") from None
    label = str(payload.get("variant_label") or "").strip()[:128]

    syl = db.get(OnlineSyllabus, syllabus_id)
    if syl is None or not syl.is_active:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    labels = svc.variant_labels(syl)
    if label and label not in labels:
        raise HTTPException(status_code=422, detail="Bunday yo'nalish yo'q.")

    key = auth.user.username
    teacher = db.execute(
        select(OnlineTeacher).where(OnlineTeacher.owner_key == key)
    ).scalar_one_or_none()
    if teacher is None:
        name = f"{auth.user.first_name or ''} {auth.user.last_name or ''}".strip()
        teacher = OnlineTeacher(
            owner_key=key, full_name=name[:255], is_active=True, created_at=svc.now()
        )
        db.add(teacher)
        db.flush()
    elif not teacher.is_active:
        # Administrator o'chirib qo'ygan o'qituvchi o'zini qayta yoqa olmasin.
        raise HTTPException(
            status_code=403,
            detail="Online ta'limdagi hisobingiz administrator tomonidan to'xtatilgan.",
        )

    if svc.teacher_teaches(db, teacher, syllabus_id, label):
        db.commit()
        return {"created": False}
    db.add(
        OnlineTeacherCourse(
            teacher_id=teacher.id, syllabus_id=syllabus_id, variant_label=label, created_at=svc.now()
        )
    )
    db.commit()
    return {"created": True}


@router.delete(
    "/online/teacher/courses/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def teacher_leave_course(
    syllabus_id: int = Query(...),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> None:
    """O'qituvchi fanni ro'yxatidan olib tashlaydi. Materiallar o'chmaydi."""
    _staff_or_403(auth)
    teacher = svc.teacher_for(db, auth.user.username)
    if teacher is None:
        return
    for row in db.execute(
        select(OnlineTeacherCourse).where(
            OnlineTeacherCourse.teacher_id == teacher.id,
            OnlineTeacherCourse.syllabus_id == syllabus_id,
            OnlineTeacherCourse.variant_label == variant_label.strip(),
        )
    ).scalars():
        db.delete(row)
    db.commit()


# ============================ Mavzular ============================

@router.get("/online/teacher/topics/")
def teacher_topics(
    syllabus_id: int = Query(...),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    """Fandagi mavzular va har birida qaysi material tayyor ekani."""
    teacher = _me(db, auth)
    syllabus = _own_course(db, teacher, syllabus_id, variant_label)

    rows = db.execute(
        select(OnlineMaterial.topic_code, OnlineMaterial.kind).where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
        )
    ).all()
    have: dict[str, set[str]] = {}
    for code, kind in rows:
        have.setdefault(str(code), set()).add(str(kind))

    # Dasturning o'z turlari: malakada tarqatma va masala yo'q, amaliy bor.
    allowed = mk.kinds_for(syllabus)
    out = []
    for t in svc.topics_for(syllabus, variant_label):
        code = str(t.get("code") or "").strip()
        kinds = have.get(code, set())
        out.append(
            {
                "code": code,
                "title": str(t.get("title") or ""),
                "type": str(t.get("type") or ""),
                "has": {k: (k in kinds) for k in allowed},
                "ready": len(kinds & set(allowed)),
            }
        )
    return out


@router.get("/online/teacher/groups/")
def teacher_groups(
    syllabus_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    """O'qituvchi dars o'ta oladigan guruhlar.

    Faqat SHU o'qituvchining fanlariga biriktirilgan guruhlar qaytadi —
    aks holda dars yaratishda begona guruhni tanlab qo'yish mumkin bo'lardi.
    """
    teacher = _me(db, auth)
    mine = db.execute(
        select(OnlineTeacherCourse.syllabus_id).where(
            OnlineTeacherCourse.teacher_id == teacher.id
        )
    ).scalars().all()
    if not mine:
        return []
    if syllabus_id is not None:
        if syllabus_id not in set(mine):
            raise HTTPException(status_code=403, detail="Bu fan sizga biriktirilmagan.")
        mine = [syllabus_id]

    rows = db.execute(
        select(OnlineGroup, OnlineGroupCourse.syllabus_id)
        .join(OnlineGroupCourse, OnlineGroupCourse.group_id == OnlineGroup.id)
        .where(
            OnlineGroupCourse.syllabus_id.in_(mine),
            OnlineGroup.is_active.is_(True),
        )
        .order_by(OnlineGroup.name)
    ).all()

    seen: dict[int, dict] = {}
    for group, sid in rows:
        item = seen.setdefault(
            group.id, {"id": group.id, "name": group.name, "syllabus_ids": []}
        )
        if sid not in item["syllabus_ids"]:
            item["syllabus_ids"].append(sid)
    return list(seen.values())


# ============================ Materiallar ============================

@router.get("/online/teacher/materials/", response_model=list[OnlineMaterialOut])
def list_materials(
    syllabus_id: int = Query(...),
    topic_code: str = Query(...),
    variant_label: str = Query(default=""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[OnlineMaterialOut]:
    teacher = _me(db, auth)
    _own_course(db, teacher, syllabus_id, variant_label)
    rows = db.execute(
        select(OnlineMaterial)
        .where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
            OnlineMaterial.topic_code == topic_code.strip(),
        )
        .order_by(OnlineMaterial.kind, OnlineMaterial.sort_order, OnlineMaterial.id)  # qo'shilish tartibida
    ).scalars().all()
    return [OnlineMaterialOut.model_validate(r) for r in rows]


def _target_material(
    db: Session, teacher: OnlineTeacher, payload: OnlineMaterialIn, kind: str
) -> OnlineMaterial | None:
    """Yangilanadigan yozuv (bo'lsa); `None` bo'lsa yangisi qo'shiladi."""
    if payload.material_id:
        obj = db.get(OnlineMaterial, payload.material_id)
        if obj is None:
            raise HTTPException(status_code=404, detail="Material topilmadi.")
        # Boshqa fanning yozuvini shu yerdan tahrirlab bo'lmasin.
        _own_course(db, teacher, obj.syllabus_id, obj.variant_label)
        return obj

    base = (
        OnlineMaterial.syllabus_id == payload.syllabus_id,
        OnlineMaterial.variant_label == (payload.variant_label or ""),
        OnlineMaterial.topic_code == payload.topic_code.strip(),
        OnlineMaterial.kind == kind,
    )

    if kind in MULTI_KINDS:
        # Bir xil havolani ikki marta qo'shish — nusxa, yangilash emas.
        url = payload.external_url.strip()
        if not url:
            return None
        return db.execute(
            select(OnlineMaterial).where(*base, OnlineMaterial.external_url == url)
        ).scalars().first()

    return db.execute(select(OnlineMaterial).where(*base)).scalars().first()


@router.post(
    "/online/teacher/materials/",
    response_model=OnlineMaterialOut,
    status_code=status.HTTP_201_CREATED,
)
def save_material(
    payload: OnlineMaterialIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> OnlineMaterialOut:
    """Kontentni (ma'ruza, test, keys, video havolasi) saqlaydi.

    Ma'ruza, keys, test va taqdimotdan bir mavzuda BITTA bo'ladi — qayta
    saqlansa eskisi yangilanadi, aks holda talaba oynasida bir nechta
    ma'ruza paydo bo'lardi va qaysi biri haqiqiy ekani noma'lum qolardi.

    Video esa `MULTI_KINDS` da: har saqlash yangi yozuv qo'shadi.
    `material_id` berilsa — o'sha yozuvning o'zi yangilanadi.
    """
    teacher = _me(db, auth)
    try:
        kind = payload.validated_kind()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if kind in FILE_KINDS and not payload.payload and not payload.external_url.strip():
        raise HTTPException(
            status_code=400,
            detail=f"'{kind}' turi fayl bilan yuklanadi — /materials/upload/ dan foydalaning.",
        )
    syllabus = _own_course(db, teacher, payload.syllabus_id, payload.variant_label)
    # Dastur qoidasi: turi ruxsat etilganmi, malakada mavzu bormi, test
    # savollari to'liqmi. Test uchun tozalangan payload qaytadi.
    try:
        cleaned = mk.validate_material(syllabus, payload.topic_code, kind, payload.payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    body = cleaned if cleaned is not None else payload.payload

    existing = _target_material(db, teacher, payload, kind)

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    now = svc.now()

    if existing is not None:
        existing.title = payload.title.strip()[:1024]
        existing.language = payload.language.strip().lower()[:8] or "uz"
        existing.payload = body
        existing.external_url = payload.external_url.strip()[:1024]
        existing.owner_key = auth.user.username
        existing.author_name = display[:255]
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return OnlineMaterialOut.model_validate(existing)

    obj = OnlineMaterial(
        syllabus_id=payload.syllabus_id,
        variant_label=payload.variant_label or "",
        topic_code=payload.topic_code.strip(),
        kind=kind,
        title=payload.title.strip()[:1024],
        language=payload.language.strip().lower()[:8] or "uz",
        payload=body,
        external_url=payload.external_url.strip()[:1024],
        owner_key=auth.user.username,
        author_name=display[:255],
        sort_order=payload.sort_order,
        created_at=now,
        updated_at=now,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return OnlineMaterialOut.model_validate(obj)


@router.post(
    "/online/teacher/materials/upload/",
    response_model=OnlineMaterialOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_material(
    file: UploadFile = File(...),
    syllabus_id: int = Form(...),
    topic_code: str = Form(...),
    kind: str = Form(...),
    variant_label: str = Form(default=""),
    title: str = Form(default=""),
    language: str = Form(default="uz"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> OnlineMaterialOut:
    """Tarqatma yoki taqdimot faylini yuklaydi.

    Tarqatma `MULTI_KINDS` da: har yuklash mavzuga YANGI fayl qo'shadi,
    eskisini almashtirmaydi. Bitta mavzuga bir nechta qo'llanma, jadval
    yoki ko'rgazma to'g'ri keladi va ularni turli o'qituvchilar to'ldiradi.
    Taqdimot esa bitta bo'lib qoladi.
    """
    teacher = _me(db, auth)
    kind = (kind or "").strip().lower()
    if kind not in FILE_KINDS:
        raise HTTPException(
            status_code=400, detail=f"Fayl faqat {', '.join(FILE_KINDS)} uchun yuklanadi."
        )
    syllabus = _own_course(db, teacher, syllabus_id, variant_label)
    if kind not in mk.kinds_for(syllabus):
        raise HTTPException(status_code=400, detail=f"Bu fanda '{kind}' turi yo'q.")

    try:
        content = await file.read()
    except Exception as exc:
        logger.exception("Online material o'qilmadi: %s", exc)
        raise HTTPException(status_code=400, detail="Fayl o'qilmadi. Qayta tanlang.") from exc
    if not content:
        raise HTTPException(status_code=400, detail="Fayl bo'sh.")
    if len(content) > UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Fayl juda katta ({len(content) // (1024 * 1024)} MB). Chegara 40 MB.",
        )

    raw_name = file.filename or "fayl"
    ctype = file.content_type or ""
    if not storage.validate_extension(raw_name, content=content, content_type=ctype):
        raise HTTPException(
            status_code=400, detail="Fayl turi qo'llab-quvvatlanmaydi. PDF, JPG yoki PNG yuklang."
        )
    ext = storage.detect_extension(raw_name, content, ctype) or ".pdf"
    if not raw_name.lower().endswith(ext):
        raw_name = f"{raw_name}{ext}"

    # Online fayllar ALOHIDA papkada — mavjud media bilan aralashmasin.
    topic_key = f"online-{syllabus_id}-{(variant_label or 'asosiy')}-{topic_code}"
    rel_path = storage.handout_relative_path(
        topic_key, auth.user.username, raw_name, language=language
    )
    rel_path = f"online/{rel_path}"
    try:
        storage.save_upload(rel_path, content)
    except OSError as exc:
        logger.exception("Online material diskka yozilmadi: %s", exc)
        raise HTTPException(status_code=400, detail="Fayl saqlanmadi.") from exc

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    now = svc.now()

    existing = None
    if kind not in MULTI_KINDS:
        existing = db.execute(
            select(OnlineMaterial).where(
                OnlineMaterial.syllabus_id == syllabus_id,
                OnlineMaterial.variant_label == (variant_label or ""),
                OnlineMaterial.topic_code == topic_code.strip(),
                OnlineMaterial.kind == kind,
            )
        ).scalars().first()

    if existing is not None:
        # Eski fayl diskda qolib ketmasin.
        if existing.file:
            try:
                storage.delete_file(existing.file)
            except OSError:
                logger.warning("Eski online fayl o'chmadi: %s", existing.file)
        existing.title = (title.strip() or raw_name)[:1024]
        existing.file = rel_path
        existing.file_name = raw_name[:512]
        existing.file_size = len(content)
        existing.language = (language or "uz").strip().lower()[:8]
        existing.owner_key = auth.user.username
        existing.author_name = display[:255]
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        return OnlineMaterialOut.model_validate(existing)

    obj = OnlineMaterial(
        syllabus_id=syllabus_id,
        variant_label=variant_label or "",
        topic_code=topic_code.strip(),
        kind=kind,
        title=(title.strip() or raw_name)[:1024],
        language=(language or "uz").strip().lower()[:8],
        payload={},
        file=rel_path,
        file_name=raw_name[:512],
        file_size=len(content),
        owner_key=auth.user.username,
        author_name=display[:255],
        created_at=now,
        updated_at=now,
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return OnlineMaterialOut.model_validate(obj)


@router.delete(
    "/online/teacher/materials/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_material(
    pk: int, db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_auth)
) -> None:
    teacher = _me(db, auth)
    obj = db.get(OnlineMaterial, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Material topilmadi.")
    _own_course(db, teacher, obj.syllabus_id, obj.variant_label)
    if obj.file:
        try:
            storage.delete_file(obj.file)
        except OSError:
            logger.warning("Online fayl o'chmadi: %s", obj.file)
    db.delete(obj)
    db.commit()


# ============================ Talabalar holati ============================
#
# Ilgari o'qituvchi o'z guruhi haqida HECH NARSA ko'ra olmasdi: kim ma'ruzani
# ochgan, kim test topshirgan, kim umuman kirmagan — bularning hammasi faqat
# admin panelida edi. Dars o'tadigan odam uchun bu eng kerakli ma'lumot.


def _group_roster(db: Session, group: OnlineGroup) -> dict[str, str]:
    """Guruhdagi talabalar: `{student_id: ism}`.

    Alohida talabalar ro'yxati jadvali yo'q — talaba tashqi OnlineTest
    tizimida yashaydi. Shuning uchun ro'yxat portalda IZ QOLDIRGAN
    talabalardan yig'iladi: material ochgan, test topshirgan yoki darsga
    qatnashganlar. Ya'ni bu "guruh jurnali" emas, "portaldan foydalanganlar"
    ro'yxati — va o'qituvchi qo'lda ham qo'sha oladi.
    """
    out: dict[str, str] = {}

    rows = db.execute(
        select(OnlineProgress.student_id, OnlineProgress.student_name).where(
            OnlineProgress.group_name == group.name
        )
    ).all()
    for sid, name in rows:
        key = str(sid or "").strip()
        if key:
            out.setdefault(key, str(name or "").strip())

    att = db.execute(
        select(OnlineAttendance.student_id, OnlineAttendance.student_name)
        .join(OnlineLesson, OnlineLesson.id == OnlineAttendance.lesson_id)
        .where(OnlineLesson.group_id == group.id)
    ).all()
    for sid, name in att:
        key = str(sid or "").strip()
        if not key:
            continue
        if key not in out or not out[key]:
            out[key] = str(name or "").strip()
    return out


@router.get("/online/teacher/group-students/")
def group_students(
    group_id: int = Query(...),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> list[dict]:
    """Guruh talabalari — davomat belgilashda ro'yxatdan tanlash uchun."""
    teacher = _me(db, auth)
    group = db.get(OnlineGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")

    # Guruh o'qituvchining fanlaridan birini o'qiydimi.
    mine = set(
        db.execute(
            select(OnlineTeacherCourse.syllabus_id).where(
                OnlineTeacherCourse.teacher_id == teacher.id
            )
        ).scalars().all()
    )
    linked = set(
        db.execute(
            select(OnlineGroupCourse.syllabus_id).where(
                OnlineGroupCourse.group_id == group.id
            )
        ).scalars().all()
    )
    if not (mine & linked):
        raise HTTPException(status_code=403, detail="Bu guruh sizga biriktirilmagan.")

    roster = _group_roster(db, group)
    return [
        {"student_id": sid, "student_name": name or sid}
        for sid, name in sorted(roster.items(), key=lambda kv: (kv[1] or kv[0]).lower())
    ]


@router.get("/online/teacher/progress/")
def teacher_progress(
    syllabus_id: int = Query(...),
    variant_label: str = Query(default=""),
    group_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    """Fan bo'yicha talabalar holati: nimani ochgan, testdan necha ball olgan."""
    teacher = _me(db, auth)
    syllabus = _own_course(db, teacher, syllabus_id, variant_label)

    stmt = select(OnlineProgress).where(
        OnlineProgress.syllabus_id == syllabus_id,
        OnlineProgress.variant_label == (variant_label or ""),
    )
    if group_id:
        group = db.get(OnlineGroup, group_id)
        if group is None:
            raise HTTPException(status_code=404, detail="Guruh topilmadi.")
        stmt = stmt.where(OnlineProgress.group_name == group.name)

    rows = db.execute(stmt).scalars().all()
    topics = svc.topics_for(syllabus, variant_label)
    opened_titles = {str(t.get("code") or "").strip(): str(t.get("title") or "") for t in topics}

    by_student: dict[str, dict] = {}
    for r in rows:
        sid = (r.student_id or "").strip()
        if not sid:
            continue
        item = by_student.setdefault(
            sid,
            {
                "student_id": sid,
                "student_name": (r.student_name or "").strip() or sid,
                "group_name": (r.group_name or "").strip(),
                "topics": [],
                "tests_taken": 0,
                "cases_taken": 0,
                "grades": [],
                "score_sum": 0,
                "score_total": 0,
            },
        )
        submitted = r.test_submitted_at is not None
        if submitted:
            item["tests_taken"] += 1
            item["score_sum"] += int(r.test_score or 0)
            item["score_total"] += int(r.test_total or 0)

        # Mavzu bahosi — test va vaziyatli masalaning o'rtachasi.
        grade = svc.topic_grade(r)
        if grade["grade"] is not None:
            item["grades"].append(grade["grade"])
        if grade["case_done"]:
            item["cases_taken"] += 1
        item["topics"].append(
            {
                "topic_code": r.topic_code,
                "topic_title": opened_titles.get(r.topic_code, ""),
                "viewed": {
                    "lecture": r.lecture_viewed_at is not None,
                    "presentation": r.presentation_viewed_at is not None,
                    "video": r.video_viewed_at is not None,
                    "handout": r.handout_viewed_at is not None,
                },
                "test_score": r.test_score if submitted else None,
                "test_total": r.test_total if submitted else None,
                "test_submitted_at": r.test_submitted_at,
                "case_answer": (r.case_answer or "")[:2000],
                **grade,
            }
        )

    students = sorted(by_student.values(), key=lambda x: x["student_name"].lower())
    for st in students:
        st["topics"].sort(key=lambda t: str(t["topic_code"]))
        # `percent` — faqat testlar bo'yicha; `average_grade` esa yakuniy
        # baho, ya'ni test va masala o'rtachalarining o'rtachasi.
        st["percent"] = (
            round(st["score_sum"] * 100 / st["score_total"]) if st["score_total"] else None
        )
        marks = st.pop("grades")
        st["graded_count"] = len(marks)
        st["average_grade"] = round(sum(marks) / len(marks)) if marks else None

    return {
        "subject_name": syllabus.subject_name,
        "topic_count": len(topics),
        "students": students,
    }
