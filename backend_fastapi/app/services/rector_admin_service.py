"""Admin panelidagi hisobotlar — rektor sahifasi uchun.

Admin endpointlari `require_roles("admin")` bilan yopiq, rektor tokeni esa
DB foydalanuvchisiga bog'lanmagan — u ularga yaramaydi. Shuning uchun bu
yerda admin ekranlari tayangan XIZMATLAR qayta chaqiriladi: admin kodi bir
qator ham o'zgarmaydi, rektor esa o'sha raqamlarni ko'radi.

Qamrab olingani:
  * hozirgi GPS davomat ("darsda kim bor, kim yo'q") — `location_service`;
  * davr bo'yicha GPS ogohlantirishlari — `core_stafflocationalert`;
  * o'qituvchi xavf darajasi va bayroqlari — `report_rollup_service`;
  * fanlar kesimida test natijasi va o'tish foizi — `core_studenttestattempt`;
  * online guruhlar davomati va o'zlashtirishi — `online_*` jadvallari;
  * kontent bazasi hajmi — `content_catalog`, `external_catalog`.

Hammasi faqat O'QIYDI.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.live_test import LiveTestSession
from app.models.online_edu import (
    MalakaListener,
    OnlineAttendance,
    OnlineGroup,
    OnlineLesson,
    OnlineProgress,
)
from app.models.staff_location import StaffLocationAlert
from app.services import location_service, report_rollup_service
from app.services.activity_report_service import range_bounds
from app.services.content_catalog import build_catalog_stats
from app.services.external_catalog import build_syllabus_catalog_stats
from app.services.rector_report_service import _pct, staff_directory, student_key_expr

# O'tish chegarasi — institutning baho shkalasidagi "qoniqarli" boshlanishi.
PASS_PERCENT = 56

UNKNOWN = "—"


# ============================ GPS davomat ============================


def attendance_live(db: Session) -> dict:
    """Ayni daqiqadagi holat: jadval bo'yicha darsda bo'lishi kerak bo'lganlar.

    `get_live_teaching_status` admin "Jonli monitoring" ekrani bilan bir xil
    manba — rektor ko'rgan son admin ko'rgani bilan ustma-ust tushadi.
    """
    data = location_service.get_live_teaching_status(db)
    rows = data.get("royxat", []) or []

    departments: dict[str, dict] = {}
    for r in rows:
        name = (r.get("department") or "").strip() or UNKNOWN
        slot = departments.setdefault(name, {"department": name, "total": 0, "present": 0})
        slot["total"] += 1
        if r.get("present"):
            slot["present"] += 1
    dept_rows = []
    for slot in departments.values():
        slot["absent"] = slot["total"] - slot["present"]
        slot["percent"] = _pct(slot["present"], slot["total"])
        dept_rows.append(slot)
    dept_rows.sort(key=lambda d: (d["percent"] if d["percent"] is not None else 101, d["department"]))

    total = int(data.get("jami", 0) or 0)
    present = int(data.get("joyida", 0) or 0)
    return {
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "total": total,
        "present": present,
        "absent": int(data.get("joyida_emas", 0) or 0),
        "percent": _pct(present, total),
        "rows": rows,
        "departments": dept_rows,
    }


def attendance_alerts(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Davr bo'yicha "darsda belgilangan binoda bo'lmagan" ogohlantirishlari."""
    alerts = (
        db.execute(
            select(StaffLocationAlert)
            .where(
                StaffLocationAlert.alert_date >= start_day,
                StaffLocationAlert.alert_date <= end_day,
            )
            .order_by(StaffLocationAlert.created_at.desc())
        )
        .scalars()
        .all()
    )
    directory = staff_directory(db)

    by_day: Counter[str] = Counter()
    by_owner: dict[str, dict] = {}
    by_dept: Counter[str] = Counter()
    for a in alerts:
        by_day[a.alert_date.isoformat()] += 1
        info = directory.get(a.owner_key, {})
        dept = (info.get("department") or "").strip() or UNKNOWN
        by_dept[dept] += 1
        slot = by_owner.setdefault(
            a.owner_key,
            {
                "owner_key": a.owner_key,
                "display_name": info.get("display_name") or a.owner_key,
                "department": dept,
                "alerts": 0,
                "last_at": None,
                "buildings": set(),
            },
        )
        slot["alerts"] += 1
        if a.building_name:
            slot["buildings"].add(a.building_name)
        if slot["last_at"] is None or a.created_at > slot["last_at"]:
            slot["last_at"] = a.created_at

    teachers = []
    for slot in by_owner.values():
        slot["buildings"] = sorted(slot["buildings"])
        slot["last_at"] = slot["last_at"].isoformat() if slot["last_at"] else None
        teachers.append(slot)
    teachers.sort(key=lambda t: (-t["alerts"], t["display_name"].lower()))

    days = []
    cursor = start_day
    while cursor <= end_day:
        key = cursor.isoformat()
        days.append({"date": key, "alerts": by_day.get(key, 0)})
        cursor += dt.timedelta(days=1)

    recent = []
    for a in alerts[:200]:
        info = directory.get(a.owner_key, {})
        recent.append(
            {
                "display_name": info.get("display_name") or a.owner_key,
                "department": (info.get("department") or "").strip() or UNKNOWN,
                "building_name": a.building_name or UNKNOWN,
                "slot": (
                    f"{a.slot_start.strftime('%H:%M')}–{a.slot_end.strftime('%H:%M')}"
                    if a.slot_start and a.slot_end
                    else UNKNOWN
                ),
                "distance_m": round(a.distance_m) if a.distance_m is not None else None,
                "radius_m": round(a.radius_m) if a.radius_m is not None else None,
                "alert_date": a.alert_date.isoformat(),
                "created_at": a.created_at.isoformat(),
            }
        )

    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "total": len(alerts),
        "staff_affected": len(by_owner),
        "days": days,
        "departments": [
            {"department": name, "alerts": n} for name, n in by_dept.most_common()
        ],
        "teachers": teachers,
        "recent": recent,
    }


