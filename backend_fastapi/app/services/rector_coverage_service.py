"""Kafedra qamrovi, kamchiliklar va dinamika — rektor hisobotining ikkinchi yarmi.

Birinchi yarim (`rector_report_service`) "kim nima qildi" ga javob beradi.
Bu yerda esa boshqa savol: "NIMA YETISHMAYAPTI". Qaysi kafedrada sillabus
yo'q, qaysi sillabusda mavzu yo'q, qaysi mavzuda ma'ruza, taqdimot, video
yoki tarqatma yo'q — rektor buni birma-bir ochib yurmasdan ko'rsin.

Material mavzuga `topic_norm` orqali bog'lanadi: `{sillabus_id}::{variant}::{kod}`
(masalan `2568::asosiy::l1`). Shakl tarqatma, video, taqdimot va tayyor
materialda bir xil, shuning uchun qamrov bitta guruhlangan so'rov bilan
yig'iladi — 481 sillabus va o'n minglab material bo'lsa ham so'rovlar soni
o'zgarmaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Integer, cast, func, literal, select, text
from sqlalchemy.orm import Session

from app.models.analytics import StudentTestAttempt, UserActivityEvent
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.live_test import LiveTestSession
from app.models.prepared_content import PreparedContent
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.services.activity_report_service import range_bounds
from app.services.rector_report_service import staff_directory

# Rektor hisobotida faqat darsdan oldin yuklanishi kerak bo'lgan materiallar
# kamchilik sifatida ko'rsatiladi. Ma'ruza matni, vaziyatli masala va testlar
# dars jarayonida generatsiya qilinadi, shuning uchun qamrov tanqisligiga kirmaydi.
COVERAGE_KINDS = ("presentation", "video", "handout")

KIND_LABEL = {
    "presentation": "Taqdimot",
    "video": "Video",
    "handout": "Tarqatma",
}

# Davr kesimi: kunlik, haftalik, oylik, choraklik.
BUCKETS = {
    "day": ("kun", "day"),
    "week": ("hafta", "week"),
    "month": ("oy", "month"),
    "quarter": ("chorak", "quarter"),
}


def _sid_expr(column):
    """`topic_norm` ning birinchi bo'lagi — sillabus id (faqat raqamli yozuvlar)."""
    return cast(func.split_part(column, "::", 1), Integer)


def _code_expr(column):
    """Uchinchi bo'lak — mavzu kodi."""
    return func.lower(func.split_part(column, "::", 3))


def _variant_expr(column):
    """Ikkinchi bo'lak — yo'nalish (semestr) yorlig'i."""
    return func.lower(func.split_part(column, "::", 2))


def _structured(column):
    # Eski yozuvlarda `topic_norm` sarlavhaning o'zi bo'lishi mumkin —
    # ular mavzuga bog'lanmaydi va qamrovga kirmaydi.
    return column.op("~")(literal("^[0-9]+::"))


def material_coverage(db: Session) -> dict[tuple[int, str], set[str]]:
    """(sillabus_id, mavzu_kodi) → qaysi material turlari bor."""
    pieces = []

    # Tayyor materiallardan faqat taqdimot oldindan tayyorlanadigan qamrovga kiradi.
    pieces.append(
        select(
            _sid_expr(PreparedContent.topic_norm).label("sid"),
            _variant_expr(PreparedContent.topic_norm).label("variant"),
            _code_expr(PreparedContent.topic_norm).label("code"),
            func.lower(PreparedContent.kind).label("kind"),
        ).where(
            _structured(PreparedContent.topic_norm),
            func.lower(PreparedContent.kind) == "presentation",
        )
    )
    # Fayl sifatida yuklanadigan tarqatma, video va taqdimotlar.
    for model, kind in (
        (TopicHandout, "handout"),
        (TopicVideo, "video"),
        (TopicPresentation, "presentation"),
    ):
        pieces.append(
            select(
                _sid_expr(model.topic_norm).label("sid"),
                _variant_expr(model.topic_norm).label("variant"),
                _code_expr(model.topic_norm).label("code"),
                literal(kind).label("kind"),
            ).where(_structured(model.topic_norm))
        )

    union = pieces[0].union_all(*pieces[1:]).subquery()
    rows = db.execute(
        select(union.c.sid, union.c.variant, union.c.code, union.c.kind).distinct()
    ).all()

    # Ikki kalit: (fan, kod) — bitta yo'nalishli fanlar uchun (eski yozuvlarda
    # yorliq har xil bo'lishi mumkin), va (fan, yo'nalish, kod) — semestrlarga
    # bo'lingan fanlar uchun, aks holda 10-semestr L1 dagi material 9-semestr
    # L1 ni ham "to'ldirilgan" qilib ko'rsatardi.
    out: dict[tuple, set[str]] = {}
    for r in rows:
        if r.sid is None or not r.code:
            continue
        kind = r.kind if r.kind in COVERAGE_KINDS else None
        if kind is None:
            continue
        out.setdefault((int(r.sid), str(r.code)), set()).add(kind)
        out.setdefault((int(r.sid), str(r.variant or ""), str(r.code)), set()).add(kind)
    return out


