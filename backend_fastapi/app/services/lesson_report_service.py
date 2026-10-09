"""Dars jadvali bo'yicha nazorat hisoboti — har bir xodim kesimida (2026-09-25).

Ilgari hisobot MONITOR atrofida qurilgan edi: faqat monitorli xonalardagi
darslar ko'rinardi (13 800 darsdan 2 600 tasi) va faqat kafedra Excel yuborgan
o'qituvchilar hisobga olinardi. Ya'ni ko'pchilik nazoratdan chetda qolardi.

Endi manba — HEMIS jadvalining to'liq nusxasi (`core_hemislesson`). Har bir
dars uchun bitta savolga javob beriladi: o'qituvchi shu dars vaqtida iMentor'ni
ishlatdimi? "Ishlatdi" degani — o'sha oynada jonli test ochgani, QR bilan
kompyuterga kirgani YOKI platformada ishlagani (sahifa ochgani, material
ko'rgani, ekran ochiq turgani). Oxirgisi 2026-10-08 da qo'shildi: usiz
ma'ruzani iMentor'dan ko'rsatgan o'qituvchi "ishlatmagan" deb chiqardi.
"""

from __future__ import annotations

import datetime as dt
import os
from bisect import bisect_left, bisect_right
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hemis_lesson import HemisLesson
from app.services import monitor_schedule_service as ms
from app.services.dean_access import in_groups

# Dars boshlanishidan oldin va tugagandan keyin qancha vaqt "shu darsniki" hisoblanadi.
BEFORE = dt.timedelta(minutes=15)
AFTER = dt.timedelta(minutes=5)

#: Dars "iMentor'da o'tilgan" deb hisoblanishi uchun kerak bo'lgan ENG KAM
#: ish vaqti (daqiqa). Institut talabi: dars to'liq iMentor'da o'tilsin —
#: ya'ni ~60 daqiqa, majburiy eng kami 50 (2026-10-08).
#:
#: Ilgari chegara umuman yo'q edi: bir sahifaga 3-4 daqiqa kirgan o'qituvchi
#: ham "ishlatdi" bo'lib chiqardi va hisobot aldardi.
#:
#: Talab 2026-10-09 da 50 dan 40 daqiqaga tushirildi: dars juftligi 80
#: daqiqa, tanaffus va davomat olishni hisobga olsa, 40 daqiqa "darsning
#: asosiy qismi iMentor'da o'tildi" degani uchun yetarli.
#:
#: `IMENTOR_MIN_LESSON_MINUTES` bilan o'zgartiriladi — talab o'zgarsa
#: yangi versiya chiqarish shart emas.
MIN_LESSON_MINUTES = int(os.environ.get("IMENTOR_MIN_LESSON_MINUTES") or 40)


def _merge_spans(spans: list[tuple[dt.datetime, dt.datetime]]) -> list[tuple[dt.datetime, dt.datetime]]:
    """Ish oraliqlarini birlashtiradi: kesishmaydigan, boshi va oxiri bo'yicha tartiblangan ro'yxat.

    `_worked_seconds` oxirlar ro'yxatida ikkilik qidiruv qiladi — bu faqat
    oxirlar ham tartiblangan bo'lsa to'g'ri. Heartbeat oraliqlari har xil
    uzunlikda (1-15 daqiqa) va bir-birini qoplaydi, shuning uchun boshi bo'yicha
    tartiblanganda oxirlari tartibsiz bo'lib qolardi va qidiruv kerakli
    oraliqlarni tashlab yuborardi. Jonli ma'lumotda (2026-10-03..09) 11 ta
    darsda ishlangan vaqt kam chiqqan, 4 tasi (50,1 daqiqa → 49,7) chegaradan
    noto'g'ri tushib qolgan edi.
    """
    out: list[tuple[dt.datetime, dt.datetime]] = []
    for a, b in sorted(x for x in spans if x[1] > x[0]):
        if out and a <= out[-1][1]:
            if b > out[-1][1]:
                out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


def lesson_key(lesson) -> tuple:
    """Bitta haqiqiy dars: o'qituvchi, sana, vaqt, xona.

    HEMIS har GURUH uchun alohida qator beradi: 4 guruhga bir vaqtda o'qilgan
    bitta ma'ruza 4 ta "dars" bo'lib sanalardi (2026-10-03..09: 2208 qator,
    haqiqiy darslar 1637). Hisobot DARSLARNI sanaydi, guruhlarni emas.
    """
    return (
        lesson.teacher_username or f"name:{lesson.teacher_name}",
        lesson.lesson_date,
        lesson.start_time or lesson.para,
        lesson.end_time or "",
        (lesson.auditorium_name or "").strip().casefold(),
        # Ehtiyot: monitor belgisi farq qilsa (HEMIS/inventar nomuvofiq) birlashtirilmaydi.
        lesson.monitor_id or "",
    )