# ============================ Xavf darajasi ============================


def risk_report(
    db: Session, *, period: str, anchor: dt.date | None, department: str = ""
) -> dict:
    """Admin "Super AI hisobot"idagi darajalar va bayroqlar — o'sha xizmatdan.

    Daraja oylik faollikdan: `inactive` (30 kunda umuman kirmagan), `low`
    (oyda 60 daqiqadan kam), `sufficient` (180 gacha), `active`.
    """
    rows = report_rollup_service.build_teacher_report_rows(db, period, anchor)
    _start_dt, _end_dt, start_d, end_d = report_rollup_service.period_bounds(period, anchor)

    needle = (department or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in (r.get("department") or "").lower()]

    tiers = {"inactive": 0, "low": 0, "sufficient": 0, "active": 0}
    flags: Counter[str] = Counter()
    departments: dict[str, dict] = {}
    geo_values: list[float] = []

    for r in rows:
        tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1
        for flag in r["flags"]:
            flags[flag] += 1
        if r.get("pings_count"):
            geo_values.append(float(r["in_geofence_pct"]))

        name = (r.get("department") or "").strip() or UNKNOWN
        d = departments.setdefault(
            name,
            {
                "department": name,
                "teachers": 0,
                "inactive": 0,
                "low": 0,
                "no_cases": 0,
                "no_tests": 0,
                "alerts": 0,
                "_geo": [],
            },
        )
        d["teachers"] += 1
        if r["tier"] == "inactive":
            d["inactive"] += 1
        elif r["tier"] == "low":
            d["low"] += 1
        if "no_cases" in r["flags"]:
            d["no_cases"] += 1
        if "no_tests" in r["flags"]:
            d["no_tests"] += 1
        d["alerts"] += int(r.get("alerts_count") or 0)
        if r.get("pings_count"):
            d["_geo"].append(float(r["in_geofence_pct"]))

    dept_rows = []
    for d in departments.values():
        geo = d.pop("_geo")
        d["geofence_pct"] = round(sum(geo) / len(geo), 1) if geo else None
        d["at_risk_pct"] = _pct(d["inactive"] + d["low"], d["teachers"])
        dept_rows.append(d)
    dept_rows.sort(key=lambda d: (-(d["at_risk_pct"] or 0), d["department"]))

    return {
        "period": period,
        "from": start_d.isoformat(),
        "to": end_d.isoformat(),
        "total": len(rows),
        "tiers": tiers,
        "flags": dict(flags),
        "geofence_avg": round(sum(geo_values) / len(geo_values), 1) if geo_values else None,
        "geofence_tracked": len(geo_values),
        "departments": dept_rows,
        "rows": rows,
    }


