"""Dars jadvali bo'yicha nazorat hisoboti — har bir xodim kesimida (2026-09-25).

Ilgari hisobot MONITOR atrofida qurilgan edi: faqat monitorli xonalardagi
darslar ko'rinardi (13 800 darsdan 2 600 tasi) va faqat kafedra Excel yuborgan
o'qituvchilar hisobga olinardi. Ya'ni ko'pchilik nazoratdan chetda qolardi.

Endi manba — HEMIS jadvalining to'liq nusxasi (`core_hemislesson`). Har bir
dars uchun bitta savolga javob beriladi: o'qituvchi shu dars vaqtida iMentor'ni
ishlatdimi? "Ishlatdi" degani — o'sha oynada jonli test ochgani yoki QR bilan
kompyuterga kirgani (monitor hisobotidagi bilan bir xil o'lchov).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.services import monitor_schedule_service as ms

# Dars boshlanishidan oldin va tugagandan keyin qancha vaqt "shu darsniki" hisoblanadi.
BEFORE = dt.timedelta(minutes=15)
AFTER = dt.timedelta(minutes=5)


def _window(lesson: HemisLesson) -> tuple[dt.datetime, dt.datetime]:
    """Darsning vaqt oynasi. Vaqti yozilmagan bo'lsa — para jadvalidan."""
    start_hhmm, end_hhmm = lesson.start_time, lesson.end_time
    if not (start_hhmm and end_hhmm):
        start_hhmm, end_hhmm = ms.PERIOD_TIMES.get(lesson.para, ("08:00", "09:20"))
    try:
        sh, sm = (int(x) for x in start_hhmm.split(":")[:2])
        eh, em = (int(x) for x in end_hhmm.split(":")[:2])
    except ValueError:
        sh, sm, eh, em = 8, 0, 9, 20
    day = lesson.lesson_date
    start = dt.datetime.combine(day, dt.time(sh, sm), tzinfo=ms.TASHKENT) - BEFORE
    end = dt.datetime.combine(day, dt.time(eh, em), tzinfo=ms.TASHKENT) + AFTER
    return start, end


def _lessons(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
             teacher: str = "") -> list[HemisLesson]:
    q = select(HemisLesson).where(HemisLesson.lesson_date >= start_day, HemisLesson.lesson_date <= end_day)
    if teacher:
        q = q.where(HemisLesson.teacher_username == teacher)
    rows = list(db.execute(q).scalars())
    if department:
        needle = ms._norm(department)
        rows = [r for r in rows if needle in ms._norm(r.department_name) or ms._norm(r.department_name) in needle]
    return rows


def _used_map(db: Session, lessons: list[HemisLesson]) -> dict[int, tuple[bool, int]]:
    """Har dars uchun (ishlatildimi, talaba soni)."""
    usernames = {x.teacher_username for x in lessons if x.teacher_username}
    if not usernames or not lessons:
        return {}
    days = [x.lesson_date for x in lessons]
    window_start = dt.datetime.combine(min(days), dt.time(0, 0), tzinfo=ms.TASHKENT)
    window_end = dt.datetime.combine(max(days) + dt.timedelta(days=1), dt.time(0, 0), tzinfo=ms.TASHKENT)
    events = ms._usage_events(db, usernames, window_start, window_end)

    out: dict[int, tuple[bool, int]] = {}
    for lesson in lessons:
        if not lesson.teacher_username:
            continue
        start, end = _window(lesson)
        students = 0
        used = False
        for when, count in events.get(lesson.teacher_username, []):
            if start <= when <= end:
                used = True
                students += count
        if used:
            out[lesson.id] = (True, students)
    return out


def teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                 query: str = "") -> dict:
    """Har o'qituvchi bo'yicha bitta qator: nechta dars, nechtasida ishlatgan."""
    lessons = _lessons(db, start_day, end_day, department=department)
    used = _used_map(db, lessons)

    by_teacher: dict[str, dict] = {}
    for lesson in lessons:
        # Hisobiga bog'lanmagan o'qituvchi ham ko'rinadi — uni topish kerak.
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        row = by_teacher.setdefault(key, {
            "teacher_key": lesson.teacher_username,
            "teacher_name": lesson.teacher_name,
            "employee_id": lesson.employee_id,
            "linked": bool(lesson.teacher_username),
            "departments": set(),
            "lessons": 0,
            "used_lessons": 0,
            "with_monitor": 0,
            "students": 0,
            "subjects": set(),
            "groups": set(),
            "days": set(),
            "used_days": set(),
            "last_used": None,
        })
        row["lessons"] += 1
        row["departments"].add(lesson.department_name)
        row["days"].add(lesson.lesson_date)
        if lesson.subject_name:
            row["subjects"].add(lesson.subject_name)
        if lesson.group_name:
            row["groups"].add(lesson.group_name)
        if lesson.monitor_id:
            row["with_monitor"] += 1
        hit = used.get(lesson.id)
        if hit:
            row["used_lessons"] += 1
            row["students"] += hit[1]
            row["used_days"].add(lesson.lesson_date)
            if row["last_used"] is None or lesson.lesson_date > row["last_used"]:
                row["last_used"] = lesson.lesson_date

    needle = (query or "").strip().casefold()
    rows = []
    for row in by_teacher.values():
        if needle and needle not in f"{row['teacher_name']} {row['teacher_key']}".casefold():
            continue
        lessons_count = row["lessons"]
        rows.append({
            **{k: v for k, v in row.items() if k not in ("departments", "subjects", "groups", "days", "used_days")},
            "department": " / ".join(sorted(row["departments"]))[:200],
            "subject_count": len(row["subjects"]),
            "group_count": len(row["groups"]),
            "days": len(row["days"]),
            "used_days": len(row["used_days"]),
            "usage_percent": round(100 * row["used_lessons"] / lessons_count) if lessons_count else 0,
            "last_used": row["last_used"].isoformat() if row["last_used"] else None,
        })
    rows.sort(key=lambda r: (r["usage_percent"], -r["lessons"]))

    total_lessons = sum(r["lessons"] for r in rows)
    total_used = sum(r["used_lessons"] for r in rows)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "totals": {
            "teachers": len(rows),
            "linked_teachers": sum(1 for r in rows if r["linked"]),
            "lessons": total_lessons,
            "used_lessons": total_used,
            "usage_percent": round(100 * total_used / total_lessons) if total_lessons else 0,
            "never_used": sum(1 for r in rows if r["used_lessons"] == 0),
            "with_monitor": sum(r["with_monitor"] for r in rows),
        },
        "results": rows,
    }


def department_rows(db: Session, start_day: dt.date, end_day: dt.date) -> list[dict]:
    """Kafedra kesimi — qaysi kafedra qanchalik ishlatyapti."""
    lessons = _lessons(db, start_day, end_day)
    used = _used_map(db, lessons)
    agg: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "used": 0, "teachers": set(), "used_teachers": set()})
    for lesson in lessons:
        row = agg[lesson.department_name or "—"]
        row["lessons"] += 1
        if lesson.teacher_username:
            row["teachers"].add(lesson.teacher_username)
        if lesson.id in used:
            row["used"] += 1
            if lesson.teacher_username:
                row["used_teachers"].add(lesson.teacher_username)
    out = [{
        "department": name,
        "lessons": r["lessons"],
        "used_lessons": r["used"],
        "usage_percent": round(100 * r["used"] / r["lessons"]) if r["lessons"] else 0,
        "teachers": len(r["teachers"]),
        "active_teachers": len(r["used_teachers"]),
    } for name, r in agg.items()]
    out.sort(key=lambda r: (r["usage_percent"], -r["lessons"]))
    return out


def lesson_rows(db: Session, start_day: dt.date, end_day: dt.date, *, teacher: str = "",
                department: str = "", only_missed: bool = False, limit: int = 2000) -> list[dict]:
    """Darslar ro'yxati — kim, qachon, qaysi fan, ishlatildimi."""
    lessons = _lessons(db, start_day, end_day, department=department, teacher=teacher)
    used = _used_map(db, lessons)
    lessons.sort(key=lambda x: (x.lesson_date, x.para, x.teacher_name))
    out = []
    for lesson in lessons:
        hit = used.get(lesson.id)
        if only_missed and hit:
            continue
        out.append({
            "id": lesson.id,
            "date": lesson.lesson_date.isoformat(),
            "weekday": lesson.weekday,
            "para": lesson.para,
            "start_time": lesson.start_time,
            "end_time": lesson.end_time,
            "teacher_name": lesson.teacher_name,
            "teacher_key": lesson.teacher_username,
            "department": lesson.department_name,
            "subject": lesson.subject_name,
            "group": lesson.group_name,
            "lesson_type": lesson.lesson_type,
            "room": lesson.auditorium_name,
            "building": lesson.building_name,
            "monitor_id": lesson.monitor_id,
            "used": bool(hit),
            "students": hit[1] if hit else 0,
            # Dalil: bu qator qaysi HEMIS yozuvidan va qaysi inventar xonasidan
            # kelgani — «menda dars yo'q edi», «xonada monitor yo'q» degan
            # gaplarni shu yerda tekshirish mumkin.
            "hemis_id": lesson.hemis_id,
            "auditorium_code": getattr(lesson, "auditorium_code", ""),
            "monitor_room": getattr(lesson, "monitor_room", ""),
            "monitor_department": getattr(lesson, "monitor_department", ""),
            "synced_at": (lambda t: t.isoformat() if t else None)(getattr(lesson, "synced_at", None)),
        })
        if len(out) >= limit:
            break
    return out
