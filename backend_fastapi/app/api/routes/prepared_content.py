from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.models.content import CourseSyllabus, StaffCourseSelection
from app.models.prepared_content import PreparedContent
from app.schemas.prepared_content import (
    PreparedContentIn,
    PreparedContentLatestOut,
    PreparedContentOut,
    PreparedContentPayloadIn,
    PreparedContentSummaryOut,
)
from app.services import content_catalog as cc
from app.services import topic_norm as tn
from app.services.pagination import paginate

router = APIRouter()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")
# Ma'ruza matni va taqdimot — shu fan/mavzuni o'tadigan barcha o'qituvchilarga
# umumiy. Keys/test esa faqat muallifnikida qoladi.
SHARED_KINDS = frozenset({"lecture", "presentation"})


def _is_privileged(auth: AuthContext) -> bool:
    return auth.role in ("admin", "klinika_admin")


def _syllabus_id_from_norm(topic_norm: str) -> int | None:
    raw = cc.parse_topic_norm(topic_norm).get("syllabus_id") or ""
    if not raw:
        head = (topic_norm or "").split("::", 1)[0].strip()
        raw = head if head.isdigit() else ""
    try:
        sid = int(raw)
    except (TypeError, ValueError):
        return None
    return sid or None


def _taught_syllabus_ids(db: Session, auth: AuthContext) -> set[int]:
    rows = db.execute(
        select(StaffCourseSelection.syllabus_id).where(
            StaffCourseSelection.owner_key == auth.user.username
        )
    ).scalars().all()
    return {int(sid) for sid in rows if sid}


def _teaches_syllabus(db: Session, auth: AuthContext, syllabus_id: int | None) -> bool:
    if _is_privileged(auth):
        return True
    if not syllabus_id:
        return False
    return syllabus_id in _taught_syllabus_ids(db, auth)


def _can_view_item(item: PreparedContent, db: Session, auth: AuthContext) -> bool:
    if item.owner_key == auth.user.username:
        return True
    if item.kind not in SHARED_KINDS:
        return False
    if _is_privileged(auth):
        return True
    sid = item.syllabus_id or _syllabus_id_from_norm(item.topic_norm)
    return _teaches_syllabus(db, auth, sid)


def _can_delete_item(item: PreparedContent, auth: AuthContext) -> bool:
    return item.owner_key == auth.user.username or auth.role == "admin"


def _summary(item: PreparedContent, auth: AuthContext) -> dict:
    return PreparedContentSummaryOut(
        id=item.id,
        kind=item.kind,
        topic=item.topic,
        topic_norm=item.topic_norm,
        subject_name=item.subject_name,
        author_display_name=item.author_display_name or "",
        created_at=item.created_at,
        can_delete=_can_delete_item(item, auth),
    ).model_dump()


