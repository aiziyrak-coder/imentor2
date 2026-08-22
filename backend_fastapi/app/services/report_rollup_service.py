from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsRollupDaily
from app.models.staff_location import StaffProfile
from app.models.user import Group, User, user_groups
from app.services.analytics_service import (
    TASHKENT_TZ,
    active_minutes_between,
    activity_tier,
    now_utc,
    teacher_content_counts,
    teacher_flags,
    teacher_location_compliance,
)

PERIOD_DAY = "daily"
PERIOD_WEEK = "weekly"
PERIOD_MONTH = "monthly"
PERIOD_QUARTER = "quarterly"
PERIOD_YEAR = "yearly"


def period_bounds(period: str, anchor: dt.date | None = None) -> tuple[dt.datetime, dt.datetime, dt.date, dt.date]:
    local_today = (anchor or dt.datetime.now(TASHKENT_TZ).date())
    if period == PERIOD_DAY:
        start_d = local_today
        end_d = local_today
    elif period == PERIOD_WEEK:
        start_d = local_today - dt.timedelta(days=local_today.weekday())
        end_d = start_d + dt.timedelta(days=6)
    elif period == PERIOD_MONTH:
        start_d = local_today.replace(day=1)
        if start_d.month == 12:
            end_d = start_d.replace(year=start_d.year + 1, month=1, day=1) - dt.timedelta(days=1)
        else:
            end_d = start_d.replace(month=start_d.month + 1, day=1) - dt.timedelta(days=1)
    elif period == PERIOD_QUARTER:
        q = (local_today.month - 1) // 3
        start_d = local_today.replace(month=q * 3 + 1, day=1)
        end_m = start_d.month + 2
        end_d = (start_d.replace(month=end_m) + dt.timedelta(days=31)).replace(day=1) - dt.timedelta(days=1)
    elif period == PERIOD_YEAR:
        if local_today.month >= 9:
            start_d = dt.date(local_today.year, 9, 1)
            end_d = dt.date(local_today.year + 1, 8, 31)
        else:
            start_d = dt.date(local_today.year - 1, 9, 1)
            end_d = dt.date(local_today.year, 8, 31)
    else:
        start_d = local_today.replace(day=1)
        end_d = local_today

    start_dt = dt.datetime.combine(start_d, dt.time.min, tzinfo=TASHKENT_TZ).astimezone(dt.timezone.utc)
    end_dt = dt.datetime.combine(end_d + dt.timedelta(days=1), dt.time.min, tzinfo=TASHKENT_TZ).astimezone(
        dt.timezone.utc
    )
    return start_dt, end_dt, start_d, end_d


def list_hodim_users(db: Session) -> list[User]:
    hodim_group = db.execute(select(Group).where(Group.name == "hodim")).scalar_one_or_none()
    if hodim_group is None:
        return []
    return (
        db.execute(
            select(User)
            .join(user_groups, User.id == user_groups.c.user_id)
            .where(user_groups.c.group_id == hodim_group.id, User.is_active.is_(True))
        )
        .scalars()
        .all()
    )


