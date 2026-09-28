from __future__ import annotations

import csv
import datetime as dt
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.models.analytics import StudentTestAttempt, StudentTestAttemptEvent
from app.models.live_test import LiveTestSession
from app.schemas.analytics import AiNarrativeIn
from app.services import live_test_service as live_test_svc
from app.services.openai_client import OpenAiClientError, generate_openai_text
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.services.activity_report_service import (
    TASHKENT_TZ,
    all_teachers_activity,
    teacher_daily_activity,
)
from app.services.report_rollup_service import (
    list_hodim_users,
    PERIOD_DAY,
    PERIOD_MONTH,
    PERIOD_QUARTER,
    PERIOD_WEEK,
    PERIOD_YEAR,
    build_summary,
    build_teacher_report_rows,
    filter_teacher_rows,
    period_bounds,
    rollup_day,
    teacher_report_facets,
)

router = APIRouter()

VALID_PERIODS = {PERIOD_DAY, PERIOD_WEEK, PERIOD_MONTH, PERIOD_QUARTER, PERIOD_YEAR}


def _release_db(db: Session) -> None:
    """DB ulanishini pool'ga qaytaradi (uzoq AI so'rovidan oldin).

    `education_ai.py` dagi bir xil nomli yordamchining nusxasi — ikkalasi
    ham bitta muammoni hal qiladi: ochiq tranzaksiya "idle in transaction"
    bo'lib ulanishni daqiqalab band qiladi.
    """
    try:
        db.close()
    except Exception:  # noqa: BLE001 — bo'shatish hech qachon so'rovni yiqitmasin
        pass


def _parse_anchor(raw: str | None) -> dt.date | None:
    if not raw:
        return None
    try:
        return dt.date.fromisoformat(raw.strip())
    except ValueError:
        return None


def _parse_csv_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


