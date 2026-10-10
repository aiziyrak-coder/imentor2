"""Recorded activity during a scheduled lesson; room presence is not inferred."""
from collections import defaultdict
import datetime as dt

from sqlalchemy import select
from app.models.analytics import UserActivityEvent
from zoneinfo import ZoneInfo


def scheduled_window(lesson):
    """Use only HEMIS hours; never substitute a local timetable or grace period."""
    try:
        start = dt.time.fromisoformat(lesson.start_time)
        end = dt.time.fromisoformat(lesson.end_time)
    except (ValueError, TypeError):
        return None
    tz = ZoneInfo("Asia/Tashkent")
    a = dt.datetime.combine(lesson.lesson_date, start, tzinfo=tz)
    b = dt.datetime.combine(lesson.lesson_date, end, tzinfo=tz)
    return (a, b) if b > a else None


def summarize(lesson, events, *, now=None):
    window = scheduled_window(lesson)
    if window is None:
        return {"status": "missing_schedule_time", "room_presence": "unverified",
                "note": "HEMIS dars vaqti yo‘q yoki noto‘g‘ri; vaqt taxmin qilinmadi.",
                "seconds": 0, "pages": [], "events": []}
    start, end = window
    if not lesson.teacher_username:
        return {"status": "unlinked_teacher", "room_presence": "unverified",
                "note": "HEMIS o‘qituvchisi platforma hisobiga bog‘lanmagan; kirish baholanmadi.",
                "seconds": 0, "pages": [], "events": []}
    pages = defaultdict(lambda: {"seconds": 0, "opens": 0})
    trace = []
    intervals = []
    seen = set()
    for event in events:
        if event.id in seen:
            continue
        seen.add(event.id)
        when = event.occurred_at
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        if event.owner_key != lesson.teacher_username or not start <= when < end:
            continue
        meta = event.meta or {}
        page = str(meta.get("page") or "other")
        seconds = 0
        if event.event_type == "heartbeat":
            # Receipt time closes the recorded interval. Clip to lesson bounds.
            seconds = min(max(0, int(event.duration_sec or 0)), 900,
                          max(0, int((when - start).total_seconds())))
            pages[page]["seconds"] += seconds
            if seconds:
                intervals.append((when - dt.timedelta(seconds=seconds), when))
        if event.event_type == "page_view":
            pages[page]["opens"] += 1
        trace.append({"id": event.id, "at": when.isoformat(),
                      "action": event.event_type, "page": page, "seconds": seconds})
    trace.sort(key=lambda x: (x["at"], x["id"]))
    now = now or dt.datetime.now(dt.timezone.utc)
    pending = now < end
    # Multiple tabs/devices can report the same minute. Count the union once.
    unique_seconds = 0
    previous_end = start
    for a, b in sorted(intervals):
        unique_seconds += max(0, int((b - max(a, previous_end)).total_seconds()))
        previous_end = max(previous_end, b)
    reported_seconds = sum(p["seconds"] for p in pages.values())
    return {"status": "recorded" if trace else ("pending" if pending else "no_record"),
            "room_presence": "unverified",
            "note": "Qaydlar dars vaqtiga mos. Vaqt qurilma yuborgan davomiylikdan hisoblangan. Xonada jismonan bo‘lganlik tasdiqlanmagan."
                    if trace else ("Dars hali tugamagan; yakuniy xulosa berilmadi." if pending else
                                   "Bu dars vaqtida qayd topilmadi; bu kirmaganlikning mutlaq isboti emas."),
            "seconds": unique_seconds,
            "reported_seconds": reported_seconds,
            "overlap_seconds": reported_seconds - unique_seconds,
            "first_event": trace[0]["at"] if trace else None,
            "last_event": trace[-1]["at"] if trace else None,
            "pages": [{"page": k, **v} for k, v in sorted(pages.items())],
            "events": trace}


def for_lessons(db, lessons):
    if not lessons:
        return {}
    windows = [w for x in lessons if (w := scheduled_window(x)) is not None]
    if not windows:
        return {x.id: summarize(x, []) for x in lessons}
    owners = {x.teacher_username for x in lessons if x.teacher_username}
    rows = db.execute(select(UserActivityEvent).where(
        UserActivityEvent.owner_key.in_(owners),
        UserActivityEvent.occurred_at >= min(x[0] for x in windows),
        UserActivityEvent.occurred_at < max(x[1] for x in windows),
    ).order_by(UserActivityEvent.occurred_at, UserActivityEvent.id)).scalars().all()
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.owner_key].append(row)
    return {x.id: summarize(x, grouped[x.teacher_username]) for x in lessons}
