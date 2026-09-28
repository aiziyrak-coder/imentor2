"""Har bir raqamning ortidagi ro'yxat — "bu nima va qayerdan chiqdi".

Hisobotdagi raqam o'zicha hech narsani isbotlamaydi: "Tarqatma 93" degan
son rektorga nima qilish kerakligini aytmaydi va uni tekshirib ham
bo'lmaydi. Shu sababli har bir ko'rsatkich uchun uchta narsa qaytariladi:

  * `explain` — bu raqam nimani sanaydi va NIMANI SANAMAYDI;
  * `method`  — qanday hisoblangan (qaysi shart, qaysi chegara);
  * `rows`    — ayni shu raqamni tashkil qilgan qatorlar.

Eng muhimi: ro'yxat raqam bilan BIR MANBADAN olinadi. Masalan "Vaziyatli
masala" soni `rector_report_service` da `core_preparedcontent` dan
chiqadi, shuning uchun bu yerdagi ro'yxat ham aynan o'sha jadvaldan va
aynan o'sha shart bilan yig'iladi — aks holda rektor raqamni bosib,
boshqa sonni ko'rib, hisobotga ishonchini yo'qotardi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.online_edu import (
    MalakaTestAttempt,
    OnlineAttendance,
    OnlineGroup,
    OnlineLesson,
    OnlineProgress,
    OnlineSyllabus,
)
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.services import rector_report_service as svc
from app.services.activity_report_service import range_bounds

# Bitta so'rovda qaytariladigan eng ko'p qator. Ro'yxat odam o'qishi uchun,
# arxiv ko'chirish uchun emas — to'liq soni baribir `total` da ko'rinadi.
MAX_ROWS = 500


def _dt(value) -> str:
    if not value:
        return ""
    if isinstance(value, dt.datetime):
        return value.isoformat()
    return str(value)


def _day(value) -> str:
    if not value:
        return "—"
    if isinstance(value, (dt.datetime, dt.date)):
        return value.strftime("%d.%m.%Y")
    return str(value)


# ============================ Ustunlar ============================

TEACHER_COLUMNS = [
    {"key": "display_name", "label": "F.I.Sh."},
    {"key": "department", "label": "Kafedra"},
    {"key": "minutes", "label": "Daqiqa", "align": "right"},
    {"key": "active_days", "label": "Faol kun", "align": "right"},
    {"key": "created_total", "label": "Material", "align": "right"},
    {"key": "lessons_total", "label": "Dars", "align": "right"},
    {"key": "last_login", "label": "Oxirgi kirish"},
]

MATERIAL_COLUMNS = [
    {"key": "title", "label": "Nomi"},
    {"key": "subject", "label": "Fan / mavzu"},
    {"key": "author", "label": "Kim qo'shgan"},
    {"key": "department", "label": "Kafedra"},
    {"key": "created", "label": "Sana"},
]

STUDENT_COLUMNS = [
    {"key": "display_name", "label": "Talaba"},
    {"key": "student_id", "label": "ID"},
    {"key": "attempts", "label": "Urinish", "align": "right"},
    {"key": "correct", "label": "To'g'ri javob", "align": "right"},
    {"key": "percent", "label": "Foiz", "align": "right"},
    {"key": "band", "label": "Baho"},
]

LESSON_COLUMNS = [
    {"key": "held", "label": "Sana"},
    {"key": "teacher", "label": "O'qituvchi"},
    {"key": "kind", "label": "Turi"},
    {"key": "topic", "label": "Mavzu"},
    {"key": "students", "label": "Talaba", "align": "right"},
]


# ============================ Qatorlarni yig'ish ============================


def _teacher_rows(rows: list[dict]) -> list[dict]:
    return [
        {
            "display_name": r["display_name"],
            "department": r["department"] or "—",
            "minutes": r["minutes"],
            "active_days": r["active_days"],
            "created_total": r["created_total"],
            "lessons_total": r["lessons_total"],
            "last_login": _day(r.get("last_login")),
        }
        for r in rows
    ]


def _student_rows(rows: list[dict]) -> list[dict]:
    labels = {key: label for key, label, _floor in svc.GRADE_BANDS}
    return [
        {
            "display_name": r["display_name"],
            "student_id": r["student_id"],
            "attempts": r["attempts"],
            "correct": f"{r['score_sum']}/{r['score_total']}",
            "percent": r["avg_percent"],
            "band": labels.get(r["band"], "—"),
        }
        for r in rows
    ]


def _lesson_rows(rows: list[dict]) -> list[dict]:
    return [
        {
            "held": _day(r["held_at"]),
            "teacher": r["teacher_name"],
            "kind": r["kind_label"],
            "topic": r["topic"] or r["subject_name"] or "—",
            "students": r["students"],
        }
        for r in rows
    ]


def _prepared_rows(
    db: Session,
    kind: str,
    start: dt.datetime,
    end: dt.datetime,
    directory: dict[str, dict],
    department: str,
) -> list[dict]:
    """`core_preparedcontent` dan vaziyatli masala yoki test ro'yxati."""
    rows = db.execute(
        select(PreparedContent)
        .where(
            PreparedContent.kind == kind,
            PreparedContent.created_at >= start,
            PreparedContent.created_at < end,
        )
        .order_by(PreparedContent.created_at.desc())
    ).scalars()

    out: list[dict] = []
    needle = (department or "").strip().lower()
    for r in rows:
        info = directory.get(r.owner_key)
        # Hisobotdagi son faqat `hodim` rolini sanaydi — ro'yxat ham shunday.
        if not info or info["role"] != "hodim":
            continue
        if needle and needle not in info["department"].lower():
            continue
        out.append(
            {
                "title": (r.topic or "—")[:160],
                "subject": r.subject_name or r.subject_code or "—",
                "author": info["display_name"],
                "department": info["department"] or "—",
                "created": _day(r.created_at),
                "_at": _dt(r.created_at),
            }
        )
    return out