def syllabus_topics(db: Session) -> dict[int, list[dict]]:
    """sillabus_id → mavzular ro'yxati (kod va sarlavha).

    Barcha yo'nalishlar (semestrlar) olinadi: `topics` faqat birinchi
    variantning nusxasi, semestrlarga bo'lingan fanda ikkinchi semestr
    mavzulari hisobdan tushib qolardi. Har mavzuda `key` — `material_coverage`
    dagi mos kalit.
    """
    rows = db.execute(
        select(CourseSyllabus.id, CourseSyllabus.topics, CourseSyllabus.variants)
    ).all()
    out: dict[int, list[dict]] = {}
    for r in rows:
        variants = [
            v for v in (r.variants or [])
            if isinstance(v, dict) and isinstance(v.get("topics"), list) and v.get("topics")
        ]
        multi = len(variants) > 1
        pairs: list[tuple[str, dict]] = []
        if variants:
            for v in variants:
                label = str(v.get("label") or "").strip().lower()
                pairs += [(label, t) for t in v["topics"] if isinstance(t, dict)]
        else:
            pairs = [("", t) for t in (r.topics or []) if isinstance(t, dict)]
        items = pairs
        # Mavzu kodi JSON'da `id` kalitida keladi ("L1", "A7"); eski
        # yozuvlarda `code` bo'lishi mumkin. `topic_norm` ham aynan shu
        # kodning kichik harfli shaklidan yig'iladi (`2161::asosiy::l1`),
        # shuning uchun bu yerda ham xuddi shunday normallashtiramiz.
        rows_out = []
        for label, t in items:
            code = str(t.get("code") or t.get("id") or "").strip().lower().replace(" ", "")[:16]
            rows_out.append(
                {
                    "code": code,
                    "title": str(t.get("title") or "").strip(),
                    "type": str(t.get("type") or "").strip().lower(),
                    "variant": label,
                    "key": (r.id, label, code) if multi else (r.id, code),
                }
            )
        out[r.id] = rows_out
    return out


def _blank_coverage() -> dict[str, int]:
    return {k: 0 for k in COVERAGE_KINDS}


