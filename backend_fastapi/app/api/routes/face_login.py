"""Yuz orqali kirish va admin uchun "yuz <-> hisob" bog'lash."""

from __future__ import annotations

import datetime as dt
import logging

import requests
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.api.routes.auth import _login_response
from app.core.config import get_settings
from app.core.db import get_db
from app.core.throttling import client_ip, enforce
from app.models.face_template import FaceTemplate
from app.models.online_edu import MalakaListener
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.schemas.auth import LoginResponse
from app.services import auth_service
from app.services import face_login as fl
from app.services import password_policy_service as pwd_policy
from app.services.analytics_service import record_activity_event

logger = logging.getLogger("imentor.face_login")
router = APIRouter()

MAX_FRAME_BYTES = 2 * 1024 * 1024
# Institut kompyuterlari bitta NAT IP orqali chiqadi — ertalab ko'p o'qituvchi birdan kiradi.
FACE_LOGIN_RATE = "240/minute"


# Sinxron (def): face_api chaqiruvi 1-2 soniya bloklaydi — FastAPI uni threadpool'da
# bajaradi, event loop boshqa so'rovlarni kutib qolmaydi.
@router.post("/auth/face-login/", response_model=LoginResponse)
def face_login(
    request: Request,
    frames: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> LoginResponse:
    enforce(f"throttle:face_login:{client_ip(request)}", FACE_LOGIN_RATE)
    if not 2 <= len(frames) <= 3:
        raise HTTPException(status_code=422, detail="Ikki kadr yuborilishi kerak.")
    data: list[bytes] = []
    for frame in frames:
        chunk = frame.file.read(MAX_FRAME_BYTES + 1)
        if not chunk or len(chunk) > MAX_FRAME_BYTES:
            raise HTTPException(status_code=422, detail="Kadr bo'sh yoki juda katta.")
        data.append(chunk)

    settings = get_settings()
    try:
        decision = fl.identify(db, settings.face_api_url, data)
    except requests.RequestException:
        logger.exception("face_api bilan bog'lanib bo'lmadi")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Yuz orqali kirish hozir ishlamayapti. Login va parol bilan kiring.",
        )

    if decision.status == "no_face":
        raise HTTPException(
            status_code=422,
            detail="Kadrda yuz aniq ko'rinmadi. Kameraga yaqinroq, to'g'ri qarang va yorug' joyda turing.",
        )
    if decision.status == "unknown":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Yuz tanilmadi. Kameraga to'g'ri qarab qayta urining yoki login va parol bilan kiring.",
        )
    if decision.status == "unlinked":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "Yuzingiz tanildi, lekin iMentor hisobingizga hali bog'lanmagan. "
                "Administratorga ayting; hozircha login va parol bilan kiring."
            ),
        )

    tpl = db.get(FaceTemplate, decision.template_id) if decision.template_id else None
    if decision.owner_key.startswith("ot_"):
        return _student_face_login(db, decision.owner_key, tpl)
    listener = db.execute(
        select(MalakaListener).where(MalakaListener.username == decision.owner_key)
    ).scalar_one_or_none()
    if listener is not None:
        return _listener_face_login(db, listener)

    user = auth_service.get_user_by_username(db, decision.owner_key)
    role = auth_service.resolve_user_role_from_db(db, user) if user else None
    if user is None or not user.is_active or role not in fl.FACE_LOGIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu hisobga yuz orqali kirib bo'lmaydi. Login va parol bilan kiring.",
        )
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role=role, event_type="login", meta={"method": "face"})
    db.commit()
    return _login_response(db, user, role)


def _student_face_login(db: Session, owner_key: str, tpl: FaceTemplate | None) -> LoginResponse:
    """Talaba (OnlineTest ID): hisob `online-test-login` dagi bilan bir xil — `ot_<ID>`,
    birinchi kirishda yaratiladi. Guruh sinxronlashda OnlineTest'dan yozilgan."""
    sid = owner_key[3:]
    user = auth_service.get_user_by_username(db, owner_key)
    if user is None:
        first, last = fl.split_full_name(tpl.full_name if tpl else "")[::-1]
        user = auth_service.create_user(db, owner_key, "", first, last)
        user.password = ""
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu hisob o'chirilgan.")
    auth_service.set_user_role_group(db, user, "student")
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login", meta={"method": "face"})
    db.commit()
    db.refresh(user)
    group = (tpl.group_name if tpl else "") or None
    return _login_response(db, user, "student", student_id=sid, group_name=group)


