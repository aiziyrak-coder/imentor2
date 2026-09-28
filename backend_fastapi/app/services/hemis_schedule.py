"""HEMIS dars jadvalini monitor bandligiga aylantirish (2026-09-25).

Kafedralar Excel yuboradi, u eskiradi va o'qituvchi ismi bo'yicha taxmin
qilinadi — shuning uchun rektor hisobotida darslar "aralashib" ketardi.
HEMIS'da esa jadval har kuni yangilanadi va o'qituvchi Xodim ID bilan keladi,
ya'ni iMentor login bilan AYNAN bir xil kalit.

Uch bog'lanish:
  1. HEMIS auditoriyasi → monitor (bino nomi + xona raqami).
     HEMIS'da bitta fizik xona ikki yozuvda bo'lishi mumkin ("204" va
     "204 (Oq uy)") — ikkalasi ham bitta monitorga ulanadi.
  2. HEMIS xodimi → iMentor login (`employee_id_number` = `auth_user.username`).
     Topilmasa yozuv baribir saqlanadi, faqat o'qituvchisiz (xona bandligi ko'rinadi).
  3. HEMIS darsi → `MonitorScheduleEntry` (aniq kun bilan: `lesson_date`).

Excel yozuvlariga TEGILMAYDI: sinxron faqat o'z yozuvlarini (`source_file='hemis'`)
almashtiradi. Bir slotda ikkalasi bo'lsa, hisobot HEMIS'nikini oladi.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
import unicodedata
from collections import defaultdict
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.monitor_schedule import MonitorScheduleEntry
from app.models.user import Group, User, user_groups
from app.services import hemis_client, monitor_schedule_service as ms

logger = logging.getLogger(__name__)

SOURCE = "hemis"

# HEMIS bino nomi → inventardagi bino belgisi. Inventar nomlari erkin yozilgan
# ("Asosiy (2-bino) 42-xona", "Oq uy 2 qavat 204-xona"), shuning uchun ikki
# tomon ham shu qisqa belgiga keltiriladi.
BUILDINGS = {
    "1-o'quv bino": "1-bino",
    "2- o'quv bino": "2-bino",
    "3-o'quv bino": "3-bino",
    "4- o'quv binosi": "4-bino",
    "oq uy binosi": "oq uy",
    "yuqumli kasalliklar shifoxonasi": "yukshqob",
    "fjsti klinik bazasi": "fjsti klinika",
    "9-oshp": "9-oshp",
    "vivariy (laboratoriya) binosi": "vivariy",
}

WEEKDAYS_UZ = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"]

LESSON_TYPES = {
    "ma’ruza": "Ma'ruza",
    "ma'ruza": "Ma'ruza",
    "amaliy": "Amaliy",
    "seminar": "Seminar",
    "laboratoriya": "Laboratoriya",
    "klinik mashg'ulot": "Klinik mashg'ulot",
}


def _name(value: Any) -> str:
    return str((value or {}).get("name") or "").strip()


def _norm(value: Any) -> str:
    """Kichik harf, apostroflar bir xil, ortiqcha bo'shliqsiz."""
    s = re.sub(r"\s+", " ", str(value or "")).strip().lower()
    return s.replace("ʻ", "'").replace("‘", "'").replace("’", "'").replace("`", "'")


def _room_number(value: Any) -> str:
    """Xona nomidagi oxirgi raqam — ikkala tomonda ham eng barqaror belgi."""
    found = re.findall(r"\d{1,4}", str(value or ""))
    return found[-1] if found else ""


def _inventory_building(room_full: str) -> str:
    r = _norm(room_full)
    if "oq uy" in r:
        return "oq uy"
    if "yukshqo" in r:
        return "yukshqob"
    if "fjsti klinika" in r or "fjsti klinik" in r:
        return "fjsti klinika"
    if "oilaviy poliklinika" in r and r.startswith("9"):
        return "9-oshp"
    if "vivariy" in r:
        return "vivariy"
    m = re.search(r"\((\d)-bino\)|(\d)\s*-\s*bino", r)
    if m:
        return f"{m.group(1) or m.group(2)}-bino"
    return ""


