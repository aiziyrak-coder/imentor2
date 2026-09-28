"""O'qituvchi iMentor'da ANIQ nima qilgani (2026-09-25).

Nazorat hisobotining birinchi qatlami bitta savolga javob beradi: monitorli
xonadagi darsda iMentor ochilganmi. Lekin "ochgan" degani "ishlagan" degani
emas — kirib qo'yib ketgan bo'lishi ham mumkin. Shu modul ikkinchi qatlamni
beradi:

  * qaysi bo'limda necha daqiqa turgan (`core_useractivityevent.heartbeat`);
  * nima YARATGAN — test, keys, ma'ruza, taqdimot, tarqatma, video, jonli
    sessiya (har biri o'z jadvalidan, davr ichida);
  * profili to'liqmi — surat, kafedra, lavozim, fan, yuz;
  * biriktirgan fanlarining mavzulari material bilan qoplanganmi.

Hammasi GURUHLANGAN so'rov: o'qituvchilar soni so'rovlar soniga ta'sir
qilmaydi (600 xodim ham, 6 xodim ham bir xil narxda).
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus, StaffCourseSelection
from app.models.face_template import FaceTemplate
from app.models.live_test import LiveTestSession
from app.models.prepared_content import PreparedContent
from app.models.staff_location import StaffProfile
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.services.activity_report_service import all_teachers_activity
from app.services.rector_coverage_service import COVERAGE_KINDS, material_coverage, syllabus_topics

#: Bo'lim kaliti → rektor ko'radigan nom. Kalitlar `App.tsx` dagi `View` bilan bir xil.
MODULE_LABEL: dict[str, str] = {
    "syllabus": "Sillabus",
    "lectures": "Ma'ruza matni",
    "presentation": "Taqdimot",
    "videos": "Video",
    "handouts": "Tarqatma",
    "cases": "Keys (vaziyatli masala)",
    "tests": "Test",
    "my-tests": "Mening testlarim",
    "content-catalog": "Materiallar katalogi",
    "translator": "Tarjimon",
    "profile": "Profil",
    "other": "Boshqa",
}

#: Yaratilgan material turlari — hisobotda shu tartibda ko'rinadi.
CREATED_LABEL: dict[str, str] = {
    "tests": "Test",
    "cases": "Keys",
    "lectures": "Ma'ruza",
    "presentations": "Taqdimot",
    "handouts": "Tarqatma",
    "videos": "Video",
    "live_sessions": "Jonli test",
}

#: Profil qaysi bandlardan "to'liq" hisoblanadi.
PROFILE_CHECKS = (
    ("photo", "Surat"),
    ("department", "Kafedra"),
    ("job_title", "Lavozim"),
    ("subject", "Fan biriktirilgan"),
    ("face", "Yuz ro'yxatda"),
)

# Shundan kam daqiqa — "kirib chiqqan", ish emas.
VISIT_MINUTES = 5

# Profil va fan qamrovi daqiqa sayin o'zgarmaydi, lekin rektor sahifasi "Jonli"
# rejimda har 60 soniyada butun hisobotni so'raydi va monitorda kun bo'yi ochiq
# turadi. Qamrov hisobi ~0.7 s — 5 daqiqaga saqlanadi (2026-09-26).
CACHE_SECONDS = 300
_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, build):
    import time

    now = time.monotonic()
    hit = _cache.get(key)
    if hit is not None and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = build()
    _cache[key] = (now, value)
    return value


def clear_cache() -> None:
    _cache.clear()


def _blank_created() -> dict[str, int]:
    return {k: 0 for k in CREATED_LABEL}


def created_map(db: Session, start: dt.datetime, end: dt.datetime) -> dict[str, dict[str, int]]:
    """`owner_key` → davr ichida nima yaratgani. Har tur o'z jadvalidan."""
    out: dict[str, dict[str, int]] = defaultdict(_blank_created)

    # Tayyorlangan material: ma'ruza, taqdimot, keys, test — bitta jadval, `kind` ustuni.
    prepared = {
        "test": "tests",
        "case": "cases",
        "lecture": "lectures",
        "presentation": "presentations",
    }
    rows = db.execute(
        select(PreparedContent.owner_key, PreparedContent.kind, func.count().label("n"))
        .where(PreparedContent.created_at >= start, PreparedContent.created_at < end)
        .group_by(PreparedContent.owner_key, PreparedContent.kind)
    ).all()
    for r in rows:
        field = prepared.get((r.kind or "").lower())
        if field:
            out[r.owner_key][field] += int(r.n or 0)

    # Fayl sifatida yuklanadiganlar.
    for model, field in ((TopicHandout, "handouts"), (TopicVideo, "videos"),
                         (TopicPresentation, "presentations")):
        rows = db.execute(
            select(model.owner_key, func.count().label("n"))
            .where(model.created_at >= start, model.created_at < end)
            .group_by(model.owner_key)
        ).all()
        for r in rows:
            out[r.owner_key][field] += int(r.n or 0)

    rows = db.execute(
        select(LiveTestSession.owner_key, func.count().label("n"))
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by(LiveTestSession.owner_key)
    ).all()
    for r in rows:
        out[r.owner_key]["live_sessions"] += int(r.n or 0)

    return dict(out)


