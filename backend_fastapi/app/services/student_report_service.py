"""Rektor hisoboti: TALABALAR bo'limi (2026-10-15).

Rektor talabi: o'qituvchilar bo'yicha alohida, talabalar bo'yicha alohida
sahifa bo'lsin. Talabalar sahifasida yuqorida aqlli filtr — fakultet,
kafedra, guruh, kurs — va tanlanganda ko'rinsin:

  * qaysi talaba qaysi KUNI, qaysi DARSDA, qaysi MAVZU bo'yicha test
    topshirgan;
  * testni qanday topshirgan (ball, foiz, sarflangan vaqt);
  * SAVOLLARNING o'zi va talaba qaysi javobni belgilagani;
  * darsni qaysi O'QITUVCHI o'tgani.

Qo'shimcha, so'ralmagan, lekin shu sahifasiz ma'nosi yo'q narsalar:

  * shubhali urinishlar (juda tez topshirilgan, sahifadan chiqib ketilgan,
    boshqalar bilan bir xil noyob javoblar) — baho ishonchliligi uchun;
  * umuman test topshirmagan talabalar — hisobotning eng muhim qismi,
    chunki ular odatda ko'rinmay qoladi;
  * rahbariyat tahlili (`overview`): baho taqsimoti, kurs, fakultet va
    guruh kesimi, xavf ostidagi talabalar, o'qituvchilar kesimida natija.

"Eng ko'p xato qilingan savollar" bo'limi rektor so'rovi bilan olib
tashlangan (2026-10-15).

Ma'lumot manbalari: `core_studenttestattempt` (savollar nusxasi va
belgilangan javoblar bilan), `core_livetestsession` (o'qituvchi),
`core_studentcontingent` (fakultet/guruh/kurs), `core_hemislesson`
(o'sha kundagi dars va o'qituvchi).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt, StudentTestAttemptEvent
from app.models.content import CourseSyllabus
from app.models.live_test import LiveTestSession
from app.models.student_contingent import StudentContingent
from app.services.dean_access import in_groups

#: Shundan tez topshirilgan test shubhali deb belgilanadi (savoliga sekund).
FAST_SECONDS_PER_QUESTION = 8


def _full_name(row: StudentContingent) -> str:
    return " ".join(x for x in (row.last_name, row.first_name, row.middle_name) if x).strip()


def _pct(score: int, total: int) -> int | None:
    return round(100 * score / total) if total else None


#: O'zbekiston 5 ballik tizimi: foizdan bahoga (yuqoridan pastga).
GRADE_BANDS: tuple[tuple[int, int, str], ...] = (
    (5, 86, "A’lo"),
    (4, 71, "Yaxshi"),
    (3, 55, "Qoniqarli"),
    (2, 0, "Qoniqarsiz"),
)


def grade_of(percent: int | None) -> int | None:
    """Foizdan baho: 86+ — 5, 71+ — 4, 55+ — 3, qolgani — 2."""
    if percent is None:
        return None
    for grade, floor, _label in GRADE_BANDS:
        if percent >= floor:
            return grade
    return 2


def _contingent(db: Session, groups: tuple[str, ...]) -> dict[str, StudentContingent]:
    """Faol talabalar — kalit `student_id`. Dekan guruhi bilan cheklanadi."""
    rows = db.execute(
        select(StudentContingent).where(StudentContingent.status == "active")
    ).scalars()
    return {r.student_id: r for r in rows if in_groups(r.group_name, groups)}


@dataclass(frozen=True)
class LessonScope:
    """Talabalar sahifasining doirasi (rektor talabi, 2026-10-15).

    "Hamma talabani emas — monitorli xonada dars o'tayotgan o'qituvchilarning
    talabalarini o'zini hisobga olaylik." Shuning uchun:

    * talaba — shu davrda MONITORLI xonada darsi bo'lgan guruhda o'qiydi;
    * test — o'sha guruhga monitorli xonada dars o'tgan o'qituvchi
      o'tkazgan bo'lsa sanaladi (`pairs`: o'qituvchi + guruh).

    Kafedra tanlansa, faqat shu kafedraning darslari olinadi. Hisobotdan
    chiqarilgan kafedralar va xodimlar (`report_exclusion`) bu yerga ham
    kirmaydi — darslar o'qituvchilar hisoboti bilan BIR XIL manbadan.
    """

    groups: dict[str, int]
    pairs: frozenset[tuple[str, str]]
    #: Rasmiy kafedra -> (guruhlar, o'qituvchi+guruh juftliklari).
    departments: dict[str, tuple[frozenset[str], frozenset[tuple[str, str]]]] = field(default_factory=dict)

    def has(self, group: str) -> bool:
        return (group or "") in self.groups

    def counts(self, owner: str, group: str) -> bool:
        return ((owner or ""), (group or "")) in self.pairs


#: Doira turlari: "monitor" — monitorli xonadagi darslar (asosiy), "all" —
#: barcha talabalar (kafedra tanlanmagan bo'lsa cheklovsiz).
SCOPES = ("monitor", "all")


def lesson_scope(db: Session, start_day: dt.date, end_day: dt.date, *,
                 scope: str = "monitor", department: str = "",
                 groups: tuple[str, ...] = ()) -> LessonScope | None:
    """Davrdagi darslardan talabalar doirasi. `None` — cheklov yo'q."""
    from app.services import lesson_report_service as lr

    monitored = scope != "all"
    if not monitored and not department:
        return None
    # Faqat TUGAGAN darslar — o'qituvchilar hisoboti bilan bir xil qoida:
    # ertalab tushdan keyingi darsning guruhi "test topshirmagan" bo'lmasin.
    lessons = lr._lessons(db, start_day, end_day, department=department, groups=groups)
    return scope_of(lessons, monitored=monitored)


def scope_of(lessons, *, monitored: bool) -> LessonScope:
    """Darslar ro'yxatidan doira: guruhlar, juftliklar va kafedralar."""
    from app.services import lesson_report_service as lr
    from app.services.dean_access import official_of

    counted: dict[str, int] = defaultdict(int)
    pairs: set[tuple[str, str]] = set()
    chairs: dict[str, tuple[set, set]] = {}
    for lesson in lessons:
        if monitored and not getattr(lesson, "monitor_id", None):
            continue
        teacher = (getattr(lesson, "teacher_username", "") or "").strip()
        raw = (getattr(lesson, "department_name", "") or "").strip()
        chair = chairs.setdefault(official_of(raw) or raw or "—", (set(), set()))
        for group in lr.lesson_groups(lesson):
            counted[group] += 1
            chair[0].add(group)
            if teacher:
                pairs.add((teacher, group))
                chair[1].add((teacher, group))
    return LessonScope(
        groups=dict(counted),
        pairs=frozenset(pairs),
        departments={k: (frozenset(g), frozenset(p)) for k, (g, p) in chairs.items()},
    )


def filters(db: Session, *, groups: tuple[str, ...] = ()) -> dict:
    """Saralash ro'yxatlari: fakultet, kurs, guruh va fanlar (kafedra o'rnida).

    Kafedra talabada emas, FANDA bo'ladi: talaba kafedrasi degan tushuncha
    yo'q, shuning uchun filtr fan (va uning kafedrasi) bo'yicha ishlaydi.
    """
    people = _contingent(db, groups)
    faculties: dict[str, set[str]] = defaultdict(set)
    courses: set[int] = set()
    for row in people.values():
        if row.faculty_name:
            faculties[row.faculty_name].add(row.group_name or "")
        if row.course:
            courses.add(int(row.course))

    subjects = db.execute(
        select(CourseSyllabus.subject_code, CourseSyllabus.subject_name)
        .where(CourseSyllabus.is_active.is_(True))
        .order_by(CourseSyllabus.subject_name)
    ).all()
    return {
        "faculties": sorted(faculties),
        "groups": sorted({g for gs in faculties.values() for g in gs if g}),
        "courses": sorted(courses),
        "subjects": [{"code": c, "name": n} for c, n in subjects if c],
        "groups_by_faculty": {f: sorted(g for g in gs if g) for f, gs in faculties.items()},
        "students_total": len(people),
    }


def _attempt_rows(db: Session, start_day: dt.date, end_day: dt.date):
    """Davrdagi urinishlar + dars egasi (o'qituvchi) — to'liq qator."""
    return db.execute(
        select(StudentTestAttempt, LiveTestSession.owner_key)
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id, isouter=True)
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .order_by(StudentTestAttempt.submitted_at.desc())
    ).all()


