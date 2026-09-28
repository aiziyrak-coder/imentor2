from __future__ import annotations

import os

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import decode_token
from app.models.user import User
from app.services import auth_service
from app.services.dean_access import rector_context
from app.services import password_policy_service as pwd_policy

bearer_scheme = HTTPBearer(auto_error=False)

ALLOWED_ROLES = ("admin", "klinika_admin", "hodim", "student")

# Frontend shu matn orqali parol almashtirish oynasini ochadi.
PASSWORD_CHANGE_REQUIRED = "Avval parolingizni almashtiring."

# Rektor hisoboti tokenining belgisi. Bu token DB foydalanuvchisiga
# bog'lanmagan, shuning uchun boshqa hech qayerda ishlamaydi.
RECTOR_SCOPE = "rector-report"


class AuthContext:
    def __init__(
        self,
        user: User,
        role: str,
        student_id: str | None = None,
        group_name: str | None = None,
    ) -> None:
        self.user = user
        self.role = role
        self.student_id = student_id
        # Faqat talaba tokenida bo'ladi; qolganlarda None.
        self.group_name = group_name


NO_ROLE = "Hisobingizga rol berilmagan. Administratorga murojaat qiling."


def _authenticate(
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
    *,
    allow_pending_password: bool,
) -> AuthContext:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autentifikatsiya talab qilinadi.")
    try:
        payload = decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token yaroqsiz yoki muddati o'tgan.")

    if payload.get("token_type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token talab qilinadi.")

    user_id = payload.get("user_id")
    user = db.get(User, int(user_id)) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Foydalanuvchi topilmadi.")

    # Boshqa odam bergan parol (pasport, umumiy boshlang'ich parol) bilan
    # kirgan foydalanuvchi o'z parolini qo'ymaguncha faqat parolni
    # almashtira oladi. Baza faqat token belgili bo'lsa o'qiladi — qolgan
    # barcha so'rovlarga bu tekshiruv hech narsa qo'shmaydi.
    if (
        payload.get("mcp")
        and not allow_pending_password
        and pwd_policy.must_change(db, user.username)
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PASSWORD_CHANGE_REQUIRED)

    # Rol FAQAT bazadan (2026-09-26). Ilgari `db_role or jwt_role or "hodim"`
    # edi: foydalanuvchining barcha guruhlari olib tashlansa, eski tokendagi rol
    # (hatto "admin") ishlayverardi, rolsiz hisob esa o'qituvchi bo'lib kirardi.
    role = auth_service.resolve_user_role_from_db(db, user)
    if not role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_ROLE)
    student_id = auth_service.resolve_student_id(user, payload.get("student_id"))
    group_name = str(payload.get("group_name") or "").strip() or None
    return AuthContext(user=user, role=role, student_id=student_id, group_name=group_name)


def get_current_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    return _authenticate(credentials, db, allow_pending_password=False)


def get_auth_allow_pending_password(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    """Faqat parol almashtirish uchun: majburiy almashtirish kutilayotgan token ham o'tadi."""
    return _authenticate(credentials, db, allow_pending_password=True)


def require_rector(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> dict:
    """Rektor/dekan hisobotlari: maxsus parol tokeni yoki admin.

    Rektor tokenida haqiqiy foydalanuvchi yo'q — faqat `scope` da'vosi bor.
    Shu sababli u boshqa endpointlarga umuman yaramaydi: ular
    `get_current_auth` orqali mavjud foydalanuvchini talab qiladi.
    """
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Avval parolni kiriting.")
    try:
        payload = decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Seans muddati tugadi. Qaytadan kiring.")
    if payload.get("token_type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token talab qilinadi.")

    if payload.get("scope") == RECTOR_SCOPE:
        return rector_context(payload)

    # Admin ham shu sahifani ochib ko'rishi mumkin — alohida parol shart emas.
    try:
        user_id = int(payload.get("user_id") or 0)
    except (TypeError, ValueError):
        user_id = 0
    user = db.get(User, user_id) if user_id else None
    if user is not None and user.is_active:
        if auth_service.resolve_user_role_from_db(db, user) == "admin":
            return {"kind": "admin", "login": user.username, "label": "Admin", "departments": []}
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ruxsat yo'q.")


def require_roles(*roles: str):
    def _dep(auth: AuthContext = Depends(get_current_auth)) -> AuthContext:
        if auth.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ruxsat yo'q.")
        return auth

    return _dep


def external_api_keys() -> frozenset[str]:
    raw = os.environ.get("IMENTOR_EXTERNAL_API_KEYS") or os.environ.get("EXTERNAL_API_KEYS") or ""
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def require_external_api_key(x_api_key: str | None = Header(default=None)) -> None:
    keys = external_api_keys()
    header = (x_api_key or "").strip()
    if not keys or not header or header not in keys:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Valid X-Api-Key header required.")
