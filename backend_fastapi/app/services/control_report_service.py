"""Rektor nazorat hisoboti — bitta savolga javob (2026-09-25).

Savol: **monitorli xonada dars o'tadigan o'qituvchi shu darsda iMentor'ni
ishlatdimi?** Asosiy nazorat shu, chunki monitor aynan shuning uchun qo'yilgan.

Monitorsiz xonadagi dars ham ko'rsatiladi, lekin alohida: u yerda o'qituvchi
o'z noutbukidan kirishi mumkin, majburiy emas.

Toq/juft hafta (surat/maxraj) alohida hisoblanmaydi — HEMIS har darsni ANIQ
sana bilan beradi, ya'ni jadval qaysi haftada nima bo'lishini o'zi aytadi.

Hamma raqam bitta manbadan: `core_hemislesson` (HEMIS jadvalining nusxasi).
"""

from __future__ import annotations

import datetime as dt
import threading
import time
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.services import lesson_report_service as lr
from app.services import monitor_room_service as mr
from app.services import monitor_schedule_service as ms
from app.services import teacher_activity_service as ta
from app.services.dean_access import in_groups

# Ishlatish darajasi shu chegaralardan qanday o'tgani rangni belgilaydi.
GOOD = 70
WARN = 40


#: "Kirgan, lekin yetmagan" darslar ikkiga bo'linadi: chegaraga YAQIN kelgan
#: (masalan 40 daqiqa — dars deyarli iMentor'da o'tgan) va shunchaki kirib
#: chiqqan. Rektor uchun ikkalasining ma'nosi har xil (2026-10-09).
NEAR_MINUTES = 30


#: Hisobot shu muddatga saqlanadi. Sahifa "Jonli" rejimda har 60 soniyada
#: qayta so'raydi, bir necha kishi (rektor, dekanlar, monitor) bir vaqtda ochadi,
#: raqam bosilganda esa butun hisob qaytadan yurardi. 30 kunlik davr 17-20
#: soniya hisoblanadi — brauzer kutib turolmay "so'rov vaqti tugadi" derdi
#: (2026-10-09). Testlarda 0 (qarang conftest).
CACHE_SECONDS = 45
_cache: dict[tuple, tuple[float, object]] = {}
_locks: dict[tuple, threading.Lock] = {}


def _cached(key: tuple, build):
    """Bir xil so'rov bir vaqtda kelsa bittasi hisoblaydi, qolgani natijani kutadi."""
    if CACHE_SECONDS <= 0:
        return build()
    with _locks.setdefault(key, threading.Lock()):
        hit = _cache.get(key)
        now = time.monotonic()
        if hit is not None and now - hit[0] < CACHE_SECONDS:
            return hit[1]
        value = build()
        now = time.monotonic()
        for old in [k for k, (t, _) in _cache.items() if now - t >= CACHE_SECONDS]:
            _cache.pop(old, None)
            _locks.pop(old, None)
        _cache[key] = (now, value)
        return value


def clear_cache() -> None:
    _cache.clear()
    _locks.clear()


def _band(percent: int | None) -> str:
    if percent is None:
        return "none"
    if percent >= GOOD:
        return "good"
    if percent >= WARN:
        return "warn"
    return "bad"


def _pct(part: int, whole: int) -> int:
    return round(100 * part / whole) if whole else 0


def _teacher_stats(lessons: list[HemisLesson], used: dict[int, tuple[bool, int]],
                   rooms: dict[str, dict] | None = None) -> dict[str, dict]:
    """Har o'qituvchi: monitorli va monitorsiz darslari alohida.

    `rooms` berilsa, har darsning xonasi ishlayotgani ISBOTLANGANMI ham
    sanaladi (o'sha xonada kimdir ishlatgan). Shu raqam bahonani hal qiladi.
    """
    rooms = rooms or {}
    out: dict[str, dict] = {}
    for lesson in lessons:
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        row = out.setdefault(key, {
            "teacher_key": lesson.teacher_username,
            "teacher_name": lesson.teacher_name,
            "employee_id": lesson.employee_id,
            "linked": bool(lesson.teacher_username),
            "departments": set(),
            "monitor_lessons": 0, "monitor_used": 0,
            "other_lessons": 0, "other_used": 0,
            "students": 0, "rooms": set(), "days": set(), "last_used": None,
            "other_account_active_lessons": 0,
        })
        row["departments"].add(lesson.department_name)
        row["days"].add(lesson.lesson_date)
        hit = used.get(lesson.id)
        if lesson.monitor_id:
            row["monitor_lessons"] += 1
            row["rooms"].add(lesson.auditorium_name)
            # Activity by another account is only room-level context. It cannot
            # prove this teacher could use this monitor or attended the lesson.
            if lesson.id in (rooms.get(lesson.monitor_id) or {}).get("active_lesson_ids", set()):
                row["other_account_active_lessons"] += 1
            if hit:
                row["monitor_used"] += 1
        else:
            row["other_lessons"] += 1
            if hit:
                row["other_used"] += 1
        if hit:
            row["students"] += hit[1]
            if row["last_used"] is None or lesson.lesson_date > row["last_used"]:
                row["last_used"] = lesson.lesson_date
    return out


def _teacher_row(row: dict) -> dict:
    monitor_lessons = row["monitor_lessons"]
    percent = _pct(row["monitor_used"], monitor_lessons) if monitor_lessons else None
    return {
        "teacher_key": row["teacher_key"],
        "teacher_name": row["teacher_name"],
        "employee_id": row["employee_id"],
        "linked": row["linked"],
        "department": " / ".join(sorted(x for x in row["departments"] if x))[:200],
        "monitor_lessons": monitor_lessons,
        "monitor_used": row["monitor_used"],
        "monitor_percent": percent,
        "band": _band(percent) if row["linked"] else "none",
        "other_lessons": row["other_lessons"],
        "other_used": row["other_used"],
        "lessons": monitor_lessons + row["other_lessons"],
        "students": row["students"],
        "days": len(row["days"]),
        "rooms": sorted(x for x in row["rooms"] if x)[:6],
        "last_used": row["last_used"].isoformat() if row["last_used"] else None,
        # Compatibility name retained; this is context, not proof of guilt.
        "proven_lessons": row["other_account_active_lessons"],
        "excuse": "check_room",
        "assessment": "usage_record_missing_review_required",
    }


def _attention_row(r: dict) -> dict:
    """Qizil ro'yxatdagi qator — dalili bilan."""
    return {k: r[k] for k in ("teacher_key", "teacher_name", "department", "monitor_lessons", "days", "rooms",
                              "other_used", "other_lessons", "proven_lessons", "excuse", "employee_id")}