def department_report(db: Session, *, start_day: dt.date, end_day: dt.date) -> list[dict]:
    """Har kafedra bo'yicha bitta qator: nima bor, nima yo'q, kim ishlayapti."""
    start, end = range_bounds(start_day, end_day)

    departments = {
        d.id: {"id": d.id, "name": d.name, "code": d.code, "is_active": d.is_active}
        for d in db.execute(select(AcademicDepartment)).scalars()
    }

    # Faqat faol fanlar: o'qituvchi o'chirib qayta yuklagan fan ikki marta
    # sanalib, "bo'sh mavzular" sonini sun'iy oshirmasin.
    syllabi = db.execute(
        select(
            CourseSyllabus.id,
            CourseSyllabus.department_id,
            CourseSyllabus.subject_name,
        ).where(CourseSyllabus.is_active.is_(True))
    ).all()
    topics_by_syllabus = syllabus_topics(db)
    coverage = material_coverage(db)

    # O'qituvchilar kafedra NOMI bo'yicha profilda saqlanadi.
    directory = staff_directory(db)
    teachers_by_dept: dict[str, list[str]] = {}
    for owner, info in directory.items():
        if info["role"] != "hodim":
            continue
        teachers_by_dept.setdefault(info["department"].strip().lower(), []).append(owner)

    active_owners = {
        r.owner_key
        for r in db.execute(
            select(UserActivityEvent.owner_key)
            .where(UserActivityEvent.occurred_at >= start, UserActivityEvent.occurred_at < end)
            .distinct()
        ).all()
    }

    # Kafedra id bo'yicha yig'amiz.
    stats: dict[int, dict] = {}
    for dep in departments.values():
        stats[dep["id"]] = {
            **dep,
            "syllabuses": 0,
            "syllabuses_without_topics": 0,
            "topics": 0,
            "topics_covered": 0,
            "topics_empty": 0,
            "coverage": _blank_coverage(),
            "empty_syllabuses": [],
        }

    for s in syllabi:
        if s.department_id not in stats:
            continue
        slot = stats[s.department_id]
        slot["syllabuses"] += 1
        topics = [t for t in topics_by_syllabus.get(s.id, []) if t["code"]]
        if not topics:
            slot["syllabuses_without_topics"] += 1
            if len(slot["empty_syllabuses"]) < 10:
                slot["empty_syllabuses"].append({"id": s.id, "name": s.subject_name})
            continue
        for t in topics:
            if not t["code"]:
                continue
            slot["topics"] += 1
            kinds = coverage.get(t["key"], set())
            if kinds:
                slot["topics_covered"] += 1
            else:
                slot["topics_empty"] += 1
            for k in kinds:
                slot["coverage"][k] += 1

    out: list[dict] = []
    for dep_id, slot in stats.items():
        name_key = slot["name"].strip().lower()
        owners = teachers_by_dept.get(name_key, [])
        total_topics = slot["topics"]
        slot["teachers"] = len(owners)
        slot["teachers_active"] = len([o for o in owners if o in active_owners])
        slot["coverage_percent"] = {
            k: (round(slot["coverage"][k] * 100 / total_topics) if total_topics else 0)
            for k in COVERAGE_KINDS
        }
        slot["ready_percent"] = (
            round(slot["topics_covered"] * 100 / total_topics) if total_topics else 0
        )
        # Nima yetishmayapti — qisqa ro'yxat, rektor darrov ko'rsin.
        missing = [KIND_LABEL[k] for k in COVERAGE_KINDS if slot["coverage"][k] == 0]
        slot["missing_kinds"] = missing if total_topics else []
        slot["has_syllabus"] = slot["syllabuses"] > 0
        out.append(slot)

    # Avval muammolilar: sillabusi yo'q, keyin qamrovi past.
    out.sort(key=lambda d: (d["syllabuses"] > 0, d["ready_percent"], -d["teachers"]))
    return out


def coverage_gaps(db: Session, *, limit: int = 50) -> dict:
    """Aniq kamchiliklar ro'yxati — "nima yo'q" savoliga to'g'ridan-to'g'ri javob."""
    departments = list(db.execute(select(AcademicDepartment)).scalars())
    syllabi = db.execute(
        select(
            CourseSyllabus.id,
            CourseSyllabus.department_id,
            CourseSyllabus.subject_name,
            CourseSyllabus.subject_code,
        ).where(CourseSyllabus.is_active.is_(True))
    ).all()
    dept_name = {d.id: d.name for d in departments}
    topics_by_syllabus = syllabus_topics(db)
    coverage = material_coverage(db)

    with_syllabus = {s.department_id for s in syllabi if s.department_id}
    no_syllabus = [
        {"id": d.id, "name": d.name, "is_active": d.is_active}
        for d in departments
        if d.id not in with_syllabus
    ]
    no_syllabus.sort(key=lambda d: (not d["is_active"], d["name"].lower()))

    no_topics: list[dict] = []
    empty_topics: list[dict] = []
    partial: list[dict] = []

    for s in syllabi:
        topics = [t for t in topics_by_syllabus.get(s.id, []) if t["code"]]
        dept = dept_name.get(s.department_id or 0, "")
        if not topics:
            no_topics.append({"id": s.id, "name": s.subject_name, "department": dept})
            continue
        missing_counts = _blank_coverage()
        empty = 0
        for t in topics:
            if not t["code"]:
                continue
            kinds = coverage.get(t["key"], set())
            if not kinds:
                empty += 1
                if len(empty_topics) < limit:
                    empty_topics.append(
                        {
                            "syllabus_id": s.id,
                            "subject_name": s.subject_name,
                            "department": dept,
                            "topic_code": t["code"],
                            "topic_title": t["title"],
                        }
                    )
            for k in COVERAGE_KINDS:
                if k not in kinds:
                    missing_counts[k] += 1
        missing_all = [KIND_LABEL[k] for k in COVERAGE_KINDS if missing_counts[k] == len(topics)]
        if missing_all:
            partial.append(
                {
                    "syllabus_id": s.id,
                    "subject_name": s.subject_name,
                    "department": dept,
                    "topics": len(topics),
                    "empty_topics": empty,
                    "missing_kinds": missing_all,
                }
            )

    partial.sort(key=lambda x: (-len(x["missing_kinds"]), -x["empty_topics"]))
    no_topics.sort(key=lambda x: x["name"].lower())

    return {
        "departments_without_syllabus": no_syllabus,
        "syllabuses_without_topics": no_topics[:limit],
        "topics_without_material": empty_topics[:limit],
        "syllabuses_missing_kinds": partial[:limit],
        "totals": {
            "departments": len(departments),
            "departments_without_syllabus": len(no_syllabus),
            "syllabuses": len(syllabi),
            "syllabuses_without_topics": len(no_topics),
            "syllabuses_missing_kinds": len(partial),
            "topics_without_material": sum(
                1
                for s in syllabi
                for t in topics_by_syllabus.get(s.id, [])
                if t["code"] and not coverage.get(t["key"])
            ),
        },
    }


