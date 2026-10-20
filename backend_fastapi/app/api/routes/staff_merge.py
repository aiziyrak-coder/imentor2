"""Admin: o'qituvchilarni birlashtirish, xodim to'liq ma'lumoti, JSHSHIR holati."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.staff_login import normalize_staff_login
from app.models.content import StaffCourseSelection
from app.models.face_template import FaceTemplate
from app.models.person_identity import PersonIdentity
from app.models.prepared_content import PreparedContent
from app.models.staff_location import StaffProfile
from app.models.staff_merge_log import StaffMergeLog
from app.models.staff_pinfl import StaffPinfl
from app.models.user import User
from app.services import auth_service, staff_merge
from app.services import face_login as fl

router = APIRouter()


# ------------------------------------------------------------------ nomzodlar


def _account_out(a: staff_merge.AccountSummary) -> dict:
    return {
        "username": a.username,
        "first_name": a.first_name,
        "last_name": a.last_name,
        "display_name": f"{a.first_name} {a.last_name}".strip() or a.username,
        "department": a.department,
        "pinfl": a.pinfl,
        "last_login": a.last_login,
        "date_joined": a.date_joined,
        "activity": a.activity,
        "login_kind": "phone" if a.is_phone_login else "staff_id",
        "password_is_initial": a.password_is_initial,
        "has_password": a.has_password,
    }


@router.get("/admin/staff-merge/candidates/")
def merge_candidates(
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    groups = staff_merge.find_groups(db)
    return {
        "threshold": staff_merge.NAME_SIMILARITY,
        "groups": [
            {
                "accounts": [_account_out(a) for a in g.accounts],
                "primary": g.primary,
                "similarity": g.similarity,
                "blocked": g.blocked,
                "suggest_copy_password": g.suggest_copy_password,
            }
            for g in groups
        ],
    }


class MergeRequest(BaseModel):
    primary: str
    secondaries: list[str] = Field(min_length=1, max_length=10)
    copy_password: bool = False
    note: str = Field(default="", max_length=500)

    @field_validator("primary")
    @classmethod
    def _v_primary(cls, v: str) -> str:
        return normalize_staff_login(v)

    @field_validator("secondaries")
    @classmethod
    def _v_secondaries(cls, v: list[str]) -> list[str]:
        return [normalize_staff_login(x) for x in v]


@router.post("/admin/staff-merge/")
def merge_accounts(
    payload: MergeRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Admin tasdiqlagan birlashtirish. Nomzod ro'yxatiga qaramay, shartlar server tomonda qayta
    tekshiriladi (rol, faollik, JSHSHIR ziddiyati)."""
    try:
        results = staff_merge.merge(
            db,
            payload.primary,
            payload.secondaries,
            actor=auth.user.username,
            copy_password=payload.copy_password,
            note=payload.note.strip(),
        )
        db.commit()
    except staff_merge.MergeError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Birlashtirib bo'lmadi: bog'liq ma'lumotlar mos kelmadi. Hech narsa o'zgarmadi.",
        ) from exc
    return {"primary": payload.primary, "results": results}