def _light_rows(db: Session, start_day: dt.date, end_day: dt.date):
    """Davrdagi urinishlar — savollar nusxasisiz.

    Ro'yxat va tahlil uchun savollarning o'zi kerak emas, ular esa qatorning
    eng og'ir qismi: 7 kunda 17 mingdan ortiq urinish (2026-10-15 o'lchovi).
    """
    return db.execute(
        select(
            StudentTestAttempt.id,
            StudentTestAttempt.session_id,
            StudentTestAttempt.student_id,
            StudentTestAttempt.subject_code,
            StudentTestAttempt.topic,
            StudentTestAttempt.variant_label,
            StudentTestAttempt.answers_final,
            StudentTestAttempt.score,
            StudentTestAttempt.total,
            StudentTestAttempt.duration_sec,
            StudentTestAttempt.submitted_date,
            StudentTestAttempt.submitted_at,
            LiveTestSession.owner_key,
        )
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id, isouter=True)
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
        )
        .order_by(StudentTestAttempt.submitted_at.desc())
    ).all()


def _wanted(people: dict[str, StudentContingent], *, faculty: str = "", group: str = "",
            course: int | None = None, query: str = "") -> dict[str, StudentContingent]:
    """Filtrga mos talabalar."""
    return {
        sid: row
        for sid, row in people.items()
        if (not faculty or row.faculty_name == faculty)
        and (not group or row.group_name == group)
        and (course is None or int(row.course or 0) == course)
        and (not query or query.casefold() in f"{_full_name(row)} {row.student_id}".casefold())
    }


