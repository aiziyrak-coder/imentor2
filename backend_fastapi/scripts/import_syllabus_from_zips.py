"""Ikkala Mavzular zip'dan fan katalogini qayta yuklash.

Ma'ruza, amaliy, klinik mashg'ulot, mustaqil ta'lim va laboratoriya
hammasi olinadi.

    python scripts/import_syllabus_from_zips.py \\
      --zip-a "/data/MAVZULAR 15.08.2026.zip" \\
      --zip-b "/data/Mavzular 17.08.2026.zip" \\
      --dry-run

    python scripts/import_syllabus_from_zips.py ... --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

DIRECTION_ALIASES = {
    "davolash ishi": "DI",
    "di": "DI",
    "tibbiy profilaktika": "TPI",
    "tibbiy profilaktika ishi": "TPI",
    "tpi": "TPI",
    "pediatriya ishi": "PI",
    "pediatriya": "PI",
    "ped": "PI",
    "pi": "PI",
    "stomatologiya": "S",
    "stom": "S",
    "s": "S",
    "farmatsiya": "F",
    "farm": "F",
    "f": "F",
    "fundamental tibbiyot": "FT",
    "ft": "FT",
    "tibbiy biologik ish": "FT",
    "xalq tabobati": "XT",
    "xt": "XT",
    "oliy hamshiralik ishi": "OHI",
    "ohi": "OHI",
    "biotibbiyot": "BM",
    "biotibbiyot muhandisligi": "BM",
    "bm": "BM",
    "md": "MD",
    "rtt": "RTT",
}

# Zip papka nomi → OnlineTest akademik katalogidagi ANIQ kafedra nomi.
# "To'g'rilangan" imlo (Lotin tili, Gistologiya va biologiya, ...) catalogda YO'Q —
# o'sha nomga yozilsa admin/o'qituvchi kafedrasi bo'sh chiqadi.
DEPT_FOLDER_ALIASES = {
    "gistalogiya va biologiya": "GISTOLOGIYA BIOLOGIYA",
    "gistologiya va biologiya": "GISTOLOGIYA BIOLOGIYA",
    "gistologiya biologiya": "GISTOLOGIYA BIOLOGIYA",
    "ichki kasalliklar propedevtikasi": "Ichki kasallilar propedevtikasi",
    "ichki kasalliklar propedevtikasi kafedrasi": "Ichki kasallilar propedevtikasi",
    "kommunal gigiyena": "Kommunal va mehnat gigiyenasi",
    "kommunal va mehnat gigiyenasi": "Kommunal va mehnat gigiyenasi",
    "lotin tili": "Lotin tilli, pedagogika va psixalogiya",
    "lotin tili, pedagogika va psixologiya": "Lotin tilli, pedagogika va psixalogiya",
    "nevrologiya va psixatriya": "Nevrologiya va Psixiatriya",
    "normal anatomiya": "NORMAL ANATOMIYA",
    "normal anatomiya, operativ jarrohlik va topografik anatomiya": "NORMAL ANATOMIYA",
    "ovqatlanish, bolalar va o'smirlar gigienasi": "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
    "ovqatlanish, bolalar va o 'smirlar gigienasi": "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
    "ovqatlanish, bolalar va osmirlar gigienasi": "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
    "ovqatlanish, bolalar va osmirlar gigiyenasi": "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
    "preventiv": "Preventive tibbiyot, Jamoat salomatligi, Jismoniy tarbiya va sport",
    "stomatologiya": "Stomatologiya va otorinoloringologiya",
    "stomatologiya va otorinolaringologiya": "Stomatologiya va otorinoloringologiya",
    "uralogiya va onkologiya": "Urologiya va onkologiya",
    "urologiya va onkologiya": "Urologiya va onkologiya",
    "urologiya": "Urologiya va onkologiya",
    "ijtimoiy fanlar": "ijtimoiy fanlar",
    "endokrinologiya,gemotologiya va ftiziatriya sillabus": "Endokrinologiya gematologiya va ftizatriya",
    "endokrinologiya, gemotologiya va ftiziatriya sillabus": "Endokrinologiya gematologiya va ftizatriya",
    "fakultet va gospital jarrohlik": "Fakultativ va gospital jarrohlik",
    "terapiya uash": "Terapiya yo'nalishidagi fanlar",
    "o'zbek va xorijiy tillar": "O'zbek va xorijiy tillar kafedrasi",
    "xalq tabobati va farmakologiya": "Xalq tabobati va farmakologiya kafedrasi",
    "mikrobiologiya,virusologiya,immunologiya": "Mikrobiologiya, Virusalogiya va immunologiya",
    "mikrobiologiya, virusologiya va immunologiya": "Mikrobiologiya, Virusalogiya va immunologiya",
    "travmatologiya va ortopediya": "Travmatologiya va ortapediya",
}


def _col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def read_xlsx_bytes(data: bytes) -> list[list[str]]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))
        sheet_name = next(
            (n for n in zf.namelist() if re.fullmatch(r"xl/worksheets/sheet1\.xml", n)),
            None,
        ) or next(n for n in zf.namelist() if n.startswith("xl/worksheets/sheet"))
        root = ET.fromstring(zf.read(sheet_name))
        rows: list[list[str]] = []
        for row in root.iter(f"{{{NS['m']}}}row"):
            cells: dict[int, str] = {}
            for c in row.findall("m:c", NS):
                ref = c.get("r") or ""
                idx = _col_index(ref) if ref else len(cells)
                ctype = c.get("t")
                if ctype == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                else:
                    v = c.find("m:v", NS)
                    raw = v.text if v is not None else None
                    if raw is None:
                        value = ""
                    elif ctype == "s":
                        value = shared[int(raw)] if raw.isdigit() and int(raw) < len(shared) else ""
                    else:
                        value = raw
                cells[idx] = re.sub(r"\s+", " ", (value or "")).strip()
            if not cells:
                continue
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
        return rows


def fold_apostrophes(value: str) -> str:
    s = value
    for ch in "'ʼʻ`´‘’‛′‵":
        s = s.replace(ch, "'")
    return s


def norm(value: str) -> str:
    s = fold_apostrophes(value or "").casefold()
    return re.sub(r"\s+", " ", s).strip()


def classify_activity(value: str) -> str:
    s = norm(value)
    if not s:
        return "unknown"
    if re.search(r"mustaqil|самостоят|\bsrc\b|\bсрс\b|independent", s):
        return "independent"
    if re.search(r"laborator|лаборатор|\blab\b", s):
        return "lab"
    # Excel'da Seminar = amaliy mashg'ulot, ma'ruza/leksiya EMAS.
    if re.search(r"\bseminar|\bсеминар", s):
        return "practical"
    if re.search(r"klinik\s*mashg|клиническ|\bclinical\b", s):
        return "clinical"
    if re.search(r"amaliy|practical|практик", s):
        return "practical"
    if re.search(r"ma'?ruza|maruza|lecture|leksiya|lektsiya|лекци|теорет", s):
        return "lecture"
    return "unknown"


def is_title_header(cell: str) -> bool:
    s = re.sub(r"[º°]", "", norm(cell)).strip()
    if not s or len(s) > 24:
        return False
    if re.match(r"^nomi\b", s):
        return True
    if s in {"mavzu", "title", "topic", "тема", "название", "fan nomi", "subject"}:
        return True
    return "mavzu nomi" in s or "topic name" in s


def is_type_header(cell: str) -> bool:
    s = norm(cell)
    if not s or len(s) > 20:
        return False
    if classify_activity(s) != "unknown":
        return False
    if "mashg" in s:
        return True
    return s in {"turi", "type", "вид"} or s == "занятие"


def looks_like_header_row(row: list[str]) -> bool:
    return any(is_title_header(c) for c in row) or any(is_type_header(c) for c in row)


def detect_type_column(rows: list[list[str]], title_col: int) -> int:
    sample = rows[:40]
    width = max((len(r) for r in sample), default=0)
    best, best_hits = -1, 0
    for col in range(width):
        if col == title_col:
            continue
        hits = sum(1 for r in sample if classify_activity(r[col] if col < len(r) else "") != "unknown")
        if hits > best_hits:
            best, best_hits = col, hits
    return best if best_hits >= 2 else -1


def detect_title_column(rows: list[list[str]], type_col: int) -> int:
    sample = [r for r in rows[:40] if any(c.strip() for c in r)]
    width = max((len(r) for r in sample), default=0)
    best = 1 if type_col != 1 else 0
    best_score = -1
    for col in range(width):
        if col == type_col:
            continue
        score = 0
        for r in sample:
            cell = r[col] if col < len(r) else ""
            if len(cell) >= 8 and classify_activity(cell) == "unknown":
                score += len(cell)
        if score > best_score:
            best, best_score = col, score
    return best


def parse_syllabus_excel(rows: list[list[str]], source_name: str = "") -> dict:
    header_idx = next((i for i, r in enumerate(rows[:12]) if looks_like_header_row(r)), -1)
    header = rows[header_idx] if header_idx >= 0 else []
    title_col = next((i for i, c in enumerate(header) if is_title_header(c)), -1)
    type_col = next((i for i, c in enumerate(header) if is_type_header(c)), -1)
    data = rows[header_idx + 1 :] if header_idx >= 0 else rows
    if type_col < 0:
        type_col = detect_type_column(data, title_col)
    if title_col < 0:
        title_col = detect_title_column(data, type_col)

    sample = data[:20]
    digitish = 0
    type_hits = 0
    for r in sample:
        title = r[title_col] if 0 <= title_col < len(r) else ""
        if re.fullmatch(r"\d{1,3}", title.strip()):
            digitish += 1
        typ = r[type_col] if 0 <= type_col < len(r) else ""
        if len(typ.strip()) <= 32 and classify_activity(typ) in {
            "lecture",
            "practical",
            "clinical",
            "lab",
            "independent",
        }:
            type_hits += 1
    if digitish >= 3 and type_hits < 2:
        title_col += 1
        if type_col >= 0:
            type_col += 1

    lectures: list[str] = []
    practicals: list[str] = []
    clinicals: list[str] = []
    independents: list[str] = []
    labs: list[str] = []
    seen: set[str] = set()
    for row in data:
        title = row[title_col] if 0 <= title_col < len(row) else ""
        title = re.sub(r"\s+", " ", title).strip()
        if len(title) < 4 or re.fullmatch(r"\d{1,3}", title):
            continue
        if looks_like_header_row(row):
            continue
        type_raw = row[type_col] if 0 <= type_col < len(row) else ""
        kind = classify_activity(type_raw)
        if kind not in {"lecture", "practical", "clinical", "independent", "lab"}:
            if re.search(r"\bseminar|\bсеминар", norm(source_name)):
                kind = "practical"
            else:
                continue
        key = f"{kind}::{title.casefold()}"
        if key in seen:
            continue
        seen.add(key)
        if kind == "practical":
            practicals.append(title)
        elif kind == "clinical":
            clinicals.append(title)
        elif kind == "independent":
            independents.append(title)
        elif kind == "lab":
            labs.append(title)
        else:
            lectures.append(title)

    topics = (
        [{"id": f"L{i+1}", "title": t[:500], "type": "lecture"} for i, t in enumerate(lectures)]
        + [{"id": f"A{i+1}", "title": t[:500], "type": "practical"} for i, t in enumerate(practicals)]
        + [{"id": f"K{i+1}", "title": t[:500], "type": "clinical"} for i, t in enumerate(clinicals)]
        + [{"id": f"I{i+1}", "title": t[:500], "type": "independent"} for i, t in enumerate(independents)]
        + [{"id": f"B{i+1}", "title": t[:500], "type": "lab"} for i, t in enumerate(labs)]
    )
    return {
        "topics": topics,
        "skipped_independent": 0,
        "skipped_lab": 0,
    }


def strip_kafedra_prefix(folder: str) -> str:
    return re.sub(r"^\d+\.\s*", "", (folder or "").strip())


def canonical_kafedra(folder: str) -> str:
    raw = strip_kafedra_prefix(folder)
    key = norm(raw)
    if key in DEPT_FOLDER_ALIASES:
        return DEPT_FOLDER_ALIASES[key]
    compact = re.sub(r"[\s']+", " ", key.replace("'", "")).strip()
    for alias, dest in DEPT_FOLDER_ALIASES.items():
        if re.sub(r"[\s']+", " ", alias.replace("'", "")).strip() == compact:
            return dest
    return raw


def direction_from_filename(fname: str) -> str:
    """Fayl nomi 'Stomatologiya 2021-2022 …' bo'lsa yo'nalishni ajratadi."""
    stem = re.sub(r"\.xlsx?$", "", fname, flags=re.I).replace("_", " ")
    s = norm(stem)
    best = ""
    for key in DIRECTION_ALIASES:
        if s.startswith(key) and len(key) > len(best):
            best = key
    if best:
        return DIRECTION_ALIASES[best]
    return "Asosiy"


def iter_xlsx_from_zip(path: Path):
    """Yields (kafedra, direction_folder, filename, bytes)."""
    with zipfile.ZipFile(path) as zf:
        for name in zf.namelist():
            if name.endswith("/") or name.startswith("__MACOSX"):
                continue
            parts = [p for p in name.replace("\\", "/").split("/") if p]
            if name.lower().endswith(".zip"):
                kaf = strip_kafedra_prefix(parts[1] if len(parts) > 2 else parts[0])
                direction = Path(parts[-1]).stem
                inner_bytes = zf.read(name)
                with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
                    for inn in inner.namelist():
                        if inn.lower().endswith(".xlsx") and not inn.startswith("__MACOSX"):
                            yield kaf, direction, Path(inn).name, inner.read(inn)
                continue
            if not name.lower().endswith(".xlsx"):
                continue
            if len(parts) < 3:
                continue
            kaf = strip_kafedra_prefix(parts[1])
            fname = parts[-1]
            if len(parts) >= 4:
                direction = parts[2]
            else:
                direction = direction_from_filename(fname)
            yield kaf, direction, fname, zf.read(name)


def parse_zip_path(zip_name: str) -> tuple[str, str, str] | None:
    rel = zip_name.split("::")[-1]
    parts = [p for p in rel.replace("\\", "/").split("/") if p]
    if len(parts) < 3:
        return None
    # drop zip root folder
    parts = parts[1:]
    if len(parts) < 3:
        return None
    kaf = strip_kafedra_prefix(parts[0])
    direction = parts[1]
    fname = parts[-1]
    if not fname.lower().endswith(".xlsx"):
        return None
    return kaf, direction, fname


def map_direction(folder: str) -> str:
    key = re.sub(r"[^a-z0-9а-яё]+", " ", norm(folder)).strip()
    if key in DIRECTION_ALIASES:
        return DIRECTION_ALIASES[key]
    raw = (folder or "").strip()[:32]
    if re.fullmatch(r"[A-Za-zА-ЯЁ]{1,8}", raw):
        return raw.upper() if raw.isascii() else raw
    return raw


def subject_from_filename(fname: str) -> str:
    stem = re.sub(r"\.xlsx?$", "", fname, flags=re.I)
    stem = stem.replace("_", " ")
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem[:255]


def detect_language(topics: list[dict], filename: str) -> str:
    text = " ".join(t["title"] for t in topics)
    cyr = len(re.findall(r"[А-Яа-яЁё]", text))
    lat = len(re.findall(r"[A-Za-z]", text))
    if cyr > 40 and cyr > lat * 1.2:
        return "ru"
    if "xorijiy" in filename.casefold() and lat > 80:
        return "en"
    return "uz"


def slugify_subject(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[-\s]+", "-", s).strip("-")
    return (s or "fan")[:64]


def collect_courses(zip_a: Path, zip_b: Path) -> tuple[list[dict], Counter, list[str]]:
    """15-chi asos, 17-chi ustiga yozadi (bir xil kalit bo'lsa)."""
    by_key: dict[tuple[str, str, str], dict] = {}
    stats = Counter()
    issues: list[str] = []

    for tag, zp in (("15", zip_a), ("17", zip_b)):
        if not zp or not zp.exists():
            continue
        for kaf, direction_folder, fname, data in iter_xlsx_from_zip(zp):
            try:
                rows = read_xlsx_bytes(data)
                parsed = parse_syllabus_excel(rows, fname)
            except Exception as exc:
                issues.append(f"{kaf}/{direction_folder}/{fname}: {exc}")
                stats["read_error"] += 1
                continue
            topics = parsed["topics"]
            stats["independent"] += sum(1 for t in topics if t["type"] == "independent")
            stats["lab"] += sum(1 for t in topics if t["type"] == "lab")
            if not topics:
                issues.append(f"{kaf}/{direction_folder}/{fname}: 0 mavzu")
                stats["empty"] += 1
                continue
            subject = subject_from_filename(fname)
            direction = map_direction(direction_folder)
            kaf = canonical_kafedra(kaf)
            key = (norm(kaf), norm(direction), norm(subject))
            by_key[key] = {
                "kafedra": kaf,
                "direction_code": direction,
                "subject_name": subject,
                "file_name": fname,
                "topics": topics,
                "instruction_language": detect_language(topics, fname),
                "source": tag,
                "zip_name": f"{kaf}/{direction_folder}/{fname}",
                "lecture_n": sum(1 for t in topics if t["type"] == "lecture"),
                "practical_n": sum(1 for t in topics if t["type"] == "practical"),
                "clinical_n": sum(1 for t in topics if t["type"] == "clinical"),
                "independent_n": sum(1 for t in topics if t["type"] == "independent"),
                "lab_n": sum(1 for t in topics if t["type"] == "lab"),
            }
            stats["ok"] += 1
            stats[f"ok_{tag}"] += 1

    courses = list(by_key.values())
    courses.sort(key=lambda c: (c["kafedra"].casefold(), c["direction_code"], c["subject_name"].casefold()))
    return courses, stats, issues


def resolve_folder_dept(db, folder: str, cache: dict):
    """Faol katalog kafedrasiga bog'laydi. Inactive dublikat nomiga yozilmaydi."""
    from sqlalchemy import select

    from app.models.content import AcademicDepartment
    from app.services.staff_department import pick_department_name

    key = norm(folder)
    if key in cache:
        return cache[key]
    hint = DEPT_FOLDER_ALIASES.get(key, folder)
    depts = list(
        db.execute(select(AcademicDepartment).where(AcademicDepartment.is_active.is_(True))).scalars().all()
    )
    names = [d.name for d in depts]
    picked = pick_department_name(hint, names) or pick_department_name(folder, names)
    dept = next((d for d in depts if d.name == picked), None) if picked else None
    cache[key] = dept
    return dept


def unique_code(db, name: str, used: set[str]) -> str:
    from sqlalchemy import select

    from app.models.content import CourseSyllabus

    base = slugify_subject(name)[:56]
    code = base
    n = 1
    while code in used or db.execute(
        select(CourseSyllabus.id).where(CourseSyllabus.subject_code == code)
    ).scalar_one_or_none():
        code = f"{base}-{n}"[:64]
        n += 1
        if n > 10_000:
            raise RuntimeError(f"unique_code exhausted for {name!r}")
    used.add(code)
    return code


def apply_import(courses: list[dict], *, apply: bool) -> None:
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.models.content import AcademicDepartment, CourseSyllabus

    db = SessionLocal()
    try:
        cache: dict = {}
        unmatched: Counter = Counter()
        now = dt.datetime.now(dt.timezone.utc)

        existing = list(db.execute(select(CourseSyllabus)).scalars().all()) if apply else []
        by_key: dict[tuple, CourseSyllabus] = {}
        used_codes: set[str] = set()
        for obj in existing:
            used_codes.add(obj.subject_code or "")
            dcode = (obj.direction_code or "").strip()
            by_key[(obj.department_id, norm(dcode), norm(obj.subject_name or ""))] = obj

        created = 0
        updated = 0
        sort_by_dept: Counter = Counter()

        for course in courses:
            dept = resolve_folder_dept(db, course["kafedra"], cache)
            if dept is None:
                unmatched[course["kafedra"]] += 1
            if not apply:
                continue
            if dept is None:
                existing_dept = db.execute(
                    select(AcademicDepartment).where(
                        AcademicDepartment.name == course["kafedra"][:255],
                        AcademicDepartment.is_active.is_(True),
                    )
                ).scalar_one_or_none()
                if existing_dept is not None:
                    dept = existing_dept
                    cache[norm(course["kafedra"])] = dept
                else:
                    dept = AcademicDepartment(
                        name=course["kafedra"][:255],
                        code=slugify_subject(course["kafedra"])[:56],
                        sort_order=0,
                        is_active=True,
                        created_at=now,
                        updated_at=now,
                    )
                    base = dept.code[:56]
                    n = 1
                    while db.execute(
                        select(AcademicDepartment.id).where(AcademicDepartment.code == dept.code)
                    ).scalar_one_or_none():
                        dept.code = f"{base}-{n}"[:64]
                        n += 1
                        if n > 10_000:
                            raise RuntimeError(f"department code exhausted for {course['kafedra']!r}")
                    db.add(dept)
                    db.flush()
                    cache[norm(course["kafedra"])] = dept
                    print(f"  [yangi kafedra] {dept.name}", flush=True)

            sort_by_dept[dept.id] += 1
            variant = {
                "label": "asosiy",
                "file_name": course["file_name"][:512],
                "topics": course["topics"],
            }
            key = (dept.id, norm(course["direction_code"]), norm(course["subject_name"]))
            obj = by_key.get(key)
            if obj is not None:
                obj.topics = course["topics"]
                obj.variants = [variant]
                obj.file_name = course["file_name"][:512]
                obj.direction_code = course["direction_code"][:32]
                obj.instruction_language = course["instruction_language"]
                obj.topics_i18n = {}
                obj.is_active = True
                obj.updated_at = now
                updated += 1
            else:
                obj = CourseSyllabus(
                    subject_name=course["subject_name"],
                    subject_code=unique_code(db, course["subject_name"], used_codes),
                    department_id=dept.id,
                    direction_code=course["direction_code"][:32],
                    description="",
                    instruction_language=course["instruction_language"],
                    file_name=course["file_name"][:512],
                    topics=course["topics"],
                    variants=[variant],
                    name_i18n={},
                    topics_i18n={},
                    sort_order=min(sort_by_dept[dept.id] - 1, 9999),
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
                db.add(obj)
                by_key[key] = obj
                created += 1
            if (created + updated) % 50 == 0:
                db.flush()
                print(f"  ... {created} yangi, {updated} yangilandi", flush=True)

        if apply:
            db.commit()
            print(f"Yozildi: {created} yangi fan, {updated} yangilandi", flush=True)
        else:
            print("DRY RUN — bazaga yozilmadi", flush=True)

        print("Kafedra mos kelmagan (dry-run soni):", flush=True)
        for name, n in unmatched.most_common():
            print(f"  {n:3d}  {name}", flush=True)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--zip-a", required=True, help="MAVZULAR 15.08.2026.zip")
    p.add_argument("--zip-b", default="", help="Mavzular 17.08.2026.zip")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    if not args.apply:
        args.dry_run = True

    zip_a = Path(args.zip_a)
    zip_b = Path(args.zip_b) if args.zip_b else Path()
    courses, stats, issues = collect_courses(zip_a, zip_b)
    print("statistika", dict(stats), flush=True)
    print("fanlar", len(courses), flush=True)
    print(
        "mavzular",
        sum(len(c["topics"]) for c in courses),
        "ma'ruza",
        sum(c["lecture_n"] for c in courses),
        "amaliy",
        sum(c["practical_n"] for c in courses),
        "klinik",
        sum(c["clinical_n"] for c in courses),
        "mustaqil",
        sum(c["independent_n"] for c in courses),
        "laboratoriya",
        sum(c["lab_n"] for c in courses),
        flush=True,
    )
    if issues:
        print(f"muammoli fayllar: {len(issues)}", flush=True)
        for line in issues:
            print(" ", line, flush=True)
    if args.apply:
        apply_import(courses, apply=True)
    else:
        print("DRY RUN — bazaga yozilmadi", flush=True)


if __name__ == "__main__":
    main()