def _source(lessons: list[HemisLesson], rows: list[dict]) -> dict:
    """Ma'lumot qayerdan: HEMIS nusxasi qachon olingan va nimani qamragan.

    Rektor ham, o'qituvchi ham raqamning manbasini ko'rib turishi kerak —
    shunda bahs "hisobot noto'g'ri" emas, "HEMIS'da shunday yozilgan" bo'ladi.
    """
    synced = [x.synced_at for x in lessons if getattr(x, "synced_at", None)]
    rooms_without_monitor = {x.auditorium_name for x in lessons if not x.monitor_id and x.auditorium_name}
    return {
        "synced_at": max(synced).isoformat() if synced else None,
        "lessons": len(lessons),
        "teachers": len(rows),
        "unlinked_teachers": sum(1 for r in rows if not r["linked"]),
        "rooms_without_monitor": len(rooms_without_monitor),
    }


def _attach(row: dict, engagement: dict, profiles: dict, materials: dict) -> None:
    """Qatorga iMentor'dagi haqiqiy ishini qo'shadi (daqiqa, yaratgani, profil)."""
    key = row["teacher_key"] or ""
    eng = engagement.get(key) or {}
    prof = profiles.get(key) or {}
    mat = materials.get(key) or {}
    created = eng.get("created") or {}
    row["minutes"] = int(eng.get("minutes", 0) or 0)
    row["active_days"] = int(eng.get("active_days", 0) or 0)
    row["created"] = created
    row["created_total"] = int(eng.get("created_total", 0) or 0)
    row["top_module"] = (eng.get("modules") or [{}])[0].get("label", "") if eng.get("modules") else ""
    row["depth"] = eng.get("depth", "none") if row["linked"] else "none"
    row["profile_percent"] = prof.get("percent")
    row["profile_missing"] = prof.get("missing", [])
    row["subjects_linked"] = int(prof.get("subjects", 0) or 0)
    row["material_percent"] = mat.get("percent")
    row["material_topics"] = int(mat.get("topics", 0) or 0)
    row["material_empty"] = int(mat.get("empty", 0) or 0)


def teacher_state(r: dict) -> str:
    """O'qituvchining davrdagi holati — har kishi FAQAT bitta toifada.

    Ilgari sahifadagi "kirgan, dars o'tmagan" (80) va "umuman ishlatmagan" (110)
    bir-birini qoplardi: kirib chiqqan, lekin birorta darsni to'liq o'tmagan
    o'qituvchi ikkalasida ham sanalardi va yig'indi nazoratdagilar sonidan
    (143) oshib ketardi (2026-10-09).
    """
    if not r["monitor_lessons"]:
        return "offsite"
    if not r["linked"]:
        return "unlinked"
    if r["monitor_used"] >= r["monitor_lessons"]:
        return "full"          # hamma darsini iMentor'da o'tgan
    if r["monitor_used"]:
        return "partial"       # ba'zi darsini o'tgan, qolganini o'tmagan
    if r.get("on_leave"):
        return "on_leave"
    if r.get("short_lessons"):
        return "opened"        # kirgan, lekin birorta darsni to'liq o'tmagan
    return "none"              # dars vaqtida umuman ochmagan


#: Toifalar sahifada shu tartibda; yig'indisi = nazoratdagi o'qituvchilar.
TEACHER_STATES = ("full", "partial", "opened", "none", "on_leave", "unlinked")


def teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                 query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict]:
    """O'qituvchi qatorlari + ular qurilgan xom ma'lumot.

    `overview` ham, raqam ortidagi ro'yxatni beradigan `people` ham SHU
    funksiyadan foydalanadi — shunda modaldagi ro'yxat sahifadagi raqam bilan
    bir xil hisobdan chiqadi va ular hech qachon bir-biriga qarama-qarshi bo'lmaydi.
    """
    rows, lessons, used, rooms, _ = _teacher_rows(db, start_day, end_day, department=department,
                                                  query=query, groups=groups)
    return rows, lessons, used, rooms


def _teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                  query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict, dict]:
    """`teacher_rows` + hali tugamagan (baholanmaydigan) darslar haqida ma'lumot."""
    key = ("rows", start_day, end_day, department, query, tuple(groups))
    return _cached(key, lambda: _build_teacher_rows(db, start_day, end_day, department=department,
                                                    query=query, groups=groups))


