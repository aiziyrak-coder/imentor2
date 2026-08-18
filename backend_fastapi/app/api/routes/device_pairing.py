from __future__ import annotations

import datetime as dt
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.throttling import throttle_login
from app.core.security import create_access_token, create_refresh_token
from app.models.device_pairing import DevicePairingSession
from app.schemas.device_pairing import DevicePairConfirmRequest, DevicePairCreateOut, DevicePairStatusOut

router = APIRouter()

PAIRING_TTL_MINUTES = 4

_SENSITIVE_PROFILE_KEYS = frozenset(
    {"password", "phoneDigits", "phone_digits", "access", "refresh", "token"}
)


def _sanitize_profile_snapshot(profile: dict) -> dict:
    safe: dict = {}
    for key, value in profile.items():
        if key in _SENSITIVE_PROFILE_KEYS:
            continue
        if key == "photoURL" and isinstance(value, str):
            trimmed = value.strip()
            if trimmed.startswith("data:") or len(trimmed) > 512:
                continue
        if isinstance(value, str) and len(value) > 4000:
            safe[key] = value[:4000]
        else:
            safe[key] = value
    return safe


def _expire_stale(db: Session) -> None:
    now = dt.datetime.now(dt.timezone.utc)
    stale = db.execute(
        select(DevicePairingSession).where(
            DevicePairingSession.status == "pending",
            DevicePairingSession.expires_at < now,
        )
    ).scalars().all()
    for row in stale:
        row.status = "expired"
    if stale:
        db.commit()


@router.post("/device-pair/create/", response_model=DevicePairCreateOut, status_code=201)
def device_pair_create(
    db: Session = Depends(get_db),
    _: None = Depends(throttle_login),
) -> DevicePairCreateOut:
    _expire_stale(db)
    token = secrets.token_urlsafe(24)
    desktop_secret = secrets.token_urlsafe(32)
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=PAIRING_TTL_MINUTES)
    obj = DevicePairingSession(
        pairing_token=token,
        desktop_secret=desktop_secret,
        status="pending",
        expires_at=expires,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    return DevicePairCreateOut(
        pairing_token=token,
        desktop_secret=desktop_secret,
        expires_at=expires,
        qr_payload=f"imentor-pair:{token}",
    )


@router.get("/device-pair/status/{pairing_token}/", response_model=DevicePairStatusOut)
def device_pair_status(
    pairing_token: str,
    secret: str = Query(default=""),
    x_desktop_secret: str = Header(default=""),
    db: Session = Depends(get_db),
) -> DevicePairStatusOut:
    _expire_stale(db)
    token = pairing_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token kerak.")
    obj = db.execute(
        select(DevicePairingSession).where(DevicePairingSession.pairing_token == token)
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")

    provided_secret = (secret or x_desktop_secret or "").strip()
    stored_secret = (obj.desktop_secret or "").strip()
    if stored_secret:
        if not provided_secret:
            raise HTTPException(status_code=403, detail="Desktop secret talab qilinadi.")
        if not secrets.compare_digest(stored_secret, provided_secret):
            raise HTTPException(status_code=403, detail="Desktop secret noto'g'ri.")

    now = dt.datetime.now(dt.timezone.utc)
    if obj.status == "pending" and obj.expires_at < now:
        obj.status = "expired"
        db.commit()

    if obj.status == "confirmed":
        payload = DevicePairStatusOut(
            status="confirmed",
            expires_at=obj.expires_at,
            access=obj.access_token,
            refresh=obj.refresh_token,
            role=obj.role,
            username=obj.owner_key,
            profile=obj.profile_snapshot,
        )
        obj.status = "picked_up"
        obj.picked_up_at = now
        obj.access_token = ""
        obj.refresh_token = ""
        obj.profile_snapshot = {}
        obj.desktop_secret = ""
        db.commit()
        return payload

    return DevicePairStatusOut(status=obj.status, expires_at=obj.expires_at)


@router.post("/device-pair/confirm/")
def device_pair_confirm(
    payload: DevicePairConfirmRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("hodim")),
) -> dict:
    _expire_stale(db)
    token = payload.pairing_token.strip()

    obj = db.execute(
        select(DevicePairingSession).where(DevicePairingSession.pairing_token == token).with_for_update()
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="QR kod eskirgan yoki noto'g'ri.")

    now = dt.datetime.now(dt.timezone.utc)
    if obj.expires_at < now or obj.status != "pending":
        raise HTTPException(status_code=400, detail="QR kod muddati tugagan. Kompyuterda yangilang.")

    role = auth.role
    extra = {"role": role}
    access = create_access_token(auth.user.id, extra)
    refresh = create_refresh_token(auth.user.id, extra)

    obj.status = "confirmed"
    obj.owner_key = auth.user.username
    obj.role = role
    obj.profile_snapshot = _sanitize_profile_snapshot(payload.profile)
    obj.access_token = access
    obj.refresh_token = refresh
    obj.confirmed_at = now
    db.commit()

    return {"status": "confirmed", "ok": True}
