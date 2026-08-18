from __future__ import annotations

import datetime as dt
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import Group, User

ALLOWED_ROLES = ("admin", "hodim")
# Guruh sifatida saqlanadigan barcha rollar (Django ALLOWED_ROLES bilan bir xil —
# STAFF_ROLES + student). LocalLogin faqat admin/hodim qabul qiladi,
# lekin klinika_admin/student rollari boshqa oqimlar orqali (clinic-admin,
# online-test-login) tayinlanadi va shu ro'yxatda bo'lishi kerak.
ALL_GROUP_ROLES = ("admin", "klinika_admin", "hodim", "student")
# Legacy guruh — yangi tayinlash yo'q; faqat tozalash / resolve fallback uchun.
_LEGACY_GROUP_ROLES = ("startuper",)


def demo_admin_phone_allowlist() -> frozenset[str]:
    raw = os.environ.get("DEMO_ADMIN_PHONES", "998901110001")
    return frozenset(
        "".join(ch for ch in part if ch.isdigit())
        for part in raw.split(",")
        if part.strip()
    )


def resolve_user_role_from_db(db: Session, user: User) -> str | None:
    if user.is_superuser:
        return "admin"
    group_names = {g.name.lower() for g in user.groups}
    for role in ALLOWED_ROLES + ("klinika_admin", "student"):
        if role in group_names:
            return role
    # Eski startuper guruhini hodim deb hisoblaymiz.
    if "startuper" in group_names:
        return "hodim"
    return None


def set_user_role_group(db: Session, user: User, role: str) -> None:
    role = (role or "").strip().lower()
    if role not in ALL_GROUP_ROLES:
        return
    for name in ALL_GROUP_ROLES + _LEGACY_GROUP_ROLES:
        group = db.execute(select(Group).where(Group.name == name)).scalar_one_or_none()
        if group is not None and group in user.groups:
            user.groups.remove(group)
    group = db.execute(select(Group).where(Group.name == role)).scalar_one_or_none()
    if group is None:
        group = Group(name=role)
        db.add(group)
        db.flush()
    user.groups.append(group)


def ensure_admin_group(db: Session, user: User) -> None:
    group = db.execute(select(Group).where(Group.name == "admin")).scalar_one_or_none()
    if group is None:
        group = Group(name="admin")
        db.add(group)
        db.flush()
    if group not in user.groups:
        user.groups.append(group)


def resolve_student_id(user: User, jwt_claim: str | None = None) -> str | None:
    """OnlineTest talaba ID — JWT claim yoki shadow username `ot_<id>`."""
    claim = str(jwt_claim or "").strip()
    if claim:
        return claim
    uname = str(user.username or "")
    if uname.startswith("ot_"):
        sid = uname[3:].strip()
        return sid or None
    return None


def resolve_login_role(db: Session, user: User, requested_role: str | None) -> str:
    """Login paytida rol — Django LocalLoginView bilan bir xil: DB guruhlari asosiy manba.

    Guruhni `hodim`ga o'zgartirmaydi. Aks holda admin/klinika_admin har kirishda
    (frontend role yubormaganda default `hodim`) huquqini yo'qotardi.
    """
    if user.is_superuser:
        return "admin"
    requested = (requested_role or "").strip().lower()
    if requested == "admin" and user.username in demo_admin_phone_allowlist():
        ensure_admin_group(db, user)
        return "admin"
    return resolve_user_role_from_db(db, user) or "hodim"


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def create_user(db: Session, username: str, password: str, first_name: str, last_name: str) -> User:
    user = User(
        username=username,
        password=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        is_superuser=False,
        is_staff=False,
        is_active=True,
        date_joined=dt.datetime.now(dt.timezone.utc),
    )
    db.add(user)
    db.flush()
    return user


def touch_last_login(db: Session, user: User) -> None:
    user.last_login = dt.datetime.now(dt.timezone.utc)