def _build_teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                        query: str = "", groups: tuple[str, ...] = ()) -> tuple[list[dict], list, dict, dict, dict]:
    every = lr._lessons(db, start_day, end_day, department=department, groups=groups, pending=True)
    now = lr.current_time()
    today = now.date()
    lessons, waiting = [], []
    for x in every:
        # O'tgan kunlar darsi aniq tugagan — vaqtini hisoblab o'tirilmaydi.
        (lessons if x.lesson_date < today or lr.is_over(x, now) else waiting).append(x)
    waiting_by: dict[str, int] = defaultdict(int)
    for lesson in waiting:
        if lesson.monitor_id:
            waiting_by[lesson.teacher_username or f"name:{lesson.teacher_name}"] += 1
    pending = {
        "lessons": len(waiting),
        "monitor_lessons": sum(waiting_by.values()),
        "teachers": len(waiting_by),
        "as_of": now.isoformat() if waiting else None,
    }
    # Faollik bir marta hisoblanadi va `overview` ga ham shu beriladi: ilgari
    # u ikki marta yurardi (30 kunlik davrda har biri ~4 soniya).
    engagement = ta.engagement_map(db, start_day, end_day)
    pending["_engagement"] = engagement
    # Xom o'lchov: har darsda qancha ishlangan. `used` shundan chegaradan
    # o'tganlarini oladi, qolgani "kirgan, lekin dars o'tilmagan" bo'ladi —
    # rektor aynan shu farqni ko'rishni so'radi (2026-10-08).
    work = lr.work_map(db, lessons)
    need = lr.MIN_LESSON_MINUTES * 60
    used = {k: (True, students) for k, (seconds, students) in work.items() if seconds >= need}
    # Avval XONALAR: qaysi monitor ishlayotgani isbotlangan, qaysi biri shubhali.
    rooms = mr.room_stats(lessons, used)
    stats = _teacher_stats(lessons, used, rooms)
    rows = [_teacher_row(r) for r in stats.values()]

    # Dalil: har o'qituvchi monitorli darslarida qancha vaqt ishlagan va
    # nechta darsga shunchaki "kirib chiqqan".
    short: dict[str, int] = defaultdict(int)
    near: dict[str, int] = defaultdict(int)
    worked: dict[str, int] = defaultdict(int)
    short_seconds: dict[str, int] = defaultdict(int)
    near_need = min(NEAR_MINUTES * 60, need)
    for lesson in lessons:
        if not lesson.monitor_id:
            continue
        key = lesson.teacher_username or f"name:{lesson.teacher_name}"
        seconds = work.get(lesson.id, (0, 0))[0]
        worked[key] += seconds
        if 0 < seconds < need:
            short[key] += 1
            short_seconds[key] += seconds
            if seconds >= near_need:
                near[key] += 1
    for r in rows:
        key = r["teacher_key"] or f"name:{r['teacher_name']}"
        r["short_lessons"] = short.get(key, 0)
        # Qisqa darslarning ichidan: chegaraga yaqin (30-49 daq) va juda qisqa (1-29 daq).
        r["short_near_lessons"] = near.get(key, 0)
        r["short_brief_lessons"] = short.get(key, 0) - near.get(key, 0)
        # Qisqa darslarda o'rtacha necha daqiqa ishlagan — "deyarli o'tgan"mi yoki "kirib chiqqan"mi.
        r["short_avg_minutes"] = round(short_seconds[key] / short[key] / 60) if short.get(key) else 0
        r["monitor_minutes"] = worked.get(key, 0) // 60
        # O'tilmagan darslar soni va bugun hali tugamagan darslari.
        r["monitor_missed"] = r["monitor_lessons"] - r["monitor_used"]
        r["pending_lessons"] = waiting_by.get(key, 0)

    # --- Ikkinchi qatlam: darsda ochgani kam, nima qilgani ham kerak.
    profiles = ta.profile_map(db)
    materials = ta.materials_map(db)
    for r in rows:
        _attach(r, engagement, profiles, materials)

    # HEMIS'da ta'tildagi o'qituvchi ayblanmaydi (2026-09-26) — u ro'yxatda
    # "ta'tilda" belgisi bilan qoladi, lekin qizil ro'yxatlarga tushmaydi.
    from app.services.hemis_staff import on_leave_logins

    leave = on_leave_logins(db)
    for r in rows:
        r["on_leave"] = bool(r["teacher_key"]) and r["teacher_key"] in leave
        r["state"] = teacher_state(r)

    needle = (query or "").strip().casefold()
    if needle:
        rows = [r for r in rows if needle in f"{r['teacher_name']} {r['teacher_key']}".casefold()]
    return rows, lessons, used, rooms, pending


def overview(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
             query: str = "", groups: tuple[str, ...] = ()) -> dict:
    """Rektor sahifasining butun mazmuni — bitta so'rovda."""
    key = ("overview", start_day, end_day, department, query, tuple(groups))
    # Nusxa: yo'l (route) dekan uchun ro'yxatlarni almashtiradi — saqlangan
    # javobning o'zi o'zgarib, keyingi (rektor) so'roviga o'tib ketmasin.
    return dict(_cached(key, lambda: _build_overview(db, start_day, end_day, department=department,
                                                     query=query, groups=groups)))