def room_map(auditoriums: Iterable[dict]) -> dict[Any, list[dict]]:
    """HEMIS auditoriya kodi → shu xonadagi monitor(lar).

    Bir monitorga bir necha HEMIS kodi tushishi normal (HEMIS bitta xonani ikki
    yozuvda saqlaydi). Teskarisi ham bo'ladi: inventarda bitta xona ikki
    kafedraga yozilgan (3-bino 26-xona — Fiziologiya va Patologik fiziologiya).
    Shuning uchun ro'yxat qaytariladi, kimga tegishlisini dars kafedrasi hal qiladi.
    """
    by_key: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in auditoriums:
        building = BUILDINGS.get(_norm((a.get("building") or {}).get("name")), "")
        number = _room_number(a.get("name"))
        if building and number:
            by_key[(building, number)].append(a)

    out: dict[Any, list[dict]] = defaultdict(list)
    for mon in ms.monitors():
        key = (_inventory_building(mon.get("room_full", "")), _room_number(mon.get("room_full", "")))
        if not all(key):
            continue
        for a in by_key.get(key, []):
            code = a.get("code")
            if code is not None and mon not in out[code]:
                out[code].append(mon)
    return dict(out)


def pick_monitor(candidates: list[dict], department: str) -> dict | None:
    """Bitta xonada bir necha kafedraning monitori bo'lsa — darsning kafedrasi bo'yicha.

    Aks holda dars butunlay boshqa kafedraning monitoriga yozilib ketardi.
    """
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    wanted = ms._norm(department)
    if wanted:
        for mon in candidates:
            if any(k and (k in wanted or wanted in k) for k in mon.get("department_keys", [])):
                return mon
    return None


def _name_key(value: Any) -> tuple[str, ...]:
    """Ism taqqoslash kaliti: tutuq belgisiz, kichik harf, "h" va "x" bir xil.

    HEMIS "XOLIQOV QAHRAMON NU'MONOVICH", iMentor esa "Xoliqov" + "Qahramon"
    yoki "Holiqov" deb yozadi — kalit ikkalasida bir xil chiqishi kerak.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).lower()
    text = re.sub(r"[ʻʼ‘’'`´]", "", text)
    text = text.replace("х", "x").replace("h", "x")
    return tuple(re.sub(r"[^a-zа-я0-9 ]", " ", text).split())


def used_logins(db: Session) -> set[str]:
    """iMentor'da haqiqatan ishlagan hisoblar: faollik yoki yaratilgan material bor."""
    from app.models.analytics import UserActivityEvent
    from app.models.prepared_content import PreparedContent

    out = {u for (u,) in db.execute(select(UserActivityEvent.owner_key).distinct()).all() if u}
    out |= {u for (u,) in db.execute(select(PreparedContent.owner_key).distinct()).all() if u}
    return out


