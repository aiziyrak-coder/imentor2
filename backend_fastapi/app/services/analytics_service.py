from __future__ import annotations

import datetime as dt
import hashlib
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import (
    AnalyticsRollupDaily,
    StudentTestAttempt,
    StudentTestAttemptEvent,
    UserActivityEvent,
    UserActivitySession,
)
from app.models.live_test import LiveTestSession, LiveTestSubmission
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.models.staff_location import StaffLocationAlert, StaffLocationPing, StaffProfile, StaffScheduleSlot
from app.models.user import User
from app.services import live_test_service as live_test_svc

TASHKENT_TZ = ZoneInfo("Asia/Tashkent")

TIER_INACTIVE = "inactive"
TIER_LOW = "low"
TIER_SUFFICIENT = "sufficient"
TIER_ACTIVE = "active"

HEARTBEAT_GAP_SEC = 90


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def now_local() -> dt.datetime:
    return dt.datetime.now(TASHKENT_TZ)


def academic_year_for(when: dt.datetime | None = None) -> str:
    local = (when or now_utc()).astimezone(TASHKENT_TZ)
    if local.month >= 9:
        return f"{local.year}-{local.year + 1}"
    return f"{local.year - 1}-{local.year}"


def activity_tier(active_minutes_month: int, active_minutes_30d: int) -> str:
    if active_minutes_30d <= 0:
        return TIER_INACTIVE
    if active_minutes_month < 60:
        return TIER_LOW
    if active_minutes_month <= 180:
        return TIER_SUFFICIENT
    return TIER_ACTIVE