def _listener_face_login(db: Session, listener: MalakaListener) -> LoginResponse:
    """Malaka tinglovchisi — `malaka-login` bilan bir xil token (guruh + parol almashtirish belgisi)."""
    user = auth_service.get_user_by_username(db, listener.username)
    if not listener.is_active or user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu hisob o'chirilgan.")
    group = listener.group
    if group is None or not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guruhingiz hali faollashtirilmagan. Fakultetga murojaat qiling.",
        )
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login", meta={"method": "face"})
    db.commit()
    return _login_response(
        db, user, "student", student_id=listener.username, group_name=group.name,
        must_change=pwd_policy.must_change(db, listener.username),
    )


# ------------------------------------------------------------------ admin


class FaceLinkOut(BaseModel):
    id: int
    full_name: str
    position: str
    owner_key: str
    owner_name: str
    owner_department: str
    link_source: str
    is_active: bool
    suggestions: list[dict] = []


class FaceLinkUpdate(BaseModel):
    owner_key: str = Field(default="", max_length=128)


def _staff_directory(db: Session) -> dict[str, dict]:
    users = fl._face_login_users(db)
    depts = {
        p.owner_key: p.department
        for p in db.execute(
            select(StaffProfile).where(StaffProfile.owner_key.in_([u.username for u in users] or [""]))
        ).scalars().all()
    }
    return {
        u.username: {
            "username": u.username,
            "name": f"{u.last_name} {u.first_name}".strip() or u.username,
            "department": depts.get(u.username, ""),
            "key": fl.name_key(u.last_name, u.first_name),
        }
        for u in users
    }


@router.get("/admin/face-links/", response_model=list[FaceLinkOut])
def list_face_links(
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> list[FaceLinkOut]:
    directory = _staff_directory(db)
    by_last: dict[str, list[dict]] = {}
    for entry in directory.values():
        by_last.setdefault(entry["key"][0], []).append(entry)
    out = []
    # Admin ro'yxati — faqat xodim yuzlari (talabalar sinxronlashda avtomatik bog'lanadi).
    tpls = db.execute(
        select(FaceTemplate).where(FaceTemplate.person_type != "talaba").order_by(FaceTemplate.full_name)
    ).scalars().all()
    for t in tpls:
        owner = directory.get(t.owner_key) if t.owner_key else None
        suggestions: list[dict] = []
        if not t.owner_key and t.is_active:
            last, first = fl.name_key(*fl.split_full_name(t.full_name))
            same_last = by_last.get(last, [])
            # Avval ismi ham mos keladiganlar, keyin faqat familiyasi.
            ranked = sorted(same_last, key=lambda e: (e["key"][1] != first, e["name"]))
            suggestions = [
                {"username": e["username"], "name": e["name"], "department": e["department"]}
                for e in ranked[:5]
            ]
        out.append(
            FaceLinkOut(
                id=t.id,
                full_name=t.full_name,
                position=t.position,
                owner_key=t.owner_key,
                owner_name=(owner["name"] if owner else ""),
                owner_department=(owner["department"] if owner else ""),
                link_source=t.link_source,
                is_active=t.is_active,
                suggestions=suggestions,
            )
        )
    return out


@router.put("/admin/face-links/{template_id}/", response_model=FaceLinkOut)
def update_face_link(
    template_id: int,
    payload: FaceLinkUpdate,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> FaceLinkOut:
    tpl = db.get(FaceTemplate, template_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail="Yuz topilmadi.")
    owner_key = payload.owner_key.strip()
    directory = _staff_directory(db)
    if owner_key:
        if owner_key not in directory:
            raise HTTPException(
                status_code=400,
                detail="Bu login faol o'qituvchi hisobi emas (admin hisobiga yuz bog'lanmaydi).",
            )
        # Bir hisobga bir necha yuz faqat BIR odamniki bo'lsa (cam.fermi.uz'da ikki marta
        # ro'yxatdan o'tgan). Boshqa odamning yuzi bog'lansa, u ham shu profilga kirardi.
        others = db.execute(
            select(FaceTemplate).where(FaceTemplate.owner_key == owner_key, FaceTemplate.id != tpl.id)
        ).scalars().all()
        other = next((o for o in others if fl.person_key(o.full_name) != fl.person_key(tpl.full_name)), None)
        if other is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Bu hisob allaqachon boshqa yuzga bog'langan: {other.full_name}.",
            )
    tpl.owner_key = owner_key
    # Admin bo'shatgan qatorni sinxronlash qayta avtomatik bog'lamasin.
    tpl.link_source = "admin"
    tpl.linked_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    fl.invalidate_cache()
    owner = directory.get(owner_key)
    return FaceLinkOut(
        id=tpl.id,
        full_name=tpl.full_name,
        position=tpl.position,
        owner_key=tpl.owner_key,
        owner_name=owner["name"] if owner else "",
        owner_department=owner["department"] if owner else "",
        link_source=tpl.link_source,
        is_active=tpl.is_active,
    )