def trend_report(
    db: Session, *, start_day: dt.date, end_day: dt.date, bucket: str = "day"
) -> dict:
    """Kunlik / haftalik / oylik / choraklik kesim.

    Har davr uchun: faollik (daqiqa), o'tkazilgan darslar, yaratilgan
    material va talabalarning test topshirishlari.
    """
    key = bucket if bucket in BUCKETS else "day"
    label, trunc = BUCKETS[key]
    start, end = range_bounds(start_day, end_day)

    def bucket_of(column):
        # Toshkent vaqti bo'yicha — kun chegarasi server UTC'siga surilmasin.
        local = func.timezone(text("'Asia/Tashkent'"), column)
        return func.date_trunc(trunc, local)

    seconds = db.execute(
        select(
            bucket_of(UserActivityEvent.occurred_at).label("b"),
            func.coalesce(func.sum(UserActivityEvent.duration_sec), 0).label("sec"),
            func.count(func.distinct(UserActivityEvent.owner_key)).label("people"),
        )
        .where(
            # Vaqt "heartbeat" hodisasidan yig'iladi — `activity_report_service`
            # bilan bir xil manba, aks holda ikki hisobot ikki xil raqam berardi.
            UserActivityEvent.event_type == "heartbeat",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
        .group_by("b")
    ).all()

    lessons = db.execute(
        select(bucket_of(LiveTestSession.created_at).label("b"), func.count().label("n"))
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by("b")
    ).all()

    created = db.execute(
        select(bucket_of(PreparedContent.created_at).label("b"), func.count().label("n"))
        .where(PreparedContent.created_at >= start, PreparedContent.created_at < end)
        .group_by("b")
    ).all()

    attempts = db.execute(
        select(
            bucket_of(StudentTestAttempt.submitted_at).label("b"),
            func.count().label("n"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("total"),
        )
        .where(
            StudentTestAttempt.submitted_at >= start,
            StudentTestAttempt.submitted_at < end,
        )
        .group_by("b")
    ).all()

    def as_date(value) -> str:
        if value is None:
            return ""
        if isinstance(value, dt.datetime):
            return value.date().isoformat()
        return str(value)

    rows: dict[str, dict] = {}

    def slot(b) -> dict:
        d = as_date(b)
        return rows.setdefault(
            d,
            {
                "period": d,
                "minutes": 0,
                "people": 0,
                "lessons": 0,
                "created": 0,
                "attempts": 0,
                "avg_percent": None,
            },
        )

    for r in seconds:
        s = slot(r.b)
        s["minutes"] = round(int(r.sec or 0) / 60)
        s["people"] = int(r.people or 0)
    for r in lessons:
        slot(r.b)["lessons"] = int(r.n or 0)
    for r in created:
        slot(r.b)["created"] = int(r.n or 0)
    for r in attempts:
        s = slot(r.b)
        s["attempts"] = int(r.n or 0)
        total = int(r.total or 0)
        s["avg_percent"] = round(int(r.score or 0) * 100 / total, 1) if total else None

    ordered = [rows[k] for k in sorted(rows.keys())]
    return {
        "bucket": key,
        "bucket_label": label,
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "rows": ordered,
    }
