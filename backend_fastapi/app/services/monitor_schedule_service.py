
"""Monitor-based rector report.

The rector report is intentionally scoped to interactive monitors. A teacher is
included only when the weekly monitor schedule assigns them to a monitor slot.
If the schedule file is not imported yet, the report shows monitor inventory and
empty capacity, not the full staff roster.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.live_test import LiveTestSession
from app.models.analytics import StudentTestAttempt

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
INVENTORY_PATH = DATA_DIR / "interactive_boards.json"
SCHEDULE_PATH = DATA_DIR / "monitor_schedule.json"

# Shanba ham o'quv kuni (HEMIS jadvalida 658 dars) — 2026-09-25 da qo'shildi.
WEEKDAYS = ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"]
# Vaqtlar HEMIS'dagi rasmiy `lessonPair` bo'yicha (4-6 paralar avval 30 daqiqa
# xato edi, shuning uchun "darsda ishlatildi" oynasi ham siljigan edi).
PERIODS = [
    ("1-para", "08:00", "09:20"),
    ("2-para", "09:30", "10:50"),
    ("3-para", "11:00", "12:20"),
    ("4-para", "13:00", "14:20"),
    ("5-para", "14:30", "15:50"),
    ("6-para", "16:00", "17:20"),
    ("7-para", "17:30", "18:50"),
]
WEEKDAY_INDEX = {name: i for i, name in enumerate(WEEKDAYS)}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def _norm(value: Any) -> str:
    text = _clean(value).casefold()
    text = text.replace("ў", "o").replace("ʻ", "'").replace("‘", "'").replace("’", "'").replace("`", "'")
    text = re.sub(r"\bkafedrasi\b", "", text)
    text = re.sub(r"[^a-zа-я0-9]+", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def _monitor_id(n: int) -> str:
    return f"MON-{n:03d}"


def _building_room(raw: str) -> tuple[str, str]:
    text = _clean(raw)
    parts = re.split(r"\s+(?=\d+[- ]?(?:xona|auditoriya)|[\w'‘’.-]+[- ]?xona|[\w'‘’.-]+[- ]?auditoriya)", text, maxsplit=1, flags=re.I)
    if len(parts) == 2:
        return _clean(parts[0]), _clean(parts[1])
    markers = ["xona", "auditoriya"]
    lower = text.lower()
    for marker in markers:
        pos = lower.rfind(marker)
        if pos > 0:
            start = max(lower.rfind(" ", 0, pos - 1), 0)
            return _clean(text[:start]), _clean(text[start:])
    return text, text


def inventory() -> dict:
    try:
        return json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"source_url": "", "checked_on": "", "departments": []}


def monitors() -> list[dict]:
    out: list[dict] = []
    n = 1
    for dep in inventory().get("departments", []):
        department = _clean(dep.get("department"))
        aliases = [_clean(a) for a in dep.get("aliases", []) or [] if _clean(a)]
        for room in dep.get("rooms", []) or []:
            room_text = _clean(room)
            if not room_text:
                continue
            building, room_name = _building_room(room_text)
            out.append({
                "monitor_id": _monitor_id(n),
                "department": department,
                "department_aliases": aliases,
                "department_keys": [_norm(department), *[_norm(a) for a in aliases]],
                "building": building,
                "room": room_name,
                "room_full": room_text,
                "inventory_row": dep.get("row"),
            })
            n += 1
    # Keyin qo'shilgan xonalar aniq ID bilan — ketma-ket raqamlash siljisa, yuklangan jadvallar
    # boshqa monitorga o'tib ketardi.
    for dep in inventory().get("departments", []):
        department = _clean(dep.get("department"))
        aliases = [_clean(a) for a in dep.get("aliases", []) or [] if _clean(a)]
        for extra in dep.get("extra_rooms", []) or []:
            room_text = _clean(extra.get("room"))
            if not room_text or not extra.get("monitor_id"):
                continue
            building, room_name = _building_room(room_text)
            out.append({
                "monitor_id": _clean(extra["monitor_id"]),
                "department": department,
                "department_aliases": aliases,
                "department_keys": [_norm(department), *[_norm(a) for a in aliases]],
                "building": building,
                "room": room_name,
                "room_full": room_text,
                "inventory_row": dep.get("row"),
            })
    return out


def _parse_date(raw: str | None, fallback: dt.date) -> dt.date:
    if not raw:
        return fallback
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        return fallback


def _dates(start: dt.date, end: dt.date) -> list[dt.date]:
    days: list[dt.date] = []
    cur = start
    while cur <= end:
        if cur.weekday() < 6:  # dushanba–shanba
            days.append(cur)
        cur += dt.timedelta(days=1)
    return days


TASHKENT = dt.timezone(dt.timedelta(hours=5))
PERIOD_TIMES = {para: (start, end) for para, start, end in PERIODS}
# Dars boshlanishidan oldin tayyorgarlik va oxiridagi kechikish — shu oynada iMentor ishlatilgani "foydalanildi".
USAGE_BEFORE = dt.timedelta(minutes=15)
USAGE_AFTER = dt.timedelta(minutes=5)
MAX_IMPORT_ROWS = 20000

_HEADER_ALIASES = {
    "week_start": ["hafta boshi sanasi"],
    "department": ["kafedra"],
    "room": ["monitor xona", "monitor"],
    "weekday": ["hafta kuni"],
    "para": ["para"],
    "teacher": ["o qituvchi f i sh", "oqituvchi f i sh", "o qituvchi", "oqituvchi"],
    "phone": ["telefon login", "telefon"],
    "subject": ["fan"],
    "group": ["guruh"],
    "lesson_type": ["dars turi"],
    "status": ["tasdiq holati", "holat"],
    "note": ["izoh"],
}


# ================================================================ import


def _header_key(value: Any) -> str:
    text = _clean(value).casefold()
    text = re.sub(r"[‘’ʻʼ`'�]", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _room_key(value: Any) -> str:
    """"YuKSHQO'B \\n(1-qavat) 108- auditoriya" ~ "YuKSHQO'B (1-qavat) 108-auditoriya"."""
    text = _clean(value).casefold()
    text = re.sub(r"[‘’ʻʼ`'�]", "'", text)
    text = re.sub(r"\s*-\s*", "-", text)
    # Qavs ichidagi mashg'ulot turi xonani ajratmaydi: "28 xona (ma'ruza)" = "28 xona (amaliy)".
    text = re.sub(r"\((ma'ruza|amaliy|seminar|laboratoriya|klinik)[^)]*\)", " ", text)
    # Ro'yxatda probel tushib qolgan: "3-qavat28 xona" = "3-qavat 28 xona".
    text = re.sub(r"(?<=[a-z])(?=\d)", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _split_cell(value: Any) -> list[str]:
    parts = re.split(r"\s{2,}|\n|;|\s/\s", str(value or ""))
    return [_clean(p) for p in parts if _clean(p)]


def _split_people(value: Any) -> list[str]:
    """Bitta katakda bir necha o'qituvchi (sur'at/maxraj) — 2+ bo'shliq, yangi qator yoki ; bilan.
    Bitta so'zli bo'lak alohida odam emas: "Xomidova  Moxichehra" (ikki bo'shliq) — bitta odam."""
    people: list[str] = []
    pending: list[str] = []
    for part in _split_cell(value):
        pending.extend(part.split())
        if len(pending) >= 2:
            people.append(" ".join(pending))
            pending = []
    if pending:
        if people:
            people[-1] = f"{people[-1]} {' '.join(pending)}"
        else:
            people.append(" ".join(pending))
    return people


def _phones(value: Any) -> list[str]:
    out: list[str] = []
    for part in re.split(r"\s{2,}|[,;/\n]", str(value or "")):
        digits = re.sub(r"\D", "", part)
        if len(digits) == 9:
            digits = "998" + digits
        if len(digits) == 12 and digits.startswith("998"):
            out.append(digits)
    if not out:
        digits = re.sub(r"\D", "", str(value or ""))
        if len(digits) == 9:
            out.append("998" + digits)
        elif len(digits) == 12 and digits.startswith("998"):
            out.append(digits)
    return out


def _parse_week_start(value: Any) -> dt.date | None:
    text = _clean(value)
    if not text:
        return None
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError:
        pass
    try:  # Excel seriya raqami
        serial = float(text)
        if 30000 < serial < 80000:
            return dt.date(1899, 12, 30) + dt.timedelta(days=int(serial))
    except ValueError:
        pass
    return None


def _normalize_weekday(value: Any) -> str:
    text = _clean(value).casefold()
    for name in WEEKDAYS:
        if text == name.casefold():
            return name
    return ""


def _normalize_para(value: Any) -> str:
    match = re.search(r"([1-6])", _clean(value))
    return f"{match.group(1)}-para" if match else ""


def _status_for(value: Any) -> str | None:
    """None — qator hisobga olinmaydi. O'qituvchi yozilgan-u holat "Bo'sh" qolgan bo'lsa ham
    (kafedralar holat ustunini ko'pincha to'ldirmaydi) — dars rejada, ya'ni "Band"."""
    text = _clean(value).casefold().replace("‘", "'").replace("’", "'").replace("ʻ", "'")
    if "bekor" in text or "monitor yo" in text:
        return None
    if "tasdiq" in text:
        return "Tasdiqlandi"
    return "Band"


def _department_matches(staff_department: str, department_keys: list[str]) -> bool:
    staff = _norm(staff_department)
    if not staff:
        return False
    for key in department_keys:
        if key and (staff == key or staff in key or key in staff or SequenceMatcher(None, staff, key).ratio() >= 0.85):
            return True
    return False


def _resolve_by_initials(name: str, department_keys: list[str], users_by_username: dict, info: dict) -> str:
    """"N.Malikov", "K,Saydullayeva", "Sharapov I.K." — familiya + ism bosh harfi.
    Bosh harf ko'p odamga to'g'ri keladi, shuning uchun faqat SHU kafedradagi yagona odam olinadi."""
    from app.services import face_login as fl

    tokens = [t for t in re.split(r"[\s.,]+", name) if t]
    surnames = [t for t in tokens if len(t) >= 3]
    initials = [t for t in tokens if len(t) <= 2]
    if len(surnames) != 1 or not initials:
        return ""
    surname = fl._norm_name(surnames[0], strip_suffix=False)
    initial = fl._norm_name(initials[0], strip_suffix=False)[:1]
    if not surname or not initial:
        return ""
    found = []
    for user in users_by_username.values():
        for last, first in ((user.last_name, user.first_name), (user.first_name, user.last_name)):
            if fl._norm_name(last or "", strip_suffix=False) == surname and fl._norm_name(first or "", strip_suffix=False).startswith(initial):
                if _department_matches(info.get(user.username, {}).get("department", ""), department_keys):
                    found.append(user)
                break
    found = list({u.username: u for u in found}.values())
    if len(found) == 1:
        return found[0].username
    # Bir odamning ikki hisobi (Xodim ID + telefon) — ishlatilayotganini tanlaymiz; turli odamlar bo'lsa — hech biri.
    return fl.choose_account(found, "", info) or "" if found else ""


def _resolve_teacher(
    name: str,
    phones: list[str],
    department: str,
    users_by_key: dict,
    users_by_username: dict,
    info: dict,
    department_keys: list[str] | None = None,
) -> str:
    from app.services import face_login as fl

    parts = name.split()
    if len(parts) < 2 or any(len(t) <= 2 for t in re.split(r"[\s.,]+", name) if t):
        return _resolve_by_initials(name, department_keys or [_norm(department)], users_by_username, info)
    key = fl.name_key(parts[0], parts[1])
    # Telefon faqat egasining familiyasi mos kelsa qabul qilinadi: jadvalda boshqa o'qituvchining
    # raqami xato yozilgan qatorlar bor.
    for phone in phones:
        user = users_by_username.get(phone)
        if user is None:
            continue
        user_keys = {fl.name_key(user.last_name, user.first_name)[0], fl.name_key(user.first_name, user.last_name)[0]}
        if key[0] in user_keys:
            return user.username
    chosen = fl.choose_account(users_by_key.get(key, []), department, info)
    if chosen:
        return chosen
    return _resolve_by_close_first_name(parts[0], parts[1], department_keys or [_norm(department)], users_by_username, info)


def _resolve_by_close_first_name(a: str, b: str, department_keys: list[str], users_by_username: dict, info: dict) -> str:
    """Familiya aniq, ism imlosi biroz farq qiladi ("Gulhayo" ~ "Gulhaiyo") — faqat SHU kafedrada."""
    from app.services import face_login as fl

    found = []
    for surname, first in ((a, b), (b, a)):
        s_key = fl._norm_name(surname, strip_suffix=False)
        f_key = fl._norm_name(first, strip_suffix=True)
        if len(s_key) < 3 or len(f_key) < 3:
            continue
        for user in users_by_username.values():
            for last, given in ((user.last_name, user.first_name), (user.first_name, user.last_name)):
                if fl._norm_name(last or "", strip_suffix=False) != s_key:
                    continue
                if SequenceMatcher(None, fl._norm_name(given or "", strip_suffix=True), f_key).ratio() < 0.8:
                    continue
                if _department_matches(info.get(user.username, {}).get("department", ""), department_keys):
                    found.append(user)
    found = list({u.username: u for u in found}.values())
    if len(found) == 1:
        return found[0].username
    return (fl.choose_account(found, "", info) or "") if found else ""


def import_rows(
    db: Session,
    rows: list[list[Any]],
    *,
    source_file: str = "",
    imported_by: str = "",
    allowed_departments: list[str] | tuple[str, ...] | None = None,
    only_teacher: str = "",
    self_name: str = "",
) -> dict:
    """Kafedra to'ldirgan jadval qatorlarini saqlaydi.

    `only_teacher` — o'qituvchi sozlamalardan O'Z jadvalini yuklaydi: fayldan faqat
    unga tegishli qatorlar olinadi va bazada faqat UNING eski qatorlari almashtiriladi.
    Hamkasblarning qatorlariga tegilmaydi (bitta kafedrada bir necha o'qituvchi
    bir vaqtda yuklasa ham ziddiyat chiqmaydi).

    Faylda o'qituvchi yozilgan kafedralarning eski jadvali to'liq almashtiriladi,
    boshqa kafedralarga tegilmaydi — hamma kafedralar uchun umumiy shablonda faqat
    bitta kafedra to'ldirgan bo'lsa ham boshqalar o'chib ketmaydi.
    """
    from app.models.monitor_schedule import MonitorScheduleEntry
    from app.services import face_login as fl

    if len(rows) > MAX_IMPORT_ROWS:
        raise ValueError(f"Fayl juda katta: {len(rows)} qator (eng ko'pi {MAX_IMPORT_ROWS}).")

    header_idx = -1
    columns: dict[str, int] = {}
    for i, row in enumerate(rows[:30]):
        keys = [_header_key(c) for c in row]
        if "kafedra" in keys and any(k.startswith("hafta kuni") for k in keys):
            header_idx = i
            for field, aliases in _HEADER_ALIASES.items():
                for col, k in enumerate(keys):
                    if k in aliases or any(k.startswith(a) for a in aliases):
                        columns.setdefault(field, col)
            break
    required = {"department", "room", "weekday", "para", "teacher"}
    if header_idx < 0 or not required <= set(columns):
        raise ValueError(
            "Bu fayl monitor bandligi shabloniga o'xshamaydi: sarlavhada Kafedra, Monitor/xona, "
            "Hafta kuni, Para va O'qituvchi F.I.Sh ustunlari bo'lishi kerak."
        )

    def cell(row: list[Any], field: str) -> str:
        col = columns.get(field)
        return str(row[col]) if col is not None and col < len(row) and row[col] is not None else ""

    all_monitors = monitors()
    by_room: dict[tuple[str, str], dict] = {}
    for m in all_monitors:
        for dep_key in m["department_keys"]:
            by_room[(dep_key, _room_key(m["room_full"]))] = m
    allowed_set = {_norm(d) for d in (allowed_departments or []) if _clean(d)}

    users = fl._face_login_users(db)
    users_by_username = {u.username: u for u in users}
    users_by_key: dict[tuple[str, str], list] = {}
    for u in users:
        for k in {fl.name_key(u.last_name, u.first_name), fl.name_key(u.first_name, u.last_name)}:
            users_by_key.setdefault(k, []).append(u)
    info = fl._account_info(db, list(users_by_username))

    entries: list[dict] = []
    unmatched_rooms: set[str] = set()
    forbidden: set[str] = set()
    unresolved: dict[str, set[str]] = {}
    # Faylda bitta kafedra bo'lsa, kafedra katagi bo'sh qolgan qatorlar ham o'shaniki.
    file_departments = {_clean(cell(r, "department")) for r in rows[header_idx + 1:] if _clean(cell(r, "teacher"))} - {""}
    only_department = next(iter(file_departments)) if len(file_departments) == 1 else ""

    for row in rows[header_idx + 1:]:
        teacher_text = cell(row, "teacher")
        # O'qituvchi o'z jadvalini yuklaganda "O'qituvchi" ustuni bo'sh qolishi mumkin —
        # bunday qator uniki (fan yoki guruh yozilgan bo'lsa).
        is_self_row = bool(only_teacher) and not _clean(teacher_text) and bool(
            _clean(cell(row, "subject")) or _clean(cell(row, "group"))
        )
        if is_self_row:
            teacher_text = self_name or only_teacher
        if not _clean(teacher_text):
            continue
        status = _status_for(cell(row, "status"))
        weekday = _normalize_weekday(cell(row, "weekday"))
        para = _normalize_para(cell(row, "para"))
        if status is None or not weekday or not para:
            continue
        dep_raw, room_raw = cell(row, "department") or only_department, cell(row, "room")
        monitor = by_room.get((_norm(dep_raw), _room_key(room_raw)))
        if monitor is None:
            unmatched_rooms.add(f"{_clean(dep_raw)} — {_clean(room_raw)}")
            continue
        if allowed_set and not any(k in allowed_set for k in monitor["department_keys"]):
            forbidden.add(monitor["department"])
            continue
        teachers = _split_people(teacher_text)
        groups = _split_cell(cell(row, "group"))
        phones = _phones(cell(row, "phone"))
        for idx, name in enumerate(teachers):
            username = only_teacher if is_self_row else _resolve_teacher(
                name, phones, monitor["department"], users_by_key, users_by_username, info, monitor["department_keys"]
            )
            if not username:
                unresolved.setdefault(monitor["department"], set()).add(name)
            entries.append({
                "monitor_id": monitor["monitor_id"],
                "department": monitor["department"],
                "room_full": _clean(monitor["room_full"])[:255],
                "weekday": weekday,
                "para": para,
                "teacher_name": name[:255],
                "teacher_phone": ",".join(phones)[:64],
                "teacher_username": username,
                "subject": _clean(cell(row, "subject"))[:255],
                "group_name": (groups[idx] if len(groups) == len(teachers) else _clean(cell(row, "group")))[:255],
                "lesson_type": _clean(cell(row, "lesson_type"))[:64],
                "status": status,
                "note": _clean(cell(row, "note"))[:255],
                "week_start": _parse_week_start(cell(row, "week_start")),
            })

    other_teacher_rows = 0
    if only_teacher:
        mine = [e for e in entries if e["teacher_username"] == only_teacher]
        other_teacher_rows = len(entries) - len(mine)
        entries = mine
    departments = sorted({e["department"] for e in entries})
    if departments:
        old = db.query(MonitorScheduleEntry).filter(MonitorScheduleEntry.department.in_(departments))
        if only_teacher:
            old = old.filter(MonitorScheduleEntry.teacher_username == only_teacher)
        old.delete(synchronize_session=False)
        now = dt.datetime.now(dt.timezone.utc)
        for e in entries:
            db.add(MonitorScheduleEntry(**e, source_file=source_file[:255], imported_by=imported_by[:128], imported_at=now))
        db.commit()

    return {
        "imported_rows": len(entries),
        "departments": [
            {
                "department": dep,
                "rows": sum(1 for e in entries if e["department"] == dep),
                "monitors": len({e["monitor_id"] for e in entries if e["department"] == dep}),
                "teachers": len({e["teacher_name"] for e in entries if e["department"] == dep}),
                "unresolved_teachers": sorted(unresolved.get(dep, set())),
            }
            for dep in departments
        ],
        "unmatched_rooms": sorted(unmatched_rooms),
        "forbidden_departments": sorted(forbidden),
        "other_teacher_rows": other_teacher_rows,
    }


# ================================================================ hisobot


def _load_schedule(db: Session) -> list:
    from app.models.monitor_schedule import MonitorScheduleEntry

    return db.execute(select(MonitorScheduleEntry)).scalars().all()


def _effective_from(entry) -> dt.date | None:
    """Jadval qaysi kundan kuchga kiradi — faylda yozilgan hafta boshi (o'sha haftaning dushanbasi).
    Undan oldingi kunlarda bu dars rejada bo'lmagan: "ishlatilmadi" deb hisoblash noto'g'ri bo'lardi.
    Sana yozilmagan bo'lsa — yuklangan haftaning dushanbasi."""
    day = getattr(entry, "week_start", None)
    if day is None:
        imported = getattr(entry, "imported_at", None)
        if imported is None:
            return None
        day = imported.astimezone(TASHKENT).date() if isinstance(imported, dt.datetime) else imported
    return day - dt.timedelta(days=day.weekday())


def _applies_on(entry, day: dt.date, since: dt.date | None) -> bool:
    """Shu yozuv aynan shu kunga tegishlimi.

    HEMIS yozuvida aniq kun bor (`lesson_date`) — jadval har hafta o'zgarishi mumkin.
    Kafedra Excel'ida esa kun yo'q: u haftalik takrorlanadigan jadval, shuning uchun
    kuchga kirgan haftadan boshlab har hafta hisoblanadi.
    """
    lesson_day = getattr(entry, "lesson_date", None)
    if lesson_day is not None:
        return lesson_day == day
    return since is None or since <= day


def _entries_on(entries: list, day: dt.date, effective: dict) -> list:
    """Shu kundagi yozuvlar. Bitta slotda HEMIS ham, Excel ham bo'lsa — HEMIS ustun,
    chunki u har kuni yangilanadi; aks holda bitta dars ikki marta hisoblanardi."""
    todays = [e for e in entries if _applies_on(e, day, effective.get(id(e)))]
    from_hemis = [e for e in todays if getattr(e, "lesson_date", None) is not None]
    return from_hemis or todays


def planned_lessons_by_teacher(db: Session, start_day: dt.date, end_day: dt.date) -> dict[str, int]:
    """Monitor jadvalidagi har o'qituvchining tanlangan kunlardagi rejadagi paralari soni.

    Jadvalda yo'q o'qituvchi natijada BO'LMAYDI — uning darsi bor-yo'qligini bilmaymiz.
    Rektor hisobotida darsi bo'lmagan kun "ishlamagan" deb qizil bo'lmasligi uchun (2026-09-22)."""
    days = _dates(start_day, end_day)
    by_slot: dict[tuple[str, str, str], list] = {}
    effective: dict[int, dt.date | None] = {}
    out: dict[str, int] = {}
    for entry in _load_schedule(db):
        if entry.weekday not in WEEKDAY_INDEX or entry.para not in PERIOD_TIMES:
            continue
        if _status_for(entry.status) is None:
            continue
        if entry.teacher_username:
            out.setdefault(entry.teacher_username, 0)
        by_slot.setdefault((entry.monitor_id, entry.weekday, entry.para), []).append(entry)
        effective[id(entry)] = _effective_from(entry)

    for day in days:
        weekday = WEEKDAYS[day.weekday()]
        for (_monitor, entry_weekday, _para), entries in by_slot.items():
            if entry_weekday != weekday:
                continue
            for entry in _entries_on(entries, day, effective):
                if entry.teacher_username:
                    out[entry.teacher_username] += 1
    return out


def _slot_window(day: dt.date, para: str) -> tuple[dt.datetime, dt.datetime]:
    start_hhmm, end_hhmm = PERIOD_TIMES[para]
    sh, sm = (int(x) for x in start_hhmm.split(":"))
    eh, em = (int(x) for x in end_hhmm.split(":"))
    start = dt.datetime.combine(day, dt.time(sh, sm), tzinfo=TASHKENT) - USAGE_BEFORE
    end = dt.datetime.combine(day, dt.time(eh, em), tzinfo=TASHKENT) + USAGE_AFTER
    return start, end


#: Dars vaqtida iMentor OCHIQ bo'lganini ko'rsatadigan qaydlar.
#: `logout` ataylab yo'q: u sessiya tugaganini bildiradi, boshlanganini emas.
WORKING_EVENTS = ("heartbeat", "page_view", "content_view", "live_test_opened", "login")


#: Bitta "heartbeat" qancha vaqtni qoplashi mumkin. Brauzer uzoq turib
#: qolgan yoki soat sakragan hollarda haddan tashqari uzun oraliq yozilmasin.
MAX_SPAN_SECONDS = 15 * 60


def _work_spans(db: Session, usernames: set[str], start: dt.datetime,
                end: dt.datetime) -> dict[str, list[tuple[dt.datetime, dt.datetime]]]:
    """O'qituvchi iMentor'da ISHLAGAN oraliqlar: (boshlandi, tugadi).

    Manba — `heartbeat` qaydlari: ular sahifa ochiq va foydalanuvchi faol
    bo'lgan davomiylikni olib keladi. Qayd KELGAN vaqt oraliqning oxiri,
    `duration_sec` esa uzunligi.

    Buning uchun kerak: dars "o'tildi" deyish uchun qancha vaqt ishlanganini
    bilish shart — bir necha daqiqa kirib chiqish dars emas (2026-10-08).
    """
    from app.models.analytics import UserActivityEvent

    out: dict[str, list[tuple[dt.datetime, dt.datetime]]] = {u: [] for u in usernames}
    if not usernames:
        return out
    for owner, when, seconds in db.execute(
        select(UserActivityEvent.owner_key, UserActivityEvent.occurred_at,
               UserActivityEvent.duration_sec).where(
            UserActivityEvent.owner_key.in_(usernames),
            UserActivityEvent.event_type == "heartbeat",
            UserActivityEvent.occurred_at >= start,
            UserActivityEvent.occurred_at < end,
        )
    ).all():
        length = min(max(0, int(seconds or 0)), MAX_SPAN_SECONDS)
        if not length:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        out[owner].append((when - dt.timedelta(seconds=length), when))
    for rows in out.values():
        rows.sort()
    return out


def _usage_events(db: Session, usernames: set[str], start: dt.datetime, end: dt.datetime) -> dict[str, list]:
    """O'qituvchi iMentor'ni darsda ishlatgan paytlar. Har biri (vaqt, talabalar soni).

    Uch manba:
      * jonli test ochilgani — talabalar soni shundan keladi;
      * kompyuterga QR orqali kirgani;
      * platformadagi HAQIQIY ish — sahifa ochish, material ko'rish, ekran
        ochiq turgani (`heartbeat`).

    Uchinchisi 2026-10-08 da qo'shildi. Ilgari faqat jonli test va QR
    hisoblanardi, shuning uchun ma'ruzani iMentor'dan ko'rsatgan o'qituvchi
    "ishlatmagan" deb chiqardi — jonli ma'lumotda bunday 275 ta dars va
    qizil ro'yxatga noto'g'ri tushgan 11 ta o'qituvchi bor edi.

    Bu qayd o'qituvchi XONADA bo'lganini isbotlamaydi, faqat o'sha vaqtda
    iMentor'da ishlaganini — monitor hisobotining boshqa o'lchovlari ham
    shunday (qarang `lesson_evidence.summarize`).
    """
    from app.models.device_pairing import DevicePairingSession
    from app.services.rector_report_service import student_key_expr

    events: dict[str, list] = {u: [] for u in usernames}
    if not usernames:
        return events
    students = dict(
        db.execute(
            select(StudentTestAttempt.session_id, func.count(func.distinct(student_key_expr())))
            .join(LiveTestSession, LiveTestSession.id == StudentTestAttempt.session_id)
            .where(LiveTestSession.owner_key.in_(usernames), LiveTestSession.created_at >= start, LiveTestSession.created_at < end)
            .group_by(StudentTestAttempt.session_id)
        ).all()
    )
    for sid, owner, created in db.execute(
        select(LiveTestSession.id, LiveTestSession.owner_key, LiveTestSession.created_at).where(
            LiveTestSession.owner_key.in_(usernames), LiveTestSession.created_at >= start, LiveTestSession.created_at < end
        )
    ).all():
        events[owner].append((created, int(students.get(sid, 0) or 0)))
    for owner, picked in db.execute(
        select(DevicePairingSession.owner_key, DevicePairingSession.picked_up_at).where(
            DevicePairingSession.owner_key.in_(usernames),
            DevicePairingSession.picked_up_at.is_not(None),
            DevicePairingSession.picked_up_at >= start,
            DevicePairingSession.picked_up_at < end,
        )
    ).all():
        events[owner].append((picked, 0))
    return events


def build_report(
    db: Session,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    department: str = "",
    monitor_id: str = "",
    query: str = "",
    teacher: str = "",
    allowed_departments: list[str] | tuple[str, ...] | None = None,
) -> dict:
    today = dt.datetime.now(TASHKENT).date()
    start_day = _parse_date(date_from, today)
    end_day = _parse_date(date_to, start_day)
    if start_day > end_day:
        start_day, end_day = end_day, start_day
    if (end_day - start_day).days > 31:
        end_day = start_day + dt.timedelta(days=31)

    all_monitors = monitors()
    allowed_set = {_norm(d) for d in (allowed_departments or []) if _clean(d)}
    if allowed_set:
        all_monitors = [m for m in all_monitors if any(k in allowed_set or any(k and (k in a or a in k) for a in allowed_set) for k in m.get("department_keys", []))]
    dept_filter = _norm(department)
    monitor_filter = _clean(monitor_id).casefold()
    q = _clean(query).casefold()
    if dept_filter:
        all_monitors = [m for m in all_monitors if any(k == dept_filter or (k and (k in dept_filter or dept_filter in k)) for k in m.get("department_keys", []))]
    if monitor_filter:
        all_monitors = [m for m in all_monitors if m["monitor_id"].casefold() == monitor_filter]
    by_id = {m["monitor_id"]: m for m in all_monitors}

    schedule = _load_schedule(db)
    visible_departments = {m["department"] for m in all_monitors}
    schedule_index: dict[tuple[str, str, str], list] = {}
    effective: dict[int, dt.date | None] = {}
    schedule_from: dict[str, dt.date] = {}
    for entry in schedule:
        if teacher and entry.teacher_username != teacher:
            continue
        if entry.monitor_id in by_id and entry.weekday in WEEKDAY_INDEX and entry.para in PERIOD_TIMES:
            schedule_index.setdefault((entry.monitor_id, entry.weekday, entry.para), []).append(entry)
            since = _effective_from(entry)
            effective[id(entry)] = since
            if since and (entry.monitor_id not in schedule_from or since < schedule_from[entry.monitor_id]):
                schedule_from[entry.monitor_id] = since

    days = _dates(start_day, end_day)
    usernames = {e.teacher_username for entries in schedule_index.values() for e in entries if e.teacher_username}
    window_start = dt.datetime.combine(start_day, dt.time(0, 0), tzinfo=TASHKENT)
    window_end = dt.datetime.combine(end_day + dt.timedelta(days=1), dt.time(0, 0), tzinfo=TASHKENT)
    events = _usage_events(db, usernames, window_start, window_end)

    slots: list[dict] = []
    monitor_stats = {m["monitor_id"]: {"planned": 0, "used": 0, "teachers": set(), "students": 0} for m in all_monitors}
    teacher_rows: dict[str, dict] = {}
    for day in days:
        weekday = WEEKDAYS[day.weekday()]
        for m in all_monitors:
            for para, start_time, end_time in PERIODS:
                entries = _entries_on(schedule_index.get((m["monitor_id"], weekday, para), []), day, effective)
                win_start, win_end = _slot_window(day, para)
                used_by: set[str] = set()
                students = 0
                for e in entries:
                    for when, count in events.get(e.teacher_username, []) if e.teacher_username else []:
                        if win_start <= when <= win_end:
                            used_by.add(e.teacher_username)
                            students += count
                planned = bool(entries)
                used = bool(used_by)
                if planned:
                    stats = monitor_stats[m["monitor_id"]]
                    stats["planned"] += 1
                    stats["used"] += 1 if used else 0
                    stats["students"] += students
                    for e in entries:
                        stats["teachers"].add(e.teacher_username or e.teacher_name)
                        key = e.teacher_username or f"name:{e.teacher_name}"
                        row = teacher_rows.setdefault(key, {
                            "teacher_key": e.teacher_username,
                            "teacher_name": e.teacher_name,
                            "department": m["department"],
                            "planned_slots": 0,
                            "used_slots": 0,
                            "students": 0,
                            "linked": bool(e.teacher_username),
                        })
                        row["planned_slots"] += 1
                        if e.teacher_username and e.teacher_username in used_by:
                            row["used_slots"] += 1
                            row["students"] += students
                slot = {
                    **{k: v for k, v in m.items() if k not in {"department_keys", "department_aliases"}},
                    "date": day.isoformat(),
                    "weekday": weekday,
                    "para": para,
                    "start_time": start_time,
                    "end_time": end_time,
                    "teacher_name": " / ".join(e.teacher_name for e in entries),
                    "teacher_key": " / ".join(e.teacher_username for e in entries if e.teacher_username),
                    "subject": " / ".join(dict.fromkeys(e.subject for e in entries if e.subject)),
                    "group": " / ".join(dict.fromkeys(e.group_name for e in entries if e.group_name)),
                    "lesson_type": " / ".join(dict.fromkeys(e.lesson_type for e in entries if e.lesson_type)),
                    "status": entries[0].status if entries else "Bo‘sh",
                    # Reja qayerdan: HEMIS (har kuni yangilanadi) yoki kafedra Excel'i.
                    "source": "hemis" if entries and getattr(entries[0], "source_file", "") == "hemis" else ("excel" if entries else ""),
                    "planned": planned,
                    "used": used,
                    "student_count": students,
                }
                if q:
                    hay = " ".join(str(slot.get(k, "")) for k in ["monitor_id", "department", "room_full", "teacher_name", "subject", "group"]).casefold()
                    if q not in hay:
                        continue
                slots.append(slot)

    monitor_rows: list[dict] = []
    for m in all_monitors:
        st = monitor_stats[m["monitor_id"]]
        planned = int(st["planned"])
        used = int(st["used"])
        public_m = {k: v for k, v in m.items() if k not in {"department_keys", "department_aliases"}}
        monitor_rows.append({
            **public_m,
            "planned_slots": planned,
            "used_slots": used,
            "free_slots": max(0, len(days) * len(PERIODS) - planned),
            "usage_percent": round(used * 100 / planned, 1) if planned else None,
            "teacher_count": len(st["teachers"]),
            "students": int(st["students"]),
            # Jadval bor, lekin tanlangan oraliqdan keyin kuchga kirsa — "yuklanmagan" emas.
            "schedule_from": schedule_from[m["monitor_id"]].isoformat() if m["monitor_id"] in schedule_from else None,
        })

    teachers = list(teacher_rows.values())
    for t in teachers:
        t["usage_percent"] = round(t["used_slots"] * 100 / t["planned_slots"], 1) if t["planned_slots"] else None
    teachers.sort(key=lambda r: (r["department"], r["teacher_name"]))

    imports: dict[str, dict] = {}
    for entry in schedule:
        if entry.department not in visible_departments:
            continue
        item = imports.setdefault(entry.department, {
            "department": entry.department, "rows": 0, "teachers": set(), "unresolved": set(),
            "imported_at": entry.imported_at, "source_file": entry.source_file,
        })
        item["rows"] += 1
        item["teachers"].add(entry.teacher_name)
        if not entry.teacher_username:
            item["unresolved"].add(entry.teacher_name)
        if entry.imported_at and (item["imported_at"] is None or entry.imported_at > item["imported_at"]):
            item["imported_at"], item["source_file"] = entry.imported_at, entry.source_file
    import_rows_out = [
        {
            "department": v["department"],
            "rows": v["rows"],
            "teachers": len(v["teachers"]),
            "unresolved_teachers": sorted(v["unresolved"]),
            "imported_at": v["imported_at"].isoformat() if v["imported_at"] else None,
            "source_file": v["source_file"],
        }
        for v in sorted(imports.values(), key=lambda x: x["department"])
    ]

    planned_total = sum(m["planned_slots"] for m in monitor_rows)
    used_total = sum(m["used_slots"] for m in monitor_rows)
    return {
        "from": start_day.isoformat(),
        "to": end_day.isoformat(),
        "schedule_imported": bool(import_rows_out),
        "source": {"inventory": inventory().get("source_url", ""), "checked_on": inventory().get("checked_on", "")},
        "totals": {
            "monitors": len(monitor_rows),
            "planned_slots": planned_total,
            "used_slots": used_total,
            "free_slots": sum(m["free_slots"] for m in monitor_rows),
            "teachers": len(teachers),
            "usage_percent": round(used_total * 100 / planned_total, 1) if planned_total else None,
        },
        "departments": sorted(visible_departments),
        "imports": import_rows_out,
        "monitors": monitor_rows,
        "teachers": teachers,
        "slots": slots,
    }