# ============================ Fanlar kesimida natija ============================


def subjects_report(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Har fan bo'yicha: nechta talaba, o'rtacha natija, o'tish foizi.

    Manba — `core_studenttestattempt` (ball allaqachon hisoblangan arxiv),
    rektorning "Talabalar" bo'limi bilan bir xil. Admin ekranidagi kabi har
    topshiriqni qaytadan baholab chiqish shart emas.
    """
    passed = case(
        (
            and_(
                StudentTestAttempt.total > 0,
                StudentTestAttempt.score * 100 >= StudentTestAttempt.total * PASS_PERCENT,
            ),
            1,
        ),
        else_=0,
    )
    rows = db.execute(
        select(
            StudentTestAttempt.subject_code,
            func.count(StudentTestAttempt.id).label("attempts"),
            func.count(func.distinct(student_key_expr())).label("students"),
            func.count(func.distinct(StudentTestAttempt.session_id)).label("sessions"),
            func.count(func.distinct(LiveTestSession.owner_key)).label("teachers"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("total"),
            func.coalesce(func.sum(passed), 0).label("passed"),
        )
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id)
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .group_by(StudentTestAttempt.subject_code)
    ).all()

    codes = [r.subject_code for r in rows if r.subject_code]
    names: dict[str, tuple[str, int | None]] = {}
    if codes:
        for s in db.execute(
            select(CourseSyllabus.subject_code, CourseSyllabus.subject_name, CourseSyllabus.department_id)
            .where(CourseSyllabus.subject_code.in_(codes))
        ).all():
            names.setdefault(s.subject_code, (s.subject_name, s.department_id))
    dept_names = {d.id: d.name for d in db.execute(select(AcademicDepartment)).scalars()}

    out = []
    for r in rows:
        subject_name, dept_id = names.get(r.subject_code or "", ("", None))
        attempts = int(r.attempts or 0)
        passed_n = int(r.passed or 0)
        out.append(
            {
                "subject_code": r.subject_code or "",
                "subject_name": subject_name or ("Fan biriktirilmagan" if not r.subject_code else r.subject_code),
                "department": dept_names.get(dept_id, "") if dept_id else "",
                "attempts": attempts,
                "students": int(r.students or 0),
                "sessions": int(r.sessions or 0),
                "teachers": int(r.teachers or 0),
                "avg_percent": _pct(r.score, r.total),
                "pass_rate": _pct(passed_n, attempts),
                "failed": attempts - passed_n,
            }
        )
    out.sort(key=lambda x: (x["pass_rate"] if x["pass_rate"] is not None else 101, -x["attempts"]))

    total_attempts = sum(x["attempts"] for x in out)
    total_passed = sum(x["attempts"] - x["failed"] for x in out)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "pass_percent": PASS_PERCENT,
        "subjects": len(out),
        "attempts": total_attempts,
        "pass_rate": _pct(total_passed, total_attempts),
        "results": out,
    }


# ============================ Online guruhlar ============================


def online_groups(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Guruh kesimida online davomat va test natijasi — qaysi guruh orqada.

    Davomat foizi = darsga kirishlar / (o'tilgan darslar × guruh hajmi).
    Guruh hajmi malaka guruhlarida tinglovchilar ro'yxatidan, online
    guruhlarda esa iz qoldirgan talabalar sonidan olinadi (online ta'limda
    talabalar ro'yxati bizda saqlanmaydi) — shuning uchun u taxminiy.
    """
    start, end = range_bounds(start_day, end_day)
    groups = {g.id: g for g in db.execute(select(OnlineGroup)).scalars()}
    id_by_name = {g.name: g.id for g in groups.values()}

    held = {
        r.group_id: int(r.n or 0)
        for r in db.execute(
            select(OnlineLesson.group_id, func.count().label("n"))
            .where(OnlineLesson.started_at >= start, OnlineLesson.started_at < end)
            .group_by(OnlineLesson.group_id)
        ).all()
    }

    presence_key = func.concat(OnlineAttendance.lesson_id, ":", OnlineAttendance.student_id)
    attendance = {
        r.group_id: r
        for r in db.execute(
            select(
                OnlineLesson.group_id,
                func.count(func.distinct(presence_key)).label("presences"),
                func.count(func.distinct(OnlineAttendance.student_id)).label("students"),
                func.coalesce(func.sum(OnlineAttendance.total_seconds), 0).label("seconds"),
            )
            .join(OnlineLesson, OnlineLesson.id == OnlineAttendance.lesson_id)
            .where(OnlineAttendance.joined_at >= start, OnlineAttendance.joined_at < end)
            .group_by(OnlineLesson.group_id)
        ).all()
    }

    progress = {}
    for r in db.execute(
        select(
            OnlineProgress.group_name,
            func.count(func.distinct(OnlineProgress.student_id)).label("students"),
            func.count(OnlineProgress.id).label("tests"),
            func.coalesce(func.sum(OnlineProgress.test_score), 0).label("score"),
            func.coalesce(func.sum(OnlineProgress.test_total), 0).label("total"),
        )
        .where(
            OnlineProgress.test_submitted_at >= start,
            OnlineProgress.test_submitted_at < end,
        )
        .group_by(OnlineProgress.group_name)
    ).all():
        gid = id_by_name.get(r.group_name)
        if gid is not None:
            progress[gid] = r

    listeners = {
        r.group_id: int(r.n or 0)
        for r in db.execute(
            select(MalakaListener.group_id, func.count().label("n"))
            .where(MalakaListener.is_active.is_(True))
            .group_by(MalakaListener.group_id)
        ).all()
    }

    rows = []
    for gid, g in groups.items():
        att = attendance.get(gid)
        prog = progress.get(gid)
        held_n = held.get(gid, 0)
        known = max(
            listeners.get(gid, 0),
            int(att.students or 0) if att else 0,
            int(prog.students or 0) if prog else 0,
        )
        presences = int(att.presences or 0) if att else 0
        attendance_pct = (
            round(min(100.0, presences * 100.0 / (held_n * known)), 1) if held_n and known else None
        )
        if not (g.is_active or held_n or att or prog):
            continue
        rows.append(
            {
                "group_id": gid,
                "group_name": g.name,
                "program": g.program,
                "program_label": "Malaka oshirish" if g.program == "malaka" else "Online ta’lim",
                "size": known,
                "size_is_roster": bool(listeners.get(gid)),
                "lessons_held": held_n,
                "students_attended": int(att.students or 0) if att else 0,
                "presences": presences,
                "attendance_pct": attendance_pct,
                "minutes": round(int(att.seconds or 0) / 60) if att else 0,
                "tests": int(prog.tests or 0) if prog else 0,
                "avg_percent": _pct(prog.score, prog.total) if prog else None,
            }
        )
    rows.sort(
        key=lambda r: (
            r["attendance_pct"] if r["attendance_pct"] is not None else 101,
            r["group_name"].lower(),
        )
    )
    return {"from": start_day.isoformat(), "to": end_day.isoformat(), "results": rows}


# ============================ Kontent bazasi ============================


def content_bank(db: Session) -> dict:
    """Butun baza hajmi: testlar, keyslar, savollar, fanlar va mavzular.

    Admin bosh sahifasi bilan bir xil xizmatlar — sana oralig'iga bog'liq emas.
    """
    return {
        "catalog": build_catalog_stats(db, published_only=False, kind=None),
        "syllabus": build_syllabus_catalog_stats(db),
    }


# ============================ AI sarfi ============================

# Taxminiy ro'yxat narxi, AQSh dollari / 1 mln token: (kirish, keshdan, chiqish).
# Faqat solishtirish uchun — aniq summa OpenAI hisobida.
AI_PRICES: dict[str, tuple[float, float, float]] = {
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-4o-mini": (0.15, 0.075, 0.60),
    "gpt-4o": (2.50, 1.25, 10.00),
    "text-embedding-3-small": (0.02, 0.02, 0.0),
}


def _price(model: str) -> tuple[float, float, float]:
    name = (model or "").lower()
    # Eng uzun mos prefiks: "gpt-4o-mini" "gpt-4o" dan oldin tekshirilsin.
    for key in sorted(AI_PRICES, key=len, reverse=True):
        if name.startswith(key):
            return AI_PRICES[key]
    # Noma'lum model — qimmatiga hisoblanadi (sarf kam ko'rsatilmasin). Ilgari
    # gpt-4.1-nano ro'yxatda yo'q edi va 25 barobar qimmat ko'rsatilardi.
    return AI_PRICES["gpt-4o"]


def _cost(model: str, prompt: int, cached: int, completion: int) -> float:
    p_in, p_cached, p_out = _price(model)
    fresh = max(0, prompt - cached)
    return (fresh * p_in + cached * p_cached + completion * p_out) / 1_000_000


def ai_usage(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Qaysi funksiya qancha token va taxminan qancha pul yeydi."""
    from app.models.ai_usage import AiUsageLog

    start, end = range_bounds(start_day, end_day)
    grouped = db.execute(
        select(
            AiUsageLog.kind,
            AiUsageLog.model,
            func.count().label("calls"),
            func.coalesce(func.sum(AiUsageLog.prompt_tokens), 0).label("prompt"),
            func.coalesce(func.sum(AiUsageLog.cached_tokens), 0).label("cached"),
            func.coalesce(func.sum(AiUsageLog.completion_tokens), 0).label("completion"),
            func.coalesce(func.sum(AiUsageLog.total_tokens), 0).label("total"),
        )
        .where(AiUsageLog.created_at >= start, AiUsageLog.created_at < end)
        .group_by(AiUsageLog.kind, AiUsageLog.model)
    ).all()

    rows = []
    for r in grouped:
        prompt, cached, completion = int(r.prompt), int(r.cached), int(r.completion)
        rows.append(
            {
                "kind": r.kind or "boshqa",
                "model": r.model,
                "calls": int(r.calls),
                "prompt_tokens": prompt,
                "cached_tokens": cached,
                "completion_tokens": completion,
                "total_tokens": int(r.total),
                "cached_pct": _pct(cached, prompt),
                "avg_tokens": round(int(r.total) / int(r.calls)) if r.calls else 0,
                "cost_usd": round(_cost(r.model, prompt, cached, completion), 4),
            }
        )
    rows.sort(key=lambda x: -x["cost_usd"])

    local_day = func.date(func.timezone("Asia/Tashkent", AiUsageLog.created_at))
    by_day = {
        str(r.day): r
        for r in db.execute(
            select(
                local_day.label("day"),
                func.count().label("calls"),
                func.coalesce(func.sum(AiUsageLog.total_tokens), 0).label("total"),
            )
            .where(AiUsageLog.created_at >= start, AiUsageLog.created_at < end)
            .group_by("day")
        ).all()
    }
    days = []
    cursor = start_day
    while cursor <= end_day:
        hit = by_day.get(cursor.isoformat())
        days.append(
            {
                "date": cursor.isoformat(),
                "calls": int(hit.calls) if hit else 0,
                "tokens": int(hit.total) if hit else 0,
            }
        )
        cursor += dt.timedelta(days=1)

    total_prompt = sum(x["prompt_tokens"] for x in rows)
    total_cached = sum(x["cached_tokens"] for x in rows)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "calls": sum(x["calls"] for x in rows),
        "tokens": sum(x["total_tokens"] for x in rows),
        "cached_pct": _pct(total_cached, total_prompt),
        "cost_usd": round(sum(x["cost_usd"] for x in rows), 4),
        "prices_note": "Taxminiy ro'yxat narxi (USD / 1 mln token); aniq summa OpenAI hisobida.",
        "results": rows,
        "days": days,
    }