def _file_rows(
    db: Session,
    model,
    start: dt.datetime,
    end: dt.datetime,
    directory: dict[str, dict],
    department: str,
) -> list[dict]:
    """Tarqatma / video / taqdimot ro'yxati — har biri o'z jadvalidan."""
    rows = db.execute(
        select(model)
        .where(model.created_at >= start, model.created_at < end)
        .order_by(model.created_at.desc())
    ).scalars()

    out: list[dict] = []
    needle = (department or "").strip().lower()
    for r in rows:
        info = directory.get(r.owner_key)
        if not info or info["role"] != "hodim":
            continue
        if needle and needle not in info["department"].lower():
            continue
        out.append(
            {
                "title": (getattr(r, "title", "") or getattr(r, "file_name", "") or "—")[:160],
                "subject": (r.topic or "—")[:160],
                "author": info["display_name"] or getattr(r, "author_name", ""),
                "department": info["department"] or "—",
                "created": _day(r.created_at),
                "_at": _dt(r.created_at),
            }
        )
    return out


# ============================ Ko'rsatkichlar ta'rifi ============================

_ADMIN_NOTE = (
    "Administrator hisoblari hisobga olinmaydi: ular orqali material ommaviy "
    "import qilingan (24 000 dan ortiq tarqatma), va u o'qituvchi mehnati emas."
)

