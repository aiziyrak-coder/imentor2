"""Rektor hisoboti — butun institut bo'yicha yagona ko'rinish.

Admin panelidagi faollik hisoboti bitta savolga javob berardi: "o'qituvchi
platformadan qancha foydalandi". Rektorga esa boshqa narsa kerak — o'qituvchi
NIMA QILDI (dars o'tdimi, test va vaziyatli masala yaratdimi, material
joyladimi) va TALABA NIMA OLDI (darsga qatnashdimi, testda qanday baho oldi).

Shu sababli bu yerdagi har bir funksiya guruhlangan so'rovlar bilan ishlaydi:
600 xodim va o'n minglab test urinishi bo'lsa ham so'rovlar soni o'zgarmaydi.
Hisobot faqat O'QIYDI — hech qayerga yozmaydi.

Ma'lumot manbalari:
  * faollik (daqiqa, sahifalar)   — `core_useractivityevent` (`activity_report_service`)
  * yaratilgan material           — `core_preparedcontent`, `core_topichandout`,
                                    `core_topicvideo`, `core_topicpresentation`
  * dars o'tilgani                — `core_livetestsession` (QR test) va `online_lesson`
  * talaba natijasi               — `core_studenttestattempt` (arxiv, ball bilan)
  * online ta'lim davomati/bahosi — `online_attendance`, `online_progress`
  * malaka natijalari             — `malaka_test_attempt`
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.live_test import LiveTestSession
from app.models.online_edu import (
    MalakaTestAttempt,
    OnlineAttendance,
    OnlineGroup,
    OnlineLesson,
    OnlineProgress,
    OnlineSyllabus,
)
from app.models.staff_location import StaffProfile
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.models.user import Group, User, user_groups
from app.services.activity_report_service import (
    _local_day,  # mahalliy kun (Toshkent) — hisobot kunlari server UTC'siga surilmasin
    all_teachers_activity,
    range_bounds,
)
from app.services import report_exclusion
from app.services.dean_access import ExclusionScope

STAFF_ROLES = ("admin", "klinika_admin", "hodim")

# Baho darajalari — foizdan nom. Talaba bahosi butun institutda shu
# shkalada o'lchanadi, shunda rektor ko'rgan raqam o'qituvchi ko'rgani bilan
# bir xil bo'ladi.
def student_key_expr():
    """Talabani ajratadigan kalit. `student_id` bo'sh qolgan urinishlar (QR orqali ID'siz
    kirganlar) bitta "talaba"ga qo'shilib ketmasin — ular ism-familiyasi bilan ajratiladi."""
    return func.coalesce(
        func.nullif(StudentTestAttempt.student_id, ""),
        func.concat("name:", func.lower(func.trim(StudentTestAttempt.last_name)), " ", func.lower(func.trim(StudentTestAttempt.first_name))),
    )


GRADE_BANDS = (
    ("alo", "A'lo (86-100%)", 86),
    ("yaxshi", "Yaxshi (71-85%)", 71),
    ("qoniqarli", "Qoniqarli (56-70%)", 56),
    ("qoniqarsiz", "Qoniqarsiz (0-55%)", 0),
)




def _allowed_department_names(allowed_departments: list[str] | tuple[str, ...] | None) -> set[str]:
    return {str(name).strip().casefold() for name in (allowed_departments or []) if str(name).strip()}


def _department_allowed(department: str | None, allowed: set[str]) -> bool:
    return not allowed or (department or "").strip().casefold() in allowed


def _allowed_subject_codes(db: Session, allowed_departments: list[str] | tuple[str, ...] | None) -> set[str] | None:
    allowed = _allowed_department_names(allowed_departments)
    excluded = report_exclusion.load(db)
    if not allowed and not excluded.subject_codes:
        return None
    # Faqat chiqarish (dekan cheklovi yo'q): kafedrasiz fanlar ham qoladi.
    keep_unassigned = not allowed or isinstance(allowed_departments, ExclusionScope)
    rows = db.execute(
        select(CourseSyllabus.subject_code, AcademicDepartment.name)
        .outerjoin(AcademicDepartment, AcademicDepartment.id == CourseSyllabus.department_id)
        .where(CourseSyllabus.subject_code.is_not(None), CourseSyllabus.subject_code != "")
    ).all()
    return {
        r.subject_code for r in rows
        if r.subject_code not in excluded.subject_codes
        and (_department_allowed(r.name, allowed) if r.name else keep_unassigned)
    }

def band_of(percent: float | None) -> str:
    if percent is None:
        return ""
    for key, _label, floor in GRADE_BANDS:
        if percent >= floor:
            return key
    return "qoniqarsiz"


def _pct(score: int | None, total: int | None) -> float | None:
    if not total:
        return None
    return round((score or 0) * 100 / total, 1)


# ============================ Xodimlar ma'lumotnomasi ============================


