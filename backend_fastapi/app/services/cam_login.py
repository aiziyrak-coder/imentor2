"""JSHSHIR bilan kirish: cam.fermi.uz tasdiqlagan xodimning iMentor hisobini topish yoki ochish.

Tartib (birinchi topilgani):
  1. JSHSHIR allaqachon hisobga bog'langan (`core_staffpinfl`) — o'sha hisob;
  2. cam.fermi.uz qaytargan HEMIS Xodim ID — shu loginli hisob;
  3. hech biri yo'q — yangi hisob: login = Xodim ID (bo'lmasa JSHSHIR), parolsiz,
     rol `hodim`, ism-familiya va lavozim cam.fermi.uz'dan, kafedra faqat mavjud
     kafedraga aniq mos kelsa (yangi kafedra yaratilmaydi).
Keyin JSHSHIR shu hisobga `link_source="cam"` bilan bog'lanadi.

Faqat `hodim` hisobiga kiritiladi: admin va klinika admini JSHSHIR bilan kira olmaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.staff_location import StaffProfile
from app.models.staff_pinfl import StaffPinfl
from app.models.user import User
from app.services import auth_service
from app.services import staff_department as staff_dept
from app.services import staff_pinfl

CAM_LOGIN_ROLE = "hodim"


class CamLoginRefused(Exception):
    """Hisob bor, lekin unga JSHSHIR bilan kirib bo'lmaydi (o'chirilgan yoki admin)."""


def _title(value: str) -> str:
    return " ".join(w[:1].upper() + w[1:].lower() for w in (value or "").split())


def _names(person: dict[str, str]) -> tuple[str, str]:
    first, last = person.get("first_name", ""), person.get("last_name", "")
    if not (first and last):
        parts = person.get("full_name", "").split()
        last, first = (parts + ["", ""])[:2] if len(parts) >= 2 else ("", "")
    return _title(first)[:150], _title(last)[:150]


def _existing_account(db: Session, pinfl: str, hemis_id: str) -> User | None:
    owner = staff_pinfl.owner_for(db, pinfl)
    if owner:
        user = auth_service.get_user_by_username(db, owner)
        if user is not None:
            return user
    if hemis_id:
        return auth_service.get_user_by_username(db, hemis_id)
    return None


def _new_username(db: Session, pinfl: str, hemis_id: str) -> str:
    for candidate in (hemis_id, pinfl):
        if candidate and auth_service.get_user_by_username(db, candidate) is None:
            return candidate
    raise CamLoginRefused("login band")


def _fill_profile(db: Session, username: str, person: dict[str, str]) -> None:
    """Faqat BO'SH maydonlar to'ldiriladi — admin yoki o'qituvchi yozgani o'zgarmaydi."""
    profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == username)).scalar_one_or_none()
    now = dt.datetime.now(dt.timezone.utc)
    if profile is None:
        profile = StaffProfile(owner_key=username, updated_at=now)
        db.add(profile)
        db.flush()
    if not profile.job_title and person.get("position"):
        profile.job_title = person["position"][:255]
    if not profile.department_id and person.get("department"):
        dept = staff_dept.resolve_department(db, department_name=person["department"])
        if dept is not None:
            staff_dept.apply_staff_department(db, profile, department_id=dept.id)
    profile.updated_at = now


def _link_pinfl(db: Session, pinfl: str, username: str, full_name: str) -> None:
    rec = db.get(StaffPinfl, pinfl)
    if rec is None:
        rec = StaffPinfl(pinfl=pinfl)
        db.add(rec)
    elif rec.link_source == "admin" and rec.owner_key and rec.owner_key != username:
        return  # admin qo'lda bog'lagan — tegilmaydi (1-qadamda o'sha hisob tanlangan bo'lardi)
    rec.owner_key = username
    rec.link_source = "cam"
    rec.full_name = (full_name or rec.full_name or "")[:255]
    rec.is_active = True
    rec.synced_at = dt.datetime.now(dt.timezone.utc)


def account_for(db: Session, pinfl: str, person: dict[str, str]) -> tuple[User, str, bool]:
    """(hisob, rol, yangi_ochildimi). Commit qilmaydi."""
    hemis_id = person.get("hemis_employee_id", "")
    hemis_id = hemis_id if hemis_id.isdigit() else ""
    user = _existing_account(db, pinfl, hemis_id)
    created = False
    if user is None:
        first, last = _names(person)
        user = auth_service.create_user(db, _new_username(db, pinfl, hemis_id), "", first, last)
        user.password = ""  # parolsiz: JSHSHIR, yuz yoki admin bergan parol bilan kiradi
        auth_service.set_user_role_group(db, user, CAM_LOGIN_ROLE)
        created = True
    role = auth_service.resolve_user_role_from_db(db, user) or ""
    if not user.is_active or role != CAM_LOGIN_ROLE:
        raise CamLoginRefused(role or "inactive")
    _fill_profile(db, user.username, person)
    _link_pinfl(db, pinfl, user.username, person.get("full_name", ""))
    return user, role, created