@router.get("/admin/staff-merge/log/")
def merge_log(
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> list[dict]:
    rows = db.execute(select(StaffMergeLog).order_by(StaffMergeLog.merged_at.desc()).limit(200)).scalars().all()
    return [
        {
            "id": r.id,
            "primary": r.primary_key,
            "merged": r.merged_key,
            "merged_name": r.merged_name,
            "pinfl": r.pinfl,
            "moved": r.moved,
            "skipped_duplicates": r.skipped_duplicates,
            "actor": r.actor,
            "note": r.note,
            "merged_at": r.merged_at,
        }
        for r in rows
    ]


# ------------------------------------------------------------------ xodim to'liq ma'lumoti


def _mask_passport(series: str, number: str) -> str:
    return f"{series}{number}" if series or number else ""


@router.get("/admin/staff/{username}/detail/")
def staff_detail(
    username: str,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Bitta xodimning hamma ma'lumoti: hisob, profil, cam.fermi.uz dagi shaxsi, yuz, faollik, tarix."""
    login = normalize_staff_login(username)
    user = auth_service.get_user_by_username(db, login)
    if user is None:
        raise HTTPException(status_code=404, detail="Xodim topilmadi.")
    role = auth_service.resolve_user_role_from_db(db, user) or ""
    profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == login)).scalar_one_or_none()
    link = db.execute(
        select(StaffPinfl).where(StaffPinfl.owner_key == login, StaffPinfl.is_active.is_(True))
    ).scalar_one_or_none()

    identity = None
    if link is not None:
        identity = db.execute(
            select(PersonIdentity).where(PersonIdentity.pinfl == link.pinfl, PersonIdentity.is_active.is_(True))
        ).scalars().first()

    templates = db.execute(select(FaceTemplate).where(FaceTemplate.owner_key == login)).scalars().all()
    courses = db.execute(
        select(func.count()).select_from(StaffCourseSelection).where(StaffCourseSelection.owner_key == login)
    ).scalar_one()
    content = db.execute(
        select(func.count()).select_from(PreparedContent).where(PreparedContent.owner_key == login)
    ).scalar_one()
    history = db.execute(
        select(StaffMergeLog)
        .where((StaffMergeLog.primary_key == login) | (StaffMergeLog.merged_key == login))
        .order_by(StaffMergeLog.merged_at.desc())
    ).scalars().all()

    # Shu odamga o'xshash boshqa hisoblar (nomzod bo'lsa).
    duplicates = []
    if role == staff_merge.ROLE and user.is_active:
        for g in staff_merge.find_groups(db):
            if login in {a.username for a in g.accounts}:
                duplicates = [_account_out(a) for a in g.accounts if a.username != login]
                break

    return {
        "account": {
            "username": user.username,
            "login_kind": "phone" if fl._is_phone_login(user.username) else "staff_id",
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": role,
            "is_active": user.is_active,
            "date_joined": user.date_joined,
            "last_login": user.last_login,
            "password_is_initial": user.last_login is None and bool(user.password) and not user.password.startswith("!"),
        },
        "profile": None
        if profile is None
        else {
            "faculty": profile.faculty,
            "department": profile.department,
            "department_id": profile.department_id,
            "direction": profile.direction,
            "job_title": profile.job_title,
            "participant_kind": profile.participant_kind,
            "hemis_status": profile.hemis_status,
            "has_photo": bool(profile.photo),
        },
        "pinfl": None
        if link is None
        else {"pinfl": link.pinfl, "source": link.link_source, "full_name": link.full_name, "synced_at": link.synced_at},
        "cam_fermi": None
        if identity is None
        else {
            "full_name": identity.full_name,
            "passport": _mask_passport(identity.passport_series, identity.passport_number),
            "hemis_id": identity.hemis_id,
            "kind": identity.kind,
            "synced_at": identity.synced_at,
        },
        "face": {
            "templates": len(templates),
            "positions": sorted({t.position for t in templates if t.position}),
        },
        "activity": {"courses": int(courses), "prepared_content": int(content)},
        "merge_history": [
            {
                "primary": h.primary_key,
                "merged": h.merged_key,
                "moved": h.moved,
                "actor": h.actor,
                "merged_at": h.merged_at,
            }
            for h in history
        ],
        "duplicates": duplicates,
    }


# ------------------------------------------------------------------ JSHSHIR holati


@router.get("/admin/staff-pinfl/status/")
def pinfl_status(
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """cam.fermi.uz dan kelgan JSHSHIRlar va o'qituvchi hisoblari qamrovi."""
    active = db.execute(select(func.count()).select_from(StaffPinfl).where(StaffPinfl.is_active.is_(True))).scalar_one()
    linked = db.execute(
        select(func.count()).select_from(StaffPinfl).where(StaffPinfl.is_active.is_(True), StaffPinfl.owner_key != "")
    ).scalar_one()
    last_sync = db.execute(select(func.max(StaffPinfl.synced_at))).scalar_one()
    cam_staff = db.execute(
        select(func.count()).select_from(PersonIdentity).where(
            PersonIdentity.kind == "xodim", PersonIdentity.is_active.is_(True)
        )
    ).scalar_one()
    cam_with_pinfl = db.execute(
        select(func.count()).select_from(PersonIdentity).where(
            PersonIdentity.kind == "xodim", PersonIdentity.is_active.is_(True), PersonIdentity.pinfl != ""
        )
    ).scalar_one()

    teachers = [
        u for u in db.execute(select(User).where(User.is_active.is_(True), User.is_superuser.is_(False))).scalars()
        if auth_service.resolve_user_role_from_db(db, u) == staff_merge.ROLE
    ]
    names = [u.username for u in teachers]
    with_pinfl = set(
        db.execute(
            select(StaffPinfl.owner_key).where(StaffPinfl.is_active.is_(True), StaffPinfl.owner_key.in_(names or [""]))
        ).scalars()
    )
    depts = dict(
        db.execute(
            select(StaffProfile.owner_key, StaffProfile.department).where(StaffProfile.owner_key.in_(names or [""]))
        ).all()
    )
    without = [
        {
            "username": u.username,
            "display_name": f"{u.first_name} {u.last_name}".strip() or u.username,
            "department": depts.get(u.username) or "",
            "last_login": u.last_login,
        }
        for u in teachers
        if u.username not in with_pinfl
    ]
    without.sort(key=lambda r: r["display_name"].lower())
    return {
        "pinfl_records": int(active),
        "pinfl_linked": int(linked),
        "pinfl_unlinked": int(active - linked),
        "cam_staff": int(cam_staff),
        "cam_staff_with_pinfl": int(cam_with_pinfl),
        "last_synced_at": last_sync,
        "teachers_total": len(teachers),
        "teachers_with_pinfl": len(teachers) - len(without),
        "teachers_without_pinfl": without,
    }
