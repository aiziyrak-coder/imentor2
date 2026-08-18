from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.core.throttling import throttle_login
from app.models.user import User
from app.schemas.auth import LocalLoginRequest, LoginResponse, TokenRefreshRequest, TokenRefreshResponse
from app.schemas.auth_extra import OnlineTestStudentLoginRequest
from app.services import auth_service
from app.services import online_test_client as otc
from app.services import staff_profile as sp

router = APIRouter()
settings = get_settings()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _login_response(
    db: Session,
    user: User,
    role: str,
    *,
    student_id: str | None = None,
    group_name: str | None = None,
) -> LoginResponse:
    extra = {"role": role}
    if student_id:
        extra["student_id"] = student_id
    access = create_access_token(user.id, extra)
    refresh = create_refresh_token(user.id, extra)
    return LoginResponse(
        access=access,
        refresh=refresh,
        role=role,
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        photo_url=sp.staff_photo_url_for_user(user.username, db),
        student_id=student_id,
        group_name=group_name,
    )


@router.post("/auth/local-login/", response_model=LoginResponse)
def local_login(
    payload: LocalLoginRequest,
    db: Session = Depends(get_db),
    _: None = Depends(throttle_login),
) -> LoginResponse:
    username = payload.phone_digits
    user = auth_service.get_user_by_username(db, username)

    if user is None:
        if not payload.register:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
        if not settings.django_allow_open_registration:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ro'yxatdan o'tish faqat administrator orqali mumkin.",
            )
        reg_role = "hodim"
        user = auth_service.create_user(
            db, username, payload.password, payload.first_name.strip(), payload.last_name.strip()
        )
        auth_service.set_user_role_group(db, user, reg_role)
        role = reg_role
        db.commit()
        db.refresh(user)
        return _login_response(db, user, role)

    if not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
    if payload.register:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu telefon raqam allaqachon ro'yxatdan o'tgan.")

    role = auth_service.resolve_login_role(db, user, payload.role)
    auth_service.touch_last_login(db, user)
    db.commit()
    return _login_response(db, user, role)


@router.post("/auth/token/refresh/", response_model=TokenRefreshResponse)
def token_refresh(payload: TokenRefreshRequest, db: Session = Depends(get_db)) -> TokenRefreshResponse:
    try:
        claims = decode_token(payload.refresh)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token yaroqsiz yoki muddati o'tgan.")
    if claims.get("token_type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token talab qilinadi.")

    user_id = claims.get("user_id")
    user = db.get(User, int(user_id)) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Foydalanuvchi topilmadi.")

    role = auth_service.resolve_user_role_from_db(db, user)
    jwt_role = str(claims.get("role") or "").strip().lower()
    if jwt_role not in ("admin", "klinika_admin", "hodim", "student"):
        jwt_role = ""
    extra: dict = {"role": role or jwt_role or "hodim"}
    student_id = auth_service.resolve_student_id(user, claims.get("student_id"))
    if student_id:
        extra["student_id"] = student_id

    return TokenRefreshResponse(
        access=create_access_token(user.id, extra),
        refresh=create_refresh_token(user.id, extra),
    )


@router.post("/auth/online-test-login/", response_model=LoginResponse)
def online_test_student_login(
    payload: OnlineTestStudentLoginRequest,
    db: Session = Depends(get_db),
    _: None = Depends(throttle_login),
) -> LoginResponse:
    student_id = (payload.id or payload.student_id or payload.username or "").strip()
    password = (payload.password or "").strip()
    if not student_id or not password:
        raise HTTPException(status_code=400, detail="Talaba ID va parol majburiy.")

    try:
        ot = otc.online_test_login(student_id, password)
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    user_info = ot["user"]
    first_name, last_name = otc.split_person_name(str(user_info.get("name") or ""))
    sid = str(user_info.get("id") or student_id).strip()
    username = f"ot_{sid}"[:150]

    user = auth_service.get_user_by_username(db, username)
    if user is None:
        user = auth_service.create_user(db, username, "", first_name, last_name)
        user.password = ""
    else:
        user.first_name = first_name
        user.last_name = last_name
    auth_service.set_user_role_group(db, user, "student")
    auth_service.touch_last_login(db, user)
    db.commit()
    db.refresh(user)

    group_name = str(user_info.get("group_name") or "").strip() or None
    return _login_response(db, user, "student", student_id=sid, group_name=group_name)


@router.get("/academic-catalog/")
def academic_catalog(auth: AuthContext = Depends(require_roles(*STAFF_ROLES, "student"))) -> dict:
    try:
        return otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/public/kafedralar/")
def public_kafedralar() -> list[dict]:
    """Ro'yxatdan o'tish formasi uchun kafedra ro'yxati — faqat nom/kod, talaba ma'lumotisiz."""
    try:
        catalog = otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError:
        return []
    rows: list[dict] = []
    for kafedra in catalog.get("kafedralar") or []:
        name = str(kafedra.get("name") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "id": kafedra.get("id"),
                "name": name,
                "code": kafedra.get("code"),
                "directions": [
                    str(d.get("name") or "").strip()
                    for d in (kafedra.get("directions") or [])
                    if str(d.get("name") or "").strip()
                ],
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows
