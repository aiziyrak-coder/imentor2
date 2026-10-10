"""HEMIS eksportidan (.xlsx) xodim va talabalarni bazaga qo'shadi.

Fayl ikkita varaqdan iborat (HEMIS standart eksporti):

  * `Xodimlar`  — login sifatida `employee_id_number` ishlatiladi (10 raqam),
    rol `hodim`, parol standart `fjsti123`.
  * `Talabalar` — login `ot_<student_id_number>` (`auth.py` dagi online-test
    oqimi bilan bir xil), rol `student`, **parol bo'sh** — talaba baribir
    tashqi online-test tizimi orqali kiradi, lokal parol ishlatilmaydi.

HEMIS qiymatlari `"Pediatriya fakulteti | code=344-194 | id=64"` ko'rinishida
keladi — `|` dan oldingi qismi olinadi.

Skript IDEMPOTENT: mavjud foydalanuvchi qayta yaratilmaydi, faqat ism-familiya
va profili yangilanadi.

Eslatma: .xlsx — oddiy zip+XML, tashqi kutubxona ishlatilmaydi, shuning uchun
backend obrazini qayta qurish shart emas.

    # Ko'rish (bazaga tegmaydi)
    docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \\
      run --rm -v "$PWD/data:/data" backend_fastapi \\
      python scripts/import_hemis_xlsx.py --file /data/HEMIS.xlsx --dry-run

    # Faqat professor-o'qituvchilar + talabalar, haqiqiy yozuv
    docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \\
      run --rm -v "$PWD/data:/data" backend_fastapi \\
      python scripts/import_hemis_xlsx.py --file /data/HEMIS.xlsx \\
      --employee-types teacher --apply
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.staff_location import StaffProfile  # noqa: E402
from app.services import auth_service  # noqa: E402
from app.services import staff_department as staff_dept  # noqa: E402

DEFAULT_PASSWORD = "fjsti123"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
# Diqqat: `workbook.xml.rels` paketi va `workbook.xml` dagi `r:id` — ikki xil namespace.
REL_NS = {"r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}

STAFF_SHEET = "Xodimlar"
STUDENT_SHEET = "Talabalar"

# `employeeType` ustunidagi HEMIS turlari — `--employee-types` uchun qisqa nomlar.
EMPLOYEE_TYPE_GROUPS = {
    "teacher": ("professor-o‘qituvchi", "professor-o'qituvchi"),
    "admin": ("administrativ-boshqaruv",),
    "service": ("xizmat ko‘rsatuvchi", "xizmat ko'rsatuvchi"),
    "other": ("boshqa",),
}


# ---------------------------------------------------------------- xlsx o'qish

def _col_index(ref: str) -> int:
    """"C7" -> 2 (0-based ustun raqami)."""
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def _sheet_targets(zf: zipfile.ZipFile) -> dict[str, str]:
    """Varaq nomi -> zip ichidagi yo'l (`xl/worksheets/sheetN.xml`)."""
    rels = {}
    rel_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rel_root:
        rid = rel.get("Id")
        target = rel.get("Target") or ""
        if rid:
            # Target `/xl/worksheets/sheet2.xml` yoki `worksheets/sheet2.xml` bo'lishi mumkin.
            clean = target.lstrip("/")
            rels[rid] = clean if clean.startswith("xl/") else f"xl/{clean}"

    out: dict[str, str] = {}
    wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
    for order, sheet in enumerate(wb_root.iter(f"{{{NS['m']}}}sheet"), start=1):
        name = sheet.get("name") or ""
        if not name:
            continue
        rid = sheet.get(f"{{{REL_NS['r']}}}id")
        target = rels.get(rid or "")
        if target is None:
            # Zaxira: rels o'qilmasa varaq tartibi bo'yicha (`sheet1.xml`, ...).
            fallback = f"xl/worksheets/sheet{order}.xml"
            target = fallback if fallback in zf.namelist() else None
        if target:
            out[name] = target
    return out


def read_sheet_rows(path: Path, sheet_name: str) -> list[list[str]]:
    """Berilgan varaqni qatorlar ro'yxati sifatida qaytaradi (faqat matn)."""
    with zipfile.ZipFile(path) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")))

        targets = _sheet_targets(zf)
        target = targets.get(sheet_name)
        if target is None:
            raise KeyError(f"'{sheet_name}' varag'i topilmadi. Mavjudlari: {sorted(targets)}")

        root = ET.fromstring(zf.read(target))
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
                cells[idx] = (value or "").strip()
            if not cells:
                continue
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
        return rows


def as_dicts(rows: list[list[str]]) -> list[dict[str, str]]:
    if not rows:
        return []
    header = [(h or "").strip() for h in rows[0]]
    out = []
    for row in rows[1:]:
        item = {h: (row[i].strip() if i < len(row) else "") for i, h in enumerate(header) if h}
        if any(item.values()):
            out.append(item)
    return out


# ---------------------------------------------------------------- normalizatsiya

def hemis_label(value: str) -> str:
    """"Pediatriya fakulteti | code=344-194 | id=64" -> "Pediatriya fakulteti"."""
    return (value or "").split("|")[0].strip()


def title_case(name: str) -> str:
    """"GULCHEXRA" -> "Gulchexra"; "MANSURJON O‘G‘LI" -> "Mansurjon O‘g‘li"."""
    parts = re.split(r"(\s+|-)", (name or "").strip())
    out = []
    for part in parts:
        if not part.strip() or part == "-":
            out.append(part)
            continue
        out.append(part[:1].upper() + part[1:].lower())
    return "".join(out)


def clean_id(value: str) -> str:
    """Login normalizatsiyasi bilan bir xil (`app.core.staff_login`)."""
    return "".join(ch for ch in (value or "") if ch.isalnum()).upper()


def person_names(row: dict[str, str]) -> tuple[str, str]:
    """(ism, familiya) — HEMIS `first_name` / `second_name` ustunlaridan."""
    first = title_case(row.get("first_name") or "")
    last = title_case(row.get("second_name") or "")
    if not first and not last:
        parts = (row.get("full_name") or "").split()
        if parts:
            last = title_case(parts[0])
            first = title_case(parts[1]) if len(parts) > 1 else ""
    return first, last


def employee_type_key(row: dict[str, str]) -> str:
    label = hemis_label(row.get("employeeType") or "").lower()
    for key, needles in EMPLOYEE_TYPE_GROUPS.items():
        if any(n in label for n in needles):
            return key
    return "other"


# ---------------------------------------------------------------- yozish

def _ensure_profile(db, owner_key: str) -> StaffProfile:
    profile = db.execute(
        select(StaffProfile).where(StaffProfile.owner_key == owner_key)
    ).scalar_one_or_none()
    if profile is None:
        profile = StaffProfile(owner_key=owner_key, updated_at=dt.datetime.now(dt.timezone.utc))
        db.add(profile)
        db.flush()
    return profile


def import_staff(db, rows: list[dict[str, str]], *, types: set[str], skip_fired: bool,
                 password: str, apply: bool, limit: int | None) -> Counter:
    stats: Counter = Counter()
    seen: set[str] = set()
    shown = 0

    for line_no, row in enumerate(rows, start=2):
        staff_id = clean_id(row.get("employee_id_number") or "")
        if not staff_id:
            stats["id_yoq"] += 1
            continue
        if staff_id in seen:
            stats["faylda_takror"] += 1
            continue
        seen.add(staff_id)

        if employee_type_key(row) not in types:
            stats["tur_mos_emas"] += 1
            continue
        status = hemis_label(row.get("employeeStatus") or "").lower()
        if skip_fired and "bo‘shagan" in status.replace("'", "‘"):
            stats["boshagan"] += 1
            continue

        first_name, last_name = person_names(row)
        department = hemis_label(row.get("department") or "")
        job_title = hemis_label(row.get("staffPosition") or "")
        specialty = hemis_label(row.get("specialty") or "")

        user = auth_service.get_user_by_username(db, staff_id)
        created = user is None

        if apply:
            if created:
                user = auth_service.create_user(db, staff_id, password, first_name, last_name)
            else:
                user.first_name = first_name or user.first_name
                user.last_name = last_name or user.last_name
            auth_service.set_user_role_group(db, user, "hodim")

            profile = _ensure_profile(db, staff_id)
            if department:
                staff_dept.apply_staff_department(db, profile, department_name=department)
            profile.participant_kind = "employee"
            if job_title:
                profile.job_title = job_title
            if specialty:
                profile.direction = specialty
            profile.updated_at = dt.datetime.now(dt.timezone.utc)

        stats["yangi" if created else "mavjud"] += 1
        if created and (limit is None or shown < limit):
            shown += 1
            print(f"  [{line_no}] {staff_id}  {last_name} {first_name} · {department or '—'} · {job_title or '—'}")

    return stats


def import_students(db, rows: list[dict[str, str]], *, apply: bool, limit: int | None) -> Counter:
    stats: Counter = Counter()
    seen: set[str] = set()
    shown = 0

    for line_no, row in enumerate(rows, start=2):
        sid = clean_id(row.get("student_id_number") or "")
        if not sid:
            stats["id_yoq"] += 1
            continue
        if sid in seen:
            stats["faylda_takror"] += 1
            continue
        seen.add(sid)

        username = f"ot_{sid}"[:150]
        first_name, last_name = person_names(row)
        faculty = hemis_label(row.get("department") or "")
        study_group = hemis_label(row.get("group") or "")
        specialty = hemis_label(row.get("specialty") or "")

        user = auth_service.get_user_by_username(db, username)
        created = user is None

        if apply:
            if created:
                # Parol bo'sh — talaba tashqi online-test tizimi orqali kiradi
                # (`/auth/online-test-login/` bilan bir xil oqim).
                user = auth_service.create_user(db, username, "", first_name, last_name)
                user.password = ""
            else:
                user.first_name = first_name or user.first_name
                user.last_name = last_name or user.last_name
            auth_service.set_user_role_group(db, user, "student")

            profile = _ensure_profile(db, username)
            profile.participant_kind = "student"
            if faculty:
                profile.faculty = faculty
            if study_group:
                profile.study_group = study_group
            if specialty:
                profile.direction = specialty
            profile.updated_at = dt.datetime.now(dt.timezone.utc)

        stats["yangi" if created else "mavjud"] += 1
        if created and (limit is None or shown < limit):
            shown += 1
            print(f"  [{line_no}] {username}  {last_name} {first_name} · {faculty or '—'} · {study_group or '—'}")

    return stats


def _report(title: str, stats: Counter) -> None:
    print(f"\n--- {title}")
    for key in ("yangi", "mavjud", "tur_mos_emas", "boshagan", "id_yoq", "faylda_takror"):
        if stats.get(key):
            print(f"    {key:16} {stats[key]}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="HEMIS eksporti (.xlsx)")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help=f"Xodimlar uchun standart parol (default: {DEFAULT_PASSWORD})")
    parser.add_argument(
        "--employee-types",
        default="teacher",
        help="Vergul bilan: teacher,admin,service,other yoki all (default: teacher)",
    )
    parser.add_argument("--skip-staff", action="store_true", help="Xodimlar varag'ini o'tkazib yuborish")
    parser.add_argument("--skip-students", action="store_true", help="Talabalar varag'ini o'tkazib yuborish")
    parser.add_argument("--keep-fired", action="store_true", help="'Bo‘shagan' xodimlarni ham qo'shish")
    parser.add_argument("--show", type=int, default=15, help="Nechta yangi yozuv chop etilsin (0 = hammasi)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Faqat ko'rsatadi, bazaga yozmaydi")
    group.add_argument("--apply", action="store_true", help="Bazaga yozadi")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"XATO: fayl topilmadi: {path}")
        sys.exit(1)
    if len(args.password) < 6:
        print("XATO: parol kamida 6 belgidan iborat bo'lishi kerak.")
        sys.exit(1)

    raw_types = {t.strip().lower() for t in args.employee_types.split(",") if t.strip()}
    types = set(EMPLOYEE_TYPE_GROUPS) if "all" in raw_types else raw_types
    unknown = types - set(EMPLOYEE_TYPE_GROUPS)
    if unknown:
        print(f"XATO: noma'lum employee-type: {sorted(unknown)}. Mavjudlari: {sorted(EMPLOYEE_TYPE_GROUPS)} yoki all")
        sys.exit(1)

    limit = None if args.show == 0 else args.show
    print(f"Fayl: {path}")
    print(f"Xodim turlari: {sorted(types)}  |  Xodim paroli: {args.password}  |  Talaba paroli: (bo'sh — online-test)")

    db = SessionLocal()
    try:
        if not args.skip_staff:
            rows = as_dicts(read_sheet_rows(path, STAFF_SHEET))
            print(f"\n=== {STAFF_SHEET}: {len(rows)} qator ===")
            _report("Xodimlar", import_staff(
                db, rows, types=types, skip_fired=not args.keep_fired,
                password=args.password, apply=args.apply, limit=limit,
            ))
        if not args.skip_students:
            rows = as_dicts(read_sheet_rows(path, STUDENT_SHEET))
            print(f"\n=== {STUDENT_SHEET}: {len(rows)} qator ===")
            _report("Talabalar", import_students(db, rows, apply=args.apply, limit=limit))

        if args.apply:
            db.commit()
            print("\nBazaga yozildi.")
        else:
            db.rollback()
            print("\nDRY-RUN — bazaga hech narsa yozilmadi. Yozish uchun --apply bering.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