def build_teacher_report_rows(db: Session, period: str, anchor: dt.date | None = None) -> list[dict]:
    start_dt, end_dt, start_d, end_d = period_bounds(period, anchor)
    month_start = dt.datetime.now(TASHKENT_TZ).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_start_utc = month_start.astimezone(dt.timezone.utc)
    days_30 = now_utc() - dt.timedelta(days=30)

    rows: list[dict] = []
    for user in list_hodim_users(db):
        owner = user.username
        active_period = active_minutes_between(db, owner, start_dt, end_dt)
        active_month = active_minutes_between(db, owner, month_start_utc, end_dt)
        active_30d = active_minutes_between(db, owner, days_30, end_dt)
        content = teacher_content_counts(db, owner, start_dt, end_dt)
        loc = teacher_location_compliance(db, owner, start_d, end_d)
        profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == owner)).scalar_one_or_none()
        tier = activity_tier(active_month, active_30d)
        flags = teacher_flags(content)
        if tier == "inactive":
            flags.append("inactive")
        rows.append(
            {
                "owner_key": owner,
                "display_name": " ".join(filter(None, [user.first_name, user.last_name])).strip() or owner,
                "department": (profile.department if profile else "") or "",
                "active_minutes_period": active_period,
                "active_minutes_month": active_month,
                "active_minutes_30d": active_30d,
                "tier": tier,
                "last_login": user.last_login.isoformat() if user.last_login else None,
                "cases_created": content["cases_created"],
                "tests_created": content["tests_created"],
                "live_sessions_count": content["live_sessions"],
                "in_geofence_pct": loc["in_geofence_pct"],
                "alerts_count": loc["alerts_count"],
                "pings_count": loc["pings_count"],
                "flags": flags,
            }
        )
    rows.sort(key=lambda r: (-r["active_minutes_period"], r["display_name"]))
    return rows


def teacher_report_facets(rows: list[dict]) -> dict:
    departments: dict[str, int] = {}
    tier_counts = {"inactive": 0, "low": 0, "sufficient": 0, "active": 0}
    flag_counts: dict[str, int] = {}
    for r in rows:
        dept = (r.get("department") or "").strip() or "—"
        departments[dept] = departments.get(dept, 0) + 1
        tier = r.get("tier") or "inactive"
        if tier in tier_counts:
            tier_counts[tier] += 1
        for f in r.get("flags") or []:
            flag_counts[f] = flag_counts.get(f, 0) + 1
    dept_list = sorted(
        [{"name": k, "count": v} for k, v in departments.items()],
        key=lambda x: (-x["count"], x["name"]),
    )
    return {
        "departments": dept_list,
        "tiers": tier_counts,
        "flags": flag_counts,
    }


def _row_is_risk(row: dict) -> bool:
    if row.get("tier") == "inactive":
        return True
    flags = set(row.get("flags") or [])
    if flags & {"no_cases", "no_tests", "no_live_tests"}:
        return True
    if float(row.get("in_geofence_pct") or 0) < 50:
        return True
    if int(row.get("alerts_count") or 0) > 0:
        return True
    return False


def _row_matches_search(row: dict, search: str) -> bool:
    q = (search or "").strip().lower()
    if not q:
        return True
    hay = " ".join(
        [
            str(row.get("display_name") or ""),
            str(row.get("owner_key") or ""),
            str(row.get("department") or ""),
        ]
    ).lower()
    return all(tok in hay for tok in q.split())


def filter_teacher_rows(
    rows: list[dict],
    *,
    search: str = "",
    department: str = "",
    tiers: list[str] | None = None,
    flags: list[str] | None = None,
    risk_only: bool = False,
    min_minutes: int | None = None,
    max_minutes: int | None = None,
    min_geofence: float | None = None,
    max_geofence: float | None = None,
    sort: str = "minutes_desc",
) -> list[dict]:
    tier_set = {t.strip().lower() for t in (tiers or []) if t.strip()}
    flag_set = {f.strip().lower() for f in (flags or []) if f.strip()}
    dept_filter = (department or "").strip()

    out: list[dict] = []
    for row in rows:
        if dept_filter and (row.get("department") or "").strip() != dept_filter:
            continue
        if tier_set and (row.get("tier") or "") not in tier_set:
            continue
        if flag_set and not flag_set.intersection({f.lower() for f in (row.get("flags") or [])}):
            continue
        if risk_only and not _row_is_risk(row):
            continue
        mins = int(row.get("active_minutes_period") or 0)
        if min_minutes is not None and mins < min_minutes:
            continue
        if max_minutes is not None and mins > max_minutes:
            continue
        geo = float(row.get("in_geofence_pct") or 0)
        if min_geofence is not None and geo < min_geofence:
            continue
        if max_geofence is not None and geo > max_geofence:
            continue
        if not _row_matches_search(row, search):
            continue
        out.append(row)

    if sort == "minutes_asc":
        out.sort(key=lambda r: (r.get("active_minutes_period") or 0, r.get("display_name") or ""))
    elif sort == "name":
        out.sort(key=lambda r: (r.get("display_name") or "").lower())
    elif sort == "geofence_asc":
        out.sort(key=lambda r: (float(r.get("in_geofence_pct") or 0), r.get("display_name") or ""))
    elif sort == "alerts_desc":
        out.sort(key=lambda r: (-int(r.get("alerts_count") or 0), r.get("display_name") or ""))
    elif sort == "risk_desc":
        out.sort(key=lambda r: (-len(r.get("flags") or []), -(0 if r.get("tier") != "inactive" else 1), r.get("display_name") or ""))
    else:
        out.sort(key=lambda r: (-(r.get("active_minutes_period") or 0), r.get("display_name") or ""))
    return out