def _build_overview(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                    query: str = "", groups: tuple[str, ...] = ()) -> dict:
    rows, lessons, used, rooms, pending = _teacher_rows(db, start_day, end_day, department=department,
                                                        query=query, groups=groups)
    engagement = pending["_engagement"]
    pending = {k: v for k, v in pending.items() if not k.startswith("_")}
    # Kesh bilan bo'lishilgan ro'yxat — tartiblash boshqa so'rovga ta'sir qilmasin.
    rows = list(rows)

    # --- Asosiy: monitorli darslar
    monitor_lessons = sum(r["monitor_lessons"] for r in rows)
    monitor_used = sum(r["monitor_used"] for r in rows)
    other_lessons = sum(r["other_lessons"] for r in rows)
    other_used = sum(r["other_used"] for r in rows)

    # Hisobotning asosiy qismi FAQAT monitorli xonada darsi borlar haqida:
    # klinikada yoki masofadan dars o'tadigan o'qituvchini monitor bo'yicha
    # baholab bo'lmaydi, uni bitta ro'yxatga qo'shish esa raqamlarni
    # chalkashtirardi (2026-10-06 shikoyati). Ular alohida bo'limda.
    watched = [r for r in rows if r["monitor_lessons"] > 0]
    idle = [r for r in watched if r["monitor_used"] == 0 and r["linked"] and not r["on_leave"]]
    idle.sort(key=lambda r: -r["monitor_lessons"])
    # Bahonasi yo'qlar va avval xonasi tekshirilishi kerak bo'lganlar — ALOHIDA.
    # Room activity by somebody else is never treated as an individual verdict.
    # "Qayd yo'q" faqat dars vaqtida UMUMAN ochmaganlarga tegishli: kirib,
    # lekin darsni to'liq o'tmaganlarda qayd bor — ular alohida toifada.
    blamed = []
    check_room = [r for r in idle if r["state"] == "none"]
    states = {name: sum(1 for r in watched if r["state"] == name) for name in TEACHER_STATES}
    teachers_used = states["full"] + states["partial"]

    # --- Kunlik kesim (grafik uchun)
    per_day: dict[dt.date, dict] = defaultdict(lambda: {"monitor": 0, "used": 0})
    for lesson in lessons:
        if not lesson.monitor_id:
            continue
        day = per_day[lesson.lesson_date]
        day["monitor"] += 1
        if lesson.id in used:
            day["used"] += 1
    daily = [{
        "date": day.isoformat(),
        "weekday": ms.WEEKDAYS[day.weekday()] if day.weekday() < len(ms.WEEKDAYS) else "",
        "lessons": v["monitor"],
        "used": v["used"],
        "percent": _pct(v["used"], v["monitor"]),
    } for day, v in sorted(per_day.items())]

    # --- Kafedralar
    dep_agg: dict[str, dict] = defaultdict(
        lambda: {"monitor": 0, "used": 0, "teachers": set(), "active": set(), "other": 0})
    for lesson in lessons:
        d = dep_agg[lesson.department_name or "—"]
        if lesson.monitor_id:
            d["monitor"] += 1
            if lesson.teacher_username:
                d["teachers"].add(lesson.teacher_username)
            if lesson.id in used:
                d["used"] += 1
                if lesson.teacher_username:
                    d["active"].add(lesson.teacher_username)
        else:
            d["other"] += 1
    departments = [{
        "department": name,
        "monitor_lessons": v["monitor"],
        "monitor_used": v["used"],
        "percent": _pct(v["used"], v["monitor"]),
        "band": _band(_pct(v["used"], v["monitor"])) if v["monitor"] else "none",
        "teachers": len(v["teachers"]),
        "active_teachers": len(v["active"]),
        "other_lessons": v["other"],
    } for name, v in dep_agg.items() if v["monitor"] or v["other"]]
    departments.sort(key=lambda r: (r["percent"], -r["monitor_lessons"]))

    rows.sort(key=lambda r: (r["monitor_percent"] if r["monitor_percent"] is not None else 999,
                             -r["monitor_lessons"]))
    # Ro'yxatlar TARTIBLANGANDAN keyin bo'linadi: aks holda asosiy ro'yxat
    # "eng yomoni oldinda" tartibini yo'qotardi.
    monitored_rows = [r for r in rows if r["monitor_lessons"] > 0]
    offsite = [r for r in rows if not r["monitor_lessons"]]

    # --- Monitorsiz joylar: qaysi bino va xonada, necha dars, kim
    place_agg: dict[str, dict] = defaultdict(
        lambda: {"lessons": 0, "used": 0, "teachers": set()})
    for lesson in lessons:
        if lesson.monitor_id:
            continue
        name = " — ".join(x for x in (lesson.building_name, lesson.auditorium_name) if x) or "—"
        p = place_agg[name]
        p["lessons"] += 1
        if lesson.teacher_username:
            p["teachers"].add(lesson.teacher_username)
        if lesson.id in used:
            p["used"] += 1
    places = sorted(
        ({"place": name, "lessons": v["lessons"], "used": v["used"],
          "teachers": len(v["teachers"]), "percent": _pct(v["used"], v["lessons"])}
         for name, v in place_agg.items()),
        key=lambda r: -r["lessons"],
    )

    # --- Faollik sifati: kirgani emas, nima qilgani
    linked = [r for r in rows if r["linked"]]
    shown = {r["teacher_key"] for r in linked}
    quality = {
        "minutes": sum(r["minutes"] for r in linked),
        "worked": sum(1 for r in linked if r["depth"] == "worked"),
        "viewed": sum(1 for r in linked if r["depth"] == "viewed"),
        "visit": sum(1 for r in linked if r["depth"] == "visit"),
        "never": sum(1 for r in linked if r["depth"] == "none"),
        "no_subject": sum(1 for r in linked if not r["subjects_linked"]),
        "profile_incomplete": sum(1 for r in linked if (r["profile_percent"] or 0) < 100),
        "teachers": len(linked),
    }
    mine = {k: v for k, v in engagement.items() if k in shown}
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "headline": {
            "monitor_lessons": monitor_lessons,
            "monitor_used": monitor_used,
            "monitor_percent": _pct(monitor_used, monitor_lessons),
            "band": _band(_pct(monitor_used, monitor_lessons)) if monitor_lessons else "none",
            "watched_teachers": len(watched),
            "idle_teachers": len(idle),
            # O'qituvchi kesimi: darsi borlardan nechtasi kamida bitta darsni
            # iMentor'da o'tgan. Toifalar bir-birini qoplamaydi, yig'indisi =
            # `watched_teachers`.
            "teachers_used": teachers_used,
            "teacher_percent": _pct(teachers_used, len(watched)),
            "teacher_buckets": states,
            # Qisman o'tganlarning o'tilmay qolgan darslari.
            "partial_missed_lessons": sum(r["monitor_missed"] for r in watched if r["state"] == "partial"),
            # Hali tugamagan darslar — hech bir raqamga kirmagan.
            "pending": pending,
            "other_lessons": other_lessons,
            "other_used": other_used,
            "other_percent": _pct(other_used, other_lessons),
            "unlinked_teachers": sum(1 for r in rows if not r["linked"]),
            "total_lessons": monitor_lessons + other_lessons,
            "blamed_teachers": len(blamed),
            "check_room_teachers": len(check_room),
            "on_leave_teachers": sum(1 for r in rows if r["on_leave"]),
            # Monitorli xonada umuman darsi yo'qlar — asosiy foizga kirmaydi.
            "offsite_teachers": len(offsite),
            # Kirgan, lekin darsni iMentor'da o'tmagan: chegaradan past.
            "short_lessons": sum(r.get("short_lessons", 0) for r in rows),
            "short_teachers": sum(1 for r in rows if r.get("short_lessons")),
            # Monitorli darslar ishlangan vaqt bo'yicha: to'liq (chegaradan o'tgan),
            # yaqin (30-49 daq), qisqa (1-29 daq), umuman ochilmagan. Yig'indisi =
            # `monitor_lessons` — sahifadagi taqsimot chizig'i shundan.
            "work_buckets": {
                "full": monitor_used,
                "near": sum(r.get("short_near_lessons", 0) for r in rows),
                "brief": sum(r.get("short_brief_lessons", 0) for r in rows),
                "none": monitor_lessons - monitor_used - sum(r.get("short_lessons", 0) for r in rows),
            },
            "short_near_teachers": sum(1 for r in rows if r.get("short_near_lessons")),
            "short_brief_teachers": sum(1 for r in rows if r.get("short_brief_lessons")),
            "near_minutes": NEAR_MINUTES,
            "min_lesson_minutes": lr.MIN_LESSON_MINUTES,
        },
        "attention": [_attention_row(r) for r in blamed[:60]],
        "check_room": [_attention_row(r) for r in check_room[:40]],
        "rooms": mr.payload(rooms),
        "room_summary": mr.summary(rooms),
        "source": _source(lessons, rows),
        "daily": daily,
        "departments": departments,
        "teachers": monitored_rows,
        "offsite": {
            "teachers": offsite,
            "count": len(offsite),
            "lessons": sum(r["other_lessons"] for r in offsite),
            "used": sum(r["other_used"] for r in offsite),
            "places": places[:60],
            "places_total": len(places),
        },
        "quality": quality,
        "modules": ta.module_totals(mine),
        "created": ta.created_totals(mine),
        "created_labels": ta.CREATED_LABEL,
    }


# ======================================================= raqam ortidagi odamlar


def _person(key: str, name: str, subtitle: str, value, label: str, *, kind: str = "teacher",
            note: str = "") -> dict:
    return {"key": key, "kind": kind, "name": name or key, "subtitle": subtitle,
            "value": value, "value_label": label, "note": note}


def _by_value(people: list[dict], *, reverse: bool = True) -> list[dict]:
    people.sort(key=lambda r: ((r["value"] if isinstance(r["value"], (int, float)) else 0), r["name"]),
                reverse=reverse)
    if not reverse:  # kam qiymat oldinda, lekin ism ichida A→Z qolsin
        people.sort(key=lambda r: (r["value"] if isinstance(r["value"], (int, float)) else 0, r["name"]))
    return people


