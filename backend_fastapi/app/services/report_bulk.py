"""Hisobot ko'rsatkichlarini BARCHA o'qituvchi uchun birdan yig'adi.

── Muammo ───────────────────────────────────────────────────────────────
`build_teacher_report_rows` har bir o'qituvchi uchun alohida so'rov
yuborardi: faol daqiqa (uch oraliq), yaratilgan kontent (uch tur),
joylashuv (uch jadval) va profil. Institutda 646 ta hodim bor, ya'ni bir
hisobot ochilishi bazaga ~5000 ta so'rov yog'dirardi va 8 soniya davom
etardi. Shu vaqt davomida ulanish band turadi: ikki admin bir vaqtda
hisobot ochsa navbat hosil bo'lardi, uchinchisi esa kutib qolardi.

── Yechim ───────────────────────────────────────────────────────────────
Har bir ko'rsatkich uchun BITTA guruhlangan so'rov: natija
`owner_key → qiymat` lug'ati bo'lib qaytadi. O'qituvchilar soni endi
so'rovlar soniga ta'sir qilmaydi — 646 ta bo'ladimi, 6460 ta bo'ladimi,
so'rov soni o'zgarmaydi.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import UserActivityEvent, UserActivitySession
from app.models.live_test import LiveTestSession
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.models.staff_location import (
    StaffLocationAlert,
    StaffLocationPing,
    StaffProfile,
    StaffScheduleSlot,
)

TASHKENT_TZ = ZoneInfo("Asia/Tashkent")


def active_minutes_bulk(db: Session, start: dt.datetime, end: dt.datetime) -> dict[str, int]:
    """`owner_key` → oraliqdagi faol daqiqa.

    Avval zarbalar (`heartbeat`) yig'iladi. Zarba yozilmagan eski
    foydalanuvchilar uchun sessiya jadvalidagi daqiqa ishlatiladi —
    bittalab hisoblashdagi mantiq bilan bir xil.
    """
    out: dict[str, int] = {}
    rows = db.execute(
        select(
            UserActivityEvent.owner_key,
            func.coalesce(func.sum(UserActivityEvent.duration_sec), 0),
        )
        .where(
            UserActivityEvent.event_type == "heartbeat",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
        .group_by(UserActivityEvent.owner_key)
    )
    for owner, sec in rows:
        sec = int(sec or 0)
        if sec > 0:
            out[owner] = max(1, sec // 60)

    sess = db.execute(
        select(
            UserActivitySession.owner_key,
            func.coalesce(func.sum(UserActivitySession.active_minutes), 0),
        )
        .where(
            UserActivitySession.started_at >= start,
            UserActivitySession.started_at < end,
        )
        .group_by(UserActivitySession.owner_key)
    )
    for owner, minutes in sess:
        if owner not in out:
            out[owner] = int(minutes or 0)
    return out


def content_counts_bulk(
    db: Session, start: dt.datetime, end: dt.datetime
) -> dict[str, dict[str, int]]:
    """`owner_key` → {cases_created, tests_created, live_sessions}."""
    out: dict[str, dict[str, int]] = {}

    def slot(owner: str) -> dict[str, int]:
        return out.setdefault(
            owner, {"cases_created": 0, "tests_created": 0, "live_sessions": 0}
        )

    rows = db.execute(
        select(PreparedContent.owner_key, PreparedContent.kind, func.count())
        .where(
            PreparedContent.kind.in_((KIND_CASE, KIND_TEST)),
            PreparedContent.created_at >= start,
            PreparedContent.created_at < end,
        )
        .group_by(PreparedContent.owner_key, PreparedContent.kind)
    )
    for owner, kind, n in rows:
        key = "cases_created" if kind == KIND_CASE else "tests_created"
        slot(owner)[key] = int(n or 0)

    live = db.execute(
        select(LiveTestSession.owner_key, func.count())
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by(LiveTestSession.owner_key)
    )
    for owner, n in live:
        slot(owner)["live_sessions"] = int(n or 0)
    return out


def location_compliance_bulk(
    db: Session, start: dt.date, end: dt.date
) -> dict[str, dict[str, float | int]]:
    """`owner_key` → joylashuv intizomi ko'rsatkichlari."""
    out: dict[str, dict[str, float | int]] = {}

    def slot(owner: str) -> dict[str, float | int]:
        return out.setdefault(
            owner,
            {"alerts_count": 0, "pings_count": 0, "schedule_slots": 0, "in_geofence_pct": 0.0},
        )

    alerts = db.execute(
        select(StaffLocationAlert.owner_key, func.count())
        .where(StaffLocationAlert.alert_date >= start, StaffLocationAlert.alert_date <= end)
        .group_by(StaffLocationAlert.owner_key)
    )
    for owner, n in alerts:
        slot(owner)["alerts_count"] = int(n or 0)

    since = dt.datetime.combine(start, dt.time.min, tzinfo=TASHKENT_TZ)
    pings = db.execute(
        select(StaffLocationPing.owner_key, func.count())
        .where(StaffLocationPing.recorded_at >= since)
        .group_by(StaffLocationPing.owner_key)
    )
    for owner, n in pings:
        slot(owner)["pings_count"] = int(n or 0)

    slots = db.execute(
        select(StaffScheduleSlot.owner_key, func.count())
        .where(StaffScheduleSlot.is_active.is_(True))
        .group_by(StaffScheduleSlot.owner_key)
    )
    for owner, n in slots:
        slot(owner)["schedule_slots"] = int(n or 0)

    for values in out.values():
        alert_n = int(values["alerts_count"])
        ping_n = int(values["pings_count"])
        # Bittalab hisoblashdagi formulaning aynan o'zi.
        in_pct = (
            100.0
            if ping_n > 0 and alert_n == 0
            else (max(0.0, 100.0 - alert_n * 10.0) if ping_n else 0.0)
        )
        values["in_geofence_pct"] = round(min(100.0, in_pct), 1)
    return out


def departments_bulk(db: Session) -> dict[str, str]:
    """`owner_key` → kafedra nomi."""
    rows = db.execute(select(StaffProfile.owner_key, StaffProfile.department))
    return {owner: (dept or "") for owner, dept in rows}


EMPTY_CONTENT: dict[str, int] = {"cases_created": 0, "tests_created": 0, "live_sessions": 0}
EMPTY_LOCATION: dict[str, float | int] = {
    "alerts_count": 0,
    "pings_count": 0,
    "schedule_slots": 0,
    "in_geofence_pct": 0.0,
}