def teacher_map(db: Session, teachers: Iterable[dict], *, stats: dict | None = None,
                used: set[str] | None = None) -> dict[Any, str]:
    """HEMIS xodim id → iMentor login.

    1. Asosiy yo'l: `employee_id_number` (Xodim ID) = `auth_user.username`.
    2. Zaxira (2026-09-26): ko'p o'qituvchi TELEFON RAQAMI bilan ro'yxatdan
       o'tgan (`998884137755`) — Xodim ID bo'yicha topilmaydi va rektor
       hisobotida "hisobi yo'q" bo'lib chiqardi, garchi iMentor'dan
       foydalanayotgan bo'lsa ham (110 tadan 76 tasi shunday edi).
       Ular FAMILIYA + ISM bo'yicha bog'lanadi, faqat moslik IKKI tomonda ham
       yagona bo'lsa: iMentor'da shu ismli faol xodim bitta, HEMIS'da ham bitta,
       va bu hisob boshqa HEMIS xodimining Xodim ID si emas. Aks holda
       bog'lanmaydi — adashib boshqa odamga yozgandan ko'ra bog'lamagan yaxshi.
    """
    staff = db.execute(
        select(User.username, User.first_name, User.last_name, Group.name)
        .join(user_groups, user_groups.c.user_id == User.id, isouter=True)
        .join(Group, Group.id == user_groups.c.group_id, isouter=True)
        .where(User.is_active.is_(True))
    ).all()
    known = {r[0] for r in staff}
    people = list(teachers)
    out: dict[Any, str] = {}

    for t in people:
        login = str(t.get("employee_id_number") or "").strip()
        if login and login in known and t.get("id") is not None:
            out[t["id"]] = login

    # --- zaxira: ism bo'yicha, ikki tomonda ham yagona bo'lsa
    staff_ids = {str(t.get("employee_id_number") or "").strip() for t in people} - {""}
    claimed = set(out.values())
    by_name: dict[tuple[str, str], set[str]] = defaultdict(set)
    for username, first, last, role in staff:
        if role != "hodim" or username in staff_ids or username in claimed:
            continue
        last_key, first_key = _name_key(last), _name_key(first)
        if last_key and first_key:
            by_name[(last_key[0], first_key[0])].add(username)

    hemis_by_name: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in people:
        parts = _name_key(t.get("full_name"))
        if len(parts) >= 2 and t.get("id") is not None and t["id"] not in out:
            hemis_by_name[(parts[0], parts[1])].append(t)

    by_name_linked = 0
    for key, group in hemis_by_name.items():
        candidates = by_name.get(key, set())
        if len(group) == 1 and len(candidates) == 1:
            out[group[0]["id"]] = next(iter(candidates))
            by_name_linked += 1

    # --- Ikki hisobli odam (2026-09-26). 24 kishida Xodim ID bilan ochilgan
    # hisob HECH ishlatilmagan, o'sha odamning telefon hisobi esa faol (1 500
    # harakat, 75 material). Darslar ishlatilmagan hisobga yozilib, hisobotda
    # faol o'qituvchi "iMentor ochmagan" bo'lib chiqardi. Xodim ID hisobi
    # ishlatilmagan va shu ismli YAGONA boshqa xodim hisobi ishlatilgan bo'lsa —
    # darslar o'sha hisobga yoziladi.
    if used is None:
        used = used_logins(db)
    name_of: dict[str, tuple[str, str]] = {}
    staff_by_name: dict[tuple[str, str], set[str]] = defaultdict(set)
    for username, first, last, role in staff:
        if role != "hodim":
            continue
        last_key, first_key = _name_key(last), _name_key(first)
        if last_key and first_key:
            name_of[username] = (last_key[0], first_key[0])
            staff_by_name[(last_key[0], first_key[0])].add(username)
    taken = set(out.values())
    switched = 0
    for hemis_id, login in list(out.items()):
        if login in used or login not in name_of:
            continue
        alternatives = [u for u in staff_by_name[name_of[login]] if u != login and u in used and u not in taken]
        if len(alternatives) == 1:
            out[hemis_id] = alternatives[0]
            taken.add(alternatives[0])
            switched += 1
    if stats is not None:
        stats["ism_boyicha_boglandi"] = by_name_linked
        stats["faol_hisobga_otkazildi"] = switched
    if by_name_linked:
        logger.info("HEMIS: %d o'qituvchi ism bo'yicha bog'landi (telefon raqamli login)", by_name_linked)
    return out


def _entry_from(lesson: dict, mon: dict, login: str, day: dt.date) -> MonitorScheduleEntry:
    pair = str((lesson.get("lessonPair") or {}).get("name") or "").strip()
    training = _norm((lesson.get("trainingType") or {}).get("name"))
    return MonitorScheduleEntry(
        monitor_id=mon["monitor_id"],
        department=mon["department"],
        room_full=mon.get("room_full", ""),
        weekday=WEEKDAYS_UZ[day.weekday()],
        para=f"{pair}-para" if pair else "",
        teacher_name=str((lesson.get("employee") or {}).get("name") or "")[:255],
        teacher_username=login,
        subject=str((lesson.get("subject") or {}).get("name") or "")[:255],
        group_name=str((lesson.get("group") or {}).get("name") or "")[:255],
        lesson_type=LESSON_TYPES.get(training, training.title())[:64],
        status="Band",
        lesson_date=day,
        week_start=day - dt.timedelta(days=day.weekday()),
        hemis_id=str(lesson.get("id") or "")[:32],
        source_file=SOURCE,
        imported_by=SOURCE,
    )


