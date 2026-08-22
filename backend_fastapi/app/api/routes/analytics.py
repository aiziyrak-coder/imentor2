from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth, require_roles
from app.core.db import get_db
from app.models.live_test import LiveTestSession
from app.schemas.analytics import ActivityEventsBatchIn, LiveTestEventsBatchIn
from app.services.analytics_service import attach_live_test_events, ip_hash, record_activity_event
from sqlalchemy import select

router = APIRouter()

AUTH_ROLES = ("admin", "klinika_admin", "hodim", "student")


@router.post("/analytics/events/")
def ingest_activity_events(
    payload: ActivityEventsBatchIn,
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_auth),
) -> dict:
    if auth.role not in AUTH_ROLES:
        raise HTTPException(status_code=403, detail="Ruxsat yo'q.")
    if not payload.events:
        return {"ok": True, "count": 0}

    owner = auth.user.username
    ip = request.client.host if request.client else ""
    count = 0
    for ev in payload.events[:50]:
        et = (ev.event_type or "").strip()
        if et not in ("heartbeat", "page_view", "live_test_opened", "content_view", "logout"):
            continue
        meta = dict(ev.meta or {})
        if payload.page:
            meta["page"] = payload.page[:256]
        meta["ip_hash"] = ip_hash(ip)
        record_activity_event(
            db,
            owner_key=owner,
            role=auth.role,
            event_type=et,
            duration_sec=ev.duration_sec,
            meta=meta,
        )
        count += 1
    db.commit()
    return {"ok": True, "count": count}


@router.post("/analytics/live-test-events/")
def ingest_live_test_events(
    payload: LiveTestEventsBatchIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("student")),
) -> dict:
    key = (payload.session_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="session_key kerak.")
    session = db.execute(select(LiveTestSession).where(LiveTestSession.session_key == key)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Sessiya topilmadi.")

    student_id = auth.student_id or ""
    if not student_id:
        raise HTTPException(status_code=403, detail="Talaba ID topilmadi.")

    events = [e.model_dump() for e in payload.events]
    count = attach_live_test_events(
        db,
        session_id=session.id,
        student_id=student_id,
        participant_key=(payload.participant_key or "").strip(),
        events=events,
    )
    db.commit()
    return {"ok": True, "count": count}