def build_summary(db: Session, period: str, anchor: dt.date | None = None) -> dict:
    teachers = build_teacher_report_rows(db, period, anchor)
    tier_counts = {"inactive": 0, "low": 0, "sufficient": 0, "active": 0}
    for t in teachers:
        tier_counts[t["tier"]] = tier_counts.get(t["tier"], 0) + 1

    from app.models.analytics import StudentTestAttempt

    start_dt, end_dt, _, _ = period_bounds(period, anchor)
    attempts = db.execute(
        select(func.count()).select_from(StudentTestAttempt).where(
            StudentTestAttempt.submitted_at >= start_dt,
            StudentTestAttempt.submitted_at < end_dt,
        )
    ).scalar_one()
    avg_score = db.execute(
        select(func.avg(StudentTestAttempt.score * 100.0 / func.nullif(StudentTestAttempt.total, 0))).where(
            StudentTestAttempt.submitted_at >= start_dt,
            StudentTestAttempt.submitted_at < end_dt,
            StudentTestAttempt.total > 0,
        )
    ).scalar_one()

    return {
        "period": period,
        "teachers_total": len(teachers),
        "tier_counts": tier_counts,
        "student_attempts": int(attempts or 0),
        "avg_score_pct": round(float(avg_score or 0), 1),
        "teachers_without_cases": sum(1 for t in teachers if "no_cases" in t["flags"]),
        "teachers_without_tests": sum(1 for t in teachers if "no_tests" in t["flags"]),
        "teachers_inactive": tier_counts.get("inactive", 0),
    }


def rollup_day(db: Session, day: dt.date) -> int:
    start_dt = dt.datetime.combine(day, dt.time.min, tzinfo=TASHKENT_TZ).astimezone(dt.timezone.utc)
    end_dt = start_dt + dt.timedelta(days=1)
    written = 0
    for user in list_hodim_users(db):
        owner = user.username
        minutes = active_minutes_between(db, owner, start_dt, end_dt)
        content = teacher_content_counts(db, owner, start_dt, end_dt)
        loc = teacher_location_compliance(db, owner, day, day)
        metrics = {
            "active_minutes": minutes,
            **content,
            **loc,
            "tier": activity_tier(minutes, minutes),
        }
        row = db.execute(
            select(AnalyticsRollupDaily).where(
                AnalyticsRollupDaily.rollup_date == day,
                AnalyticsRollupDaily.scope == "teacher",
                AnalyticsRollupDaily.scope_key == owner,
            )
        ).scalar_one_or_none()
        if row is None:
            row = AnalyticsRollupDaily(
                rollup_date=day,
                scope="teacher",
                scope_key=owner,
                metrics=metrics,
                updated_at=now_utc(),
            )
            db.add(row)
        else:
            row.metrics = metrics
            row.updated_at = now_utc()
        written += 1
    db.commit()
    return written
