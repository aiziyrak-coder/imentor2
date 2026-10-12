from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_current_auth, require_roles
from app.core.db import get_db
from app.models.analytics import UserActivityEvent
from app.models.live_test import LiveTestSession
from app.schemas.analytics import ActivityEventsBatchIn, LiveTestEventsBatchIn
from app.services.analytics_service import attach_live_test_events, ip_hash, record_activity_event
from sqlalchemy import select

router = APIRouter()

AUTH_ROLES = ("admin", "klinika_admin", "hodim", "student")

#: Bitta hodisada yozilishi mumkin bo'lgan eng katta vaqt (15 daqiqa).
#:
#: Mijoz har daqiqada yuboradi, ya'ni haqiqiy qiymat ~60 dan oshmaydi.
#: Chegara ishonch uchun: usiz o'zgartirilgan mijoz "bugun 40 soat
#: ishladim" deb yozib qo'ya oladi va butun hisobot ma'nosini yo'qotadi.
#: Oshgani rad etilmaydi — qirqiladi, shunda qolgan vaqt saqlanib qoladi.
MAX_EVENT_SEC = 900

#: Navbatdan kechikib kelgan qayd ASL vaqtiga qaytariladi. Mijoz soatiga
#: ishonilmaydi (sinf kompyuterlarida soat ko'pincha noto'g'ri): mijoz
#: qayd paytini (`client_ts_ms`) ham, yuborish paytini (`sent_at_ms`) ham
#: O'Z soati bilan beradi — ularning farqi kechikish, u server soatidan
#: ayiriladi. Shunda kompyuter soati qancha xato bo'lmasin, natija to'g'ri.
MAX_DELAY = dt.timedelta(hours=24)


def _occurred_at(client_ts_ms: int | None, sent_at_ms: int | None, now: dt.datetime) -> dt.datetime:
    if not client_ts_ms or not sent_at_ms:
        return now
    delay = dt.timedelta(milliseconds=sent_at_ms - client_ts_ms)
    # Bir necha soniyalik kechikish — oddiy yuborish, vaqt o'zgartirilmaydi.
    if delay < dt.timedelta(seconds=30) or delay > MAX_DELAY:
        return now
    return now - delay


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
    now = dt.datetime.now(dt.timezone.utc)
    count = 0
    for ev in payload.events[:50]:
        et = (ev.event_type or "").strip()
        if et not in ("heartbeat", "page_view", "live_test_opened", "content_view", "logout"):
            continue
        when = _occurred_at(ev.client_ts_ms, payload.sent_at_ms, now)
        # Navbatdan qayta yuborilgan (javobi yo'lda yo'qolgan) qayd ikki marta
        # sanalmasin. Mijoz har qaydga noyob `meta.qid` beradi; qayta yuborilgani
        # doim kechikkan bo'ladi, shuning uchun faqat shundaylari tekshiriladi.
        qid = str((ev.meta or {}).get("qid") or "")[:64]
        if qid and when != now and db.execute(
            select(UserActivityEvent.id).where(
                UserActivityEvent.owner_key == owner,
                UserActivityEvent.event_type == et,
                UserActivityEvent.occurred_at >= now - MAX_DELAY - dt.timedelta(minutes=5),
                UserActivityEvent.meta["qid"].astext == qid,
            ).limit(1)
        ).first():
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
            duration_sec=min(max(0, ev.duration_sec), MAX_EVENT_SEC),
            meta=meta,
            occurred_at=when,
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