def merge_group_rows(lessons: list) -> list:
    """Bir darsning guruh qatorlarini bittaga yig'adi.

    Vakil — eng kichik id'li qator; barcha guruhlar `merged_groups` da
    (ORM ustuni emas, oddiy atribut — bazaga yozilmaydi).
    """
    by_key: dict[tuple, list] = {}
    for lesson in sorted(lessons, key=lambda x: x.id):
        by_key.setdefault(lesson_key(lesson), []).append(lesson)
    out = []
    for rows in by_key.values():
        head = rows[0]
        head.merged_groups = tuple(sorted({x.group_name for x in rows if x.group_name}))
        out.append(head)
    return out


def lesson_groups(lesson) -> tuple[str, ...]:
    """Dars o'tilgan barcha guruhlar (yig'ilmagan qatorda — o'zining guruhi)."""
    merged = getattr(lesson, "merged_groups", None)
    if merged is not None:
        return merged
    return (lesson.group_name,) if lesson.group_name else ()


def _worked_seconds(spans: list[tuple[dt.datetime, dt.datetime]],
                    ends: list[dt.datetime], start: dt.datetime, end: dt.datetime) -> int:
    """Dars oynasi ichida HAQIQATAN ishlangan soniya.

    Bir vaqtda ikki oyna (telefon + monitor) ochiq bo'lsa, o'sha daqiqa ikki
    marta sanalmasin: oraliqlar birlashtiriladi.

    `spans` — `_merge_spans` natijasi (kesishmaydigan, tartiblangan), `ends` —
    o'sha oxirlar. Faqat shunda ikkilik qidiruv to'g'ri: har dars uchun butun
    ro'yxat emas, faqat kerakli bo'lagi ko'riladi.
    Bunisiz hisobot 19 soniyaga cho'zilgandi (2026-10-08).
    """
    # Soniyalar aniq (kasr bilan) yig'iladi va oxirida yaxlitlanadi: ilgari har
    # bo'lak alohida butunga qirqilardi va darsdan 10-20 soniya yo'qolardi —
    # chegaradagi darsda (49:59) bu natijani o'zgartiradi.
    total = 0.0
    reached = start
    for i in range(bisect_left(ends, start), len(spans)):
        a, b = spans[i]
        if a >= end:
            break
        a, b = max(a, start), min(b, end)
        if b <= a or b <= reached:
            continue
        total += (b - max(a, reached)).total_seconds()
        reached = max(reached, b)
    return int(round(total))


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


def current_time() -> dt.datetime:
    """Hozirgi vaqt (Toshkent). Alohida funksiya — testda almashtirish uchun."""
    return dt.datetime.now(ms.TASHKENT)


def is_over(lesson: HemisLesson, now: dt.datetime) -> bool:
    """Dars jadval bo'yicha tugaganmi.

    Hali tugamagan darsni "ishlatilmagan" deb bo'lmaydi: bugungi kun ertalab
    ochilganda tushdan keyingi darslar ham maxrajga tushib, foizni sun'iy
    pasaytirardi (2026-10-09: soat 11:46 da 443 darsdan 77 tasi — 17%).
    """
    return _window(lesson)[1] - AFTER <= now


def _lessons(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
             teacher: str = "", groups: tuple[str, ...] = (),
             pending: bool = False) -> list[HemisLesson]:
    """Davrdagi darslar. `pending=False` — faqat TUGAGANLARI (baholanadiganlari)."""
    q = select(HemisLesson).where(HemisLesson.lesson_date >= start_day, HemisLesson.lesson_date <= end_day)
    if teacher:
        q = q.where(HemisLesson.teacher_username == teacher)
    rows = list(db.execute(q).scalars())
    if groups:
        # Xalqaro fakultet dekani: faqat o'z guruhlariga o'tilgan darslar.
        rows = [r for r in rows if in_groups(r.group_name, groups)]
    # Guruh qatorlari bitta darsga yig'iladi — hisobot darslarni sanaydi.
    rows = merge_group_rows(rows)
    if department:
        needle = ms._norm(department)
        rows = [r for r in rows if needle in ms._norm(r.department_name) or ms._norm(r.department_name) in needle]
    if not pending and end_day >= current_time().date():
        now = current_time()
        today = now.date()
        rows = [r for r in rows if r.lesson_date < today or is_over(r, now)]
    return rows