def profile_map(db: Session) -> dict[str, dict]:
    """`owner_key` → profil to'liqligi (5 daqiqalik kesh bilan)."""
    return _cached("profile_map", lambda: _profile_map(db))


def _profile_map(db: Session) -> dict[str, dict]:
    """`owner_key` → profil to'liqligi: nima bor, nima yo'q, necha foiz."""
    profiles = {
        p.owner_key: p
        for p in db.execute(select(StaffProfile)).scalars()
    }
    subjects: dict[str, int] = {
        r.owner_key: int(r.n or 0)
        for r in db.execute(
            select(StaffCourseSelection.owner_key, func.count().label("n"))
            .group_by(StaffCourseSelection.owner_key)
        ).all()
    }
    faces = {
        r[0]
        for r in db.execute(
            select(FaceTemplate.owner_key).where(
                FaceTemplate.owner_key != "", FaceTemplate.is_active.is_(True)
            )
        ).all()
    }

    owners = set(profiles) | set(subjects) | {x for x in faces if x}
    out: dict[str, dict] = {}
    for owner in owners:
        p = profiles.get(owner)
        have = {
            "photo": bool(p and (p.photo or "").strip()),
            "department": bool(p and (p.department or "").strip()),
            "job_title": bool(p and (p.job_title or "").strip()),
            "subject": subjects.get(owner, 0) > 0,
            "face": owner in faces,
        }
        done = sum(1 for v in have.values() if v)
        out[owner] = {
            "have": have,
            "missing": [label for key, label in PROFILE_CHECKS if not have[key]],
            "percent": round(100 * done / len(PROFILE_CHECKS)),
            "subjects": subjects.get(owner, 0),
            "photo": have["photo"],
            "face": have["face"],
        }
    return out


def materials_map(db: Session) -> dict[str, dict]:
    """`owner_key` → fan qamrovi (5 daqiqalik kesh bilan)."""
    return _cached("materials_map", lambda: _materials_map(db))