METRICS: dict[str, dict] = {
    "teachers_total": {
        "title": "O'qituvchilar",
        "explain": "Tizimda `hodim` rolida ro'yxatdan o'tgan barcha xodimlar.",
        "method": "Xodimlar ro'yxati rol bo'yicha olinadi; sana oralig'i bu songa ta'sir qilmaydi.",
        "source": "auth_user + core_staffprofile",
    },
    "teachers_active": {
        "title": "Faol o'qituvchilar",
        "explain": "Tanlangan oraliqda iMentorda ish qilgan xodimlar.",
        "method": "Faol deb hisoblanadi: vaqti 0 dan katta YOKI material qo'shgan YOKI dars o'tgan.",
        "source": "core_useractivityevent + material jadvallari",
    },
    "teachers_inactive": {
        "title": "Umuman kirmaganlar",
        "explain": "Tanlangan oraliqda iMentorga umuman kirmagan, hech narsa qo'shmagan xodimlar.",
        "method": "Faollik shartlarining birortasi ham bajarilmagan xodimlar.",
        "source": "core_useractivityevent",
    },
    "teachers_minutes": {
        "title": "Jami vaqt",
        "explain": "O'qituvchilarning iMentorda o'tkazgan vaqti.",
        "method": (
            "Har 30 soniyada yuboriladigan `heartbeat` signallari qo'shiladi va "
            "bo'lim kesimida daqiqaga yaxlitlanadi. Sahifa ochiq turib, foydalanuvchi "
            "boshqa oynaga o'tsa signal yuborilmaydi."
        ),
        "source": "core_useractivityevent (heartbeat)",
    },
    "teachers_avg_minutes": {
        "title": "O'rtacha vaqt (faol)",
        "explain": "Faol o'qituvchiga to'g'ri keladigan o'rtacha vaqt.",
        "method": "Jami vaqt FAQAT faol o'qituvchilar soniga bo'linadi — kirmaganlar o'rtachani pasaytirmaydi.",
        "source": "core_useractivityevent (heartbeat)",
    },
    "lessons_total": {
        "title": "O'tilgan darslar",
        "explain": "Jonli (QR) testlar va online video darslar birgalikda.",
        "method": "QR sessiya yaratilgan sana bo'yicha, online dars esa boshlangan sana bo'yicha sanaladi.",
        "source": "core_livetestsession + online_lesson",
    },
    "cases_created": {
        "title": "Vaziyatli masalalar",
        "explain": "O'qituvchilar yaratgan vaziyatli masalalar.",
        "method": "Oraliqda yaratilgan, turi `case` bo'lgan yozuvlar. " + _ADMIN_NOTE,
        "source": "core_preparedcontent",
    },
    "tests_created": {
        "title": "Testlar",
        "explain": "O'qituvchilar yaratgan test to'plamlari.",
        "method": "Oraliqda yaratilgan, turi `test` bo'lgan yozuvlar. " + _ADMIN_NOTE,
        "source": "core_preparedcontent",
    },
    "handouts_created": {
        "title": "Tarqatma materiallar",
        "explain": "O'qituvchilar yuklagan tarqatma fayllar.",
        "method": "Oraliqda yuklangan fayllar. " + _ADMIN_NOTE,
        "source": "core_topichandout",
    },
    "videos_created": {
        "title": "Videolar",
        "explain": "O'qituvchilar qo'shgan video darslar.",
        "method": "Oraliqda qo'shilgan videolar. " + _ADMIN_NOTE,
        "source": "core_topicvideo",
    },
    "presentations_created": {
        "title": "Taqdimotlar",
        "explain": "O'qituvchilar yuklagan taqdimot fayllari.",
        "method": "Oraliqda yuklangan taqdimotlar. " + _ADMIN_NOTE,
        "source": "core_topicpresentation",
    },
    "students_total": {
        "title": "Test topshirgan talabalar",
        "explain": "Oraliqda kamida bitta test topshirgan talabalar.",
        "method": "Talaba ID bo'yicha guruhlanadi — bir talaba bir marta sanaladi.",
        "source": "core_studenttestattempt",
    },
    "students_attempts": {
        "title": "Test urinishlari",
        "explain": "Topshirilgan testlarning umumiy soni.",
        "method": "Har bir topshirish alohida sanaladi; bir talaba bir necha marta topshirishi mumkin.",
        "source": "core_studenttestattempt",
    },
    "students_avg": {
        "title": "O'rtacha ball",
        "explain": "Talabalarning o'rtacha natijasi.",
        "method": "Barcha to'g'ri javoblar yig'indisi barcha savollar yig'indisiga bo'linadi — talabalar o'rtachasining o'rtachasi emas.",
        "source": "core_studenttestattempt",
    },
    "online_attendance_students": {
        "title": "Online darsda qatnashganlar",
        "explain": "Online video darsga ulangan talabalar.",
        "method": "Talaba ID bo'yicha guruhlanadi; ro'yxatda har bir ulanish alohida ko'rinadi.",
        "source": "online_attendance",
    },
    "online_attendance_visits": {
        "title": "Qatnashuv soni",
        "explain": "Online darsga ulanishlar soni (takroriy ulanish ham sanaladi).",
        "method": "Har bir ulanish yozuvi alohida sanaladi.",
        "source": "online_attendance",
    },
    "online_attendance_minutes": {
        "title": "Darsda o'tirgan vaqt",
        "explain": "Talabalarning online darsda o'tkazgan umumiy vaqti.",
        "method": "Ulanish va uzilish orasidagi soniyalar qo'shilib, daqiqaga aylantiriladi.",
        "source": "online_attendance",
    },
    "online_tests": {
        "title": "Online testlar",
        "explain": "Online ta'lim bo'limida topshirilgan testlar.",
        "method": "Testi topshirilgan (`test_submitted_at` to'ldirilgan) yozuvlar.",
        "source": "online_progress",
    },
    "malaka_attempts": {
        "title": "Malaka oshirish testlari",
        "explain": "Malaka oshirish tinglovchilarining test urinishlari.",
        "method": "Har bir urinish alohida sanaladi (kirish, chiqish va mavzu testlari).",
        "source": "malaka_test_attempt",
    },
}

