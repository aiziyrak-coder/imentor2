from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from sqlalchemy.exc import IntegrityError

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.security import hash_password, verify_password
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.schemas.staff_admin import (
    AdminDeprovisionStaffRequest,
    AdminStaffListEntry,
    AdminStaffUpsertRequest,
    AvatarResponse,
    ChangePasswordRequest,
    MeOut,
)
from app.services import auth_service
from app.services import file_storage as storage
from app.services import staff_department as staff_dept
from app.services import staff_profile
from app.services.pagination import paginate

router = APIRouter()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")
ALL_ROLES = STAFF_ROLES + ("student",)


@router.get("/auth/me/", response_model=MeOut)
def me(db: Session = Depends(get_db), auth: AuthContext = Depends(require_roles(*ALL_ROLES))) -> MeOut:
    return MeOut(
        id=auth.user.id,
        username=auth.user.username,
        role=auth.role,
        first_name=auth.user.first_name or "",
        last_name=auth.user.last_name or "",
        photo_url=staff_profile.staff_photo_url_for_user(auth.user.username, db),
        student_id=auth.student_id,
    )


@router.post("/auth/change-password/")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    if not verify_password(payload.current_password, auth.user.password):
        raise HTTPException(status_code=400, detail="Joriy parol noto'g'ri.")
    auth.user.password = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@router.post("/auth/admin-provision-staff/", status_code=status.HTTP_200_OK)
def admin_provision_staff(
    payload: AdminStaffUpsertRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    username = payload.phone_digits
    user = auth_service.get_user_by_username(db, username)
    created = user is None

    if created and not payload.password.strip():
        raise HTTPException(status_code=400, detail="Yangi xodim uchun parol majburiy.")

    if created:
        user = auth_service.create_user(
            db, username, payload.password.strip(), payload.first_name.strip(), payload.last_name.strip()
        )
    else:
        if payload.password.strip():
            user.password = hash_password(payload.password.strip())
        user.first_name = payload.first_name.strip() or user.first_name
        user.last_name = payload.last_name.strip() or user.last_name

    role = payload.role
    if role == "admin" and username not in auth_service.demo_admin_phone_allowlist():
        role = "hodim"
    auth_service.set_user_role_group(db, user, role)

    # Profil maydonlari har doim yangilanadi (bo'sh = tozalash).
    profile_fields = {
        "faculty": (payload.faculty or "").strip(),
        "direction": (payload.direction or "").strip(),
        "participant_kind": (payload.participant_kind or "").strip(),
        "study_group": (payload.study_group or "").strip(),
        "job_title": (payload.job_title or "").strip(),
    }
    wants_dept = payload.department_id is not None or bool((payload.department or "").strip())
    profile = db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == username)
    ).scalar_one_or_none()
    if profile is None and (any(profile_fields.values()) or wants_dept):
        profile = StaffProfile(owner_key=username, updated_at=dt.datetime.now(dt.timezone.utc))
        db.add(profile)
        db.flush()
    if profile is not None:
        for field, value in profile_fields.items():
            setattr(profile, field, value)
        staff_dept.apply_staff_department(
            db,
            profile,
            department_id=payload.department_id,
            department_name=(payload.department or "").strip(),
        )
        profile.updated_at = dt.datetime.now(dt.timezone.utc)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Kafedra yoki xodim ma'lumotini saqlab bo'lmadi. Boshqa kafedra tanlab qayta urinib ko'ring.",
        ) from exc
    return {"username": username, "role": role, "created": created}