@router.get("/prepared-content/mine/")
def list_my_prepared_content(
    request: Request,
    kind: str,
    topic_norm: list[str] = Query(default=[]),
    shared: bool = Query(default=False),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    """Saqlangan yozuvlar ro'yxati.

    Standart: faqat joriy foydalanuvchiniki (keys/test).
    `shared=1` + `topic_norm`: ma'ruza/taqdimot — shu fan/mavzuni o'tadigan
    barcha o'qituvchilarniki (muallif filtri yo'q).
    """
    if not kind.strip():
        raise HTTPException(status_code=400, detail="kind majburiy.")
    kind_value = kind.strip()
    wanted = [t.strip().lower() for t in topic_norm if t and t.strip()]
    structured = [w for w in wanted if tn.is_structured_topic_norm(w)]
    wanted = structured or wanted

    if shared:
        if kind_value not in SHARED_KINDS:
            raise HTTPException(status_code=400, detail="shared faqat lecture/presentation uchun.")
        if not wanted:
            raise HTTPException(status_code=400, detail="shared=1 uchun topic_norm kerak.")
        stmt = select(PreparedContent).where(
            PreparedContent.kind == kind_value,
            PreparedContent.topic_norm.in_(wanted),
        )
        if not _is_privileged(auth):
            taught = _taught_syllabus_ids(db, auth)
            allowed = [w for w in wanted if _syllabus_id_from_norm(w) in taught]
            owner_or_shared = [PreparedContent.owner_key == auth.user.username]
            if allowed:
                owner_or_shared.append(PreparedContent.topic_norm.in_(allowed))
            stmt = stmt.where(or_(*owner_or_shared))
    else:
        stmt = select(PreparedContent).where(
            PreparedContent.owner_key == auth.user.username,
            PreparedContent.kind == kind_value,
        )
        if wanted:
            stmt = stmt.where(PreparedContent.topic_norm.in_(wanted))

    rows = db.execute(stmt.order_by(PreparedContent.created_at.desc())).scalars().all()
    out = [_summary(r, auth) for r in rows]
    return paginate(out, request, default_page_size=100, max_page_size=300)


@router.get("/prepared-content/{pk}/")
def get_prepared_content_by_id(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    """Bitta yozuvni to'liq payload bilan olish."""
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    return _out(item)


def _out(item: PreparedContent) -> PreparedContentOut:
    return PreparedContentOut(
        id=item.id,
        owner_key=item.owner_key,
        kind=item.kind,
        topic=item.topic,
        topic_norm=item.topic_norm,
        author_display_name=item.author_display_name,
        subject_name=item.subject_name,
        subject_code=item.subject_code,
        variant_label=item.variant_label,
        topic_code=item.topic_code,
        payload=item.payload,
        created_at=item.created_at,
    )


@router.get("/prepared-content/", response_model=PreparedContentLatestOut)
def get_latest_prepared_content(
    kind: str,
    topic_norm: str,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentLatestOut:
    if not kind.strip() or not topic_norm.strip():
        raise HTTPException(status_code=400, detail="kind, topic_norm are required.")
    kind_value = kind.strip()
    norm = topic_norm.strip().lower()
    stmt = select(PreparedContent).where(
        PreparedContent.kind == kind_value,
        PreparedContent.topic_norm == norm,
    )
    if kind_value not in SHARED_KINDS:
        stmt = stmt.where(PreparedContent.owner_key == auth.user.username)
    elif not _is_privileged(auth):
        sid = _syllabus_id_from_norm(norm)
        if not _teaches_syllabus(db, auth, sid):
            stmt = stmt.where(PreparedContent.owner_key == auth.user.username)
    item = db.execute(
        stmt.order_by(PreparedContent.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    if item is None:
        return PreparedContentLatestOut(payload=None)
    return PreparedContentLatestOut(payload=item.payload)


@router.post("/prepared-content/", response_model=PreparedContentOut, status_code=status.HTTP_201_CREATED)
def create_prepared_content(
    payload: PreparedContentIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    topic_norm = (payload.topic_norm or "").strip().lower() or payload.topic.lower()

    syllabus = None
    subject_name = payload.subject_name
    subject_code = payload.subject_code.strip()
    if subject_code:
        syllabus = db.execute(
            select(CourseSyllabus).where(CourseSyllabus.subject_code == subject_code)
        ).scalar_one_or_none()
        if syllabus:
            subject_name = syllabus.subject_name
            subject_code = subject_code or syllabus.subject_code

    variant_label = payload.variant_label.strip()
    topic_code = payload.topic_code.strip()
    if not variant_label or not topic_code:
        parsed = cc.parse_topic_norm(topic_norm)
        variant_label = variant_label or parsed.get("variant_label", "")
        topic_code = topic_code or parsed.get("topic_code", "")

    if topic_code:
        sid = syllabus.id if syllabus else 0
        if not sid:
            try:
                sid = int(cc.parse_topic_norm(topic_norm).get("syllabus_id") or 0)
            except ValueError:
                sid = 0
        if sid:
            rebuilt = tn.build_topic_norm(sid, variant_label, topic_code)
            if rebuilt:
                topic_norm = rebuilt

    obj = PreparedContent(
        owner_key=auth.user.username[:128],
        kind=payload.kind[:32],
        # DB ustunlari (Django bilan bir xil sxema) VARCHAR(255)/(128)/(64) —
        # mavzu nomlari juda uzun bo'lishi mumkin (masalan, ko'p qatorli
        # sarlavhalar), shuning uchun DB xatosiga olib kelmasligi uchun
        # kesib qo'yiladi (Django DRF ham xuddi shu max_length'larga
        # validatsiya qiladi).
        topic=payload.topic[:255],
        topic_norm=topic_norm[:255],
        # Muallif: frontend yubormasa ham, server foydalanuvchini biladi —
        # Baza ro'yxatida "kim yaratgan" doim ko'rinishi kerak.
        author_display_name=(
            payload.author_display_name.strip()
            or f"{auth.user.first_name} {auth.user.last_name}".strip()
            or auth.user.username
        )[:128],
        subject_name=subject_name[:255],
        subject_code=subject_code[:64],
        variant_label=variant_label[:128],
        topic_code=topic_code[:32],
        syllabus_id=(
            syllabus.id if syllabus else _syllabus_id_from_norm(topic_norm)
        ),
        payload=payload.payload,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _out(obj)


@router.patch("/prepared-content/{pk}/", response_model=PreparedContentOut)
def update_prepared_content_payload(
    pk: int,
    body: PreparedContentPayloadIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> PreparedContentOut:
    """Yozuvning payload'ini almashtirish.

    Keys/test — faqat egasi. Ma'ruza/taqdimot — shu fanni o'tadigan
    o'qituvchi ham tahrirlab saqlashi mumkin (hamma oxirgisini ko'radi).
    """
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    item.payload = body.payload
    db.commit()
    db.refresh(item)
    return _out(item)


@router.delete("/prepared-content/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_prepared_content(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> None:
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk)
    ).scalar_one_or_none()
    if item is None or not _can_view_item(item, db, auth):
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if not _can_delete_item(item, auth):
        raise HTTPException(status_code=403, detail="O'chirish uchun ruxsat yo'q.")
    db.delete(item)
    db.commit()
