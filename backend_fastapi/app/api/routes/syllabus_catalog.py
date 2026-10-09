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
from app.schemas.course_syllabus import (
    CourseSyllabusFullOut,
    CourseSyllabusUpsertRequest,
    OwnSyllabusCreateRequest,
    OwnSyllabusUpdateRequest,
)
from app.services.direction_code import infer_direction_code, normalize_direction_code
from app.services.pagination import paginate
from app.services.staff_department import normalize_department_name
from app.services import staff_department as staff_dept
from app.services import syllabus_access as access

router = APIRouter()

logger = logging.getLogger(__name__)

STAFF_ROLES = ("admin", "klinika_admin", "hodim")

# Bitta o'qituvchi Excel'dan yuklay oladigan faol shaxsiy fanlar chegarasi.
OWN_SYLLABUS_LIMIT = 40

_OWN_TYPE_PREFIX = {"lecture": "L", "practical": "A", "clinical": "K", "independent": "I", "lab": "B"}


# Fan ko'rinishi qoidasi `app/services/syllabus_access.py` da — tarqatma,
# taqdimot, video va tayyor kontent ham aynan shu qoidadan o'tadi.
_visible_to = access.visible_to


def _slugify_subject(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return (s or "fan")[:64]


def _valid_variants(obj: CourseSyllabus) -> list[dict]:
    return [v for v in (obj.variants or []) if isinstance(v, dict)]


def _sync_legacy_fields(obj: CourseSyllabus) -> None:
    variants = _valid_variants(obj)
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
        department_is_clinical=bool(obj.department.is_clinical) if obj.department else False,
        direction_code=obj.direction_code or "",
        description=obj.description,
        instruction_language=obj.instruction_language,
        file_name=obj.file_name,
        topics=obj.topics,
        variants=_valid_variants(obj),
        name_i18n=obj.name_i18n or {},
        topics_i18n=obj.topics_i18n or {},
        teacher_owned=bool(obj.created_by),
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
        is_own=bool(sel.syllabus.created_by) and sel.syllabus.created_by == sel.owner_key,
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
    username = auth.user.username
    out = []
    for obj in rows:
        if _topic_count(obj) > 0 and _visible_to(obj.allowed_owner_keys, username, auth.role):
            out.append(_full_out(obj).model_dump())
    return paginate(out, request, default_page_size=200, max_page_size=1000)


@router.post("/course-syllabuses/translate-names/")
def translate_syllabus_and_department_names(
    payload: dict,
    db: Session = Depends(get_db),
    auth=Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Fan va kafedra NOMLARINI interfeys tiliga o'giradi (mavzularsiz — arzon).

    Fan tanlash ro'yxati va sozlamalardagi kafedra ro'yxati shu bilan to'liq
    tarjima qilinadi: butun sillabusni (yuzlab mavzu) o'girish shart emas.
    Idempotent: tarjima bir marta bazaga yoziladi, keyingi so'rovlar AI'siz.

    Kutiladi: {"lang": "ru", "syllabus_ids": [1, 2], "departments": true}
    Qaytadi:  {"syllabi": {"1": "..."}, "departments": {"<asl nom>": "..."}}
    """
    from app.core.config import get_settings
    from app.services.syllabus_i18n import (
        SUPPORTED_LANGS,
        _BATCH,
        _translate_batch,
        looks_wrong_language,
    )

    lang = str(payload.get("lang") or "").strip().lower()
    if lang not in SUPPORTED_LANGS:
        raise HTTPException(status_code=400, detail="lang must be uz, ru or en.")
    raw_ids = payload.get("syllabus_ids") or []
    ids = [int(x) for x in raw_ids[:300] if str(x).strip().isdigit()] if isinstance(raw_ids, list) else []
    username = auth.user.username

    syllabi = []
    if ids:
        syllabi = [
            obj
            for obj in db.execute(select(CourseSyllabus).where(CourseSyllabus.id.in_(ids))).scalars().all()
            if _visible_to(obj.allowed_owner_keys, username, auth.role)
        ]
    departments = []
    if payload.get("departments"):
        departments = (
            db.execute(select(AcademicDepartment).where(AcademicDepartment.is_active.is_(True))).scalars().all()
        )

    def needs(name: str, i18n: dict | None, source: str) -> bool:
        if not (name or "").strip() or str((i18n or {}).get(lang) or "").strip():
            return False
        # Asl tilda bo'lsa tarjima kerak emas — lekin asl til xato belgilangan
        # bo'lishi mumkin, shuning uchun matnning o'zi ham tekshiriladi.
        return source != lang or looks_wrong_language(name, lang)

    todo_s = [r for r in syllabi if needs(r.subject_name, r.name_i18n, (r.instruction_language or "uz").lower())]
    todo_d = [d for d in departments if needs(d.name, d.name_i18n, "uz")]
    texts = list(dict.fromkeys([r.subject_name for r in todo_s] + [d.name for d in todo_d]))

    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    got: dict[str, str] = {}
    if api_key and texts:
        for i in range(0, len(texts), _BATCH):
            got.update(_translate_batch(api_key, settings.openai_fast_model, texts[i : i + _BATCH], lang))

    def apply(obj, name: str) -> None:
        value = str(got.get(name) or "").strip()
        if value and not looks_wrong_language(value, lang):
            obj.name_i18n = {**(obj.name_i18n or {}), lang: value}

    for r in todo_s:
        apply(r, r.subject_name)
    for d in todo_d:
        apply(d, d.name)
    if todo_s or todo_d:
        db.commit()

    def shown(name: str, i18n: dict | None, source: str) -> str | None:
        value = str((i18n or {}).get(lang) or "").strip()
        if value:
            return value
        return None if needs(name, i18n, source) else name

    return {
        "syllabi": {
            str(r.id): v
            for r in syllabi
            if (v := shown(r.subject_name, r.name_i18n, (r.instruction_language or "uz").lower())) is not None
        },
        "departments": {
            d.name: v for d in departments if (v := shown(d.name, d.name_i18n, "uz")) is not None
        },
    }


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
    if obj is None or not _visible_to(obj.allowed_owner_keys, auth.user.username, auth.role):
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
    topic_count = sum(len((v.get("topics") or [])) for v in _valid_variants(obj))
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
    if profile is not None and not profile.department_id and (profile.department or '').strip():
        staff_dept.apply_staff_department(db, profile, department_name=profile.department)
        db.commit()
        db.refresh(profile)
    if profile is None or not profile.department_id:
        # Registratsiya paytida kafedra ID yozilmay qolgan eski profillarni bloklamaymiz:
        # o'qituvchi qidiruv orqali fanini tanlay olsin.
        rows = (
            db.execute(
                select(CourseSyllabus)
                .where(CourseSyllabus.is_active.is_(True))
                .order_by(CourseSyllabus.department_id, CourseSyllabus.sort_order, CourseSyllabus.subject_name)
            )
            .scalars()
            .all()
        )
        out = [
            _full_out(obj).model_dump()
            for obj in rows
            if _topic_count(obj) > 0 and _visible_to(obj.allowed_owner_keys, auth.user.username, auth.role)
        ]
        return paginate(out, request, default_page_size=200, max_page_size=1000)

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

    # Kafedra dublikat yoki imlosi boshqacha yozilgan bo'lsa, fanlar bo'sh qolmasin.
    # Masalan xodim profili bir AcademicDepartment IDda, syllabuslar esa shu nomga
    # yaqin boshqa IDda turib qolishi mumkin.
    if not rows and (profile.department or '').strip():
        target = normalize_department_name(profile.department or '')
        all_rows = (
            db.execute(
                select(CourseSyllabus)
                .join(AcademicDepartment, CourseSyllabus.department_id == AcademicDepartment.id, isouter=True)
                .where(CourseSyllabus.is_active.is_(True))
                .order_by(CourseSyllabus.sort_order, CourseSyllabus.subject_name)
            )
            .scalars()
            .all()
        )
        rows = [
            obj for obj in all_rows
            if obj.department and normalize_department_name(obj.department.name) == target
        ]

    # Baribir topilmasa ham o'qituvchini to'xtatmaymiz: qidiruv orqali barcha
    # fanlardan tanlay oladi. Bu onboardingdagi "kafedrada fan yo'q" holatini yo'qotadi.
    if not rows:
        rows = (
            db.execute(
                select(CourseSyllabus)
                .where(CourseSyllabus.is_active.is_(True))
                .order_by(CourseSyllabus.department_id, CourseSyllabus.sort_order, CourseSyllabus.subject_name)
            )
            .scalars()
            .all()
        )

    # O'qituvchining Excel'dan o'zi yuklagan fanlari kafedrasidan qat'i nazar
    # doim ro'yxatda — kafedrasi aniqlanmagan (NULL) fan yo'qolib qolmasin.
    have = {obj.id for obj in rows}
    own = db.execute(
        select(CourseSyllabus).where(
            CourseSyllabus.created_by == auth.user.username,
            CourseSyllabus.is_active.is_(True),
        )
    ).scalars().all()
    rows = list(rows) + [obj for obj in own if obj.id not in have]

    out = [
        _full_out(obj).model_dump()
        for obj in rows
        if _topic_count(obj) > 0 and _visible_to(obj.allowed_owner_keys, auth.user.username, auth.role)
    ]
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
    # Ko'rish huquqi bo'lmagan (boshqaga cheklangan) fan ro'yxatga chiqmaydi —
    # aks holda uning id'si keyingi saqlashda qaytib kelib, butun ro'yxat rad etilardi.
    return [
        _selection_out(r)
        for r in rows
        if _visible_to(r.syllabus.allowed_owner_keys, auth.user.username, auth.role)
    ]


@router.put("/course-syllabuses/my/", response_model=list[StaffCourseSelectionOut])
def set_my_teaching_subjects(
    payload: SetMyTeachingSubjectsRequest,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> list[StaffCourseSelectionOut]:
    """O'qitadigan fanlar to'plamini almashtiradi.

    Bo'sh ro'yxat ham qabul qilinadi: fan tanlash majburiy emas — o'qituvchi
    tizimga fansiz kira oladi va keyin katalogdan tanlaydi yoki o'zi yuklaydi.
    """
    ids = sorted({int(x) for x in payload.syllabus_ids})
    if not ids:
        db.execute(delete(StaffCourseSelection).where(StaffCourseSelection.owner_key == auth.user.username))
        db.commit()
        return []

    profile = _staff_profile(db, auth.user.username)
    if profile is not None and not profile.department_id and (profile.department or '').strip():
        staff_dept.apply_staff_department(db, profile, department_name=profile.department)
        db.commit()
        db.refresh(profile)
    # Profil (kafedra) bo'lmasa ham fan tanlash to'xtatilmaydi: katalog butun
    # institutniki, o'qituvchi o'z fanini yuklagan bo'lishi ham mumkin.

    fans = (
        db.execute(
            select(CourseSyllabus).where(
                CourseSyllabus.id.in_(ids),
                CourseSyllabus.is_active.is_(True),
            )
        )
        .scalars()
        .all()
    )
    found = {f.id for f in fans}
    missing = [i for i in ids if i not in found]
    # Boshqa o'qituvchiga tegishli (cheklangan) fan id bilan ham tanlanmaydi.
    # Xabar "topilmadi" bilan bir xil — fan borligini oshkor qilmaydi.
    forbidden = [f.id for f in fans if not _visible_to(f.allowed_owner_keys, auth.user.username, auth.role)]
    if missing or forbidden:
        raise HTTPException(
            status_code=400,
            detail="Faqat o'z kafedrangizdagi faol fanlarni tanlash mumkin.",
        )

    owner = auth.user.username
    # Farq bo'yicha yangilanadi: ro'yxatda qolgan fanning MAVJUD qatorlari
    # (admin biriktirgan yo'nalish `variant_label` bilan) tegilmaydi. Ilgari
    # hammasi o'chirilib `variant_label=""` bilan qayta yozilardi — o'qituvchi
    # boshqa fan qo'shganda admin tanlagan yo'nalish jimgina yo'qolib, boshqa
    # yo'nalishning mavzulari va materiallari chiqib qolardi.
    existing = db.execute(
        select(StaffCourseSelection).where(StaffCourseSelection.owner_key == owner)
    ).scalars().all()
    have = {row.syllabus_id for row in existing}
    wanted = set(ids)
    for row in existing:
        if row.syllabus_id not in wanted:
            db.delete(row)
    now = dt.datetime.now(dt.timezone.utc)
    for sid in ids:
        if sid in have:
            continue
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


# ---------------- O'qituvchining o'zi yuklagan fanlari ----------------


def _own_topics(payload: OwnSyllabusCreateRequest | OwnSyllabusUpdateRequest) -> list[dict]:
    """Kodlar serverda qayta beriladi (L1, A1, I1 …) — brauzerdan kelganiga
    ishonmaymiz: takror yoki noto'g'ri kod materialni boshqa mavzuga ulab
    qo'yardi. Bir turdagi bir xil nom takrorlansa bittasi qoladi."""
    counters: dict[str, int] = {}
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    order = list(_OWN_TYPE_PREFIX)
    for t in sorted(payload.topics or [], key=lambda x: order.index(x.type)):
        title = " ".join(t.title.split())[:1000]
        key = (t.type, title.lower())
        if len(title) < 2 or key in seen:
            continue
        seen.add(key)
        counters[t.type] = counters.get(t.type, 0) + 1
        out.append({"id": f"{_OWN_TYPE_PREFIX[t.type]}{counters[t.type]}", "type": t.type, "title": title})
    return out


@router.post(
    "/course-syllabuses/own/",
    response_model=StaffCourseSelectionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_own_syllabus(
    payload: OwnSyllabusCreateRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> StaffCourseSelectionOut:
    """O'qituvchi namuna Excel'idan o'z fanini yaratadi.

    Fan faqat shu o'qituvchiga ko'rinadi (`allowed_owner_keys=[owner]`) va
    darhol uning "Mening fanlarim" ro'yxatiga qo'shiladi. Mavzu kodlari
    oddiy fanlardagidek (L1/A1/I1), shuning uchun tarqatma, taqdimot, video,
    ma'ruza va testlar hech qanday farqsiz shu mavzularga biriktiriladi.
    """
    owner = auth.user.username
    name = " ".join(payload.subject_name.split())[:255]
    topics = _own_topics(payload)
    if not topics:
        raise HTTPException(status_code=400, detail="Faylda mavzu topilmadi.")

    active_count = len(
        db.execute(
            select(CourseSyllabus.id).where(
                CourseSyllabus.created_by == owner, CourseSyllabus.is_active.is_(True)
            )
        ).all()
    )
    if active_count >= OWN_SYLLABUS_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Siz {OWN_SYLLABUS_LIMIT} tadan ortiq fan yuklay olmaysiz. Keraksizini o'chiring.",
        )

    # Bir xil nomdagi shaxsiy fan ikki marta yuklansa — nusxa ko'paymasin.
    duplicate = db.execute(
        select(CourseSyllabus.id).where(
            CourseSyllabus.created_by == owner,
            CourseSyllabus.is_active.is_(True),
            CourseSyllabus.subject_name == name,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(
            status_code=409,
            detail="Bu nomdagi fan sizda allaqachon bor. Nomini o'zgartiring yoki eskisini o'chiring.",
        )

    profile = _staff_profile(db, owner)
    if profile is not None and not profile.department_id and (profile.department or "").strip():
        staff_dept.apply_staff_department(db, profile, department_name=profile.department)
        db.flush()
    lang = (payload.instruction_language or "uz").strip().lower()
    if lang not in ("uz", "en", "ru"):
        lang = "uz"
    file_name = (payload.file_name or f"{name}.xlsx").strip()[:512]

    base = f"own-{owner}-{_slugify_subject(name)}"[:58]
    code, n = base, 1
    while db.execute(select(CourseSyllabus.id).where(CourseSyllabus.subject_code == code)).first():
        code = f"{base}-{n}"[:64]
        n += 1

    now = dt.datetime.now(dt.timezone.utc)
    obj = CourseSyllabus(
        subject_name=name,
        subject_code=code,
        department_id=profile.department_id if profile is not None else None,
        direction_code=infer_direction_code(name) or "",
        description="O'qituvchi o'zi yuklagan fan.",
        instruction_language=lang,
        file_name=file_name,
        topics=topics,
        variants=[{"label": "asosiy", "file_name": file_name, "topics": topics}],
        name_i18n={},
        topics_i18n={},
        allowed_owner_keys=[owner],
        created_by=owner,
        sort_order=0,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    _sync_legacy_fields(obj)
    db.add(obj)
    db.flush()
    sel = StaffCourseSelection(owner_key=owner, syllabus_id=obj.id, variant_label="", selected_at=now)
    db.add(sel)
    try:
        db.commit()
    except IntegrityError:
        # Ikki oynadan bir vaqtda yuklash: kod tekshiruvdan keyin band bo'ldi.
        db.rollback()
        raise HTTPException(status_code=409, detail="Fan hozirgina yaratildi. Sahifani yangilang.") from None
    db.refresh(sel)
    background.add_task(_translate_syllabus_bg, obj.id)
    logger.info("Shaxsiy fan yaratildi: #%s %r owner=%s mavzular=%s", obj.id, name, owner, len(topics))
    return _selection_out(sel)


def _norm_title(title: str) -> str:
    return " ".join((title or "").replace("’", "'").replace("‘", "'").split()).lower()


def _codes_with_materials(db: Session, sid: int) -> set[str]:
    """Qaysi mavzu kodlariga material biriktirilgan (tarqatma, taqdimot, video, tayyor kontent)."""
    from app.models.prepared_content import PreparedContent
    from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo

    codes: set[str] = set()
    for model in (TopicHandout, TopicPresentation, TopicVideo, PreparedContent):
        for norm in db.execute(
            select(model.topic_norm).where(model.topic_norm.like(f"{sid}::%"))
        ).scalars():
            parts = (norm or "").split("::")
            if len(parts) == 3 and parts[2]:
                codes.add(parts[2].lower())
    return codes


def _merge_own_topics(
    old: list[dict], new: list[dict], keep_codes: set[str], counters: dict | None = None
) -> tuple[list[dict], dict]:
    """Yangi Excel ro'yxatini eski mavzular bilan birlashtiradi — material yo'qolmasin.

    * Nomi (bir xil turda) mos kelgan mavzu ESKI kodini saqlaydi — unga
      yuklangan tarqatma/video/test o'z joyida qoladi.
    * Yangi mavzu shu turdagi eng katta raqamdan keyingi kodni oladi (eski
      kod qayta ishlatilmaydi — boshqa mavzuning materiali unga o'tib ketmasin).
    * Faylda yo'q, lekin materiali bor mavzu o'chirilmaydi — ro'yxat oxirida
      qoladi; materialsiz eski mavzu olib tashlanadi.
    """
    order = list(_OWN_TYPE_PREFIX)
    by_key = {(t.get("type"), _norm_title(t.get("title", ""))): t for t in old}
    # Oldin berilgan eng katta raqamlar (o'chirilgan mavzular ham) — kod qayta
    # berilmasin: brauzer keshida eski mavzuning ma'ruzasi yangi mavzuga chiqardi.
    max_num: dict[str, int] = {k: int(v) for k, v in (counters or {}).items() if str(v).isdigit()}
    for t in old:
        tid = str(t.get("id") or "")
        num = "".join(ch for ch in tid if ch.isdigit())
        if num:
            max_num[t.get("type")] = max(max_num.get(t.get("type"), 0), int(num))

    used: set[str] = set()
    merged: list[dict] = []
    added = 0
    for t in new:
        prev = by_key.get((t["type"], _norm_title(t["title"])))
        if prev is not None and str(prev.get("id")) not in used:
            item = {**prev, "title": t["title"]}
        else:
            max_num[t["type"]] = max_num.get(t["type"], 0) + 1
            item = {"id": f"{_OWN_TYPE_PREFIX[t['type']]}{max_num[t['type']]}", "type": t["type"], "title": t["title"]}
            added += 1
        used.add(str(item["id"]))
        merged.append(item)

    kept_with_material = 0
    removed = 0
    for t in old:
        if str(t.get("id")) in used:
            continue
        if str(t.get("id") or "").lower() in keep_codes:
            merged.append(dict(t))
            used.add(str(t.get("id")))
            kept_with_material += 1
        else:
            removed += 1
    merged.sort(key=lambda x: order.index(x.get("type")) if x.get("type") in order else len(order))
    stats = {
        "added": added,
        "removed": removed,
        "kept_with_material": kept_with_material,
        "total": len(merged),
        "counters": max_num,
    }
    return merged, stats


@router.patch("/course-syllabuses/own/{pk}/")
def update_own_syllabus(
    pk: int,
    payload: OwnSyllabusUpdateRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> dict:
    """O'qituvchi o'z fanini tahrirlaydi: nom, o'qitish tili, yangi Excel.

    Faqat o'zi yuklagan fanda. Yangi Excel eski mavzular bilan nomi bo'yicha
    birlashtiriladi (`_merge_own_topics`) — materiallar yo'qolmaydi.
    """
    owner = auth.user.username
    obj = db.get(CourseSyllabus, pk)
    if obj is None or not obj.created_by or obj.created_by != owner or not obj.is_active:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")

    stats: dict = {}
    topics_changed = False
    if payload.subject_name is not None:
        name = " ".join(payload.subject_name.split())[:255]
        clash = db.execute(
            select(CourseSyllabus.id).where(
                CourseSyllabus.created_by == owner,
                CourseSyllabus.is_active.is_(True),
                CourseSyllabus.subject_name == name,
                CourseSyllabus.id != pk,
            )
        ).first()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Bu nomdagi fan sizda allaqachon bor.")
        if name != obj.subject_name:
            obj.subject_name = name
            obj.name_i18n = {}
            topics_changed = True
    if payload.instruction_language is not None:
        lang = payload.instruction_language.strip().lower()
        if lang in ("uz", "en", "ru") and lang != obj.instruction_language:
            obj.instruction_language = lang
            topics_changed = True
    if payload.topics is not None:
        new_topics = _own_topics(payload)
        if not new_topics:
            raise HTTPException(status_code=400, detail="Faylda mavzu topilmadi.")
        variants = [dict(v) for v in _valid_variants(obj)] or [
            {"label": "asosiy", "file_name": obj.file_name, "topics": obj.topics or []}
        ]
        merged, stats = _merge_own_topics(
            list(variants[0].get("topics") or []),
            new_topics,
            _codes_with_materials(db, pk),
            variants[0].get("code_counters") or {},
        )
        counters = stats.pop("counters", {})
        file_name = (payload.file_name or variants[0].get("file_name") or obj.file_name or "").strip()[:512]
        variants[0] = {**variants[0], "topics": merged, "file_name": file_name, "code_counters": counters}
        obj.variants = variants
        _sync_legacy_fields(obj)
        topics_changed = True

    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(obj)
    if topics_changed:
        background.add_task(_translate_syllabus_bg, obj.id)
    return {"syllabus": _full_out(obj).model_dump(), "stats": stats}


@router.delete(
    "/course-syllabuses/own/{pk}/",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_own_syllabus(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("hodim")),
) -> None:
    """O'qituvchi o'zi yuklagan fanni o'chiradi.

    Fan bazadan o'chirilmaydi — faqat yashiriladi (`is_active=False`) va
    ro'yxatdan olinadi. Unga yuklangan tarqatma, video va testlar saqlanib
    qoladi: xato bosilgan bo'lsa admin qaytara oladi. Boshqaning fanini
    o'chirishga urinish "topilmadi" deb javob oladi.
    """
    owner = auth.user.username
    obj = db.get(CourseSyllabus, pk)
    if obj is None or not obj.created_by or obj.created_by != owner:
        raise HTTPException(status_code=404, detail="Fan topilmadi.")
    obj.is_active = False
    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    # Faqat egasining tanlovi. Boshqa (admin biriktirgan) qatorlar qoladi —
    # fan faol emasligi uchun ro'yxatlarda baribir ko'rinmaydi, qaytarilsa tiklanadi.
    db.execute(
        delete(StaffCourseSelection).where(
            StaffCourseSelection.syllabus_id == pk, StaffCourseSelection.owner_key == owner
        )
    )
    db.commit()


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
    # Cheklangan (o'qituvchining shaxsiy) fani ro'yxatda bo'lmagan xodimga
    # biriktirilmaydi: u fanni ko'rardi-yu, materiallari 404 berar va o'z
    # fanlar ro'yxatini saqlay olmay qolardi.
    if not _visible_to(syllabus.allowed_owner_keys, owner, "hodim"):
        raise HTTPException(
            status_code=400,
            detail="Bu fan boshqa o'qituvchiga tegishli (shaxsiy fan) — uni boshqaga biriktirib bo'lmaydi.",
        )

    available = [
        (v.get("label") or "").strip() for v in _valid_variants(syllabus) if (v.get("label") or "").strip()
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

    # O'qituvchi o'zi yuklagan fan bazadan o'chirilmaydi — yashiriladi.
    # Butunlay o'chirilsa uning tarqatma/video/taqdimot fayllari (ular fanga
    # faqat `topic_norm` orqali bog'langan) yetim qolib, `own-<telefon>` kodi
    # boshqa fanga qayta berilishi mumkin edi. Tanlovlar olinadi.
    if obj.created_by:
        obj.is_active = False
        obj.updated_at = dt.datetime.now(dt.timezone.utc)
        db.execute(delete(StaffCourseSelection).where(StaffCourseSelection.syllabus_id == pk))
        db.commit()
        return

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
