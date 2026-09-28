"""Sahifa kesimidagi faollik hisoboti.

Savol: "Falonchi bugun iMentorda necha daqiqa bo'ldi va qaysi bo'limda
qanchadan?" Javob `core_useractivityevent` jadvalida yotibdi — har zarba
`duration_sec` va `meta->>'page'` bilan yoziladi.

── Nega alohida modul ────────────────────────────────────────────────────
`report_rollup_service` har o'qituvchi uchun alohida so'rov yuboradi:
370 o'qituvchi × 5 so'rov = 1850 ta. Bir kishi hisobotni ochsa baza
band bo'ladi. Bu yerdagi funksiyalar esa GURUHLANGAN so'rov ishlatadi —
o'qituvchilar soni qancha bo'lsa ham so'rovlar soni o'zgarmaydi (4 ta).

Sana chegarasi Toshkent vaqtida hisoblanadi: hisobotni o'qiydigan odam
"bugun" deganda UTC kunini emas, o'z kunini nazarda tutadi.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models.analytics import UserActivityEvent
from app.models.live_test import LiveTestSession
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent

TASHKENT_TZ = ZoneInfo("Asia/Tashkent")

#: Bo'lim kalitlari — frontenddagi `View` nomlari bilan bir xil.
#: Hisobotda shu tartibda chiqadi.
PAGE_ORDER = (
    "syllabus",
    "lectures",
    "presentation",
    "videos",
    "handouts",
    "cases",
    "tests",
    "content-catalog",
    "translator",
    "profile",
)


def day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Toshkent kunining boshi va oxiri — UTC da."""
    start_local = dt.datetime.combine(day, dt.time.min, tzinfo=TASHKENT_TZ)
    end_local = start_local + dt.timedelta(days=1)
    return start_local.astimezone(dt.timezone.utc), end_local.astimezone(dt.timezone.utc)