def _teacher_person(row: dict, value, label: str) -> dict:
    note = "ta\u2019tilda" if row.get("on_leave") else ("hisobi yo\u2018q" if not row["linked"] else "")
    return _person(row["teacher_key"] or f"name:{row['teacher_name']}", row["teacher_name"],
                   row["department"], value, label, note=note)


#: Qaysi raqam qaysi ro'yxatni ochadi. Har biri sahifadagi ANIQ bir raqam.
TEACHER_METRICS: dict[str, str] = {
    "monitor_lessons": "Monitorli xonada darsi bor o\u2018qituvchilar",
    "monitor_used": "Monitorli darsda iMentor ochganlar",
    "watched": "Nazoratdagi o\u2018qituvchilar",
    "idle": "Monitorli darsda iMentor ochmaganlar",
    "blamed": "Monitorli darsda foydalanish qaydi topilmagan — tekshirish kerak",
    "check_room": "Avval xonasi tekshirilishi kerak",
    "on_leave": "HEMIS bo\u2018yicha ta\u2019tilda",
    "unlinked": "HEMIS jadvalida bor, iMentor hisobi yo\u2018q",
    "other_lessons": "Monitorsiz xonada darsi bor",
    "offsite": "Monitorli xonada darsi YO‘Q — klinika yoki masofaviy",
    "short": "Kirgan, lekin darsni iMentor’da o‘tmagan",
    "t_used": "Kamida bitta darsini iMentor’da o‘tganlar",
    "t_full": "Hamma darsini iMentor’da o‘tganlar",
    "t_partial": "Ba’zi darsini o‘tgan, qolganini o‘tmaganlar",
    "t_opened": "Kirgan, lekin birorta darsni to‘liq o‘tmaganlar",
    "t_none": "Dars vaqtida iMentor’ni umuman ochmaganlar",
    "short_near": (f"Ishlatgan, lekin {lr.MIN_LESSON_MINUTES} daqiqaga yetmagan "
                   f"({NEAR_MINUTES}–{lr.MIN_LESSON_MINUTES - 1} daqiqa)"),
    "short_brief": f"Kirib chiqqan ({NEAR_MINUTES} daqiqadan kam)",
    "other_used": "Monitorsiz darsda iMentor ochganlar",
    "total_lessons": "Jadvalda darsi bor barcha o\u2018qituvchilar",
    "minutes": "iMentor\u2019da ishlagan vaqt bo\u2018yicha",
    "worked": "Material yaratganlar",
    "viewed": "Ko\u2018rgan, lekin yaratmaganlar",
    "visit": "Kirib chiqqanlar (5 daqiqadan kam)",
    "never": "Bu davrda umuman kirmaganlar",
    "no_subject": "Fan biriktirmaganlar",
    "profile_incomplete": "Profili to\u2018liq emas",
    "teachers": "Nazoratdagi hisoblar",
    "material_gap": "Fanida materialsiz mavzu qolganlar",
}


def people(db: Session, start_day: dt.date, end_day: dt.date, *, metric: str, key: str = "",
           department: str = "", groups: tuple[str, ...] = ()) -> dict:
    """Sahifadagi bitta RAQAM ortidagi odamlar ro'yxati.

    Rektor raqamni bosadi — kim ekanini ko'radi. Ro'yxat hisobotning o'zi
    bilan bir manbadan (`teacher_rows`), shuning uchun soni har doim mos keladi.
    """
    name, _, arg = (metric or "").partition(":")
    arg = arg or key

    if name in ("students_tested", "students_attempts", "students_all", "group", "groups_active"):
        return _student_people(db, start_day, end_day, name, arg)

    rows, lessons, used, rooms = teacher_rows(db, start_day, end_day, department=department, groups=groups)
    linked = [r for r in rows if r["linked"]]
    title = TEACHER_METRICS.get(name, "")
    out: list[dict] = []

    def add(filtered, value_of, label, *, rows_source=None):
        for r in (rows_source if rows_source is not None else filtered):
            out.append(_teacher_person(r, value_of(r), label))

    if name == "monitor_lessons":
        add([r for r in rows if r["monitor_lessons"]], lambda r: r["monitor_lessons"], "dars")
    elif name == "monitor_used":
        add([r for r in rows if r["monitor_used"]], lambda r: r["monitor_used"], "dars")
    elif name == "watched":
        add([r for r in rows if r["monitor_lessons"] > 0],
            lambda r: r["monitor_percent"] if r["monitor_percent"] is not None else 0, "%")
    elif name in ("idle", "blamed", "check_room"):
        idle = [r for r in rows if r["monitor_lessons"] > 0 and r["monitor_used"] == 0
                and r["linked"] and not r["on_leave"]]
        if name == "blamed":
            idle = [r for r in idle if r["excuse"] == "none"]
        elif name == "check_room":
            idle = [r for r in idle if r["state"] == "none"]
        add(idle, lambda r: r["monitor_lessons"], "dars")
    elif name in ("t_used", "t_full", "t_partial", "t_opened", "t_none"):
        want = ("full", "partial") if name == "t_used" else (name[2:],)
        for r in rows:
            if r["state"] not in want:
                continue
            # "2 / 4 dars" — nechta darsidan nechtasini o'tgani bir qarashda.
            label = f"/ {r['monitor_lessons']} dars"
            if r["state"] == "opened":
                label += f" · {r['short_lessons']} tasiga kirgan"
            out.append(_teacher_person(r, r["monitor_used"], label))
    elif name == "on_leave":
        add([r for r in rows if r.get("on_leave")], lambda r: r["monitor_lessons"], "dars")
    elif name == "unlinked":
        add([r for r in rows if not r["linked"]], lambda r: r["lessons"], "dars")
    elif name == "short":
        # Qisqa kirib chiqqanlar: eng ko'p "aldagan" oldinda.
        add([r for r in rows if r.get("short_lessons")],
            lambda r: r.get("short_lessons", 0), "dars")
    elif name in ("short_near", "short_brief"):
        field = "short_near_lessons" if name == "short_near" else "short_brief_lessons"
        add([r for r in rows if r.get(field)], lambda r: r.get(field, 0), "dars")
    elif name == "offsite":
        # Monitor bo'yicha baholab bo'lmaydiganlar: butun darsi monitorsiz
        # joyda o'tadi (klinika bazasi, dispanser, masofaviy).
        add([r for r in rows if not r["monitor_lessons"]], lambda r: r["other_lessons"], "dars")
    elif name == "other_lessons":
        add([r for r in rows if r["other_lessons"]], lambda r: r["other_lessons"], "dars")
    elif name == "other_used":
        add([r for r in rows if r["other_used"]], lambda r: r["other_used"], "dars")
    elif name == "total_lessons":
        add([r for r in rows if r["lessons"]], lambda r: r["lessons"], "dars")
    elif name == "minutes":
        add([r for r in linked if r["minutes"]], lambda r: r["minutes"], "daq")
    elif name in ("worked", "viewed", "visit", "never"):
        # "never" — sahifadagi nom; ma'lumotdagi qiymat "none".
        want = "none" if name == "never" else name
        add([r for r in linked if r["depth"] == want], lambda r: r["created_total"], "material")
    elif name == "no_subject":
        add([r for r in linked if not r["subjects_linked"]], lambda r: r["lessons"], "dars")
    elif name == "profile_incomplete":
        add([r for r in linked if (r["profile_percent"] or 0) < 100],
            lambda r: r["profile_percent"] or 0, "%")
    elif name == "teachers":
        add(linked, lambda r: r["monitor_lessons"], "dars")
    elif name == "material_gap":
        add([r for r in linked if r["material_empty"]], lambda r: r["material_empty"], "bo\u2018sh mavzu")
    elif name in ("department", "department_active"):
        # Kafedra qatoridagi "N/M o'qituvchi" AYNAN shunday sanaladi: shu
        # kafedrada MONITORLI darsi bor, hisobi bog'langan o'qituvchilar.
        # Ilgari bu yerda qator matni bo'yicha filtr edi \u2014 ikki kafedrada dars
        # o'tadigan o'qituvchida son mos kelmasdi (2026-09-28).
        out = _department_people(rows, lessons, used, arg, only_active=name == "department_active")
        title = (f"{arg} \u2014 monitorda ishlatganlar" if name == "department_active"
                 else f"{arg} \u2014 o\u2018qituvchilari")
    elif name in ("day", "day_used"):
        out = _day_people(rows, lessons, used, arg, only_used=name == "day_used")
        title = ("Shu kuni monitorli darsda ishlatganlar" if name == "day_used"
                 else "Shu kuni monitorli darsi bo\u2018lganlar") + f" \u2014 {arg}"
    elif name in ("room", "room_idle"):
        out = _room_people(rows, lessons, used, arg, only_idle=name == "room_idle")
        room = rooms.get(arg) or {}
        label = room.get("room") or arg
        title = (f"{label} \u2014 ochmaganlar" if name == "room_idle" else f"{label} \u2014 dars o\u2018tadiganlar")
    elif name in ("module", "created"):
        out, title = _activity_people(db, start_day, end_day, rows, name, arg)
    else:
        raise ValueError(f"noma'lum ko'rsatkich: {metric}")

    _by_value(out, reverse=name not in ("minutes_low",))
    return {"metric": metric, "title": title or metric, "kind": "teacher",
            "total": len(out), "people": out[:400]}