def build_entries(
    lessons: Iterable[dict], rooms: dict[Any, dict], teachers: dict[Any, str],
    *, start: dt.date, end: dt.date,
) -> tuple[list[MonitorScheduleEntry], dict]:
    """Darslardan yozuvlar; ikkinchi qiymat — nima nega tashlab yuborilgani."""
    stats = {"jami": 0, "monitorsiz_xona": 0, "xonasi_ikki_kafedrada": 0,
             "sanasi_oraliqdan_tashqari": 0, "parasi_yoq": 0, "oqituvchisi_boglanmadi": 0, "yozuv": 0}
    seen: set[str] = set()
    out: list[MonitorScheduleEntry] = []
    for lesson in lessons:
        stats["jami"] += 1
        candidates = rooms.get((lesson.get("auditorium") or {}).get("code")) or []
        if not candidates:
            stats["monitorsiz_xona"] += 1
            continue
        mon = pick_monitor(candidates, _name(lesson.get("department")))
        if mon is None:
            stats["xonasi_ikki_kafedrada"] += 1
            continue
        ts = lesson.get("lesson_date")
        if not ts:
            stats["sanasi_oraliqdan_tashqari"] += 1
            continue
        day = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()
        if not (start <= day <= end):
            stats["sanasi_oraliqdan_tashqari"] += 1
            continue
        if not str((lesson.get("lessonPair") or {}).get("name") or "").strip():
            stats["parasi_yoq"] += 1
            continue
        login = teachers.get((lesson.get("employee") or {}).get("id"), "")
        if not login:
            stats["oqituvchisi_boglanmadi"] += 1
        key = str(lesson.get("id") or "")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(_entry_from(lesson, mon, login, day))
        stats["yozuv"] += 1
    return out, stats


def sync(db: Session, *, start: dt.date, end: dt.date, education_year: int | str = "") -> dict:
    """HEMIS jadvalini oraliq uchun qayta yozadi. Excel yozuvlariga tegilmaydi."""
    auditoriums = hemis_client.auditoriums()
    rooms = room_map(auditoriums)
    teachers = teacher_map(db, hemis_client.teachers())
    lessons = hemis_client.schedule(education_year)
    entries, stats = build_entries(lessons, rooms, teachers, start=start, end=end)

    removed = db.query(MonitorScheduleEntry).filter(
        MonitorScheduleEntry.source_file == SOURCE,
        MonitorScheduleEntry.lesson_date >= start,
        MonitorScheduleEntry.lesson_date <= end,
    ).delete(synchronize_session=False)
    for entry in entries:
        db.add(entry)

    stats |= {
        "monitor_boglandi": len({m["monitor_id"] for mons in rooms.values() for m in mons}),
        "monitor_jami": len(ms.monitors()),
        "oqituvchi_boglandi": len(teachers),
        "eski_yozuv_olindi": removed,
        "oraliq": f"{start}…{end}",
    }
    logger.info("HEMIS sinxron: %s", stats)
    return stats


# ============================================================ to'liq jadval


