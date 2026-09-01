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
    MATERIAL_KINDS,
    OnlineMaterial,
    OnlineSyllabus,
    OnlineTeacher,
    OnlineTeacherCourse,
)
from app.schemas.online_edu import OnlineMaterialIn, OnlineMaterialOut
from app.services import file_storage as storage
from app.services import online_edu_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()

# Yuklanadigan fayl chegarasi — tarqatma va taqdimot uchun.
UPLOAD_MAX_BYTES = 40 * 1024 * 1024

# Fayl sifatida saqlanadigan turlar; qolganlari `payload` (AI kontenti).
FILE_KINDS = ("handout", "presentation")


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
    db: Session = Depends(get_db), auth: AuthContext = Depends(get_current_auth)
) -> dict:
    """Portalga kirgach birinchi so'rov: men online o'qituvchimanmi va nima o'tayapman."""
    teacher = svc.teacher_for(db, auth.user.username)
    if teacher is None:
        return {"is_online_teacher": False, "courses": []}

    rows = db.execute(
        select(OnlineSyllabus, OnlineTeacherCourse)
        .join(
            OnlineTeacherCourse,
            OnlineTeacherCourse.syllabus_id == OnlineSyllabus.id,
        )
        .where(OnlineTeacherCourse.teacher_id == teacher.id)
        .order_by(OnlineSyllabus.sort_order, OnlineSyllabus.subject_name)
    ).all()

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
                    "variant_label": label,
                    "topic_count": len(svc.topics_for(syl, label)),
                    "instruction_language": syl.instruction_language,
                }
            )
    return {
        "is_online_teacher": True,
        "full_name": teacher.full_name,
        "courses": courses,
    }


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

    out = []
    for t in svc.topics_for(syllabus, variant_label):
        code = str(t.get("code") or "").strip()
        kinds = have.get(code, set())
        out.append(
            {
                "code": code,
                "title": str(t.get("title") or ""),
                "type": str(t.get("type") or ""),
                "has": {k: (k in kinds) for k in MATERIAL_KINDS},
                "ready": len(kinds & set(MATERIAL_KINDS)),
            }
        )
    return out


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
        .order_by(OnlineMaterial.kind, OnlineMaterial.sort_order, OnlineMaterial.id)
    ).scalars().all()
    return [OnlineMaterialOut.model_validate(r) for r in rows]


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
    """AI yaratgan kontentni (ma'ruza, test, keys, taqdimot matni) saqlaydi.

    Bir mavzuda bir turdan BITTA material bo'ladi — qayta saqlansa eskisi
    yangilanadi. Aks holda talaba oynasida bir nechta ma'ruza paydo bo'lardi
    va qaysi biri haqiqiy ekani noma'lum qolardi.
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
    _own_course(db, teacher, payload.syllabus_id, payload.variant_label)

    existing = db.execute(
        select(OnlineMaterial).where(
            OnlineMaterial.syllabus_id == payload.syllabus_id,
            OnlineMaterial.variant_label == (payload.variant_label or ""),
            OnlineMaterial.topic_code == payload.topic_code.strip(),
            OnlineMaterial.kind == kind,
        )
    ).scalar_one_or_none()

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    now = svc.now()

    if existing is not None:
        existing.title = payload.title.strip()[:1024]
        existing.language = payload.language.strip().lower()[:8] or "uz"
        existing.payload = payload.payload
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
        payload=payload.payload,
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
    """Tarqatma yoki taqdimot faylini yuklaydi."""
    teacher = _me(db, auth)
    kind = (kind or "").strip().lower()
    if kind not in FILE_KINDS:
        raise HTTPException(
            status_code=400, detail=f"Fayl faqat {', '.join(FILE_KINDS)} uchun yuklanadi."
        )
    _own_course(db, teacher, syllabus_id, variant_label)

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

    existing = db.execute(
        select(OnlineMaterial).where(
            OnlineMaterial.syllabus_id == syllabus_id,
            OnlineMaterial.variant_label == (variant_label or ""),
            OnlineMaterial.topic_code == topic_code.strip(),
            OnlineMaterial.kind == kind,
        )
    ).scalar_one_or_none()

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
