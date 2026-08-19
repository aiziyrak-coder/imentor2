from __future__ import annotations

import datetime as dt
import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.core.staff_login import normalize_staff_login
from app.models.content import AcademicDepartment, CourseSyllabus, StaffCourseSelection
from app.models.user import User
from app.schemas.content import (
    AdminStaffCourseSelectionOut,
    AssignCourseSelectionRequest,
    SetMyTeachingSubjectsRequest,
    StaffCourseSelectionOut,
)
from app.schemas.course_syllabus import CourseSyllabusFullOut, CourseSyllabusUpsertRequest
from app.services.direction_code import infer_direction_code, normalize_direction_code
from app.services.pagination import paginate

router = APIRouter()

logger = logging.getLogger(__name__)

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _slugify_subject(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return (s or "fan")[:64]


def _sync_legacy_fields(obj: CourseSyllabus) -> None:
    variants = obj.variants or []
    if variants:
        first = variants[0]
        obj.file_name = (first.get("file_name") or obj.file_name or "")[:512]
        obj.topics = first.get("topics") or []
    elif not obj.topics:
        obj.topics = []


def _full_out(obj: CourseSyllabus) -> CourseSyllabusFullOut:
    return CourseSyllabusFullOut(
        id=obj.id,
        subject_name=obj.subject_name,
        subject_code=obj.subject_code,
        department=obj.department_id,
        department_name=obj.department.name if obj.department else "",
        department_code=obj.department.code if obj.department else "",
        direction_code=obj.direction_code or "",
        description=obj.description,
        instruction_language=obj.instruction_language,
        file_name=obj.file_name,
        topics=obj.topics,
        variants=obj.variants,
        name_i18n=obj.name_i18n or {},
        topics_i18n=obj.topics_i18n or {},
        sort_order=obj.sort_order,
        is_active=obj.is_active,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
    )


def _selection_out(sel: StaffCourseSelection) -> StaffCourseSelectionOut:
    return StaffCourseSelectionOut(
        id=sel.id,
        syllabus=_full_out(sel.syllabus).model_dump(),
        variant_label=sel.variant_label,
        selected_at=sel.selected_at,
    )


def _admin_selection_out(sel: StaffCourseSelection, user_cache: dict[str, User | None], db: Session) -> AdminStaffCourseSelectionOut:
    if sel.owner_key not in user_cache:
        user_cache[sel.owner_key] = db.execute(
            select(User).where(User.username == sel.owner_key)
        ).scalar_one_or_none()
    user = user_cache[sel.owner_key]
    owner_name = (f"{user.first_name} {user.last_name}".strip() if user else "") or sel.owner_key
    owner_phone_display = f"+{sel.owner_key}" if len(sel.owner_key) == 12 else sel.owner_key
    return AdminStaffCourseSelectionOut(
        id=sel.id,
        owner_key=sel.owner_key,
        owner_name=owner_name,
        owner_phone_display=owner_phone_display,
        syllabus=_full_out(sel.syllabus).model_dump(),
        variant_label=sel.variant_label,
        selected_at=sel.selected_at,
    )


@router.get("/course-syllabuses/catalog/")
def syllabus_catalog(
    request: Request,
    db: Session = Depends(get_db),
    auth=Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    rows = (
        db.execute(
            select(CourseSyllabus)
            .where(CourseSyllabus.is_active.is_(True))
            .order_by(CourseSyllabus.sort_order, CourseSyllabus.subject_name)
        )
        .scalars()
        .all()
    )
    out = []
    for obj in rows:
        topic_count = sum(len((v or {}).get("topics") or []) for v in (obj.variants or []))
        if not topic_count and obj.topics:
            topic_count = len(obj.topics)
        if topic_count > 0:
            out.append(_full_out(obj).model_dump())
    return paginate(out, request, default_page_size=200, max_page_size=1000)


@router.post("/course-syllabuses/{pk}/translate/")
def translate_syllabus(
    pk: int,
    lang: str = "",
    db: Session = Depends(get_db),
    auth=Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Sillabus nomi va mavzu nomlarini interfeys tillariga tarjima qiladi.

    Interfeys tili almashganda, tarjimasi yo'q sillabus uchun chaqiriladi.
    Idempotent: mavjud tarjimalar qayta yaratilmaydi, shuning uchun bir necha
    foydalanuvchi bir vaqtda chaqirsa ham natija bir xil bo'ladi.
    """
    from app.services.syllabus_i18n import SUPPORTED_LANGS, ensure_syllabus_translations

    obj = db.get(CourseSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Sillabus topilmadi.")

    wanted = (lang or "").strip().lower()
    langs = (wanted,) if wanted in SUPPORTED_LANGS else SUPPORTED_LANGS
    changed = ensure_syllabus_translations(db, obj, langs)
    db.refresh(obj)
    return {
        "ok": True,
        "changed": changed,
        "name_i18n": obj.name_i18n or {},
        "topics_i18n": obj.topics_i18n or {},
    }


@router.patch("/admin/course-syllabuses/{pk}/translations/")
def admin_update_syllabus_translations(
    pk: int,
    payload: dict,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    """Admin tarjimalarni qo'lda tuzatadi (sifat nazorati).

    Kutiladigan shakl:
        {"lang": "en",
         "subject_name": "...",                 # ixtiyoriy
         "topics": {"<asl sarlavha>": "<tarjima>"}}   # ixtiyoriy

    Faqat berilgan qiymatlar yangilanadi; bo'sh satr yuborilsa o'sha
    tarjima o'chiriladi (keyin avtomatik qayta yaratilishi mumkin).
    """
    from app.services.syllabus_i18n import SUPPORTED_LANGS

    obj = db.get(CourseSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Sillabus topilmadi.")

    lang = str(payload.get("lang") or "").strip().lower()
    if lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail="Til noto'g'ri (uz/ru/en).")

    name_i18n = dict(obj.name_i18n or {})
    if "subject_name" in payload:
        value = str(payload.get("subject_name") or "").strip()
        if value:
            name_i18n[lang] = value[:255]
        else:
            name_i18n.pop(lang, None)

    topics_i18n = {k: dict(v or {}) for k, v in (obj.topics_i18n or {}).items()}
    incoming = payload.get("topics")
    if isinstance(incoming, dict):
        current = topics_i18n.get(lang) or {}
        for original, translated in incoming.items():
            original = str(original or "").strip()
            if not original:
                continue
            value = str(translated or "").strip()
            if value:
                current[original] = value[:512]
            else:
                current.pop(original, None)
        topics_i18n[lang] = current

    obj.name_i18n = name_i18n
    obj.topics_i18n = topics_i18n
    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(obj)
    return {"ok": True, "name_i18n": obj.name_i18n, "topics_i18n": obj.topics_i18n}


def _topic_count(obj: CourseSyllabus) -> int:
    topic_count = sum(len((v or {}).get("topics") or []) for v in (obj.variants or []))
    if not topic_count and obj.topics:
        topic_count = len(obj.topics)
    return topic_count


def _staff_profile(db: Session, owner_key: str):
    from app.models.staff_location import StaffProfile

    return db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == owner_key)
    ).scalar_one_or_none()


@router.get("/course-syllabuses/department/")
def department_course_syllabuses(
    request: Request,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> dict:
    """Xodim kafedrasidagi faol fanlar (birinchi kirish / profile tanlash uchun)."""
    profile = _staff_profile(db, auth.user.username)
    if profile is None or not profile.department_id:
        raise HTTPException(
            status_code=400,
            detail="Kafedra biriktirilmagan. Administrator bilan bog'laning.",
        )

    rows = (
        db.execute(
            select(CourseSyllabus)
            .where(
                CourseSyllabus.is_active.is_(True),
                CourseSyllabus.department_id == profile.department_id,
            )
            .order_by(CourseSyllabus.sort_order, CourseSyllabus.subject_name)
        )
        .scalars()
        .all()
    )
    out = [_full_out(obj).model_dump() for obj in rows if _topic_count(obj) > 0]
    return paginate(out, request, default_page_size=200, max_page_size=1000)


@router.get("/course-syllabuses/my/", response_model=list[StaffCourseSelectionOut])
def my_course_selections(
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> list[StaffCourseSelectionOut]:
    rows = (
        db.execute(
            select(StaffCourseSelection)
            .join(CourseSyllabus)
            .where(
                StaffCourseSelection.owner_key == auth.user.username,
                CourseSyllabus.is_active.is_(True),
            )
            .order_by(StaffCourseSelection.selected_at.desc())
        )
        .scalars()
        .all()
    )
    return [_selection_out(r) for r in rows]


@router.put("/course-syllabuses/my/", response_model=list[StaffCourseSelectionOut])
def set_my_teaching_subjects(
    payload: SetMyTeachingSubjectsRequest,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> list[StaffCourseSelectionOut]:
    """Kafedra fanlaridan o'qitadigan fanlar to'plamini almashtiradi (kamida 1 ta)."""
    ids = sorted({int(x) for x in payload.syllabus_ids})
    if not ids:
        raise HTTPException(status_code=400, detail="Kamida bitta fan tanlang.")

    profile = _staff_profile(db, auth.user.username)
    if profile is None or not profile.department_id:
        raise HTTPException(
            status_code=400,
            detail="Kafedra biriktirilmagan. Administrator bilan bog'laning.",
        )

    fans = (
        db.execute(
            select(CourseSyllabus).where(
                CourseSyllabus.id.in_(ids),
                CourseSyllabus.is_active.is_(True),
                CourseSyllabus.department_id == profile.department_id,
            )
        )
        .scalars()
        .all()
    )
    found = {f.id for f in fans}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Faqat o'z kafedrangizdagi faol fanlarni tanlash mumkin.",
        )

    owner = auth.user.username
    db.execute(delete(StaffCourseSelection).where(StaffCourseSelection.owner_key == owner))
    now = dt.datetime.now(dt.timezone.utc)
    for sid in ids:
        db.add(
            StaffCourseSelection(
                owner_key=owner,
                syllabus_id=sid,
                variant_label="",
                selected_at=now,
            )
        )
    db.commit()

    rows = (
        db.execute(
            select(StaffCourseSelection)
            .join(CourseSyllabus)
            .where(
                StaffCourseSelection.owner_key == owner,
                CourseSyllabus.is_active.is_(True),
            )
            .order_by(StaffCourseSelection.selected_at.desc())
        )
        .scalars()
        .all()
    )
    return [_selection_out(r) for r in rows]


@router.post("/course-syllabuses/my/")
def my_course_selections_create_forbidden(auth=Depends(require_roles("hodim"))) -> None:
    raise HTTPException(
        status_code=405,
        detail="Fanni saqlash uchun PUT /course-syllabuses/my/ ishlating.",
    )


@router.delete("/course-syllabuses/my/{syllabus_id}/")
def my_course_selection_delete_forbidden(syllabus_id: int, auth=Depends(require_roles("hodim"))) -> None:
    raise HTTPException(
        status_code=405,
        detail="Fanni o'zgartirish uchun PUT /course-syllabuses/my/ ishlating.",
    )


@router.get("/admin/staff-course-selections/")
def admin_list_course_selections(
    request: Request,
    syllabus_id: int | None = None,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    stmt = select(StaffCourseSelection).order_by(StaffCourseSelection.selected_at.desc())
    if syllabus_id is not None:
        stmt = stmt.where(StaffCourseSelection.syllabus_id == syllabus_id)
    rows = db.execute(stmt).scalars().all()
    user_cache: dict[str, User | None] = {}
    out = [_admin_selection_out(r, user_cache, db).model_dump() for r in rows]
    return paginate(out, request, default_page_size=100, max_page_size=500)


@router.post(
    "/admin/staff-course-selections/",
    response_model=list[AdminStaffCourseSelectionOut],
    status_code=status.HTTP_201_CREATED,
)
def admin_assign_course_selection(
    payload: AssignCourseSelectionRequest,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> list[AdminStaffCourseSelectionOut]:
    try:
        owner = normalize_staff_login(payload.phone_digits)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Telefon raqami (998XXXXXXXXX) yoki Xodim ID kiriting.",
        )

    if db.execute(select(User).where(User.username == owner)).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Bu loginli xodim topilmadi.")

    syllabus = db.get(CourseSyllabus, payload.syllabus_id)
    if syllabus is None:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")

    available = [
        (v.get("label") or "").strip() for v in (syllabus.variants or []) if (v.get("label") or "").strip()
    ]
    labels = [lbl.strip() for lbl in payload.variant_labels if lbl.strip()]
    labels = list(dict.fromkeys(labels))

    # Bo'sh labels = butun fan (yo'nalish ajratmasdan). Variantlar ixtiyoriy.
    if labels:
        if available:
            invalid = [lbl for lbl in labels if lbl not in available]
            if invalid:
                raise HTTPException(status_code=400, detail="Noto'g'ri syllabus/yo'nalish.")
    else:
        labels = [""]

    results: list[StaffCourseSelection] = []
    for label in labels:
        sel = db.execute(
            select(StaffCourseSelection).where(
                StaffCourseSelection.owner_key == owner,
                StaffCourseSelection.syllabus_id == syllabus.id,
                StaffCourseSelection.variant_label == label,
            )
        ).scalar_one_or_none()
        if sel is None:
            sel = StaffCourseSelection(
                owner_key=owner,
                syllabus_id=syllabus.id,
                variant_label=label,
                selected_at=dt.datetime.now(dt.timezone.utc),
            )
            db.add(sel)
            db.flush()
        results.append(sel)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Bu fanni ushbu xodimga allaqachon biriktirilgan.") from exc
    for r in results:
        db.refresh(r)
    user_cache: dict[str, User | None] = {}
    return [_admin_selection_out(r, user_cache, db) for r in results]


@router.delete("/admin/staff-course-selections/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def admin_delete_course_selection(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> None:
    obj = db.get(StaffCourseSelection, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    db.delete(obj)
    db.commit()


# ---------------- Admin: CourseSyllabus CRUD ----------------


@router.get("/admin/course-syllabuses/stats/")
def admin_syllabus_stats(
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    from app.services.external_catalog import build_syllabus_catalog_stats

    return build_syllabus_catalog_stats(db)


@router.get("/admin/course-syllabuses/")
def admin_list_syllabuses(
    request: Request,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    rows = db.execute(
        select(CourseSyllabus).order_by(CourseSyllabus.sort_order, CourseSyllabus.subject_name)
    ).scalars().all()
    out = [_full_out(r).model_dump() for r in rows]
    return paginate(out, request, default_page_size=200, max_page_size=1000)


@router.post(
    "/admin/course-syllabuses/",
    response_model=CourseSyllabusFullOut,
    status_code=status.HTTP_201_CREATED,
)
def admin_create_syllabus(
    payload: CourseSyllabusUpsertRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> CourseSyllabusFullOut:
    if not (payload.subject_name or "").strip():
        raise HTTPException(status_code=400, detail="Fan nomi kerak.")

    code = payload.subject_code.strip() or _slugify_subject(payload.subject_name)
    base_code = code
    n = 1
    while db.execute(select(CourseSyllabus).where(CourseSyllabus.subject_code == code)).scalar_one_or_none():
        code = f"{base_code}-{n}"[:64]
        n += 1

    variants = [v.model_dump() for v in payload.variants]
    file_name = payload.file_name.strip() or f"{payload.subject_name.strip()}.pdf"
    topics = payload.topics
    if variants and not payload.file_name.strip():
        file_name = variants[0]["file_name"]
    if variants and not topics:
        topics = variants[0]["topics"]

    instr_lang = payload.instruction_language.strip().lower()
    if instr_lang not in ("uz", "en", "ru"):
        instr_lang = "uz"

    direction_code = normalize_direction_code(payload.direction_code)
    if not direction_code:
        direction_code = infer_direction_code(file_name) or infer_direction_code(
            payload.subject_name or ""
        )

    now = dt.datetime.now(dt.timezone.utc)
    obj = CourseSyllabus(
        subject_name=payload.subject_name.strip(),
        subject_code=code,
        department_id=payload.department_id,
        direction_code=direction_code,
        description=payload.description.strip()[:512],
        instruction_language=instr_lang,
        file_name=file_name,
        topics=topics,
        variants=variants,
        sort_order=payload.sort_order,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    _sync_legacy_fields(obj)
    db.add(obj)
    db.commit()
    db.refresh(obj)

    # Yangi sillabus DARHOL 3 tilga tarjima qilinadi — o'qituvchi til
    # almashtirganda kutib turmasin. Fonda bajariladi: tarjima xato bersa
    # ham sillabus yaratilgan bo'lib qolaveradi (keyin talab bo'yicha
    # /translate/ orqali to'ldiriladi).
    background.add_task(_translate_syllabus_bg, obj.id)

    return _full_out(obj)


def _translate_syllabus_bg(syllabus_id: int) -> None:
    """Fon vazifasi: o'z DB sessiyasini ochadi (so'rovniki yopilgan bo'ladi)."""
    from app.core.db import SessionLocal
    from app.services.syllabus_i18n import ensure_syllabus_translations

    db = SessionLocal()
    try:
        obj = db.get(CourseSyllabus, syllabus_id)
        if obj is not None:
            ensure_syllabus_translations(db, obj)
    except Exception:
        logger.warning("Sillabus %s tarjimasi bajarilmadi", syllabus_id, exc_info=True)
    finally:
        db.close()


@router.patch("/admin/course-syllabuses/{pk}/", response_model=CourseSyllabusFullOut)
def admin_update_syllabus(
    pk: int,
    payload: CourseSyllabusUpsertRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> CourseSyllabusFullOut:
    obj = db.get(CourseSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")

    data = payload.model_dump(exclude_unset=True)
    topics_changed = False
    if "subject_name" in data and data["subject_name"]:
        obj.subject_name = data["subject_name"].strip()
    if "description" in data:
        obj.description = (data.get("description") or "").strip()[:512]
    if "variants" in data:
        topics_changed = True
        incoming = data["variants"]
        if data.get("append_variants"):
            existing = list(obj.variants or [])
            existing_labels = {(v.get("label") or "").lower() for v in existing}
            for v in incoming:
                key = (v.get("label") or "").lower()
                if key in existing_labels:
                    existing = [x for x in existing if (x.get("label") or "").lower() != key]
                    existing_labels.discard(key)
                existing.append(v)
            obj.variants = existing
        else:
            obj.variants = incoming
        _sync_legacy_fields(obj)
    if "file_name" in data and data["file_name"]:
        obj.file_name = data["file_name"].strip()
    if "topics" in data:
        topics_changed = True
        obj.topics = data["topics"]
    if "sort_order" in data:
        obj.sort_order = int(data["sort_order"])
    if "is_active" in data:
        obj.is_active = bool(data["is_active"])
    if "department_id" in data:
        obj.department_id = data["department_id"]
    if "direction_code" in data:
        obj.direction_code = normalize_direction_code(data.get("direction_code"))
    if "instruction_language" in data:
        lang = (data.get("instruction_language") or "uz").strip().lower()
        if lang in ("uz", "en", "ru"):
            obj.instruction_language = lang
    if data.get("subject_code"):
        new_code = data["subject_code"].strip()[:64]
        if new_code != obj.subject_code:
            clash = db.execute(
                select(CourseSyllabus).where(CourseSyllabus.subject_code == new_code, CourseSyllabus.id != pk)
            ).scalar_one_or_none()
            if clash is None:
                obj.subject_code = new_code

    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(obj)

    # Yangi/qo'shilgan mavzular ham avto 3 tilga (uz-lotin, ru, en) tarjima qilinsin.
    if topics_changed:
        background.add_task(_translate_syllabus_bg, obj.id)

    return _full_out(obj)


@router.delete("/admin/course-syllabuses/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def admin_delete_syllabus(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> None:
    from sqlalchemy import delete as sa_delete, update
    from sqlalchemy.exc import IntegrityError

    from app.models.prepared_content import PreparedContent

    obj = db.get(CourseSyllabus, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")

    # Bog'liq yozuvlarni avval tozalash (Postgres FK da ON DELETE yo'q — RESTRICT).
    db.execute(sa_delete(StaffCourseSelection).where(StaffCourseSelection.syllabus_id == pk))
    db.execute(
        update(PreparedContent).where(PreparedContent.syllabus_id == pk).values(syllabus_id=None)
    )
    try:
        db.delete(obj)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Bu fanni o'chirib bo'lmadi — bog'liq ma'lumotlar mavjud.",
        ) from exc