@router.get("/admin/reports/teachers/")
def admin_teacher_report(
    period: str = Query(PERIOD_MONTH),
    from_date: str | None = Query(None, alias="from"),
    q: str | None = Query(None, description="Smart qidiruv: ism, login, kafedra"),
    department: str | None = Query(None),
    tier: str | None = Query(None, description="Vergul bilan: inactive,low,sufficient,active"),
    flags: str | None = Query(None, description="Vergul bilan: no_cases,no_tests,..."),
    risk_only: bool = Query(False),
    min_minutes: int | None = Query(None, ge=0),
    max_minutes: int | None = Query(None, ge=0),
    min_geofence: float | None = Query(None, ge=0, le=100),
    max_geofence: float | None = Query(None, ge=0, le=100),
    sort: str = Query("minutes_desc"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail="Noto'g'ri period.")
    anchor = _parse_anchor(from_date)
    all_rows = build_teacher_report_rows(db, period, anchor)
    filtered = filter_teacher_rows(
        all_rows,
        search=q or "",
        department=department or "",
        tiers=_parse_csv_list(tier),
        flags=_parse_csv_list(flags),
        risk_only=risk_only,
        min_minutes=min_minutes,
        max_minutes=max_minutes,
        min_geofence=min_geofence,
        max_geofence=max_geofence,
        sort=sort,
    )
    start_dt, end_dt, start_d, end_d = period_bounds(period, anchor)
    return {
        "period": period,
        "from": start_d.isoformat(),
        "to": end_d.isoformat(),
        "teachers": filtered,
        "total": len(all_rows),
        "filtered_total": len(filtered),
        "facets": teacher_report_facets(all_rows),
    }


@router.get("/admin/reports/summary/")
def admin_report_summary(
    period: str = Query(PERIOD_MONTH),
    from_date: str | None = Query(None, alias="from"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail="Noto'g'ri period.")
    anchor = _parse_anchor(from_date)
    summary = build_summary(db, period, anchor)
    start_dt, end_dt, start_d, end_d = period_bounds(period, anchor)
    summary["from"] = start_d.isoformat()
    summary["to"] = end_d.isoformat()
    return summary


@router.get("/admin/reports/teachers/export.csv")
def export_teacher_report_csv(
    period: str = Query(PERIOD_MONTH),
    from_date: str | None = Query(None, alias="from"),
    q: str | None = Query(None),
    department: str | None = Query(None),
    tier: str | None = Query(None),
    flags: str | None = Query(None),
    risk_only: bool = Query(False),
    sort: str = Query("minutes_desc"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
):
    all_rows = build_teacher_report_rows(db, period, _parse_anchor(from_date))
    rows = filter_teacher_rows(
        all_rows,
        search=q or "",
        department=department or "",
        tiers=_parse_csv_list(tier),
        flags=_parse_csv_list(flags),
        risk_only=risk_only,
        sort=sort,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "owner_key",
            "display_name",
            "department",
            "tier",
            "active_minutes_period",
            "active_minutes_month",
            "cases_created",
            "tests_created",
            "live_sessions",
            "in_geofence_pct",
            "alerts",
            "flags",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["owner_key"],
                r["display_name"],
                r["department"],
                r["tier"],
                r["active_minutes_period"],
                r["active_minutes_month"],
                r["cases_created"],
                r["tests_created"],
                r["live_sessions_count"],
                r["in_geofence_pct"],
                r["alerts_count"],
                ",".join(r["flags"]),
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="teacher-report-{period}.csv"'},
    )


@router.get("/admin/student-test-archive/")
def admin_student_test_archive(
    student_id: str = Query(""),
    academic_year: str | None = Query(None),
    from_date: dt.date | None = Query(None, alias="from"),
    to_date: dt.date | None = Query(None, alias="to"),
    subject_code: str | None = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    sid = (student_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="student_id kerak.")

    stmt = select(StudentTestAttempt).where(StudentTestAttempt.student_id == sid)
    if academic_year:
        stmt = stmt.where(StudentTestAttempt.academic_year == academic_year.strip())
    if from_date:
        stmt = stmt.where(StudentTestAttempt.submitted_date >= from_date)
    if to_date:
        stmt = stmt.where(StudentTestAttempt.submitted_date <= to_date)
    subject = (subject_code or "").strip()
    if subject:
        stmt = stmt.where(StudentTestAttempt.subject_code == subject)
    attempts = db.execute(stmt.order_by(StudentTestAttempt.submitted_at.desc())).scalars().all()
    if not attempts:
        return {"found": False, "student_id": sid, "attempts": []}

    subject_names = live_test_svc.subject_names_for_codes(
        db, {a.subject_code for a in attempts if a.subject_code}
    )

    out_attempts = []
    for a in attempts:
        events = db.execute(
            select(StudentTestAttemptEvent)
            .where(StudentTestAttemptEvent.attempt_id == a.id)
            .order_by(StudentTestAttemptEvent.occurred_at)
        ).scalars().all()
        questions = a.questions_snapshot if isinstance(a.questions_snapshot, list) else []
        answers = a.answers_final if isinstance(a.answers_final, list) else []
        q_detail = []
        for i, q in enumerate(questions):
            if not isinstance(q, dict):
                continue
            chosen = answers[i] if i < len(answers) else None
            correct_idx = q.get("correctOptionIndex")
            q_detail.append(
                {
                    "index": i,
                    "question": q.get("question", ""),
                    "options": q.get("options", []),
                    "selected_index": chosen,
                    "correct_index": correct_idx,
                    "is_correct": chosen is not None and correct_idx is not None and int(chosen) == int(correct_idx),
                    "explanation": q.get("explanation", ""),
                }
            )
        out_attempts.append(
            {
                "id": a.id,
                "session_id": a.session_id,
                "subject_code": a.subject_code,
                "subject_name": subject_names.get(a.subject_code, a.subject_code),
                "topic": a.topic,
                "topic_code": a.topic_code,
                "variant_label": a.variant_label,
                "score": a.score,
                "total": a.total,
                "submitted_at": a.submitted_at.isoformat(),
                "academic_year": a.academic_year,
                "duration_sec": a.duration_sec,
                "questions": q_detail,
                "timeline": [
                    {
                        "event_type": e.event_type,
                        "question_index": e.question_index,
                        "option_index": e.option_index,
                        "occurred_at": e.occurred_at.isoformat(),
                        "client_ts_ms": e.client_ts_ms,
                    }
                    for e in events
                ],
            }
        )

    latest = attempts[0]
    return {
        "found": True,
        "student_id": sid,
        "first_name": latest.first_name,
        "last_name": latest.last_name,
        "attempts": out_attempts,
    }


@router.get("/admin/student-test-archive/search/")
def search_student_test_archive(
    q: str = Query(""),
    academic_year: str | None = Query(None),
    from_date: dt.date | None = Query(None, alias="from"),
    to_date: dt.date | None = Query(None, alias="to"),
    subject_code: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Talaba ID yoki ism bo'yicha smart qidiruv (arxivdan)."""
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"results": [], "q": needle}

    pattern = f"%{needle}%"
    stmt = select(StudentTestAttempt).where(
        (StudentTestAttempt.student_id.ilike(pattern))
        | (StudentTestAttempt.first_name.ilike(pattern))
        | (StudentTestAttempt.last_name.ilike(pattern))
    )
    if academic_year:
        stmt = stmt.where(StudentTestAttempt.academic_year == academic_year.strip())
    if from_date:
        stmt = stmt.where(StudentTestAttempt.submitted_date >= from_date)
    if to_date:
        stmt = stmt.where(StudentTestAttempt.submitted_date <= to_date)
    subject = (subject_code or "").strip()
    if subject:
        stmt = stmt.where(StudentTestAttempt.subject_code == subject)
    attempts = db.execute(stmt.order_by(StudentTestAttempt.submitted_at.desc()).limit(500)).scalars().all()
    subject_names = live_test_svc.subject_names_for_codes(
        db, {a.subject_code for a in attempts if a.subject_code}
    )

    seen: set[str] = set()
    results: list[dict] = []
    for a in attempts:
        sid = (a.student_id or "").strip()
        if not sid or sid in seen:
            continue
        seen.add(sid)
        count = sum(1 for x in attempts if (x.student_id or "").strip() == sid)
        results.append(
            {
                "student_id": sid,
                "first_name": a.first_name or "",
                "last_name": a.last_name or "",
                "attempts_count": count,
                "last_submitted_at": a.submitted_at.isoformat(),
                "subjects": sorted(
                    {
                        subject_names.get(x.subject_code, x.subject_code)
                        for x in attempts
                        if (x.student_id or "").strip() == sid and x.subject_code
                    }
                ),
            }
        )
        if len(results) >= limit:
            break
    return {"q": needle, "results": results}


@router.post("/admin/reports/ai-narrative/")
def admin_ai_narrative(
    payload: AiNarrativeIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI kaliti sozlanmagan.")

    period = payload.period if payload.period in VALID_PERIODS else PERIOD_MONTH
    anchor = _parse_anchor(payload.anchor_date)
    summary = build_summary(db, period, anchor)
    teachers = build_teacher_report_rows(db, period, anchor)[:40]

    # Ma'lumot yig'ib bo'lindi — OpenAI javobini kutish 1-2 daqiqa davom
    # etadi va shu vaqt davomida ulanish band turishi kerak emas. Bir necha
    # admin bir vaqtda hisobot so'rasa, pool tugab butun API yiqilardi.
    _release_db(db)

    lang = (payload.language or "uz").strip().lower()
    lang_hint = "O'zbek tilida" if lang == "uz" else ("Rus tilida" if lang == "ru" else "Ingliz tilida")

    prompt = (
        f"Siz tibbiy universitet iMentor platformasi admin hisobot yordamchisisiz. "
        f"Faqat quyidagi JSON raqamlaridan foydalaning, o'ylab topmang. {lang_hint} qisqa xulosa yozing.\n\n"
        f"Summary: {json.dumps(summary, ensure_ascii=False)}\n"
        f"Teachers sample: {json.dumps(teachers[:15], ensure_ascii=False)}\n\n"
        "Format: 1) Umumiy holat (2-3 jumla) 2) Xavfli o'qituvchilar (inactive, no_tests, alerts) 3) Tavsiyalar (3 band)"
    )
    try:
        text = generate_openai_text(
            api_key,
            user_text=prompt,
            system_instruction="Siz iMentor admin hisobot yordamchisisiz. Faqat berilgan raqamlardan foydalaning.",
            model=settings.openai_fast_model,
            max_tokens=1500,
            temperature=0.2,
            timeout_sec=90,
        )
    except OpenAiClientError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"period": period, "narrative": text.strip(), "summary": summary}


@router.post("/admin/reports/rollup/run/")
def admin_run_rollup(
    date: str | None = Query(None),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    day = _parse_anchor(date) or dt.datetime.now(tz=dt.timezone.utc).date()
    count = rollup_day(db, day)
    return {"ok": True, "rollup_date": day.isoformat(), "teachers_written": count}


# ─────────────────────────────────────────────────────────────────────────
# SAHIFA KESIMIDAGI FAOLLIK
#
# "Bugun kim necha daqiqa ishladi va qaysi bo'limda qanchadan?" degan
# savolga javob beradi. Yuqoridagi `/admin/reports/teachers/` umumiy
# daqiqani ko'rsatadi, bu ikkitasi esa uni bo'limlarga ajratadi.
# ─────────────────────────────────────────────────────────────────────────


def _parse_day(raw: str | None, fallback: dt.date) -> dt.date:
    parsed = _parse_anchor(raw)
    return parsed or fallback


@router.get("/admin/reports/activity/")
def admin_activity_overview(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    q: str | None = Query(None, description="Ism, login yoki kafedra bo'yicha qidiruv"),
    sort: str = Query("minutes_desc"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Barcha o'qituvchilar — tanlangan oraliqdagi bo'limlar kesimi."""
    today = dt.datetime.now(TASHKENT_TZ).date()
    start_day = _parse_day(from_date, today)
    end_day = _parse_day(to_date, start_day)
    if end_day < start_day:
        start_day, end_day = end_day, start_day
    if (end_day - start_day).days > 92:
        raise HTTPException(status_code=400, detail="Oraliq 92 kundan oshmasin.")

    stats = all_teachers_activity(db, start_day=start_day, end_day=end_day)
    profiles = {
        p.owner_key: p
        for p in db.execute(select(StaffProfile)).scalars().all()
    }

    needle = (q or "").strip().lower()
    rows: list[dict] = []
    for user in list_hodim_users(db):
        owner = user.username
        s = stats.get(owner)
        profile = profiles.get(owner)
        name = " ".join(filter(None, [user.first_name, user.last_name])).strip() or owner
        department = (profile.department if profile else "") or ""
        if needle and needle not in f"{name} {owner} {department}".lower():
            continue
        rows.append(
            {
                "owner_key": owner,
                "display_name": name,
                "department": department,
                "minutes": s["minutes"] if s else 0,
                "active_days": s["active_days"] if s else 0,
                "pages": s["pages"] if s else [],
                "videos_viewed": s["videos_viewed"] if s else 0,
                "handouts_viewed": s["handouts_viewed"] if s else 0,
                "cases_created": s["cases_created"] if s else 0,
                "tests_created": s["tests_created"] if s else 0,
                "live_sessions": s["live_sessions"] if s else 0,
            }
        )

    reverse = not sort.endswith("_asc")
    key = sort.rsplit("_", 1)[0]
    if key == "name":
        rows.sort(key=lambda r: r["display_name"].lower(), reverse=reverse)
    elif key in ("videos", "handouts", "cases", "tests"):
        field = {"videos": "videos_viewed", "handouts": "handouts_viewed",
                 "cases": "cases_created", "tests": "tests_created"}[key]
        rows.sort(key=lambda r: r[field], reverse=reverse)
    else:
        rows.sort(key=lambda r: r["minutes"], reverse=reverse)

    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "teachers": rows,
        "total": len(rows),
        "totals": {
            "minutes": sum(r["minutes"] for r in rows),
            "videos_viewed": sum(r["videos_viewed"] for r in rows),
            "handouts_viewed": sum(r["handouts_viewed"] for r in rows),
            "cases_created": sum(r["cases_created"] for r in rows),
            "tests_created": sum(r["tests_created"] for r in rows),
            "active_teachers": sum(1 for r in rows if r["minutes"] > 0),
        },
    }


@router.get("/admin/reports/activity/{owner_key}/")
def admin_activity_detail(
    owner_key: str,
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """Bitta o'qituvchi — kunma-kun, bo'limma-bo'lim."""
    today = dt.datetime.now(TASHKENT_TZ).date()
    end_day = _parse_day(to_date, today)
    start_day = _parse_day(from_date, end_day - dt.timedelta(days=29))
    if end_day < start_day:
        start_day, end_day = end_day, start_day
    if (end_day - start_day).days > 92:
        raise HTTPException(status_code=400, detail="Oraliq 92 kundan oshmasin.")

    user = db.execute(select(User).where(User.username == owner_key)).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi.")
    profile = db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == owner_key)
    ).scalar_one_or_none()

    detail = teacher_daily_activity(db, owner_key=owner_key, start_day=start_day, end_day=end_day)
    detail["display_name"] = (
        " ".join(filter(None, [user.first_name, user.last_name])).strip() or owner_key
    )
    detail["department"] = (profile.department if profile else "") or ""
    return detail