def _lesson_row(lesson: dict, login: str, day: dt.date, monitor: dict | None) -> dict:
    """HEMIS darsi → `core_hemislesson` maydonlari (monitorli yoki monitorsiz)."""
    pair = str((lesson.get("lessonPair") or {}).get("name") or "").strip()
    training = _norm((lesson.get("trainingType") or {}).get("name"))
    auditorium = lesson.get("auditorium") or {}
    return {
        "hemis_id": str(lesson.get("id") or "")[:32],
        "lesson_date": day,
        "weekday": WEEKDAYS_UZ[day.weekday()],
        "para": f"{pair}-para" if pair else "",
        "start_time": str((lesson.get("lessonPair") or {}).get("start_time") or "")[:8],
        "end_time": str((lesson.get("lessonPair") or {}).get("end_time") or "")[:8],
        "employee_id": str((lesson.get("employee") or {}).get("id") or "")[:32],
        "teacher_name": str((lesson.get("employee") or {}).get("name") or "")[:255],
        "teacher_username": login,
        "department_name": _name(lesson.get("department"))[:255],
        "subject_name": _name(lesson.get("subject"))[:255],
        "group_name": _name(lesson.get("group"))[:128],
        "lesson_type": LESSON_TYPES.get(training, training.title())[:64],
        "auditorium_name": str(auditorium.get("name") or "")[:255],
        "building_name": _name(auditorium.get("building"))[:255],
        "auditorium_code": str(auditorium.get("code") or "")[:32],
        "monitor_id": str((monitor or {}).get("monitor_id") or "")[:16],
        # Dalil: dars qaysi inventar yozuviga tayanib "monitorli" deb belgilandi.
        "monitor_room": str((monitor or {}).get("room_full") or "")[:255],
        "monitor_department": str((monitor or {}).get("department") or "")[:255],
    }


def sync_lessons(db: Session, *, start: dt.date, end: dt.date, education_year: int | str = "") -> dict:
    """HEMIS jadvalining TO'LIQ nusxasi — monitorsiz xonalardagi darslar ham.

    Rektor hisoboti shu jadvaldan yig'iladi: o'qituvchining har bir darsi
    ko'rinishi kerak, xonasida monitor bor-yo'qligidan qat'i nazar.
    """
    from app.models.hemis_lesson import HemisLesson

    rooms = room_map(hemis_client.auditoriums())
    link_stats: dict = {}
    teachers = teacher_map(db, hemis_client.teachers(), stats=link_stats)
    lessons = hemis_client.schedule(education_year)
    now = dt.datetime.now(dt.timezone.utc)

    existing = {
        r.hemis_id: r
        for r in db.execute(
            select(HemisLesson).where(HemisLesson.lesson_date >= start, HemisLesson.lesson_date <= end)
        ).scalars()
    }
    stats = {"hemisda": 0, "oraliqda": 0, "yangi": 0, "yangilandi": 0, "ozgarmadi": 0,
             "oqituvchisi_boglanmadi": 0, "monitorli": 0, "olib_tashlandi": 0,
             "ism_boyicha_boglandi": link_stats.get("ism_boyicha_boglandi", 0),
             "faol_hisobga_otkazildi": link_stats.get("faol_hisobga_otkazildi", 0)}
    seen: set[str] = set()

    for lesson in lessons:
        stats["hemisda"] += 1
        ts = lesson.get("lesson_date")
        if not ts:
            continue
        day = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()
        if not (start <= day <= end):
            continue
        stats["oraliqda"] += 1
        login = teachers.get((lesson.get("employee") or {}).get("id"), "")
        if not login:
            stats["oqituvchisi_boglanmadi"] += 1
        monitor = pick_monitor(rooms.get((lesson.get("auditorium") or {}).get("code")) or [],
                               _name(lesson.get("department")))
        if monitor:
            stats["monitorli"] += 1
        data = _lesson_row(lesson, login, day, monitor)
        key = data["hemis_id"]
        if not key or key in seen:
            continue
        seen.add(key)
        row = existing.get(key)
        if row is None:
            db.add(HemisLesson(**data, synced_at=now))
            stats["yangi"] += 1
            continue
        if any(getattr(row, f) != v for f, v in data.items()):
            for field, value in data.items():
                setattr(row, field, value)
            stats["yangilandi"] += 1
        else:
            stats["ozgarmadi"] += 1
        row.synced_at = now

    # Jadvaldan olib tashlangan dars (bekor qilingan) bazada qolmasin.
    for key, row in existing.items():
        if key not in seen:
            db.delete(row)
            stats["olib_tashlandi"] += 1

    logger.info("HEMIS to'liq jadval: %s", stats)
    return stats