def _materials_map(db: Session) -> dict[str, dict]:
    """`owner_key` → biriktirgan fanlari mavzulari material bilan qoplanganmi.

    Qamrov FAN bo'yicha hisoblanadi (materialni kafedradosh yuklagan bo'lsa
    ham mavzu yopiq), lekin qaysi fan bo'sh qolgani ko'rinadi.
    """
    topics_by_syllabus = syllabus_topics(db)
    coverage = material_coverage(db)
    names = {
        r.id: r.subject_name
        for r in db.execute(select(CourseSyllabus.id, CourseSyllabus.subject_name)).all()
    }

    selections = db.execute(
        select(StaffCourseSelection.owner_key, StaffCourseSelection.syllabus_id,
               StaffCourseSelection.variant_label)
    ).all()

    out: dict[str, dict] = {}
    for sel in selections:
        topics = topics_by_syllabus.get(sel.syllabus_id) or []
        label = (sel.variant_label or "").strip().lower()
        chosen = [t for t in topics if not label or not t["variant"] or t["variant"] == label]
        if not chosen:
            chosen = topics
        row = {
            "syllabus_id": sel.syllabus_id,
            "subject": names.get(sel.syllabus_id, "—"),
            "variant": sel.variant_label or "",
            "topics": len(chosen),
            "empty": 0,
        }
        for kind in COVERAGE_KINDS:
            row[kind] = 0
        for topic in chosen:
            have = coverage.get(topic["key"], set())
            for kind in COVERAGE_KINDS:
                if kind in have:
                    row[kind] += 1
            if not have:
                row["empty"] += 1
        row["percent"] = round(100 * (row["topics"] - row["empty"]) / row["topics"]) if row["topics"] else 0
        out.setdefault(sel.owner_key, {"subjects": [], "topics": 0, "empty": 0,
                                       **{k: 0 for k in COVERAGE_KINDS}})
        agg = out[sel.owner_key]
        agg["subjects"].append(row)
        agg["topics"] += row["topics"]
        agg["empty"] += row["empty"]
        for kind in COVERAGE_KINDS:
            agg[kind] += row[kind]

    for agg in out.values():
        agg["subjects"].sort(key=lambda r: (r["percent"], -r["topics"]))
        agg["percent"] = round(100 * (agg["topics"] - agg["empty"]) / agg["topics"]) if agg["topics"] else 0
        agg["handout_percent"] = round(100 * agg["handout"] / agg["topics"]) if agg["topics"] else 0
    return out


def _depth(minutes: int, created_total: int) -> str:
    """Kirganidan keyin nima qilgani: yaratgan / ko'rgan / kirib chiqqan / kirmagan."""
    if created_total > 0:
        return "worked"
    if minutes >= VISIT_MINUTES:
        return "viewed"
    if minutes > 0:
        return "visit"
    return "none"


DEPTH_LABEL = {
    "worked": "material yaratgan",
    "viewed": "ko'rgan, yaratmagan",
    "visit": "kirib chiqqan",
    "none": "umuman kirmagan",
}


def engagement_map(db: Session, start_day: dt.date, end_day: dt.date) -> dict[str, dict]:
    """`owner_key` → davr ichidagi faollik: daqiqa, bo'limlar, yaratganlari."""
    from app.services.activity_report_service import range_bounds

    start, end = range_bounds(start_day, end_day)
    activity = all_teachers_activity(db, start_day=start_day, end_day=end_day)
    created = created_map(db, start, end)

    out: dict[str, dict] = {}
    for owner in set(activity) | set(created):
        act = activity.get(owner) or {"minutes": 0, "pages": [], "active_days": 0,
                                      "videos_viewed": 0, "handouts_viewed": 0}
        made = created.get(owner) or _blank_created()
        total = sum(made.values())
        minutes = int(act.get("minutes", 0) or 0)
        out[owner] = {
            "minutes": minutes,
            "active_days": int(act.get("active_days", 0) or 0),
            "modules": [
                {"page": p["page"], "label": MODULE_LABEL.get(p["page"], p["page"]),
                 "minutes": p["minutes"], "opens": p["opens"]}
                for p in act.get("pages", []) if p["minutes"] or p["opens"]
            ],
            "created": made,
            "created_total": total,
            "viewed": {
                "videos": int(act.get("videos_viewed", 0) or 0),
                "handouts": int(act.get("handouts_viewed", 0) or 0),
            },
            "depth": _depth(minutes, total),
        }
    return out


def module_totals(engagement: dict[str, dict]) -> list[dict]:
    """Butun muassasa kesimi: qaysi bo'limda qancha vaqt va necha kishi."""
    agg: dict[str, dict] = {}
    for row in engagement.values():
        for m in row["modules"]:
            slot = agg.setdefault(m["page"], {"page": m["page"], "label": m["label"],
                                              "minutes": 0, "opens": 0, "people": 0})
            slot["minutes"] += m["minutes"]
            slot["opens"] += m["opens"]
            slot["people"] += 1
    rows = sorted(agg.values(), key=lambda r: -r["minutes"])
    return rows


def created_totals(engagement: dict[str, dict]) -> dict[str, int]:
    """Butun muassasa bo'yicha yaratilgan material soni."""
    out = _blank_created()
    for row in engagement.values():
        for key, n in row["created"].items():
            out[key] += n
    return out