def staff_directory(db: Session) -> dict[str, dict]:
    """`owner_key` → {ism, kafedra, rol}. Bitta so'rov, barcha xodimlar."""
    rows = db.execute(
        select(
            User.username,
            User.first_name,
            User.last_name,
            User.last_login,
            Group.name.label("role"),
            StaffProfile.department,
            StaffProfile.job_title,
        )
        .join(user_groups, user_groups.c.user_id == User.id)
        .join(Group, Group.id == user_groups.c.group_id)
        .outerjoin(StaffProfile, StaffProfile.owner_key == User.username)
        .where(Group.name.in_(STAFF_ROLES))
    ).all()

    out: dict[str, dict] = {}
    for r in rows:
        # Bir foydalanuvchi bir nechta guruhda bo'lishi mumkin — eng yuqori rol qoladi.
        current = out.get(r.username)
        role = r.role or "hodim"
        if current and STAFF_ROLES.index(current["role"]) <= STAFF_ROLES.index(role):
            continue
        name = f"{r.last_name or ''} {r.first_name or ''}".strip()
        out[r.username] = {
            "owner_key": r.username,
            "display_name": name or r.username,
            "first_name": (r.first_name or "").strip(),
            "last_name": (r.last_name or "").strip(),
            "department": (r.department or "").strip(),
            "job_title": (r.job_title or "").strip(),
            "role": role,
            "last_login": r.last_login,
        }
    return out


# ============================ Yaratilgan material ============================


def _count_by_owner(db, model, start: dt.datetime, end: dt.datetime) -> dict[str, int]:
    rows = db.execute(
        select(model.owner_key, func.count().label("n"))
        .where(model.created_at >= start, model.created_at < end)
        .group_by(model.owner_key)
    ).all()
    return {r.owner_key: int(r.n or 0) for r in rows}


def created_materials(db: Session, start: dt.datetime, end: dt.datetime) -> dict[str, dict]:
    """O'qituvchi qo'li bilan qo'shilgan material: tarqatma, video, taqdimot."""
    handouts = _count_by_owner(db, TopicHandout, start, end)
    videos = _count_by_owner(db, TopicVideo, start, end)
    presentations = _count_by_owner(db, TopicPresentation, start, end)

    out: dict[str, dict] = {}
    for owner in set(handouts) | set(videos) | set(presentations):
        out[owner] = {
            "handouts_created": handouts.get(owner, 0),
            "videos_created": videos.get(owner, 0),
            "presentations_created": presentations.get(owner, 0),
        }
    return out