def student_rows(db: Session, start_day: dt.date, end_day: dt.date, *,
                 faculty: str = "", group: str = "", course: int | None = None,
                 subject_code: str = "", query: str = "",
                 scope: str = "monitor", department: str = "",
                 groups: tuple[str, ...] = ()) -> dict:
    """Talabalar ro'yxati — filtr bo'yicha, test topshirmaganlari bilan birga."""
    people = _contingent(db, groups)
    wanted = _wanted(people, faculty=faculty, group=group, course=course, query=query)
    area = lesson_scope(db, start_day, end_day, scope=scope, department=department, groups=groups)
    if area is not None:
        wanted = {sid: row for sid, row in wanted.items() if area.has(row.group_name)}

    stats: dict[str, dict] = {}
    for attempt in _light_rows(db, start_day, end_day):
        sid = (attempt.student_id or "").strip()
        if sid not in wanted:
            continue
        if subject_code and (attempt.subject_code or "") != subject_code:
            continue
        if area is not None and not area.counts(attempt.owner_key, wanted[sid].group_name):
            continue
        item = stats.setdefault(sid, {
            "attempts": 0, "score": 0, "total": 0, "seconds": 0,
            "subjects": set(), "days": set(), "last_at": None,
        })
        item["attempts"] += 1
        item["score"] += int(attempt.score or 0)
        item["total"] += int(attempt.total or 0)
        item["seconds"] += int(attempt.duration_sec or 0)
        if attempt.subject_code:
            item["subjects"].add(attempt.subject_code)
        item["days"].add(attempt.submitted_date)
        if item["last_at"] is None or attempt.submitted_at > item["last_at"]:
            item["last_at"] = attempt.submitted_at

    rows: list[dict] = []
    for sid, person in wanted.items():
        item = stats.get(sid)
        percent = _pct(item["score"], item["total"]) if item else None
        rows.append({
            "student_id": sid,
            "student_key": f"ot_{sid}",
            "full_name": _full_name(person) or sid,
            "group_name": person.group_name or "",
            "course": int(person.course or 0) or None,
            "faculty": person.faculty_name or "",
            "direction": person.direction_name or "",
            "attempts": item["attempts"] if item else 0,
            "subjects": len(item["subjects"]) if item else 0,
            "days": len(item["days"]) if item else 0,
            "percent": percent,
            "grade": grade_of(percent),
            "minutes": round(item["seconds"] / 60) if item else 0,
            "last_at": item["last_at"].isoformat() if item and item["last_at"] else None,
        })

    # Test topshirmaganlar oldinda emas, lekin yo'qolmaydi: avval ishlaganlar
    # natijasi bo'yicha, keyin qolganlari.
    rows.sort(key=lambda r: (r["attempts"] == 0, -(r["attempts"]), r["full_name"]))
    took = [r for r in rows if r["attempts"]]
    score_sum = sum(stats[r["student_id"]]["score"] for r in took)
    total_sum = sum(stats[r["student_id"]]["total"] for r in took)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "headline": {
            "students": len(rows),
            "took_test": len(took),
            "never": len(rows) - len(took),
            "attempts": sum(r["attempts"] for r in rows),
            "percent": _pct(score_sum, total_sum),
        },
        "students": rows,
    }


def _lesson_of(db: Session, attempt: StudentTestAttempt, owner: str) -> dict:
    """O'sha kuni shu o'qituvchining darsi — mavzuni darsga bog'lash uchun."""
    from app.models.hemis_lesson import HemisLesson

    if not owner:
        return {}
    row = db.execute(
        select(HemisLesson)
        .where(
            HemisLesson.lesson_date == attempt.submitted_date,
            HemisLesson.teacher_username == owner,
        )
        .order_by(HemisLesson.start_time)
    ).scalars().first()
    if row is None:
        return {}
    return {
        "para": row.para or "",
        "start_time": row.start_time or "",
        "group_name": row.group_name or "",
        "subject_name": row.subject_name or "",
        "auditorium": row.auditorium_name or "",
        "building": row.building_name or "",
        "department": row.department_name or "",
    }


def student_attempts(db: Session, student_key: str, start_day: dt.date, end_day: dt.date,
                     *, scope: str = "all", department: str = "",
                     groups: tuple[str, ...] = ()) -> dict:
    """Bitta talabaning har bir testi: kuni, darsi, mavzusi, o'qituvchisi, natijasi."""
    from app.services.rector_report_service import staff_directory

    sid = student_key.replace("ot_", "").strip()
    person = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    if groups and (person is None or not in_groups(person.group_name, groups)):
        raise PermissionError("Bu talaba sizning fakultetingizga tegishli emas.")

    directory = staff_directory(db)
    area = lesson_scope(db, start_day, end_day, scope=scope, department=department, groups=groups)
    codes = set()
    picked = []
    for attempt, owner in _attempt_rows(db, start_day, end_day):
        if (attempt.student_id or "").strip() != sid:
            continue
        # Ro'yxatdagi raqam bilan bir xil bo'lsin: doiradan tashqari testlar
        # (monitorsiz darsdagi yoki boshqa kafedraning) bu yerda ham sanalmaydi.
        if area is not None and person is not None and not area.counts(owner or "", person.group_name):
            continue
        picked.append((attempt, owner or ""))
        if attempt.subject_code:
            codes.add(attempt.subject_code)

    names = {
        c.subject_code: c.subject_name
        for c in db.execute(
            select(CourseSyllabus).where(CourseSyllabus.subject_code.in_(codes or {""}))
        ).scalars()
    }

    attempts = []
    for attempt, owner in picked:
        total = int(attempt.total or 0)
        seconds = int(attempt.duration_sec or 0)
        attempts.append({
            "id": attempt.id,
            "date": attempt.submitted_date.isoformat(),
            "submitted_at": attempt.submitted_at.isoformat(),
            "subject_code": attempt.subject_code or "",
            "subject_name": names.get(attempt.subject_code or "", "") or attempt.subject_code or "",
            "topic": attempt.topic or "",
            "variant": attempt.variant_label or "",
            "teacher_key": owner,
            "teacher_name": directory.get(owner, {}).get("display_name", owner),
            "score": int(attempt.score or 0),
            "total": total,
            "percent": _pct(int(attempt.score or 0), total),
            "minutes": round(seconds / 60, 1),
            # Juda tez topshirilgan test — baho ishonchliligini tekshirish uchun.
            "too_fast": bool(total and seconds and seconds < total * FAST_SECONDS_PER_QUESTION),
            "lesson": _lesson_of(db, attempt, owner),
        })

    return {
        "student": {
            "student_id": sid,
            "full_name": _full_name(person) if person else sid,
            "group_name": person.group_name if person else "",
            "course": int(person.course or 0) if person and person.course else None,
            "faculty": person.faculty_name if person else "",
            "direction": person.direction_name if person else "",
        },
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "attempts": attempts,
    }