@router.post("/auth/admin-deprovision-staff/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def admin_deprovision_staff(
    payload: AdminDeprovisionStaffRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    if auth.user.username == payload.phone_digits:
        raise HTTPException(status_code=400, detail="O'zingizni o'chira olmaysiz.")
    user = auth_service.get_user_by_username(db, payload.phone_digits)
    if user is None:
        return
    if user.is_superuser:
        raise HTTPException(status_code=403, detail="Superuser o'chirib bo'lmaydi.")
    profile = db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == payload.phone_digits)
    ).scalar_one_or_none()
    if profile is not None:
        if profile.photo:
            storage.delete_file(profile.photo)
        db.delete(profile)
    # Guruh bog'lanishlarini avval tozalash (ba'zi DB'larda CASCADE yo'q bo'lishi mumkin)
    user.groups.clear()
    try:
        db.delete(user)
        db.commit()
    except Exception as exc:  # noqa: BLE001 — IntegrityError va boshqa FK xatolari
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Bu xodimni o'chirib bo'lmadi — bog'liq ma'lumotlar mavjud.",
        ) from exc


@router.post("/auth/me/avatar/", response_model=AvatarResponse)
async def upload_avatar(
    file: UploadFile,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> AvatarResponse:
    if not storage.validate_avatar_extension(file.filename or ""):
        raise HTTPException(status_code=400, detail="Faqat rasm (JPG, PNG, WEBP, GIF) yuklash mumkin.")
    content = await file.read()
    if not storage.verify_image_magic(content[:16]):
        raise HTTPException(status_code=400, detail="Fayl haqiqiy rasm emas.")
    if len(content) > storage.AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Rasm hajmi 2 MB dan oshmasligi kerak.")

    owner_key = auth.user.username
    profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == owner_key)).scalar_one_or_none()
    now = dt.datetime.now(dt.timezone.utc)
    if profile is None:
        profile = StaffProfile(owner_key=owner_key, updated_at=now)
        db.add(profile)
    elif profile.photo:
        storage.delete_file(profile.photo)

    rel_path = storage.avatar_relative_path(owner_key, file.filename or "avatar.jpg")
    storage.save_upload(rel_path, content)
    profile.photo = rel_path
    profile.updated_at = now
    db.commit()
    return AvatarResponse(photo_url=staff_profile.staff_photo_url_for_user(owner_key, db))


@router.delete("/auth/me/avatar/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_avatar(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> None:
    profile = db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == auth.user.username)
    ).scalar_one_or_none()
    if profile is not None and profile.photo:
        storage.delete_file(profile.photo)
        profile.photo = ""
        db.commit()


@router.get("/admin/staff/")
def admin_staff_list(
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    from app.models.user import Group, user_groups

    # Hodimlar boshqaruvi: faqat xodimlar (talaba emas).
    allowed_roles = ("admin", "klinika_admin", "hodim")
    users = db.execute(
        select(User)
        .join(user_groups, user_groups.c.user_id == User.id)
        .join(Group, Group.id == user_groups.c.group_id)
        .where(Group.name.in_(allowed_roles))
        .distinct()
        .order_by(User.date_joined.desc())
    ).scalars().all()

    profiles = {
        p.owner_key: p
        for p in db.execute(
            select(StaffProfile).where(StaffProfile.owner_key.in_([u.username for u in users] or [""]))
        ).scalars().all()
    }

    rows = []
    for u in users:
        role = auth_service.resolve_user_role_from_db(db, u) or ""
        if role not in allowed_roles:
            continue
        profile = profiles.get(u.username)
        rows.append(
            AdminStaffListEntry(
                phone_digits=u.username,
                phone_display=f"+{u.username}" if len(u.username) == 12 else u.username,
                first_name=u.first_name,
                last_name=u.last_name,
                display_name=f"{u.first_name} {u.last_name}".strip() or u.username,
                role=role,
                faculty=profile.faculty if profile else "",
                department=profile.department if profile else "",
                department_id=profile.department_id if profile else None,
                direction=profile.direction if profile else "",
                participant_kind=profile.participant_kind if profile else "",
                study_group=profile.study_group if profile else "",
                job_title=profile.job_title if profile else "",
                is_active=u.is_active,
                date_joined=u.date_joined,
                last_login=u.last_login,
            ).model_dump()
        )
    return paginate(rows, request, default_page_size=200, max_page_size=1000)