def range_bounds(start: dt.date, end: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """`start` kunining boshidan `end` kunining oxirigacha (ikkalasi ham kiradi)."""
    return day_bounds(start)[0], day_bounds(end)[1]


def _local_day(column):
    """Ustundagi UTC vaqtdan Toshkent SANASINI ajratadi."""
    return func.date(func.timezone("Asia/Tashkent", column))


def _page(meta_column):
    """`meta->>'page'` — yozilmagan bo'lsa `boshqa`."""
    return func.coalesce(func.nullif(meta_column["page"].astext, ""), "other")


def page_minutes(
    db: Session,
    *,
    start: dt.datetime,
    end: dt.datetime,
    owner_key: str | None = None,
) -> dict[tuple[str, dt.date, str], int]:
    """(o'qituvchi, sana, bo'lim) → soniya.

    Faqat `heartbeat` hisobga olinadi: `page_view` ochilganini bildiradi,
    vaqtni emas.
    """
    stmt = (
        select(
            UserActivityEvent.owner_key,
            _local_day(UserActivityEvent.occurred_at).label("day"),
            _page(UserActivityEvent.meta).label("page"),
            func.coalesce(func.sum(UserActivityEvent.duration_sec), 0).label("sec"),
        )
        .where(
            UserActivityEvent.event_type == "heartbeat",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
        .group_by(UserActivityEvent.owner_key, "day", "page")
    )
    if owner_key:
        stmt = stmt.where(UserActivityEvent.owner_key == owner_key)
    return {(r.owner_key, r.day, r.page): int(r.sec or 0) for r in db.execute(stmt)}


def page_opens(
    db: Session,
    *,
    start: dt.datetime,
    end: dt.datetime,
    owner_key: str | None = None,
) -> dict[tuple[str, dt.date, str], int]:
    """(o'qituvchi, sana, bo'lim) → necha marta ochilgan."""
    stmt = (
        select(
            UserActivityEvent.owner_key,
            _local_day(UserActivityEvent.occurred_at).label("day"),
            _page(UserActivityEvent.meta).label("page"),
            func.count().label("n"),
        )
        .where(
            UserActivityEvent.event_type == "page_view",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
        .group_by(UserActivityEvent.owner_key, "day", "page")
    )
    if owner_key:
        stmt = stmt.where(UserActivityEvent.owner_key == owner_key)
    return {(r.owner_key, r.day, r.page): int(r.n or 0) for r in db.execute(stmt)}


def content_views(
    db: Session,
    *,
    start: dt.datetime,
    end: dt.datetime,
    owner_key: str | None = None,
) -> dict[tuple[str, dt.date, str], int]:
    """(o'qituvchi, sana, tur) → nechta ko'rilgan. Tur: `video`, `handout`."""
    kind = func.coalesce(func.nullif(UserActivityEvent.meta["kind"].astext, ""), "other")
    stmt = (
        select(
            UserActivityEvent.owner_key,
            _local_day(UserActivityEvent.occurred_at).label("day"),
            kind.label("kind"),
            func.count().label("n"),
        )
        .where(
            UserActivityEvent.event_type == "content_view",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
        .group_by(UserActivityEvent.owner_key, "day", "kind")
    )
    if owner_key:
        stmt = stmt.where(UserActivityEvent.owner_key == owner_key)
    return {(r.owner_key, r.day, r.kind): int(r.n or 0) for r in db.execute(stmt)}


def created_counts(
    db: Session,
    *,
    start: dt.datetime,
    end: dt.datetime,
    owner_key: str | None = None,
) -> dict[tuple[str, dt.date, str], int]:
    """(o'qituvchi, sana, tur) → nechta yaratilgan.

    Tur: `case`, `test` (tayyorlangan material) va `live_test` (jonli sessiya).
    """
    out: dict[tuple[str, dt.date, str], int] = {}

    stmt = (
        select(
            PreparedContent.owner_key,
            _local_day(PreparedContent.created_at).label("day"),
            PreparedContent.kind,
            func.count().label("n"),
        )
        .where(
            PreparedContent.kind.in_((KIND_CASE, KIND_TEST)),
            PreparedContent.created_at >= start,
            PreparedContent.created_at < end,
        )
        .group_by(PreparedContent.owner_key, "day", PreparedContent.kind)
    )
    if owner_key:
        stmt = stmt.where(PreparedContent.owner_key == owner_key)
    for r in db.execute(stmt):
        out[(r.owner_key, r.day, r.kind)] = int(r.n or 0)

    live = (
        select(
            LiveTestSession.owner_key,
            _local_day(LiveTestSession.created_at).label("day"),
            func.count().label("n"),
        )
        .where(LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
        .group_by(LiveTestSession.owner_key, "day")
    )
    if owner_key:
        live = live.where(LiveTestSession.owner_key == owner_key)
    for r in db.execute(live):
        out[(r.owner_key, r.day, "live_test")] = int(r.n or 0)

    return out


def _blank_day(day: dt.date) -> dict:
    return {
        "date": day.isoformat(),
        "minutes": 0,
        "pages": [],
        "videos_viewed": 0,
        "handouts_viewed": 0,
        "cases_created": 0,
        "tests_created": 0,
        "live_sessions": 0,
    }


def _sorted_pages(by_page: dict[str, dict]) -> list[dict]:
    """Bo'limlar avval belgilangan tartibda, notanishlari oxirida."""
    order = {name: i for i, name in enumerate(PAGE_ORDER)}
    return sorted(
        by_page.values(),
        key=lambda p: (order.get(p["page"], len(PAGE_ORDER)), -p["minutes"], p["page"]),
    )


def teacher_daily_activity(
    db: Session,
    *,
    owner_key: str,
    start_day: dt.date,
    end_day: dt.date,
) -> dict:
    """Bitta o'qituvchining kunma-kun va bo'limma-bo'lim tafsiloti."""
    start, end = range_bounds(start_day, end_day)
    minutes = page_minutes(db, start=start, end=end, owner_key=owner_key)
    opens = page_opens(db, start=start, end=end, owner_key=owner_key)
    views = content_views(db, start=start, end=end, owner_key=owner_key)
    created = created_counts(db, start=start, end=end, owner_key=owner_key)

    days: dict[dt.date, dict] = {}
    page_index: dict[dt.date, dict[str, dict]] = {}

    def day_slot(day: dt.date) -> dict:
        if day not in days:
            days[day] = _blank_day(day)
            page_index[day] = {}
        return days[day]

    def page_slot(day: dt.date, page: str) -> dict:
        day_slot(day)
        slot = page_index[day].get(page)
        if slot is None:
            slot = {"page": page, "minutes": 0, "seconds": 0, "opens": 0}
            page_index[day][page] = slot
        return slot

    for (_, day, page), sec in minutes.items():
        page_slot(day, page)["seconds"] += sec
    for (_, day, page), n in opens.items():
        page_slot(day, page)["opens"] += n
    for (_, day, kind), n in views.items():
        slot = day_slot(day)
        if kind == "video":
            slot["videos_viewed"] += n
        elif kind == "handout":
            slot["handouts_viewed"] += n
    for (_, day, kind), n in created.items():
        slot = day_slot(day)
        if kind == KIND_CASE:
            slot["cases_created"] += n
        elif kind == KIND_TEST:
            slot["tests_created"] += n
        elif kind == "live_test":
            slot["live_sessions"] += n

    totals_by_page: dict[str, dict] = {}
    for day, slot in days.items():
        for page, p in page_index[day].items():
            # Daqiqa YAXLITLANADI, lekin nol emas: 40 soniya turgan bo'lim
            # hisobotdan tushib qolmasligi kerak.
            p["minutes"] = max(1, round(p["seconds"] / 60)) if p["seconds"] > 0 else 0
            slot["minutes"] += p["minutes"]
            agg = totals_by_page.setdefault(
                page, {"page": page, "minutes": 0, "seconds": 0, "opens": 0}
            )
            agg["seconds"] += p["seconds"]
            agg["minutes"] += p["minutes"]
            agg["opens"] += p["opens"]
        slot["pages"] = _sorted_pages(page_index[day])

    ordered_days = [days[d] for d in sorted(days.keys(), reverse=True)]
    return {
        "owner_key": owner_key,
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "total_minutes": sum(d["minutes"] for d in ordered_days),
        "pages": _sorted_pages(totals_by_page),
        "days": ordered_days,
        "videos_viewed": sum(d["videos_viewed"] for d in ordered_days),
        "handouts_viewed": sum(d["handouts_viewed"] for d in ordered_days),
        "cases_created": sum(d["cases_created"] for d in ordered_days),
        "tests_created": sum(d["tests_created"] for d in ordered_days),
        "live_sessions": sum(d["live_sessions"] for d in ordered_days),
    }


def all_teachers_activity(db: Session, *, start_day: dt.date, end_day: dt.date) -> dict[str, dict]:
    """Barcha o'qituvchilar bo'yicha yig'indi — `owner_key` → ko'rsatkichlar.

    To'rtta guruhlangan so'rov: o'qituvchilar soni natijaga ta'sir qilmaydi.
    """
    start, end = range_bounds(start_day, end_day)
    minutes = page_minutes(db, start=start, end=end)
    opens = page_opens(db, start=start, end=end)
    views = content_views(db, start=start, end=end)
    created = created_counts(db, start=start, end=end)

    out: dict[str, dict] = {}
    page_index: dict[str, dict[str, dict]] = {}

    def slot(owner: str) -> dict:
        if owner not in out:
            out[owner] = {
                "owner_key": owner,
                "minutes": 0,
                "pages": [],
                "videos_viewed": 0,
                "handouts_viewed": 0,
                "cases_created": 0,
                "tests_created": 0,
                "live_sessions": 0,
                "active_days": set(),
            }
            page_index[owner] = {}
        return out[owner]

    for (owner, day, page), sec in minutes.items():
        s = slot(owner)
        s["active_days"].add(day)
        p = page_index[owner].setdefault(page, {"page": page, "minutes": 0, "seconds": 0, "opens": 0})
        p["seconds"] += sec
        # Use the same day/page rounding as the personal daily breakdown.
        p["minutes"] += max(1, round(sec / 60)) if sec > 0 else 0
    for (owner, day, page), n in opens.items():
        slot(owner)
        p = page_index[owner].setdefault(page, {"page": page, "minutes": 0, "seconds": 0, "opens": 0})
        p["opens"] += n
    for (owner, _day, kind), n in views.items():
        s = slot(owner)
        if kind == "video":
            s["videos_viewed"] += n
        elif kind == "handout":
            s["handouts_viewed"] += n
    for (owner, _day, kind), n in created.items():
        s = slot(owner)
        if kind == KIND_CASE:
            s["cases_created"] += n
        elif kind == KIND_TEST:
            s["tests_created"] += n
        elif kind == "live_test":
            s["live_sessions"] += n

    for owner, s in out.items():
        for p in page_index[owner].values():
            s["minutes"] += p["minutes"]
        s["pages"] = _sorted_pages(page_index[owner])
        s["active_days"] = len(s["active_days"])
    return out