def attempt_detail(db: Session, attempt_id: int, *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta urinish: har savol, variantlar, talaba belgilagani va to'g'risi."""
    from app.services.rector_report_service import staff_directory

    row = db.execute(
        select(StudentTestAttempt, LiveTestSession.owner_key)
        .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id, isouter=True)
        .where(StudentTestAttempt.id == attempt_id)
    ).first()
    if row is None:
        raise LookupError("Bunday urinish topilmadi.")
    attempt, owner = row

    person = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == (attempt.student_id or ""))
    ).scalars().first()
    if groups and (person is None or not in_groups(person.group_name, groups)):
        raise PermissionError("Bu talaba sizning fakultetingizga tegishli emas.")

    questions = attempt.questions_snapshot if isinstance(attempt.questions_snapshot, list) else []
    answers = attempt.answers_final if isinstance(attempt.answers_final, list) else []
    items = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        chosen = answers[i] if i < len(answers) else None
        correct = q.get("correctOptionIndex")
        ok = (
            chosen is not None and correct is not None
            and str(chosen).isdigit() and int(chosen) == int(correct)
        )
        items.append({
            "index": i,
            "question": q.get("question", ""),
            "options": q.get("options", []),
            "selected_index": chosen if isinstance(chosen, int) else None,
            "correct_index": correct if isinstance(correct, int) else None,
            "is_correct": ok,
            # Javobsiz qoldirilgani alohida: xato bilan bir xil emas.
            "skipped": chosen is None,
            "explanation": q.get("explanation", ""),
        })

    events = db.execute(
        select(StudentTestAttemptEvent)
        .where(StudentTestAttemptEvent.attempt_id == attempt.id)
        .order_by(StudentTestAttemptEvent.occurred_at)
    ).scalars().all()

    directory = staff_directory(db)
    total = int(attempt.total or 0)
    seconds = int(attempt.duration_sec or 0)
    return {
        "id": attempt.id,
        "student": {
            "student_id": attempt.student_id or "",
            "full_name": (_full_name(person) if person else "")
            or f"{attempt.last_name or ''} {attempt.first_name or ''}".strip(),
            "group_name": person.group_name if person else "",
            "course": int(person.course or 0) if person and person.course else None,
            "faculty": person.faculty_name if person else "",
        },
        "date": attempt.submitted_date.isoformat(),
        "submitted_at": attempt.submitted_at.isoformat(),
        "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
        "subject_code": attempt.subject_code or "",
        "topic": attempt.topic or "",
        "variant": attempt.variant_label or "",
        "teacher_key": owner or "",
        "teacher_name": directory.get(owner or "", {}).get("display_name", owner or ""),
        "score": int(attempt.score or 0),
        "total": total,
        "percent": _pct(int(attempt.score or 0), total),
        "minutes": round(seconds / 60, 1),
        "too_fast": bool(total and seconds and seconds < total * FAST_SECONDS_PER_QUESTION),
        "lesson": _lesson_of(db, attempt, owner or ""),
        "questions": items,
        # Sahifadan chiqib ketish kabi qaydlar — baho ishonchliligi uchun.
        "events": [
            {
                "type": e.event_type,
                "question_index": e.question_index,
                "at": e.occurred_at.isoformat() if e.occurred_at else None,
            }
            for e in events
        ],
    }


# =================================================================== tahlil
#
# Rektor talabi (2026-10-15): "rektor va boshqarma ko'rishi kerak bo'lgan
# narsalarni qo'shing". Ro'yxatning o'zi talabani TOPISH uchun; rahbariyat
# esa avval umumiy manzarani ko'radi: qamrov, baho taqsimoti, qaysi kurs va
# guruh orqada, kim xavf ostida, natijalarga ishonsa bo'ladimi, va qaysi
# o'qituvchining darsida talabalar qanday natija ko'rsatyapti.

#: Xavf ostidagi talaba: kamida shuncha test va o'rtacha natija 55% dan past
#: (5 ballik tizimda "qoniqarsiz").
RISK_MIN_ATTEMPTS = 3
RISK_PERCENT = 55
#: Test vaqtida sahifadan jami shuncha soniyadan ko'p chiqib ketish belgilanadi.
#: 2026-10-15 o'lchovi: 7 kunda 17 717 urinishning 3 536 tasida 30+ soniya.
AWAY_SECONDS = 30
#: Ro'yxatlar uzunligi — sahifa og'irlashmasin, jami soni alohida beriladi.
LIST_LIMIT = 60


def _away_seconds(db: Session, start_day: dt.date, end_day: dt.date) -> dict[int, float]:
    """Har urinishda test sahifasi necha soniya yashirin turgani.

    `visibility_hidden` dan keyingi `visibility_visible` gacha bo'lgan vaqt
    qo'shiladi: boshqa varaqqa yoki ilovaga o'tib qaytgan vaqt.
    """
    rows = db.execute(
        select(
            StudentTestAttemptEvent.attempt_id,
            StudentTestAttemptEvent.event_type,
            StudentTestAttemptEvent.client_ts_ms,
            StudentTestAttemptEvent.occurred_at,
        )
        .join(StudentTestAttempt, StudentTestAttempt.id == StudentTestAttemptEvent.attempt_id)
        .where(
            StudentTestAttempt.submitted_date >= start_day,
            StudentTestAttempt.submitted_date <= end_day,
            StudentTestAttemptEvent.event_type.in_(("visibility_hidden", "visibility_visible")),
        )
        .order_by(StudentTestAttemptEvent.attempt_id, StudentTestAttemptEvent.client_ts_ms)
    ).all()
    away: dict[int, float] = defaultdict(float)
    hidden_at: dict[int, float] = {}
    for attempt_id, kind, ts_ms, occurred in rows:
        if ts_ms:
            at = ts_ms / 1000.0
        elif occurred is not None:
            at = occurred.timestamp()
        else:
            continue
        if kind == "visibility_hidden":
            hidden_at[attempt_id] = at
        elif attempt_id in hidden_at:
            away[attempt_id] += max(0.0, at - hidden_at.pop(attempt_id))
    return dict(away)


def copy_clusters(rows) -> list[list]:
    """Bir xil javoblar: bitta testda, bitta variantda AYNAN bir xil javoblar
    ketma-ketligi va ichida testdagi boshqa hech kim tanlamagan kamida ikkita
    javob.

    Faqat "bir xil" yetarli emas: kuchli guruhda hamma to'g'ri javob beradi
    va kalitida xato bo'lgan savolda hamma bir xil "xato" qiladi. Boshqa
    hech kim tanlamagan javobning bir necha talabada takrorlanishi esa
    tasodif emas. 2026-10-15 o'lchovi: oddiy moslik 944 guruhcha, bu qoida
    bilan 77 ta (193 talaba).
    """
    by_test: dict[tuple, list] = defaultdict(list)
    for r in rows:
        answers = r.answers_final if isinstance(r.answers_final, list) else None
        if answers is None or int(r.total or 0) < 5:
            continue
        by_test[(r.session_id, r.variant_label or "")].append(r)

    out: list[list] = []
    for members_all in by_test.values():
        if len(members_all) < 2:
            continue
        same: dict[tuple, list] = defaultdict(list)
        for r in members_all:
            skipped = sum(1 for x in r.answers_final if x is None)
            answered_wrong = int(r.total or 0) - int(r.score or 0) - skipped
            if answered_wrong >= 2:
                same[tuple(r.answers_final)].append(r)
        for vector, members in same.items():
            if len({m.student_id for m in members}) < 2:
                continue
            # Testdagilarning yarmidan ko'pi bir xil yozgan bo'lsa — bu
            # talabalar haqida emas, savolning o'zi haqida.
            if len(members) > max(2, len(members_all) // 2):
                continue
            others = [r for r in members_all if tuple(r.answers_final) != vector]
            unique = 0
            for i, choice in enumerate(vector):
                if choice is None:
                    continue
                if not any(i < len(o.answers_final) and o.answers_final[i] == choice for o in others):
                    unique += 1
            if unique >= 2:
                out.append(members)
    return out


def _group_lessons(db: Session, start_day: dt.date, end_day: dt.date) -> dict[str, int]:
    """Davrda har guruhning HEMIS jadvalidagi darslari soni."""
    from app.models.hemis_lesson import HemisLesson

    rows = db.execute(
        select(HemisLesson.group_name, func.count())
        .where(HemisLesson.lesson_date >= start_day, HemisLesson.lesson_date <= end_day)
        .group_by(HemisLesson.group_name)
    ).all()
    out: dict[str, int] = defaultdict(int)
    for name, count in rows:
        for part in (name or "").split(","):
            if part.strip():
                out[part.strip()] += int(count or 0)
    return dict(out)


def _sid(row) -> str:
    return (row.student_id or "").strip()


#: Tahlil og'ir (ikki davr, hodisalar, xodimlar): sahifa har daqiqada
#: yangilanadi, shuning uchun bir daqiqa saqlanadi.
OVERVIEW_TTL_SECONDS = 60
_overview_cache: dict[tuple, tuple[float, dict]] = {}


def cached_overview(db: Session, start_day: dt.date, end_day: dt.date, **kwargs) -> dict:
    import time

    key = (start_day, end_day, tuple(sorted((k, v if not isinstance(v, list) else tuple(v))
                                            for k, v in kwargs.items())))
    now = time.monotonic()
    hit = _overview_cache.get(key)
    if hit and now - hit[0] < OVERVIEW_TTL_SECONDS:
        return hit[1]
    data = overview(db, start_day, end_day, **kwargs)
    if len(_overview_cache) > 64:
        _overview_cache.clear()
    _overview_cache[key] = (now, data)
    return data


def overview(db: Session, start_day: dt.date, end_day: dt.date, *,
             faculty: str = "", group: str = "", course: int | None = None,
             subject_code: str = "", scope: str = "monitor", department: str = "",
             groups: tuple[str, ...] = ()) -> dict:
    """Talabalar bo'yicha rahbariyat tahlili — ro'yxat bilan bir xil filtr."""
    from app.services import report_exclusion
    from app.services.rector_report_service import staff_directory

    people = _contingent(db, groups)
    wanted = _wanted(people, faculty=faculty, group=group, course=course)
    area = lesson_scope(db, start_day, end_day, scope=scope, department=department, groups=groups)
    if area is not None:
        wanted = {sid: row for sid, row in wanted.items() if area.has(row.group_name)}

    def in_area(r) -> bool:
        sid = _sid(r)
        return sid in wanted and (area is None or area.counts(r.owner_key, wanted[sid].group_name))

    all_rows = [
        r for r in _light_rows(db, start_day, end_day)
        if not subject_code or (r.subject_code or "") == subject_code
    ]
    mine = [r for r in all_rows if in_area(r)]

    # ---------------------------------------------------------- talaba bo'yicha
    per: dict[str, dict] = {}
    for r in mine:
        item = per.setdefault(_sid(r), {"attempts": 0, "score": 0, "total": 0})
        item["attempts"] += 1
        item["score"] += int(r.score or 0)
        item["total"] += int(r.total or 0)
    percent_of = {sid: _pct(v["score"], v["total"]) for sid, v in per.items()}

    def _summary(sids) -> dict:
        sids = list(sids)
        took = [s for s in sids if s in per]
        score = sum(per[s]["score"] for s in took)
        total = sum(per[s]["total"] for s in took)
        return {
            "students": len(sids),
            "took": len(took),
            "coverage": round(100 * len(took) / len(sids)) if sids else 0,
            "attempts": sum(per[s]["attempts"] for s in took),
            "percent": _pct(score, total),
        }

    # --------------------------------------------------------------- baholar
    grades = {5: 0, 4: 0, 3: 0, 2: 0}
    for value in percent_of.values():
        g = grade_of(value)
        if g:
            grades[g] += 1
    distribution = [
        {"grade": grade, "label": label, "from": floor, "students": grades[grade]}
        for grade, floor, label in GRADE_BANDS
    ]

    # ------------------------------------------------------------ kun bo'yicha
    days: dict[dt.date, dict] = {}
    if (end_day - start_day).days <= 62:
        d = start_day
        while d <= end_day:
            days[d] = {"attempts": 0, "students": set(), "score": 0, "total": 0}
            d += dt.timedelta(days=1)
    for r in mine:
        day = days.setdefault(r.submitted_date, {"attempts": 0, "students": set(), "score": 0, "total": 0})
        day["attempts"] += 1
        day["students"].add(_sid(r))
        day["score"] += int(r.score or 0)
        day["total"] += int(r.total or 0)
    daily = [
        {"date": d.isoformat(), "attempts": v["attempts"], "students": len(v["students"]),
         "percent": _pct(v["score"], v["total"])}
        for d, v in sorted(days.items())
    ]

    # ------------------------------------------------- kurs, fakultet, guruh
    def _grouped(key) -> dict:
        buckets: dict = defaultdict(list)
        for sid, row in wanted.items():
            buckets[key(row)].append(sid)
        return buckets

    by_course = [
        {"course": c, **_summary(sids)}
        for c, sids in sorted(_grouped(lambda r: int(r.course or 0)).items()) if c
    ]
    by_faculty = sorted(
        ({"faculty": f or "—", **_summary(sids)} for f, sids in _grouped(lambda r: r.faculty_name or "").items()),
        key=lambda x: (x["coverage"], x["percent"] or 0),
    )
    # Darsi bo'lmagan guruhni (amaliyot, magistratura) "test topshirmagan"
    # deb bir qatorga qo'yish adolatsiz: 2026-10-15 haftasida 629 guruhdan
    # 162 tasida HEMIS jadvalida birorta dars yo'q edi.
    lessons_by_group = area.groups if area is not None else _group_lessons(db, start_day, end_day)
    group_rows = []
    for g, sids in _grouped(lambda r: r.group_name or "").items():
        if not g:
            continue
        sample = wanted[sids[0]]
        group_rows.append({
            "group": g,
            "faculty": sample.faculty_name or "",
            "course": int(sample.course or 0) or None,
            "lessons": lessons_by_group.get(g, 0),
            **_summary(sids),
        })
    # Eng orqadagi guruh birinchi: darsi bo'lganlar ichida avval qamrov,
    # keyin natija; darsi bo'lmaganlar oxirida.
    group_rows.sort(key=lambda x: (
        x["lessons"] == 0, x["coverage"],
        x["percent"] if x["percent"] is not None else -1, x["group"],
    ))
    in_class = [sid for sid, row in wanted.items() if lessons_by_group.get(row.group_name or "", 0)]

    # ------------------------------------------------------- kafedralar kesimi
    # Talabaning kafedrasi yo'q — guruhiga dars o'tgan kafedra bor. Shuning
    # uchun kesim darslar bo'yicha: kafedra dars o'tgan guruhlar talabalari va
    # shu kafedra o'qituvchilarining shu guruhlarga o'tkazgan testlari.
    if area is not None:
        chairs_area = area
    else:
        from app.services import lesson_report_service as lr

        chairs_area = scope_of(lr._lessons(db, start_day, end_day, groups=groups), monitored=False)
    by_department = []
    for chair, (chair_groups, chair_pairs) in chairs_area.departments.items():
        sids = [sid for sid, row in wanted.items() if (row.group_name or "") in chair_groups]
        if not sids:
            continue
        hits: dict[str, list[int]] = {}
        for r in mine:
            sid = _sid(r)
            if (r.owner_key or "", wanted[sid].group_name or "") in chair_pairs:
                acc = hits.setdefault(sid, [0, 0, 0])
                acc[0] += 1
                acc[1] += int(r.score or 0)
                acc[2] += int(r.total or 0)
        score = sum(v[1] for v in hits.values())
        total = sum(v[2] for v in hits.values())
        by_department.append({
            "department": chair,
            "groups": len(chair_groups),
            "teachers": len({t for t, _g in chair_pairs}),
            "students": len(sids),
            "took": len(hits),
            "coverage": round(100 * len(hits) / len(sids)) if sids else 0,
            "attempts": sum(v[0] for v in hits.values()),
            "percent": _pct(score, total),
        })
    by_department.sort(key=lambda x: (x["coverage"], x["percent"] if x["percent"] is not None else -1))

    # ------------------------------------------------------- xavf ostidagilar
    risk = []
    for sid, item in per.items():
        value = percent_of.get(sid)
        if item["attempts"] >= RISK_MIN_ATTEMPTS and value is not None and value < RISK_PERCENT:
            person = wanted[sid]
            risk.append({
                "student_key": f"ot_{sid}",
                "full_name": _full_name(person) or sid,
                "group_name": person.group_name or "",
                "course": int(person.course or 0) or None,
                "attempts": item["attempts"],
                "percent": value,
            })
    risk.sort(key=lambda x: (x["percent"], -x["attempts"], x["full_name"]))

    # --------------------------------------------------------------- halollik
    directory = staff_directory(db)
    away = _away_seconds(db, start_day, end_day)
    fast = [
        r for r in mine
        if int(r.total or 0) and int(r.duration_sec or 0)
        and int(r.duration_sec) < int(r.total) * FAST_SECONDS_PER_QUESTION
    ]
    gone = [r for r in mine if away.get(r.id, 0) >= AWAY_SECONDS]

    def _member(m) -> dict:
        person = wanted.get(_sid(m))
        return {
            "student_key": f"ot_{_sid(m)}",
            "full_name": (_full_name(person) if person else "") or _sid(m),
            "group_name": person.group_name if person else "",
            "percent": _pct(int(m.score or 0), int(m.total or 0)),
        }

    clusters = []
    for members in copy_clusters(all_rows):
        if not any(in_area(m) for m in members):
            continue
        first = members[0]
        owner = first.owner_key or ""
        clusters.append({
            "date": first.submitted_date.isoformat(),
            "topic": first.topic or "",
            "teacher_key": owner,
            "teacher_name": directory.get(owner, {}).get("display_name", owner),
            "size": len(members),
            "students": [_member(m) for m in members],
        })
    clusters.sort(key=lambda c: (-c["size"], c["date"]))
    copy_students = {s["student_key"] for c in clusters for s in c["students"]}

    # ------------------------------------------------- o'qituvchilar kesimida
    exclusions = report_exclusion.load(db)
    group_size: dict[str, int] = defaultdict(int)
    for row in people.values():
        group_size[row.group_name or ""] += 1
    session_groups: dict[int, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for r in all_rows:
        person = people.get(_sid(r))
        if person is not None:
            session_groups[r.session_id][person.group_name or ""].add(_sid(r))
    participation: dict[int, int] = {}
    for session_id, by_group in session_groups.items():
        main, joined = max(by_group.items(), key=lambda kv: len(kv[1]))
        size = group_size.get(main, 0)
        if size:
            participation[session_id] = min(100, round(100 * len(joined) / size))

    teachers: dict[str, dict] = {}
    for r in mine:
        key = r.owner_key or ""
        if not key:
            continue
        t = teachers.setdefault(key, {"sessions": set(), "students": set(), "score": 0, "total": 0,
                                      "attempts": 0, "flagged": 0})
        t["attempts"] += 1
        t["sessions"].add(r.session_id)
        t["students"].add(_sid(r))
        t["score"] += int(r.score or 0)
        t["total"] += int(r.total or 0)
    # Bitta urinish ham tez, ham sahifadan chiqib yechilgan bo'lishi mumkin.
    for r in {id(x): x for x in fast + gone}.values():
        if (r.owner_key or "") in teachers:
            teachers[r.owner_key]["flagged"] += 1
    teacher_rows = []
    for key, t in teachers.items():
        info = directory.get(key, {})
        chair = info.get("department", "")
        # Hisobotdan chiqarilgan kafedralar bu yerda ham ko'rinmaydi.
        if chair and exclusions.department_excluded(chair):
            continue
        rates = [participation[s] for s in t["sessions"] if s in participation]
        teacher_rows.append({
            "teacher_key": key,
            "teacher_name": info.get("display_name", key),
            "department": chair,
            "tests": len(t["sessions"]),
            "students": len(t["students"]),
            "percent": _pct(t["score"], t["total"]),
            "participation": round(sum(rates) / len(rates)) if rates else None,
            "low_participation": sum(1 for x in rates if x < 50),
            "attempts": t["attempts"],
            # Juda tez yoki sahifadan chiqib yechilgan urinishlar ulushi.
            "flagged_percent": round(100 * t["flagged"] / t["attempts"]) if t["attempts"] else 0,
        })
    teacher_rows.sort(key=lambda x: (-x["tests"], x["teacher_name"]))

    # ----------------------------------------- o'tgan shunday davr bilan solishtirish
    span = (end_day - start_day).days + 1
    prev_end = start_day - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=span - 1)
    # O'tgan davr o'zining darslari bo'yicha: guruh va o'qituvchi juftligi
    # haftadan haftaga o'zgaradi (surat/maxraj).
    prev_area = lesson_scope(db, prev_start, prev_end, scope=scope, department=department, groups=groups)
    prev = [
        r for r in _light_rows(db, prev_start, prev_end)
        if _sid(r) in wanted
        and (not subject_code or (r.subject_code or "") == subject_code)
        and (prev_area is None or prev_area.counts(r.owner_key, wanted[_sid(r)].group_name))
    ]
    prev_students = {_sid(r) for r in prev}
    previous = {
        "from": prev_start.isoformat(),
        "to": prev_end.isoformat(),
        "took": len(prev_students),
        "coverage": round(100 * len(prev_students) / len(wanted)) if wanted else 0,
        "attempts": len(prev),
        "percent": _pct(sum(int(r.score or 0) for r in prev), sum(int(r.total or 0) for r in prev)),
    }

    head = _summary(wanted.keys())
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "headline": {
            **head,
            "never": head["students"] - head["took"],
            # Faqat shu davrda darsi bo'lgan guruhlar talabalari bo'yicha.
            "in_class": _summary(in_class),
            "grade": grade_of(head["percent"]),
            "tests": len({r.session_id for r in mine}),
            "teachers": len(teacher_rows),
            "at_risk": len(risk),
        },
        "previous": previous,
        "daily": daily,
        "distribution": distribution,
        "by_course": by_course,
        "by_faculty": by_faculty,
        "by_department": by_department,
        "groups": group_rows,
        "at_risk": risk[:LIST_LIMIT],
        "integrity": {
            "attempts": len(mine),
            "fast": {"attempts": len(fast), "students": len({_sid(r) for r in fast}),
                     "seconds_per_question": FAST_SECONDS_PER_QUESTION},
            "away": {"attempts": len(gone), "students": len({_sid(r) for r in gone}),
                     "seconds": AWAY_SECONDS},
            "copy": {"groups": len(clusters), "students": len(copy_students), "items": clusters[:30]},
        },
        "teachers": teacher_rows,
        "rules": {"risk_attempts": RISK_MIN_ATTEMPTS, "risk_percent": RISK_PERCENT},
        "scope": {
            "kind": scope if scope in SCOPES else "monitor",
            "department": department,
            "groups": len(area.groups) if area is not None else None,
            "teachers": len({t for t, _g in area.pairs}) if area is not None else None,
        },
    }


# =================================================================== dinamika

TREND_WEEKS = 8
_trend_cache: dict[tuple, tuple[float, dict]] = {}


def weekly_trend(db: Session, end_day: dt.date, *, weeks: int = TREND_WEEKS,
                 faculty: str = "", group: str = "", course: int | None = None,
                 subject_code: str = "", scope: str = "monitor", department: str = "",
                 groups: tuple[str, ...] = ()) -> dict:
    """Haftalar bo'yicha talabalar qamrovi va natijasi (2026-10-15).

    Har hafta O'Z darslari bo'yicha: o'sha haftada monitorli darsi bo'lgan
    guruhlar talabalari va o'sha juftliklar bo'yicha testlar — sahifadagi
    asosiy raqam bilan bir xil qoida.
    """
    import time

    from app.services import lesson_report_service as lr

    weeks = max(2, min(16, int(weeks)))
    monday = end_day - dt.timedelta(days=end_day.weekday())
    start = monday - dt.timedelta(weeks=weeks - 1)
    key = (start, end_day, faculty, group, course, subject_code, scope, department, tuple(groups))
    hit = _trend_cache.get(key)
    if hit and time.monotonic() - hit[0] < OVERVIEW_TTL_SECONDS * 10:
        return hit[1]

    people = _contingent(db, groups)
    wanted = _wanted(people, faculty=faculty, group=group, course=course)
    restricted = scope != "all" or bool(department)
    week_of = lambda d: d - dt.timedelta(days=d.weekday())  # noqa: E731
    areas: dict[dt.date, LessonScope] = {}
    if restricted:
        lessons = lr._lessons(db, start, end_day, department=department, groups=groups)
        by_week: dict[dt.date, list] = defaultdict(list)
        for lesson in lessons:
            by_week[week_of(lesson.lesson_date)].append(lesson)
        areas = {w: scope_of(ls, monitored=scope != "all") for w, ls in by_week.items()}

    stats: dict[dt.date, dict] = {
        start + dt.timedelta(weeks=i): {"took": set(), "attempts": 0, "score": 0, "total": 0} for i in range(weeks)
    }
    for r in _light_rows(db, start, end_day):
        sid = _sid(r)
        if sid not in wanted or (subject_code and (r.subject_code or "") != subject_code):
            continue
        w = week_of(r.submitted_date)
        if w not in stats:
            continue
        if restricted:
            area = areas.get(w)
            if area is None or not area.counts(r.owner_key, wanted[sid].group_name):
                continue
        item = stats[w]
        item["took"].add(sid)
        item["attempts"] += 1
        item["score"] += int(r.score or 0)
        item["total"] += int(r.total or 0)

    out_weeks = []
    for w, item in sorted(stats.items()):
        if restricted:
            area = areas.get(w)
            population = sum(1 for row in wanted.values() if area and area.has(row.group_name))
        else:
            population = len(wanted)
        out_weeks.append({
            "week_start": w.isoformat(),
            "week_end": min(w + dt.timedelta(days=6), end_day).isoformat(),
            "students": population,
            "took": len(item["took"]),
            "coverage": round(100 * len(item["took"]) / population) if population else None,
            "attempts": item["attempts"],
            "percent": _pct(item["score"], item["total"]),
        })
    data = {"from": start.isoformat(), "to": end_day.isoformat(), "weeks": out_weeks}
    if len(_trend_cache) > 64:
        _trend_cache.clear()
    _trend_cache[key] = (time.monotonic(), data)
    return data