def teaching_counts(db: Session, start: dt.datetime, end: dt.datetime, start_day: dt.date, end_day: dt.date) -> dict[str, dict]:
    """O'qituvchi dars o'tdimi: QR test sessiyalari va online darslar.

    Talabaning natijasi ham shu yerda yig'iladi — sessiya orqali o'qituvchiga
    bog'lanadi, shunda "uning darsida nechta talaba qatnashdi va o'rtacha
    qanday baho oldi" ko'rinadi.
    """
    out: dict[str, dict] = {}

    def slot(owner: str) -> dict:
        return out.setdefault(
            owner,
            {
                "live_sessions": 0,
                "online_lessons": 0,
                "students_taught": 0,
                "student_attempts": 0,
                "score_sum": 0,
                "score_total": 0,
            },
        )

    sessions = db.execute(
        select(LiveTestSession.owner_key, func.count().label("n"))
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by(LiveTestSession.owner_key)
    ).all()
    for r in sessions:
        slot(r.owner_key)["live_sessions"] = int(r.n or 0)

    # Talabalar natijasi — arxiv jadvalidan (ball allaqachon hisoblangan).
    results = db.execute(
        select(
            LiveTestSession.owner_key,
            func.count(func.distinct(student_key_expr())).label("students"),
            func.count(StudentTestAttempt.id).label("attempts"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score_sum"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("score_total"),
        )
        .join(StudentTestAttempt, StudentTestAttempt.session_id == LiveTestSession.id)
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .group_by(LiveTestSession.owner_key)
    ).all()
    for r in results:
        s = slot(r.owner_key)
        s["students_taught"] = int(r.students or 0)
        s["student_attempts"] = int(r.attempts or 0)
        s["score_sum"] = int(r.score_sum or 0)
        s["score_total"] = int(r.score_total or 0)

    lessons = db.execute(
        select(OnlineLesson.teacher_owner_key, func.count().label("n"))
        .where(OnlineLesson.started_at >= start, OnlineLesson.started_at < end)
        .group_by(OnlineLesson.teacher_owner_key)
    ).all()
    for r in lessons:
        slot(r.teacher_owner_key)["online_lessons"] = int(r.n or 0)

    return out


# ============================ O'qituvchilar hisoboti ============================


def scheduled_teacher_roster(db: Session, *, end_day: dt.date, department: str = "", allowed_departments=None) -> dict[str, dict]:
    """Only department-submitted monitor assignments, never the whole staff directory.

    Weekly membership starts on the schedule's effective Monday. Unlinked names
    remain visible as unknown; they must not become red/inactive staff accounts.
    """
    import hashlib
    from app.services import monitor_schedule_service as schedules

    allowed = {schedules._norm(d) for d in (allowed_departments or []) if str(d).strip()}
    needle = schedules._norm(department)
    monitors = {m["monitor_id"]: m for m in schedules.monitors()}
    roster: dict[str, dict] = {}
    for entry in schedules._load_schedule(db):
        monitor = monitors.get(entry.monitor_id)
        if not monitor or entry.weekday not in schedules.WEEKDAY_INDEX or entry.para not in schedules.PERIOD_TIMES:
            continue
        if schedules._status_for(entry.status) is None:
            continue
        keys = monitor["department_keys"]
        if allowed and not any(k in allowed for k in keys):
            continue
        if needle and not any(k == needle or (k and (k in needle or needle in k)) for k in keys):
            continue
        effective = schedules._effective_from(entry)
        if effective and effective > end_day:
            continue
        username = (entry.teacher_username or "").strip()
        name = (entry.teacher_name or "").strip()
        if not username and not name:
            continue
        key = username or "schedule:" + hashlib.sha256((monitor["department"] + "|" + schedules._norm(name)).encode()).hexdigest()[:24]
        row = roster.setdefault(key, {"owner_key": key, "display_name": name or username,
            "department": monitor["department"], "schedule_departments": [], "schedule_linked": bool(username)})
        if monitor["department"] not in row["schedule_departments"]:
            row["schedule_departments"].append(monitor["department"])
    return roster


def teacher_report(
    db: Session,
    *,
    start_day: dt.date,
    end_day: dt.date,
    department: str = "",
    query: str = "",
    only_active: bool = False,
    allowed_departments: list[str] | tuple[str, ...] | None = None,
) -> list[dict]:
    """Har bir o'qituvchi bo'yicha bitta qator — faollik, material, dars, natija."""
    start, end = range_bounds(start_day, end_day)
    directory = staff_directory(db)
    roster = scheduled_teacher_roster(db, end_day=end_day, department=department, allowed_departments=allowed_departments)
    from app.services.monitor_schedule_service import planned_lessons_by_teacher

    planned_lessons = planned_lessons_by_teacher(db, start_day, end_day)
    activity = all_teachers_activity(db, start_day=start_day, end_day=end_day)
    materials = created_materials(db, start, end)
    teaching = teaching_counts(db, start, end, start_day, end_day)

    from app.services.rector_intelligence import matches_name
    name_needle = (query or "").strip()

    rows: list[dict] = []
    for owner, assignment in roster.items():
        account = directory.get(owner)
        if account and account["role"] != "hodim":
            continue
        info = dict(account or {"owner_key": owner, "display_name": assignment["display_name"],
            "first_name": assignment["display_name"], "last_name": "", "role": "hodim", "job_title": "", "last_login": None})
        info.update(department=assignment["department"], schedule_departments=assignment["schedule_departments"],
            schedule_linked=bool(account and assignment["schedule_linked"]))
        act = activity.get(owner, {})
        mat = materials.get(owner, {})
        teach = teaching.get(owner, {})

        if name_needle and not matches_name(info, name_needle):
            continue

        minutes = int(act.get("minutes", 0) or 0)
        score_total = int(teach.get("score_total", 0) or 0)
        row = {
            **info,
            "minutes": minutes,
            "active_days": int(act.get("active_days", 0) or 0),
            "pages": act.get("pages", []),
            "videos_viewed": int(act.get("videos_viewed", 0) or 0),
            "handouts_viewed": int(act.get("handouts_viewed", 0) or 0),
            "cases_created": int(act.get("cases_created", 0) or 0),
            "tests_created": int(act.get("tests_created", 0) or 0),
            "handouts_created": int(mat.get("handouts_created", 0) or 0),
            "videos_created": int(mat.get("videos_created", 0) or 0),
            "presentations_created": int(mat.get("presentations_created", 0) or 0),
            "live_sessions": int(teach.get("live_sessions", 0) or 0),
            "online_lessons": int(teach.get("online_lessons", 0) or 0),
            "students_taught": int(teach.get("students_taught", 0) or 0),
            "student_attempts": int(teach.get("student_attempts", 0) or 0),
            "avg_student_score": _pct(teach.get("score_sum"), score_total),
        }
        row["created_total"] = (
            row["cases_created"]
            + row["tests_created"]
            + row["handouts_created"]
            + row["videos_created"]
            + row["presentations_created"]
        )
        row["lessons_total"] = row["live_sessions"] + row["online_lessons"]
        from app.services.interactive_board_service import board_info
        row["board"] = board_info(info["department"])
        # "Umuman ishlatmagan" — rektor uchun eng muhim belgi.
        row["is_active"] = minutes > 0 or row["created_total"] > 0 or row["lessons_total"] > 0
        # Monitor jadvali bo'yicha oraliqdagi rejadagi paralar; None — jadvalda yo'q (bilmaymiz).
        row["scheduled_lessons"] = planned_lessons.get(owner)
        if only_active and not row["is_active"]:
            continue
        rows.append(row)

    rows.sort(key=lambda r: (-r["minutes"], -r["created_total"], r["display_name"].lower()))
    return rows


def teacher_detail(db: Session, owner_key: str, *, start_day: dt.date, end_day: dt.date, allowed_departments: list[str] | tuple[str, ...] | None = None) -> dict:
    """Bitta o'qituvchining kunma-kun tafsiloti va o'tgan darslari."""
    from app.services.activity_report_service import teacher_daily_activity

    assignment = scheduled_teacher_roster(db, end_day=end_day, allowed_departments=allowed_departments).get(owner_key)
    info = staff_directory(db).get(owner_key)
    if not assignment or not assignment["schedule_linked"] or not info or info.get("role") != "hodim":
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Monitor jadvalida biriktirilgan o'qituvchi topilmadi.")
    info.update(department=assignment["department"], schedule_departments=assignment["schedule_departments"], schedule_linked=True)
    daily = teacher_daily_activity(db, owner_key=owner_key, start_day=start_day, end_day=end_day)
    lessons = lesson_report(db, start_day=start_day, end_day=end_day, teacher=owner_key, allowed_departments=allowed_departments)
    from app.services.interactive_board_service import board_info

    # Ro'yxatdagi qator bilan BIR MANBA: material va dars sonlari teacher_report bilan bir xil hisoblanadi.
    start, end = range_bounds(start_day, end_day)
    mat = created_materials(db, start, end).get(owner_key, {})
    teach = teaching_counts(db, start, end, start_day, end_day).get(owner_key, {})
    score_total = int(teach.get("score_total", 0) or 0)
    counts = {
        "handouts_created": int(mat.get("handouts_created", 0) or 0),
        "videos_created": int(mat.get("videos_created", 0) or 0),
        "presentations_created": int(mat.get("presentations_created", 0) or 0),
        "live_sessions": int(teach.get("live_sessions", 0) or 0),
        "online_lessons": int(teach.get("online_lessons", 0) or 0),
        "students_taught": int(teach.get("students_taught", 0) or 0),
        "student_attempts": int(teach.get("student_attempts", 0) or 0),
        "avg_student_score": _pct(teach.get("score_sum"), score_total),
    }
    counts["created_total"] = (
        int(daily.get("cases_created", 0) or 0)
        + int(daily.get("tests_created", 0) or 0)
        + counts["handouts_created"]
        + counts["videos_created"]
        + counts["presentations_created"]
    )
    counts["lessons_total"] = counts["live_sessions"] + counts["online_lessons"]
    counts["is_active"] = bool(daily.get("total_minutes") or counts["created_total"] or counts["lessons_total"])
    return {
        **info,
        **daily,
        **counts,
        "minutes": daily.get("total_minutes", 0),
        "active_days": sum(1 for d in daily.get("days", []) if d.get("minutes")),
        "lessons": lessons,
        "board": board_info(info["department"]),
        "monitor": _teacher_monitor(db, owner_key, start_day, end_day, allowed_departments),
    }


def _teacher_monitor(db: Session, owner_key: str, start_day: dt.date, end_day: dt.date, allowed_departments) -> dict:
    """O'qituvchining monitor jadvali: qaysi kun, qaysi para, qaysi xonada va ishlatildimi."""
    from app.services import monitor_schedule_service as monitor_svc

    report = monitor_svc.build_report(
        db,
        date_from=start_day.isoformat(),
        date_to=end_day.isoformat(),
        teacher=owner_key,
        allowed_departments=allowed_departments,
    )
    row = next((t for t in report["teachers"] if t.get("teacher_key") == owner_key), None)
    return {
        "planned_slots": row["planned_slots"] if row else 0,
        "used_slots": row["used_slots"] if row else 0,
        "usage_percent": row["usage_percent"] if row else None,
        "slots": [s for s in report["slots"] if s["planned"]],
    }


# ============================ Darslar ============================


def lesson_report(
    db: Session,
    *,
    start_day: dt.date,
    end_day: dt.date,
    teacher: str = "",
    subject_code: str = "",
    allowed_departments: list[str] | tuple[str, ...] | None = None,
) -> list[dict]:
    """O'tilgan darslar: QR test sessiyalari va online video darslar birga."""
    start, end = range_bounds(start_day, end_day)
    directory = staff_directory(db)
    allowed_depts = _allowed_department_names(allowed_departments)
    if teacher and not _department_allowed(directory.get(teacher, {}).get("department", ""), allowed_depts):
        return []
    allowed_codes = _allowed_subject_codes(db, allowed_departments)

    # --- QR (jonli) testlar ---
    stmt = (
        select(
            LiveTestSession.id,
            LiveTestSession.session_key,
            LiveTestSession.owner_key,
            LiveTestSession.subject_code,
            LiveTestSession.payload,
            LiveTestSession.created_at,
            LiveTestSession.is_closed,
            func.count(func.distinct(student_key_expr())).label("students"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score_sum"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("score_total"),
        )
        .outerjoin(StudentTestAttempt, StudentTestAttempt.session_id == LiveTestSession.id)
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by(
            LiveTestSession.id,
            LiveTestSession.session_key,
            LiveTestSession.owner_key,
            LiveTestSession.subject_code,
            LiveTestSession.payload,
            LiveTestSession.created_at,
            LiveTestSession.is_closed,
        )
        .order_by(LiveTestSession.created_at.desc())
    )
    if teacher:
        stmt = stmt.where(LiveTestSession.owner_key == teacher)
    if subject_code:
        stmt = stmt.where(LiveTestSession.subject_code == subject_code)
    elif allowed_codes is not None:
        if not allowed_codes:
            return []
        stmt = stmt.where(LiveTestSession.subject_code.in_(allowed_codes))
    live_rows = db.execute(stmt).all()

    codes = {r.subject_code for r in live_rows if r.subject_code}
    subject_names: dict[str, str] = {}
    if codes:
        subject_names = {
            s.subject_code: s.subject_name
            for s in db.execute(
                select(CourseSyllabus).where(CourseSyllabus.subject_code.in_(codes))
            ).scalars()
        }

    out: list[dict] = []
    for r in live_rows:
        payload = r.payload if isinstance(r.payload, dict) else {}
        info = directory.get(r.owner_key, {})
        if not _department_allowed(info.get("department", ""), allowed_depts):
            continue
        out.append(
            {
                "kind": "live_test",
                "kind_label": "Jonli (QR) test",
                "id": f"live-{r.id}",
                "session_key": r.session_key,
                "teacher_key": r.owner_key,
                "teacher_name": info.get("display_name", r.owner_key),
                "department": info.get("department", ""),
                "subject_code": r.subject_code or "",
                "subject_name": subject_names.get(r.subject_code or "", ""),
                "topic": str(payload.get("topic") or ""),
                "group_name": "",
                "held_at": r.created_at,
                "students": int(r.students or 0),
                "avg_score": _pct(r.score_sum, r.score_total),
                "is_closed": bool(r.is_closed),
            }
        )

    # --- Online ta'lim video darslari ---
    online = (
        select(
            OnlineLesson.id,
            OnlineLesson.teacher_owner_key,
            OnlineLesson.topic_code,
            OnlineLesson.title,
            OnlineLesson.started_at,
            OnlineSyllabus.subject_name,
            OnlineSyllabus.subject_code,
            OnlineGroup.name.label("group_name"),
            func.count(func.distinct(OnlineAttendance.student_id)).label("students"),
        )
        .join(OnlineSyllabus, OnlineSyllabus.id == OnlineLesson.syllabus_id)
        .join(OnlineGroup, OnlineGroup.id == OnlineLesson.group_id)
        .outerjoin(OnlineAttendance, OnlineAttendance.lesson_id == OnlineLesson.id)
        .where(OnlineLesson.started_at >= start, OnlineLesson.started_at < end)
        .group_by(
            OnlineLesson.id,
            OnlineLesson.teacher_owner_key,
            OnlineLesson.topic_code,
            OnlineLesson.title,
            OnlineLesson.started_at,
            OnlineSyllabus.subject_name,
            OnlineSyllabus.subject_code,
            OnlineGroup.name,
        )
        .order_by(OnlineLesson.started_at.desc())
    )
    if teacher:
        online = online.where(OnlineLesson.teacher_owner_key == teacher)
    if subject_code:
        online = online.where(OnlineSyllabus.subject_code == subject_code)
    elif allowed_codes is not None:
        if not allowed_codes:
            return out
        online = online.where(OnlineSyllabus.subject_code.in_(allowed_codes))

    for r in db.execute(online).all():
        info = directory.get(r.teacher_owner_key, {})
        if not _department_allowed(info.get("department", ""), allowed_depts):
            continue
        out.append(
            {
                "kind": "online_lesson",
                "kind_label": "Online video dars",
                "id": f"online-{r.id}",
                "session_key": "",
                "teacher_key": r.teacher_owner_key,
                "teacher_name": info.get("display_name", r.teacher_owner_key),
                "department": info.get("department", ""),
                "subject_code": r.subject_code or "",
                "subject_name": r.subject_name or "",
                "topic": r.title or f"{r.topic_code}-mavzu",
                "group_name": r.group_name or "",
                "held_at": r.started_at,
                "students": int(r.students or 0),
                "avg_score": None,
                "is_closed": True,
            }
        )

    out.sort(key=lambda x: x["held_at"] or dt.datetime.min, reverse=True)
    return out


# ============================ Talabalar ============================


def student_report(
    db: Session,
    *,
    start_day: dt.date,
    end_day: dt.date,
    subject_code: str = "",
    query: str = "",
    band: str = "",
    allowed_departments: list[str] | tuple[str, ...] | None = None,
) -> list[dict]:
    """Har bir talaba bo'yicha bitta qator — nechta test, o'rtacha ball, baho."""
    key = student_key_expr()
    stmt = (
        select(
            key.label("student_id"),
            func.max(StudentTestAttempt.first_name).label("first_name"),
            func.max(StudentTestAttempt.last_name).label("last_name"),
            func.count(StudentTestAttempt.id).label("attempts"),
            func.count(func.distinct(StudentTestAttempt.subject_code)).label("subjects"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score_sum"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("score_total"),
            func.max(StudentTestAttempt.submitted_at).label("last_at"),
            func.coalesce(func.sum(StudentTestAttempt.duration_sec), 0).label("duration_sec"),
        )
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .group_by(key)
    )
    allowed_codes = _allowed_subject_codes(db, allowed_departments)
    if subject_code:
        if allowed_codes is not None and subject_code not in allowed_codes:
            return []
        stmt = stmt.where(StudentTestAttempt.subject_code == subject_code)
    elif allowed_codes is not None:
        if not allowed_codes:
            return []
        stmt = stmt.where(StudentTestAttempt.subject_code.in_(allowed_codes))
    needle = (query or "").strip()
    if needle:
        pattern = f"%{needle}%"
        stmt = stmt.where(
            or_(
                StudentTestAttempt.student_id.ilike(pattern),
                StudentTestAttempt.first_name.ilike(pattern),
                StudentTestAttempt.last_name.ilike(pattern),
            )
        )

    rows: list[dict] = []
    for r in db.execute(stmt).all():
        pct = _pct(r.score_sum, r.score_total)
        row_band = band_of(pct)
        if band and row_band != band:
            continue
        name = f"{r.last_name or ''} {r.first_name or ''}".strip()
        rows.append(
            {
                "student_id": r.student_id,
                "display_name": name or r.student_id,
                "attempts": int(r.attempts or 0),
                "subjects": int(r.subjects or 0),
                "score_sum": int(r.score_sum or 0),
                "score_total": int(r.score_total or 0),
                "avg_percent": pct,
                "band": row_band,
                "minutes": round(int(r.duration_sec or 0) / 60),
                "last_at": r.last_at,
            }
        )
    rows.sort(key=lambda x: (-(x["avg_percent"] or 0), -x["attempts"], x["display_name"].lower()))
    return rows


def student_detail(
    db: Session,
    student_key: str,
    *,
    start_day: dt.date,
    end_day: dt.date,
    allowed_departments: list[str] | tuple[str, ...] | None = None,
) -> dict:
    """Bitta talabaning to'liq hisoboti: har bir testi, fanlar, o'qituvchilar, kunlar, reyting.

    Ro'yxatdagi qator bilan BIR MANBA — o'sha `student_key_expr()` kaliti va o'sha sanalar.
    """
    key = student_key_expr()
    stmt = (
        select(StudentTestAttempt, LiveTestSession.owner_key)
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id, isouter=True)
        .where(
            key == student_key,
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .order_by(StudentTestAttempt.submitted_at.desc())
    )
    allowed_codes = _allowed_subject_codes(db, allowed_departments)
    if allowed_codes is not None:
        if not allowed_codes:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(StudentTestAttempt.subject_code.in_(allowed_codes))
    rows = db.execute(stmt).all()
    if not rows:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Bu oraliqda talabaning test natijasi topilmadi.")

    directory = staff_directory(db)
    codes = {a.subject_code for a, _ in rows if a.subject_code}
    subject_names = (
        {
            c.subject_code: c.subject_name
            for c in db.execute(select(CourseSyllabus).where(CourseSyllabus.subject_code.in_(codes))).scalars()
        }
        if codes
        else {}
    )

    attempts: list[dict] = []
    subjects: dict[str, dict] = {}
    teachers: dict[str, dict] = {}
    days: dict[str, dict] = {}
    for a, owner in rows:
        pct = _pct(a.score, a.total)
        subject_name = subject_names.get(a.subject_code or "", "") or a.subject_code or "Fan ko‘rsatilmagan"
        teacher_name = directory.get(owner or "", {}).get("display_name", owner or "")
        attempts.append(
            {
                "id": a.id,
                "submitted_at": a.submitted_at,
                "subject_code": a.subject_code or "",
                "subject_name": subject_name,
                "topic": a.topic or "",
                "variant": a.variant_label or "",
                "teacher_key": owner or "",
                "teacher_name": teacher_name,
                "score": int(a.score or 0),
                "total": int(a.total or 0),
                "percent": pct,
                "band": band_of(pct),
                "minutes": round(int(a.duration_sec or 0) / 60, 1),
            }
        )
        for bucket, k, label in (
            (subjects, a.subject_code or "", subject_name),
            (teachers, owner or "", teacher_name),
            (days, a.submitted_date.isoformat(), a.submitted_date.isoformat()),
        ):
            item = bucket.setdefault(k, {"key": k, "name": label, "attempts": 0, "score": 0, "total": 0, "seconds": 0, "last_at": None})
            item["attempts"] += 1
            item["score"] += int(a.score or 0)
            item["total"] += int(a.total or 0)
            item["seconds"] += int(a.duration_sec or 0)
            if item["last_at"] is None or a.submitted_at > item["last_at"]:
                item["last_at"] = a.submitted_at

    def finish(items: dict[str, dict]) -> list[dict]:
        out = []
        for item in items.values():
            pct = _pct(item["score"], item["total"])
            out.append({**item, "percent": pct, "band": band_of(pct), "minutes": round(item.pop("seconds") / 60)})
        return out

    score = sum(x["score"] for x in attempts)
    total = sum(x["total"] for x in attempts)
    avg = _pct(score, total)

    # Reyting — shu oraliqda test topshirgan talabalar orasida (o'rtacha ball bo'yicha).
    everyone = student_report(db, start_day=start_day, end_day=end_day, allowed_departments=allowed_departments)
    better = sum(1 for r in everyone if (r["avg_percent"] or 0) > (avg or 0))

    first = rows[-1][0]
    name = f"{first.last_name or ''} {first.first_name or ''}".strip()
    return {
        "student_id": student_key,
        "display_name": name or student_key,
        "has_id": not student_key.startswith("name:"),
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "attempts_count": len(attempts),
        "score_sum": score,
        "score_total": total,
        "avg_percent": avg,
        "band": band_of(avg),
        "minutes": round(sum(int(a.duration_sec or 0) for a, _ in rows) / 60),
        "first_at": first.submitted_at,
        "last_at": rows[0][0].submitted_at,
        "rank": better + 1,
        "rank_total": len(everyone),
        "best_percent": max((x["percent"] or 0) for x in attempts),
        "worst_percent": min((x["percent"] or 0) for x in attempts),
        "subjects": sorted(finish(subjects), key=lambda x: (x["percent"] or 0)),
        "teachers": sorted(finish(teachers), key=lambda x: x["name"].lower()),
        "days": sorted(finish(days), key=lambda x: x["key"]),
        "attempts": attempts,
        "online": _student_online(db, student_key, start_day, end_day),
    }


def _student_online(db: Session, student_key: str, start_day: dt.date, end_day: dt.date) -> dict:
    """Online ta'lim: darsda qatnashgani va mavzu testlari (ID bo'lsa)."""
    if student_key.startswith("name:"):
        return {"lessons": 0, "minutes": 0, "tests": 0, "avg_percent": None}
    start, end = range_bounds(start_day, end_day)
    att = db.execute(
        select(func.count(OnlineAttendance.id), func.coalesce(func.sum(OnlineAttendance.total_seconds), 0)).where(
            OnlineAttendance.student_id == student_key, OnlineAttendance.joined_at >= start, OnlineAttendance.joined_at < end
        )
    ).one()
    tests = db.execute(
        select(
            func.count(OnlineProgress.id),
            func.coalesce(func.sum(OnlineProgress.test_score), 0),
            func.coalesce(func.sum(OnlineProgress.test_total), 0),
        ).where(
            OnlineProgress.student_id == student_key,
            OnlineProgress.test_submitted_at >= start,
            OnlineProgress.test_submitted_at < end,
        )
    ).one()
    return {
        "lessons": int(att[0] or 0),
        "minutes": round(int(att[1] or 0) / 60),
        "tests": int(tests[0] or 0),
        "avg_percent": _pct(tests[1], tests[2]),
    }


def online_student_summary(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict:
    """Online ta'lim va malaka bo'yicha talaba/tinglovchi ko'rsatkichlari."""
    start, end = range_bounds(start_day, end_day)

    attendance = db.execute(
        select(
            func.count(func.distinct(OnlineAttendance.student_id)).label("students"),
            func.count(OnlineAttendance.id).label("visits"),
            func.coalesce(func.sum(OnlineAttendance.total_seconds), 0).label("seconds"),
        ).where(OnlineAttendance.joined_at >= start, OnlineAttendance.joined_at < end)
    ).one()

    online_tests = db.execute(
        select(
            func.count(OnlineProgress.id).label("submitted"),
            func.coalesce(func.sum(OnlineProgress.test_score), 0).label("score_sum"),
            func.coalesce(func.sum(OnlineProgress.test_total), 0).label("score_total"),
        ).where(
            OnlineProgress.test_submitted_at >= start,
            OnlineProgress.test_submitted_at < end,
        )
    ).one()

    malaka = db.execute(
        select(
            func.count(func.distinct(MalakaTestAttempt.student_id)).label("listeners"),
            func.count(MalakaTestAttempt.id).label("attempts"),
            func.coalesce(func.sum(MalakaTestAttempt.score), 0).label("score_sum"),
            func.coalesce(func.sum(MalakaTestAttempt.total), 0).label("score_total"),
        ).where(
            MalakaTestAttempt.submitted_at >= start,
            MalakaTestAttempt.submitted_at < end,
        )
    ).one()

    return {
        "attendance_students": int(attendance.students or 0),
        "attendance_visits": int(attendance.visits or 0),
        "attendance_minutes": round(int(attendance.seconds or 0) / 60),
        "online_tests_submitted": int(online_tests.submitted or 0),
        "online_avg_percent": _pct(online_tests.score_sum, online_tests.score_total),
        "malaka_listeners": int(malaka.listeners or 0),
        "malaka_attempts": int(malaka.attempts or 0),
        "malaka_avg_percent": _pct(malaka.score_sum, malaka.score_total),
    }


# ============================ Umumiy ko'rinish ============================


def overview(db: Session, *, start_day: dt.date, end_day: dt.date, department: str = "", allowed_departments: list[str] | tuple[str, ...] | None = None) -> dict:
    """Rektor ekranining tepasidagi yagona manzara."""
    teachers = teacher_report(db, start_day=start_day, end_day=end_day, department=department, allowed_departments=allowed_departments)
    active = [t for t in teachers if t["is_active"]]

    students = student_report(db, start_day=start_day, end_day=end_day, allowed_departments=allowed_departments)
    score_sum = sum(s["score_sum"] for s in students)
    score_total = sum(s["score_total"] for s in students)

    bands = {key: 0 for key, _label, _floor in GRADE_BANDS}
    for s in students:
        if s["band"]:
            bands[s["band"]] = bands.get(s["band"], 0) + 1

    # Kunlik chiziq — faollik va darslar dinamikasi.
    start, end = range_bounds(start_day, end_day)
    daily_tests = {
        r.day: int(r.n or 0)
        for r in db.execute(
            select(
                StudentTestAttempt.submitted_date.label("day"),
                func.count(StudentTestAttempt.id).label("n"),
            )
            .where(
                StudentTestAttempt.submitted_date >= start_day,
                StudentTestAttempt.submitted_date <= end_day,
            )
            .group_by("day")
        ).all()
    }
    daily_lessons = {
        r.day: int(r.n or 0)
        for r in db.execute(
            select(
                _local_day(LiveTestSession.created_at).label("day"),
                func.count(LiveTestSession.id).label("n"),
            )
            .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
            .group_by("day")
        ).all()
    }

    days: list[dict] = []
    cursor = start_day
    while cursor <= end_day:
        days.append(
            {
                "date": cursor.isoformat(),
                "tests": daily_tests.get(cursor, 0),
                "lessons": daily_lessons.get(cursor, 0),
            }
        )
        cursor += dt.timedelta(days=1)

    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "teachers": {
            "total": len(teachers),
            "active": len(active),
            "inactive": sum(1 for t in teachers if t.get("schedule_linked") and not t["is_active"]),
            "unlinked": sum(1 for t in teachers if not t.get("schedule_linked")),
            "minutes": sum(t["minutes"] for t in teachers),
            "avg_minutes": round(sum(t["minutes"] for t in active) / len(active)) if active else 0,
            "cases_created": sum(t["cases_created"] for t in teachers),
            "tests_created": sum(t["tests_created"] for t in teachers),
            "handouts_created": sum(t["handouts_created"] for t in teachers),
            "videos_created": sum(t["videos_created"] for t in teachers),
            "presentations_created": sum(t["presentations_created"] for t in teachers),
            "live_sessions": sum(t["live_sessions"] for t in teachers),
            "online_lessons": sum(t["online_lessons"] for t in teachers),
        },
        "students": {
            "total": len(students),
            "attempts": sum(s["attempts"] for s in students),
            "avg_percent": _pct(score_sum, score_total),
            "bands": [
                {"key": key, "label": label, "count": bands.get(key, 0)}
                for key, label, _floor in GRADE_BANDS
            ],
        },
        "online": online_student_summary(db, start_day=start_day, end_day=end_day),
        "days": days,
    }


# ============================ Filtrlar ============================


def filter_options(db: Session) -> dict:
    """Smart filtrlar uchun ro'yxatlar — kafedra, fan, guruh, o'quv yili."""
    departments = sorted(
        {
            (d or "").strip()
            for (d,) in db.execute(select(StaffProfile.department).distinct()).all()
            if (d or "").strip()
        }
    )

    from app.services.syllabus_access import public_syllabus_clause

    subject_rows = db.execute(
        select(CourseSyllabus.subject_code, CourseSyllabus.subject_name)
        .where(CourseSyllabus.subject_code != "", public_syllabus_clause())
        .distinct()
    ).all()
    excluded = report_exclusion.load(db)
    departments = [d for d in departments if not excluded.department_excluded(d)]
    subjects = sorted(
        [
            {"code": r.subject_code, "name": r.subject_name or r.subject_code}
            for r in subject_rows
            if not excluded.subject_excluded(r.subject_name, r.subject_code)
        ],
        key=lambda s: s["name"].lower(),
    )

    groups = sorted(
        {
            (g or "").strip()
            for (g,) in db.execute(select(OnlineGroup.name).distinct()).all()
            if (g or "").strip()
        }
    )

    years = sorted(
        {
            (y or "").strip()
            for (y,) in db.execute(select(StudentTestAttempt.academic_year).distinct()).all()
            if (y or "").strip()
        },
        reverse=True,
    )

    return {
        "departments": departments,
        "subjects": subjects,
        "groups": groups,
        "academic_years": years,
        "bands": [{"key": key, "label": label} for key, label, _floor in GRADE_BANDS],
    }
