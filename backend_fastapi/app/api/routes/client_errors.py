"""Brauzer xatolari: sahifa yozadi, admin ko'radi (2026-09-24).

Yozish ochiq (kirmagan foydalanuvchida ham login sahifasi yiqilishi mumkin),
shuning uchun himoya: IP bo'yicha chegara, maydon uzunliklari kesiladi, bir
xil xato bitta qatorga yig'iladi va jadval hajmi cheklangan.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, bearer_scheme, require_roles
from app.core.db import get_db
from app.core.security import decode_token
from app.core.throttling import client_ip, enforce
from app.models.client_error import ClientErrorLog
from app.models.user import User

router = APIRouter()

# Bitta NAT ortidagi butun bino uchun ham yetarli, lekin to'ldirib tashlashga yo'l qo'ymaydi.
REPORT_RATE = "120/minute"
MAX_DISTINCT = 5000
MAX_USERS_KEPT = 20

# Bizga tegishli bo'lmagan yoki ma'nosiz xatolar.
_NOISE = re.compile(
    r"ResizeObserver loop|^Script error\.?$|chrome-extension://|moz-extension://|safari-extension://"
    r"|dynamically imported module|Importing a module script failed|ChunkLoadError"
    r"|AbortError|The user aborted a request|Load failed$|NetworkError when attempting",
    re.I,
)


class ClientErrorIn(BaseModel):
    message: str = ""
    source: str = ""
    stack: str = ""
    page: str = ""
    app_version: str = ""


def _clip(value: str, n: int) -> str:
    return (value or "").replace("\x00", "")[:n]


def _first_frame(stack: str) -> str:
    """Stack'ning birinchi o'zimizga tegishli qatori — qator/ustun raqamisiz emas, aniq joy."""
    for line in (stack or "").splitlines()[1:6]:
        line = line.strip()
        if "/assets/" in line or ".tsx" in line or ".ts" in line:
            return line
    return ""


def fingerprint(message: str, source: str, stack: str) -> str:
    # Xabardagi raqamlar (id, soniya) har xil bo'lsa ham bitta xato bitta qator bo'lsin.
    msg = re.sub(r"\d+", "#", message or "")[:300]
    where = source or _first_frame(stack)
    return hashlib.sha1(f"{msg}|{where}".encode("utf-8")).hexdigest()


def _username(credentials: HTTPAuthorizationCredentials | None, db: Session) -> str:
    if credentials is None:
        return ""
    try:
        payload = decode_token(credentials.credentials)
        user = db.get(User, int(payload.get("user_id") or 0))
        return user.username if user else ""
    except Exception:  # noqa: BLE001 — muddati o'tgan token ham xatoni yozishga to'sqinlik qilmasin
        return ""


@router.post("/client-errors/", status_code=204)
def report_client_error(
    body: ClientErrorIn,
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Response:
    enforce(f"throttle:client_errors:{client_ip(request)}", REPORT_RATE)
    message = _clip(body.message.strip(), 500)
    if not message or _NOISE.search(message) or _NOISE.search(body.source or ""):
        return Response(status_code=204)
    source = _clip(body.source, 300)
    stack = _clip(body.stack, 4000)
    fp = fingerprint(message, source, stack)
    username = _username(credentials, db)
    now = dt.datetime.now(dt.timezone.utc)

    row = db.execute(select(ClientErrorLog).where(ClientErrorLog.fingerprint == fp)).scalar_one_or_none()
    if row is None:
        if (db.execute(select(func.count(ClientErrorLog.id))).scalar() or 0) >= MAX_DISTINCT:
            return Response(status_code=204)
        row = ClientErrorLog(
            fingerprint=fp,
            message=message,
            source=source,
            stack=stack,
            page=_clip(body.page, 300),
            user_agent=_clip(request.headers.get("user-agent", ""), 300),
            username=username,
            app_version=_clip(body.app_version, 80),
            count=1,
            users=username,
            first_seen=now,
            last_seen=now,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # parallel so'rov shu xatoni hozirgina yozdi — hisob keyingisida
        return Response(status_code=204)

    row.count = (row.count or 0) + 1
    row.last_seen = now
    row.resolved_at = None  # hal qilingan xato yana chiqdi
    if body.app_version:
        row.app_version = _clip(body.app_version, 80)
    if username:
        users = [u for u in (row.users or "").split(",") if u]
        if username not in users:
            users = (users + [username])[-MAX_USERS_KEPT:]
            row.users = ",".join(users)[:2600]
        row.username = username
    db.commit()
    return Response(status_code=204)


def _row(r: ClientErrorLog) -> dict:
    users = [u for u in (r.users or "").split(",") if u]
    return {
        "id": r.id,
        "message": r.message,
        "source": r.source,
        "stack": r.stack,
        "page": r.page,
        "user_agent": r.user_agent,
        "username": r.username,
        "users": users,
        "user_count": len(users),
        "app_version": r.app_version,
        "count": r.count,
        "first_seen": r.first_seen.isoformat() if r.first_seen else None,
        "last_seen": r.last_seen.isoformat() if r.last_seen else None,
        "resolved": r.resolved_at is not None,
    }


@router.get("/admin/client-errors/")
def list_client_errors(
    days: int = Query(default=7, ge=1, le=90),
    include_resolved: bool = False,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    q = select(ClientErrorLog).where(ClientErrorLog.last_seen >= since)
    if not include_resolved:
        q = q.where(ClientErrorLog.resolved_at.is_(None))
    rows = db.execute(q.order_by(ClientErrorLog.last_seen.desc()).limit(300)).scalars().all()
    return {
        "days": days,
        "items": [_row(r) for r in rows],
        "total_events": sum(r.count or 0 for r in rows),
    }


@router.post("/admin/client-errors/{pk}/resolve/")
def resolve_client_error(
    pk: int,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_roles("admin")),
) -> dict:
    row = db.get(ClientErrorLog, pk)
    if row is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    row.resolved_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return _row(row)