def _day_people(rows: list[dict], lessons, used, day_iso: str, *, only_used: bool) -> list[dict]:
    by_key = {r["teacher_key"] or f"name:{r['teacher_name']}": r for r in rows}
    per: dict[str, dict] = {}
    for lesson in lessons:
        if not lesson.monitor_id or lesson.lesson_date.isoformat() != day_iso:
            continue
        k = lesson.teacher_username or f"name:{lesson.teacher_name}"
        slot = per.setdefault(k, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for k, v in per.items():
        if only_used and not v["used"]:
            continue
        row = by_key.get(k)
        if row is None:
            continue
        out.append(_teacher_person(row, v["used"] if only_used else v["lessons"],
                                   "dars" if only_used else f"darsdan {v['used']} tasi"))
    return out


def _room_people(rows: list[dict], lessons, used, monitor_id: str, *, only_idle: bool) -> list[dict]:
    by_key = {r["teacher_key"] or f"name:{r['teacher_name']}": r for r in rows}
    per: dict[str, dict] = {}
    for lesson in lessons:
        if lesson.monitor_id != monitor_id:
            continue
        k = lesson.teacher_username or f"name:{lesson.teacher_name}"
        slot = per.setdefault(k, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for k, v in per.items():
        if only_idle and v["used"]:
            continue
        row = by_key.get(k)
        if row is None:
            continue
        out.append(_teacher_person(row, v["lessons"], f"darsdan {v['used']} tasida ochgan"))
    return out


def _department_people(rows: list[dict], lessons, used, department: str, *, only_active: bool) -> list[dict]:
    by_key = {r["teacher_key"]: r for r in rows if r["teacher_key"]}
    per: dict[str, dict] = {}
    for lesson in lessons:
        if lesson.department_name != department or not lesson.monitor_id or not lesson.teacher_username:
            continue
        slot = per.setdefault(lesson.teacher_username, {"lessons": 0, "used": 0})
        slot["lessons"] += 1
        if lesson.id in used:
            slot["used"] += 1
    out = []
    for key, v in per.items():
        if only_active and not v["used"]:
            continue
        row = by_key.get(key)
        if row is None:
            continue
        out.append(_teacher_person(row, v["used"] if only_active else v["lessons"],
                                   "dars" if only_active else f"darsdan {v['used']} tasida ochgan"))
    return out


def _activity_people(db: Session, start_day: dt.date, end_day: dt.date, rows: list[dict],
                     kind: str, arg: str) -> tuple[list[dict], str]:
    """Bo'lim (modul) yoki yaratilgan material turi ortidagi o'qituvchilar.

    Sahifadagi "N kishi" faqat JADVALDA darsi bor, hisobi bog'langan
    o'qituvchilarni sanaydi — ro'yxat ham aynan shularni ko'rsatadi.
    """
    engagement = ta.engagement_map(db, start_day, end_day)
    by_key = {r["teacher_key"]: r for r in rows if r["teacher_key"] and r["linked"]}
    engagement = {k: v for k, v in engagement.items() if k in by_key}
    from app.services.rector_report_service import staff_directory

    directory = staff_directory(db)
    out: list[dict] = []
    title = ""
    for owner, eng in engagement.items():
        row = by_key.get(owner)
        info = directory.get(owner) or {}
        name = (row or {}).get("teacher_name") or info.get("display_name") or owner
        subtitle = (row or {}).get("department") or info.get("department", "")
        if kind == "module":
            # Sahifadagi "N kishi" bo'limni OCHGAN hammani sanaydi — 0 daqiqa
            # turgan (kirib darhol chiqqan) ham kiradi. Ro'yxat ham shunday.
            hit = next((m for m in eng.get("modules", []) if m["page"] == arg), None)
            if not hit:
                continue
            title = f"{hit['label']} \u2014 shu bo\u2018limda ishlaganlar"
            out.append(_person(owner, name, subtitle, hit["minutes"], "daq",
                               note=f"{hit['opens']} marta ochgan"))
        else:
            n = int((eng.get("created") or {}).get(arg, 0) or 0)
            if not n:
                continue
            title = f"{ta.CREATED_LABEL.get(arg, arg)} \u2014 yaratganlar"
            out.append(_person(owner, name, subtitle, n, "ta"))
    if not title:
        title = ta.MODULE_LABEL.get(arg, ta.CREATED_LABEL.get(arg, arg))
    return out, title


def _student_people(db: Session, start_day: dt.date, end_day: dt.date, name: str, arg: str) -> dict:
    data = students(db, start_day, end_day)
    rows = data["students"]
    title = "Test topshirgan talabalar"
    if name == "group":
        rows = [r for r in rows if (r["group"] or "\u2014") == arg]
        title = f"{arg} \u2014 test topshirgan talabalar"
    elif name == "students_attempts":
        title = "Urinishlar bo\u2018yicha talabalar"
    elif name == "groups_active":
        title = "Faol guruhlar (kamida bitta talaba topshirgan)"
        groups = [_person(g["group"], g["group"], f"{g['tested_students']}/{g['group_size']} talaba",
                          g["attempts"], "urinish", kind="group",
                          note=f"o\u2018rtacha {g['avg_score']}%") for g in data["groups"]]
        _by_value(groups)
        return {"metric": name, "title": title, "kind": "group", "total": len(groups), "people": groups}

    out = [_person(
        r["student_key"], r["name"],
        (r["group"] or "kontingentda yo‘q") + (f" · {r['course']}-kurs" if r.get("course") else ""),
        r["attempts"], "urinish", kind="student", note=f"o‘rtacha {r['avg_score']}%",
    ) for r in rows]
    _by_value(out)
    return {"metric": name, "title": title, "kind": "student", "total": len(out), "people": out[:400]}


def students(db: Session, start_day: dt.date, end_day: dt.date, *,
             only_groups: tuple[str, ...] = ()) -> dict:
    """Talabalar nazorati: kim test topshirgan, qaysi guruh faol."""
    from app.models.analytics import StudentTestAttempt
    from app.models.student_contingent import StudentContingent
    from app.services.rector_report_service import student_key_expr

    key = student_key_expr()
    attempts = db.execute(
        select(
            key.label("student_id"),
            func.count(StudentTestAttempt.id).label("attempts"),
            func.coalesce(func.sum(StudentTestAttempt.score), 0).label("score"),
            func.coalesce(func.sum(StudentTestAttempt.total), 0).label("total"),
        )
        # `submitted_date` — mahalliy kun, ya'ni hisobot kunlari server UTC'siga surilmaydi.
        .where(StudentTestAttempt.submitted_date >= start_day, StudentTestAttempt.submitted_date <= end_day)
        .group_by(key)
    ).all()

    contingent = {
        c.student_id: c
        for c in db.execute(select(StudentContingent).where(StudentContingent.status == "active")).scalars()
        # Xalqaro fakultet dekani faqat o'z guruhlari talabalarini ko'radi.
        if in_groups(c.group_name, only_groups)
    }
    total_students = len(contingent)

    by_group: dict[str, dict] = defaultdict(lambda: {"students": set(), "attempts": 0, "score": 0, "total": 0})
    matched = 0
    score_sum = total_sum = 0
    for row in attempts:
        sid = str(row.student_id or "").strip()
        score_sum += int(row.score or 0)
        total_sum += int(row.total or 0)
        student = contingent.get(sid) or contingent.get(sid.replace("ot_", ""))
        if student is None:
            continue
        matched += 1
        g = by_group[student.group_name or "—"]
        g["students"].add(sid)
        g["attempts"] += int(row.attempts or 0)
        g["score"] += int(row.score or 0)
        g["total"] += int(row.total or 0)

    # Guruhdagi jami talaba soni — qamrovni ko'rsatish uchun.
    group_size: dict[str, int] = defaultdict(int)
    for student in contingent.values():
        group_size[student.group_name or "—"] += 1

    groups = [{
        "group": name,
        "tested_students": len(v["students"]),
        "group_size": group_size.get(name, 0),
        "coverage": _pct(len(v["students"]), group_size.get(name, 0)),
        "attempts": v["attempts"],
        "avg_score": _pct(v["score"], v["total"]),
    } for name, v in by_group.items()]
    groups.sort(key=lambda r: -r["attempts"])

    # Talabalar ro'yxati — ismga bosib batafsilini ochish uchun.
    rows = []
    for row in attempts:
        sid = str(row.student_id or "").strip()
        student = contingent.get(sid) or contingent.get(sid.replace("ot_", ""))
        rows.append({
            "student_key": sid,
            "name": (" ".join(x for x in (student.last_name, student.first_name) if x) if student
                     else sid.replace("name:", "").title()),
            "group": student.group_name if student else "",
            "course": student.course if student else None,
            "faculty": student.faculty_name if student else "",
            "in_contingent": student is not None,
            "attempts": int(row.attempts or 0),
            "avg_score": _pct(int(row.score or 0), int(row.total or 0)),
        })
    rows.sort(key=lambda r: -r["attempts"])

    return {
        "students": rows[:400],
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "totals": {
            "contingent": total_students,
            "tested": len(attempts),
            "matched_to_contingent": matched,
            "attempts": sum(int(r.attempts or 0) for r in attempts),
            "avg_score": _pct(score_sum, total_sum),
            "coverage": _pct(matched, total_students),
            "groups_active": len(groups),
            "groups_total": len(group_size),
        },
        "groups": groups[:60],
    }


# ============================================================ batafsil ko'rinish


def teacher_detail(db: Session, owner_key: str, start_day: dt.date, end_day: dt.date,
                   *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta o'qituvchi: har bir darsi, materiallari va iMentor'dagi faolligi.

    Ro'yxatdagi qator bilan BIR MANBA — o'sha darslar va o'sha "ishlatildi" o'lchovi.
    """
    from app.services import lesson_report_service as lrs
    from app.services.rector_report_service import created_materials, range_bounds, staff_directory, teaching_counts

    # Xona holati BUTUN muassasa bo'yicha hisoblanadi: bitta o'qituvchining
    # darslariga qarab "monitor ishlamayapti" deb bo'lmaydi.
    everything = lrs._lessons(db, start_day, end_day)
    everything_used = lrs._used_map(db, everything)
    rooms = mr.room_stats(everything, everything_used)
    # Xalqaro fakultet dekani o'qituvchining FAQAT o'z guruhlaridagi darsini
    # ko'radi; xona holati esa yuqorida butun muassasa bo'yicha hisoblandi.
    lessons = [x for x in everything if x.teacher_username == owner_key
               and any(in_groups(g, groups) for g in (lrs.lesson_groups(x) or ("",)))]
    used = {k: v for k, v in everything_used.items() if k in {x.id for x in lessons}}
    stats = _teacher_stats(lessons, used, rooms)
    row = _teacher_row(next(iter(stats.values()))) if stats else None

    info = staff_directory(db).get(owner_key) or {}
    start, end = range_bounds(start_day, end_day)
    mat = created_materials(db, start, end).get(owner_key, {})
    teach = teaching_counts(db, start, end, start_day, end_day).get(owner_key, {})

    # Nima qilgani: bo'lim kesimida vaqt, yaratgan materiali, kunma-kun izi.
    from app.services.activity_report_service import teacher_daily_activity

    eng = ta.engagement_map(db, start_day, end_day).get(owner_key) or {}
    prof = ta.profile_map(db).get(owner_key) or {}
    subj = ta.materials_map(db).get(owner_key) or {}
    daily_activity = teacher_daily_activity(db, owner_key=owner_key, start_day=start_day, end_day=end_day)
    from app.services.lesson_evidence import for_lessons
    evidence = for_lessons(db, lessons)

    # Tanlangan davrdagi OXIRGI FAOLLIK. Ilgari faqat `User.last_login` ko'rsatilardi —
    # rektor kechagi kunni ochsa ham "oxirgi kirish: bugun" chiqib, hisobot davri bilan
    # ziddiyat hosil qilardi (2026-09-29). Endi ikkalasi alohida ko'rsatiladi.
    day_rows = daily_activity.get("days", [])
    active_days_in_range = [
        d["date"] for d in day_rows
        if d["minutes"] or d["tests_created"] or d["cases_created"] or d["live_sessions"]
    ]
    last_active = max(active_days_in_range) if active_days_in_range else None

    by_subject: dict[str, dict] = defaultdict(lambda: {"lessons": 0, "used": 0, "monitor": 0})
    for lesson in lessons:
        s = by_subject[lesson.subject_name or "—"]
        s["lessons"] += 1
        if lesson.monitor_id:
            s["monitor"] += 1
            if lesson.id in used:
                s["used"] += 1

    return {
        "teacher_key": owner_key,
        "profile": {
            "display_name": info.get("display_name") or (row or {}).get("teacher_name", ""),
            "job_title": info.get("job_title", ""),
            "department": (row or {}).get("department", "") or info.get("department", ""),
            "last_login": info.get("last_login").isoformat() if info.get("last_login") else None,
            # Faqat shu davr ichida: hisobotning qolgan raqamlari bilan bir xil oyna.
            "last_active": str(last_active) if last_active else None,
        },
        "summary": row,
        "engagement": {
            "minutes": int(eng.get("minutes", 0) or 0),
            "active_days": int(eng.get("active_days", 0) or 0),
            "depth": eng.get("depth", "none"),
            "depth_label": ta.DEPTH_LABEL.get(eng.get("depth", "none"), ""),
            "modules": eng.get("modules", []),
            "created": eng.get("created", {}),
            "created_total": int(eng.get("created_total", 0) or 0),
            "created_labels": ta.CREATED_LABEL,
            "viewed": eng.get("viewed", {"videos": 0, "handouts": 0}),
            "days": [
                {"date": d["date"], "minutes": d["minutes"],
                 "tests": d["tests_created"], "cases": d["cases_created"],
                 "live_sessions": d["live_sessions"]}
                for d in daily_activity.get("days", [])
            ],
        },
        "profile_check": {
            "percent": prof.get("percent", 0),
            "missing": prof.get("missing", list(label for _, label in ta.PROFILE_CHECKS)),
            "have": prof.get("have", {}),
            "subjects": int(prof.get("subjects", 0) or 0),
        },
        "subject_materials": {
            "percent": subj.get("percent", 0),
            "topics": int(subj.get("topics", 0) or 0),
            "empty": int(subj.get("empty", 0) or 0),
            "handout": int(subj.get("handout", 0) or 0),
            "presentation": int(subj.get("presentation", 0) or 0),
            "video": int(subj.get("video", 0) or 0),
            "rows": subj.get("subjects", []),
        },
        "materials": {
            "handouts": int(mat.get("handouts_created", 0) or 0),
            "videos": int(mat.get("videos_created", 0) or 0),
            "presentations": int(mat.get("presentations_created", 0) or 0),
            "live_sessions": int(teach.get("live_sessions", 0) or 0),
            "students_taught": int(teach.get("students_taught", 0) or 0),
            "student_attempts": int(teach.get("student_attempts", 0) or 0),
        },
        "rooms": [r for r in mr.payload(rooms)
                  if r["monitor_id"] in {x.monitor_id for x in lessons if x.monitor_id}],
        "subjects": sorted(
            ({"subject": name, **v, "percent": _pct(v["used"], v["monitor"])} for name, v in by_subject.items()),
            key=lambda r: -r["lessons"],
        ),
        "lessons": [{**item, "evidence": evidence.get(item["id"])}
                    for item in lrs.lesson_rows(db, start_day, end_day, teacher=owner_key, groups=groups)],
    }


def student_detail(db: Session, student_key: str, start_day: dt.date, end_day: dt.date,
                   *, groups: tuple[str, ...] = ()) -> dict:
    """Bitta talaba: kontingent ma'lumoti va har bir test urinishi."""
    from app.models.student_contingent import StudentContingent
    from app.services.rector_report_service import student_detail as base_detail

    sid = student_key.replace("ot_", "")
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    # Guruh bilan cheklangan dekan boshqa fakultet talabasini ocholmaydi.
    if groups and (row is None or not in_groups(row.group_name, groups)):
        raise PermissionError("Bu talaba sizning fakultetingizga tegishli emas.")
    detail = base_detail(db, student_key, start_day=start_day, end_day=end_day)
    detail["contingent"] = None if row is None else {
        "student_id": row.student_id,
        "full_name": " ".join(x for x in (row.last_name, row.first_name, row.middle_name) if x),
        "group_name": row.group_name,
        "course": row.course,
        "faculty": row.faculty_name,
        "direction": row.direction_name,
        "education_form": row.education_form,
        "education_language": row.education_language,
        "status": row.status,
    }
    return detail