def work_map(db: Session, lessons: list[HemisLesson]) -> dict[int, tuple[int, int]]:
    """Har dars uchun (ishlangan soniya, talaba soni) — chegarasiz, xom o'lchov."""
    usernames = {x.teacher_username for x in lessons if x.teacher_username}
    if not usernames or not lessons:
        return {}
    days = [x.lesson_date for x in lessons]
    lo_day = dt.datetime.combine(min(days), dt.time(0, 0), tzinfo=ms.TASHKENT)
    hi_day = dt.datetime.combine(max(days) + dt.timedelta(days=1), dt.time(0, 0), tzinfo=ms.TASHKENT)
    spans = {k: _merge_spans(v) for k, v in ms._work_spans(db, usernames, lo_day, hi_day).items()}
    span_ends = {k: [b for _, b in v] for k, v in spans.items()}
    events = ms._usage_events(db, usernames, lo_day, hi_day)

    ordered = {k: sorted(v) for k, v in events.items() if v}
    moments = {k: [w for w, _ in v] for k, v in ordered.items()}

    out: dict[int, tuple[int, int]] = {}
    for lesson in lessons:
        owner = lesson.teacher_username or ""
        if not owner:
            continue
        start, end = _window(lesson)
        seconds = _worked_seconds(spans.get(owner, []), span_ends.get(owner, []), start, end)
        students = 0
        rows = ordered.get(owner)
        if rows:
            times = moments[owner]
            a = bisect_left(times, start)
            b = bisect_right(times, end)
            students = sum(count for _, count in rows[a:b])
        if seconds or students:
            out[lesson.id] = (seconds, students)
    return out


def _used_map(db: Session, lessons: list[HemisLesson]) -> dict[int, tuple[bool, int]]:
    """Har dars uchun (ishlatildimi, talaba soni).

    "Ishlatildi" — dars vaqtida kamida `MIN_LESSON_MINUTES` daqiqa ishlangan.
    Qisqa kirib chiqish hisoblanmaydi: maqsad darsni iMentor'da O'TISH.
    """
    need = MIN_LESSON_MINUTES * 60
    return {k: (True, students) for k, (seconds, students) in work_map(db, lessons).items()
            if seconds >= need}


def teacher_rows(db: Session, start_day: dt.date, end_day: dt.date, *, department: str = "",
                 groups: tuple[str, ...] = (),
                 query: str = "") -> dict:
    """Har o'qituvchi bo'yicha bitta qator: nechta dars, nechtasida ishlatgan."""
    lessons = _lessons(db, start_day, end_day, department=department, groups=groups)
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
        row["groups"].update(lesson_groups(lesson))
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


def department_rows(db: Session, start_day: dt.date, end_day: dt.date,
                    *, groups: tuple[str, ...] = ()) -> list[dict]:
    """Kafedra kesimi — qaysi kafedra qanchalik ishlatyapti."""
    lessons = _lessons(db, start_day, end_day, groups=groups)
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
                groups: tuple[str, ...] = (),
                department: str = "", only_missed: bool = False, limit: int = 2000) -> list[dict]:
    """Darslar ro'yxati — kim, qachon, qaysi fan, ishlatildimi."""
    # Tugamagan darslar ham ko'rsatiladi, lekin belgi bilan — ular hali baholanmaydi.
    lessons = _lessons(db, start_day, end_day, department=department, teacher=teacher, groups=groups,
                       pending=True)
    used = _used_map(db, lessons)
    now = current_time()
    lessons.sort(key=lambda x: (x.lesson_date, x.para, x.teacher_name))
    out = []
    for lesson in lessons:
        hit = used.get(lesson.id)
        waiting = not is_over(lesson, now)
        if only_missed and (hit or waiting):
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
            "group": ", ".join(lesson_groups(lesson)),
            "lesson_type": lesson.lesson_type,
            "room": lesson.auditorium_name,
            "building": lesson.building_name,
            "monitor_id": lesson.monitor_id,
            "used": bool(hit),
            # Dars hali tugamagan — "qayd yo'q" deb hukm qilinmaydi.
            "pending": waiting and not hit,
            "students": hit[1] if hit else 0,
            # Dalil: bu qator qaysi HEMIS yozuvidan va qaysi inventar xonasidan
            # kelgani — «menda dars yo'q edi», «xonada monitor yo'q» degan
            # gaplarni shu yerda tekshirish mumkin.
            "hemis_id": lesson.hemis_id,
            "auditorium_code": getattr(lesson, "auditorium_code", ""),
            "monitor_room": getattr(lesson, "monitor_room", ""),
            "monitor_department": getattr(lesson, "monitor_department", ""),
            "synced_at": (lambda t: t.isoformat() if t else None)(getattr(lesson, "synced_at", None)),
            "hemis_status": getattr(lesson, "hemis_status", "active"),
            "hemis_missing_at": (lambda t: t.isoformat() if t else None)(getattr(lesson, "hemis_missing_at", None)),
        })
        if len(out) >= limit:
            break
    return out