for _key, _label, _floor in svc.GRADE_BANDS:
    METRICS[f"band_{_key}"] = {
        "title": _label,
        "explain": f"Oraliqdagi o'rtacha bahosi «{_label}» darajasiga tushgan talabalar.",
        "method": "Talabaning barcha testlari bo'yicha o'rtacha foizi hisoblanib, shkalaga solishtiriladi.",
        "source": "core_studenttestattempt",
    }


# ============================ Asosiy funksiya ============================


def metric_detail(
    db: Session,
    *,
    metric: str,
    start_day: dt.date,
    end_day: dt.date,
    department: str = "",
    limit: int = MAX_ROWS,
) -> dict | None:
    """Bitta ko'rsatkich: ta'rifi va uni tashkil qilgan qatorlar."""
    meta = METRICS.get(metric)
    if meta is None:
        return None

    start, end = range_bounds(start_day, end_day)
    columns: list[dict] = []
    rows: list[dict] = []
    value: str = ""

    # ---------- O'qituvchilar ----------
    if metric.startswith("teachers_"):
        teachers = svc.teacher_report(
            db, start_day=start_day, end_day=end_day, department=department
        )
        columns = TEACHER_COLUMNS
        if metric == "teachers_total":
            picked = teachers
            value = str(len(picked))
        elif metric == "teachers_active":
            picked = [t for t in teachers if t["is_active"]]
            value = str(len(picked))
        elif metric == "teachers_inactive":
            picked = sorted(
                [t for t in teachers if not t["is_active"]],
                key=lambda t: t["display_name"].lower(),
            )
            value = str(len(picked))
        elif metric == "teachers_minutes":
            picked = [t for t in teachers if t["minutes"] > 0]
            value = f"{sum(t['minutes'] for t in teachers)} daqiqa"
        else:  # teachers_avg_minutes
            active = [t for t in teachers if t["is_active"]]
            picked = sorted(active, key=lambda t: -t["minutes"])
            total = sum(t["minutes"] for t in active)
            value = f"{round(total / len(active)) if active else 0} daqiqa"
        rows = _teacher_rows(picked)

    # ---------- Darslar ----------
    elif metric == "lessons_total":
        lessons = svc.lesson_report(db, start_day=start_day, end_day=end_day)
        columns = LESSON_COLUMNS
        rows = _lesson_rows(lessons)
        value = str(len(lessons))

    # ---------- Yaratilgan material ----------
    elif metric in ("cases_created", "tests_created"):
        directory = svc.staff_directory(db)
        kind = KIND_CASE if metric == "cases_created" else KIND_TEST
        rows = _prepared_rows(db, kind, start, end, directory, department)
        columns = MATERIAL_COLUMNS
        value = str(len(rows))

    elif metric in ("handouts_created", "videos_created", "presentations_created"):
        directory = svc.staff_directory(db)
        model = {
            "handouts_created": TopicHandout,
            "videos_created": TopicVideo,
            "presentations_created": TopicPresentation,
        }[metric]
        rows = _file_rows(db, model, start, end, directory, department)
        columns = MATERIAL_COLUMNS
        value = str(len(rows))

    # ---------- Talabalar ----------
    elif metric.startswith("students_") or metric.startswith("band_"):
        students = svc.student_report(db, start_day=start_day, end_day=end_day)
        columns = STUDENT_COLUMNS
        if metric == "students_attempts":
            value = str(sum(s["attempts"] for s in students))
            picked = students
        elif metric == "students_avg":
            score = sum(s["score_sum"] for s in students)
            total = sum(s["score_total"] for s in students)
            pct = svc._pct(score, total)
            value = "—" if pct is None else f"{pct}%"
            picked = students
        elif metric.startswith("band_"):
            band = metric[5:]
            picked = [s for s in students if s["band"] == band]
            value = str(len(picked))
        else:  # students_total
            picked = students
            value = str(len(students))
        rows = _student_rows(picked)

    # ---------- Online ta'lim ----------
    elif metric.startswith("online_attendance"):
        records = db.execute(
            select(
                OnlineAttendance.student_id,
                OnlineAttendance.student_name,
                OnlineAttendance.joined_at,
                OnlineAttendance.total_seconds,
                OnlineLesson.title,
                OnlineGroup.name.label("group_name"),
            )
            .join(OnlineLesson, OnlineLesson.id == OnlineAttendance.lesson_id)
            .join(OnlineGroup, OnlineGroup.id == OnlineLesson.group_id)
            .where(OnlineAttendance.joined_at >= start, OnlineAttendance.joined_at < end)
            .order_by(OnlineAttendance.joined_at.desc())
        ).all()
        columns = [
            {"key": "display_name", "label": "Talaba"},
            {"key": "group_name", "label": "Guruh"},
            {"key": "lesson", "label": "Dars"},
            {"key": "joined", "label": "Ulangan"},
            {"key": "minutes", "label": "Daqiqa", "align": "right"},
        ]
        rows = [
            {
                "display_name": r.student_name or r.student_id,
                "group_name": r.group_name or "—",
                "lesson": r.title or "—",
                "joined": _day(r.joined_at),
                "minutes": round(int(r.total_seconds or 0) / 60),
            }
            for r in records
        ]
        if metric.endswith("students"):
            value = str(len({r.student_id for r in records}))
        elif metric.endswith("visits"):
            value = str(len(records))
        else:
            value = f"{round(sum(int(r.total_seconds or 0) for r in records) / 60)} daqiqa"

    elif metric == "online_tests":
        records = db.execute(
            select(
                OnlineProgress.student_id,
                OnlineProgress.student_name,
                OnlineProgress.group_name,
                OnlineProgress.topic_code,
                OnlineProgress.test_score,
                OnlineProgress.test_total,
                OnlineProgress.test_submitted_at,
                OnlineSyllabus.subject_name,
            )
            .join(OnlineSyllabus, OnlineSyllabus.id == OnlineProgress.syllabus_id)
            .where(
                OnlineProgress.test_submitted_at >= start,
                OnlineProgress.test_submitted_at < end,
            )
            .order_by(OnlineProgress.test_submitted_at.desc())
        ).all()
        columns = [
            {"key": "display_name", "label": "Talaba"},
            {"key": "group_name", "label": "Guruh"},
            {"key": "subject", "label": "Fan"},
            {"key": "topic", "label": "Mavzu"},
            {"key": "percent", "label": "Foiz", "align": "right"},
            {"key": "submitted", "label": "Sana"},
        ]
        rows = [
            {
                "display_name": r.student_name or r.student_id,
                "group_name": r.group_name or "—",
                "subject": r.subject_name or "—",
                "topic": r.topic_code or "—",
                "percent": svc._pct(r.test_score, r.test_total),
                "submitted": _day(r.test_submitted_at),
            }
            for r in records
        ]
        value = str(len(records))

    elif metric == "malaka_attempts":
        records = db.execute(
            select(MalakaTestAttempt)
            .where(
                MalakaTestAttempt.submitted_at >= start,
                MalakaTestAttempt.submitted_at < end,
            )
            .order_by(MalakaTestAttempt.submitted_at.desc())
        ).scalars()
        columns = [
            {"key": "display_name", "label": "Tinglovchi"},
            {"key": "group_name", "label": "Guruh"},
            {"key": "kind", "label": "Test turi"},
            {"key": "percent", "label": "Foiz", "align": "right"},
            {"key": "submitted", "label": "Sana"},
        ]
        rows = [
            {
                "display_name": r.student_name or r.student_id,
                "group_name": r.group_name or "—",
                "kind": r.kind,
                "percent": svc._pct(r.score, r.total),
                "submitted": _day(r.submitted_at),
            }
            for r in records
        ]
        value = str(len(rows))

    total = len(rows)
    return {
        "metric": metric,
        "title": meta["title"],
        "explain": meta["explain"],
        "method": meta["method"],
        "source": meta["source"],
        "value": value,
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "department": department,
        "total": total,
        "shown": min(total, limit),
        "columns": columns,
        "rows": rows[:limit],
    }