def record_activity_event(
    db: Session,
    *,
    owner_key: str,
    role: str,
    event_type: str,
    duration_sec: int = 0,
    meta: dict | None = None,
    occurred_at: dt.datetime | None = None,
) -> UserActivityEvent:
    when = occurred_at or now_utc()
    row = UserActivityEvent(
        owner_key=owner_key,
        role=role,
        event_type=event_type,
        occurred_at=when,
        duration_sec=max(0, int(duration_sec)),
        meta=meta or {},
    )
    db.add(row)
    if event_type == "logout":
        open_sess = db.execute(
            select(UserActivitySession)
            .where(UserActivitySession.owner_key == owner_key, UserActivitySession.ended_at.is_(None))
            .order_by(UserActivitySession.started_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if open_sess is not None:
            open_sess.ended_at = when
    elif event_type in ("login", "heartbeat", "page_view"):
        _touch_session(db, owner_key=owner_key, role=role, when=when, duration_sec=duration_sec)
    return row


def _touch_session(db: Session, *, owner_key: str, role: str, when: dt.datetime, duration_sec: int) -> None:
    open_sess = db.execute(
        select(UserActivitySession)
        .where(UserActivitySession.owner_key == owner_key, UserActivitySession.ended_at.is_(None))
        .order_by(UserActivitySession.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if open_sess is None:
        db.add(
            UserActivitySession(
                owner_key=owner_key,
                role=role,
                source="web",
                started_at=when,
                ended_at=None,
                active_minutes=0,
            )
        )
        return

    gap = (when - (open_sess.ended_at or open_sess.started_at)).total_seconds()
    if gap > HEARTBEAT_GAP_SEC * 4:
        open_sess.ended_at = when
        db.add(
            UserActivitySession(
                owner_key=owner_key,
                role=role,
                source="web",
                started_at=when,
                ended_at=None,
                active_minutes=0,
            )
        )
        return

    if duration_sec > 0:
        open_sess.active_minutes += max(1, duration_sec // 60)
    open_sess.ended_at = when


def active_minutes_between(db: Session, owner_key: str, start: dt.datetime, end: dt.datetime) -> int:
    rows = db.execute(
        select(func.coalesce(func.sum(UserActivityEvent.duration_sec), 0)).where(
            UserActivityEvent.owner_key == owner_key,
            UserActivityEvent.event_type == "heartbeat",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
    ).scalar_one()
    sec = int(rows or 0)
    if sec > 0:
        return max(1, sec // 60)
    sess_rows = db.execute(
        select(func.coalesce(func.sum(UserActivitySession.active_minutes), 0)).where(
            UserActivitySession.owner_key == owner_key,
            UserActivitySession.started_at >= start,
            UserActivitySession.started_at < end,
        )
    ).scalar_one()
    return int(sess_rows or 0)


def create_student_attempt_from_submission(
    db: Session,
    *,
    session: LiveTestSession,
    submission: LiveTestSubmission,
    started_at: dt.datetime | None = None,
    duration_sec: int = 0,
) -> StudentTestAttempt | None:
    existing = db.execute(
        select(StudentTestAttempt).where(
            StudentTestAttempt.session_id == session.id,
            StudentTestAttempt.student_id == submission.student_id,
        )
    ).scalar_one_or_none()
    if existing:
        return existing

    payload = session.payload if isinstance(session.payload, dict) else {}
    questions = payload.get("questions", [])
    questions = questions if isinstance(questions, list) else []
    correct, total = live_test_svc.score_submission(questions, submission.answers)
    submitted = submission.submitted_at
    local_date = submitted.astimezone(TASHKENT_TZ).date()

    attempt = StudentTestAttempt(
        session_id=session.id,
        student_id=submission.student_id or "",
        participant_key=submission.participant_key or "",
        first_name=submission.first_name or "",
        last_name=submission.last_name or "",
        subject_code=session.subject_code or "",
        topic=str(payload.get("topic") or ""),
        topic_code=str(payload.get("topicCode") or payload.get("topic_code") or ""),
        variant_label=str(payload.get("variantLabel") or payload.get("variant_label") or ""),
        questions_snapshot=questions,
        answers_final=list(submission.answers or []),
        score=correct,
        total=total,
        started_at=started_at,
        submitted_at=submitted,
        duration_sec=max(0, int(duration_sec)),
        academic_year=academic_year_for(submitted),
        submitted_date=local_date,
    )
    db.add(attempt)
    db.flush()

    pending = db.execute(
        select(StudentTestAttemptEvent).where(
            StudentTestAttemptEvent.session_id == session.id,
            StudentTestAttemptEvent.student_id == submission.student_id,
            StudentTestAttemptEvent.attempt_id.is_(None),
        )
    ).scalars().all()
    for ev in pending:
        ev.attempt_id = attempt.id
    return attempt


def attach_live_test_events(
    db: Session,
    *,
    session_id: int,
    student_id: str,
    participant_key: str,
    events: list[dict],
) -> int:
    count = 0
    for raw in events[:200]:
        if not isinstance(raw, dict):
            continue
        et = str(raw.get("event_type") or "").strip()
        if not et:
            continue
        when_ms = raw.get("client_ts_ms")
        occurred = now_utc()
        if when_ms is not None:
            try:
                occurred = dt.datetime.fromtimestamp(int(when_ms) / 1000.0, tz=dt.timezone.utc)
            except (TypeError, ValueError, OSError):
                pass
        db.add(
            StudentTestAttemptEvent(
                attempt_id=None,
                session_id=session_id,
                student_id=student_id,
                participant_key=participant_key,
                event_type=et,
                question_index=raw.get("question_index"),
                option_index=raw.get("option_index"),
                occurred_at=occurred,
                client_ts_ms=when_ms,
                meta=raw.get("meta") if isinstance(raw.get("meta"), dict) else {},
            )
        )
        count += 1
    return count


def teacher_content_counts(db: Session, owner_key: str, start: dt.datetime, end: dt.datetime) -> dict[str, int]:
    cases = db.execute(
        select(func.count()).select_from(PreparedContent).where(
            PreparedContent.owner_key == owner_key,
            PreparedContent.kind == KIND_CASE,
            PreparedContent.created_at >= start,
            PreparedContent.created_at < end,
        )
    ).scalar_one()
    tests = db.execute(
        select(func.count()).select_from(PreparedContent).where(
            PreparedContent.owner_key == owner_key,
            PreparedContent.kind == KIND_TEST,
            PreparedContent.created_at >= start,
            PreparedContent.created_at < end,
        )
    ).scalar_one()
    live = db.execute(
        select(func.count()).select_from(LiveTestSession).where(
            LiveTestSession.owner_key == owner_key,
            LiveTestSession.created_at >= start,
            LiveTestSession.created_at < end,
        )
    ).scalar_one()
    return {"cases_created": int(cases or 0), "tests_created": int(tests or 0), "live_sessions": int(live or 0)}


def teacher_location_compliance(
    db: Session, owner_key: str, start: dt.date, end: dt.date
) -> dict[str, int | float]:
    alerts = db.execute(
        select(func.count()).select_from(StaffLocationAlert).where(
            StaffLocationAlert.owner_key == owner_key,
            StaffLocationAlert.alert_date >= start,
            StaffLocationAlert.alert_date <= end,
        )
    ).scalar_one()
    pings = db.execute(
        select(func.count()).select_from(StaffLocationPing).where(
            StaffLocationPing.owner_key == owner_key,
            StaffLocationPing.recorded_at >= dt.datetime.combine(start, dt.time.min, tzinfo=TASHKENT_TZ),
        )
    ).scalar_one()
    slots = db.execute(
        select(func.count()).select_from(StaffScheduleSlot).where(
            StaffScheduleSlot.owner_key == owner_key,
            StaffScheduleSlot.is_active.is_(True),
        )
    ).scalar_one()
    alert_n = int(alerts or 0)
    ping_n = int(pings or 0)
    in_pct = 100.0 if ping_n > 0 and alert_n == 0 else (max(0.0, 100.0 - alert_n * 10.0) if ping_n else 0.0)
    return {
        "alerts_count": alert_n,
        "pings_count": ping_n,
        "schedule_slots": int(slots or 0),
        "in_geofence_pct": round(min(100.0, in_pct), 1),
    }


def teacher_flags(content: dict[str, int]) -> list[str]:
    flags: list[str] = []
    if content.get("cases_created", 0) == 0:
        flags.append("no_cases")
    if content.get("tests_created", 0) == 0:
        flags.append("no_tests")
    if content.get("live_sessions", 0) == 0:
        flags.append("no_live_tests")
    return flags


def display_name_for_user(user: User | None, owner_key: str) -> str:
    if user is None:
        return owner_key
    parts = [user.first_name or "", user.last_name or ""]
    name = " ".join(p for p in parts if p).strip()
    return name or user.username or owner_key


def ip_hash(value: str | None) -> str:
    if not value:
        return ""
    return hashlib.sha256(value.encode()).hexdigest()[:16]
