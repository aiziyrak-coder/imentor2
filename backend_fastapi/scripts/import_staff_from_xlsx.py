"""Professor-o'qituvchilar ro'yxatini (.xlsx) bazaga ommaviy qo'shadi.

Kutilgan ustunlar (sarlavha nomi bo'yicha topiladi, tartibi muhim emas):

    Xodim ID | Kafedra / Bo'lim | Ismi | Familiya | Otasining ismi | Telefon

Har bir qator uchun:
  * `auth_user` yozuvi — LOGIN sifatida **Xodim ID** ishlatiladi (`username`),
    parol standart `fjsti123` (`--password` bilan o'zgartiriladi);
  * rol — `hodim`;
  * `core_staffprofile` — kafedra nomi bo'yicha bog'lanadi (mavjud kafedra
    topilmasa, nomi matn sifatida yoziladi).

Skript IDEMPOTENT: qayta ishga tushirilsa mavjud xodimlar qayta
yaratilmaydi. Parolni ham yangilash uchun `--reset-password` bering.

    # 1) Avval nima bo'lishini ko'rish (bazaga tegmaydi)
    docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \\
      run --rm -v "$PWD/data:/data" backend_fastapi \\
      python scripts/import_staff_from_xlsx.py --file "/data/Professor-o'qituvchi (2).xlsx" --dry-run

    # 2) Haqiqiy import
    docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \\
      run --rm -v "$PWD/data:/data" backend_fastapi \\
      python scripts/import_staff_from_xlsx.py --file "/data/Professor-o'qituvchi (2).xlsx" --apply

Eslatma: .xlsx faylini o'qish uchun tashqi kutubxona ishlatilmaydi (xlsx —
oddiy zip+XML), shuning uchun backend obrazini qayta qurish shart emas.
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
from app.core.security import hash_password  # noqa: E402
from app.models.staff_location import StaffProfile  # noqa: E402
from app.services import auth_service  # noqa: E402
from app.services import staff_department as staff_dept  # noqa: E402

DEFAULT_PASSWORD = "fjsti123"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Sarlavha nomlari — kichik harfga keltirilgan holda taqqoslanadi.
COLUMN_ALIASES = {
    "staff_id": ("xodim id", "xodim_id", "id", "hodim id"),
    "department": ("kafedra / bo'lim", "kafedra / bo‘lim", "kafedra", "bo'lim", "bolim"),
    "first_name": ("ismi", "ism", "first name"),
    "last_name": ("familiya", "familiyasi", "last name"),
    "middle_name": ("otasining ismi", "sharifi", "otchestvo"),
    "phone": ("telefon", "telefon raqami", "phone"),
}


# ---------------------------------------------------------------- xlsx o'qish

def _col_index(ref: str) -> int:
    """"C7" -> 2 (0-based ustun raqami)."""
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def read_xlsx_rows(path: Path) -> list[list[str]]:
    """Birinchi varaqni qatorlar ro'yxati sifatida qaytaradi (faqat matn)."""
    with zipfile.ZipFile(path) as zf:
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
                cells[idx] = (value or "").strip()
            if not cells:
                continue
            width = max(cells) + 1
            rows.append([cells.get(i, "") for i in range(width)])
        return rows


def map_columns(header: list[str]) -> dict[str, int]:
    lowered = [(h or "").strip().lower() for h in header]
    mapping: dict[str, int] = {}
    for field, aliases in COLUMN_ALIASES.items():
        for i, cell in enumerate(lowered):
            if cell in aliases:
                mapping[field] = i
                break
    return mapping


# ---------------------------------------------------------------- normalizatsiya

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


def clean_staff_id(value: str) -> str:
    """Login normalizatsiyasi bilan bir xil bo'lishi shart (`app.core.staff_login`)."""
    return "".join(ch for ch in (value or "") if ch.isalnum()).upper()


# ---------------------------------------------------------------- import

def import_rows(rows: list[list[str]], *, password: str, reset_password: bool, apply: bool) -> None:
    if not rows:
        print("Fayl bo'sh.")
        return

    cols = map_columns(rows[0])
    missing = [f for f in ("staff_id", "first_name", "last_name") if f not in cols]
    if missing:
        print(f"XATO: ustun(lar) topilmadi: {missing}. Sarlavha: {rows[0]}")
        sys.exit(1)

    def cell(row: list[str], field: str) -> str:
        i = cols.get(field)
        return row[i].strip() if i is not None and i < len(row) else ""

    stats = Counter()
    seen_ids: set[str] = set()
    unmatched_depts: Counter[str] = Counter()
    db = SessionLocal()
    try:
        for line_no, row in enumerate(rows[1:], start=2):
            staff_id = clean_staff_id(cell(row, "staff_id"))
            first_name = title_case(cell(row, "first_name"))
            last_name = title_case(cell(row, "last_name"))
            department = cell(row, "department")

            if not staff_id:
                stats["skipped_no_id"] += 1
                print(f"  [{line_no}] o'tkazib yuborildi — Xodim ID yo'q")
                continue
            if staff_id in seen_ids:
                stats["skipped_duplicate"] += 1
                continue
            seen_ids.add(staff_id)

            user = auth_service.get_user_by_username(db, staff_id)
            created = user is None
            dept_obj = staff_dept.resolve_department(db, department_name=department) if department else None
            if department and dept_obj is None:
                stats["unmatched_dept"] += 1
                unmatched_depts[department] += 1
            elif dept_obj is not None:
                stats["linked_dept"] += 1

            if apply:
                if created:
                    user = auth_service.create_user(db, staff_id, password, first_name, last_name)
                else:
                    user.first_name = first_name or user.first_name
                    user.last_name = last_name or user.last_name
                    if reset_password:
                        user.password = hash_password(password)
                auth_service.set_user_role_group(db, user, "hodim")

                profile = db.execute(
                    select(StaffProfile).where(StaffProfile.owner_key == staff_id)
                ).scalar_one_or_none()
                if profile is None:
                    profile = StaffProfile(
                        owner_key=staff_id,
                        updated_at=dt.datetime.now(dt.timezone.utc),
                    )
                    db.add(profile)
                    db.flush()
                if department:
                    staff_dept.apply_staff_department(db, profile, department_name=department)
                profile.updated_at = dt.datetime.now(dt.timezone.utc)

            stats["created" if created else "updated"] += 1
            if created or dept_obj is None:
                action = "YARATILADI" if created else ("PAROL YANGILANADI" if reset_password else "mavjud")
                mapped = dept_obj.name if dept_obj else "KAFEDRA MOS KELMADI"
                print(f"  [{line_no}] {staff_id}  {last_name} {first_name}  · {department or '—'}  → {action} / {mapped}")

        if apply:
            db.commit()
        else:
            db.rollback()
    finally:
        db.close()

    print()
    print(f"Jami qator      : {len(rows) - 1}")
    print(f"Noyob Xodim ID  : {len(seen_ids)}")
    print(f"Yangi xodim     : {stats['created']}")
    print(f"Mavjud xodim    : {stats['updated']}")
    print(f"Kafedra bog'landi: {stats['linked_dept']}")
    print(f"Kafedra topilmadi: {stats['unmatched_dept']}")
    print(f"ID yo'q         : {stats['skipped_no_id']}")
    print(f"Takroriy ID     : {stats['skipped_duplicate']}")
    if unmatched_depts:
        print("Mos kelmagan kafedra nomlari:")
        for name, n in unmatched_depts.most_common():
            print(f"  {n:4d}  {name}")
    print()
    if apply:
        print("Bazaga yozildi.")
    else:
        print("DRY-RUN — bazaga hech narsa yozilmadi. Yozish uchun --apply bering.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="Xodimlar ro'yxati (.xlsx)")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help=f"Standart parol (default: {DEFAULT_PASSWORD})")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Mavjud xodimlarning parolini ham standart parolga qaytarish",
    )
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

    rows = read_xlsx_rows(path)
    print(f"Fayl: {path}  ({len(rows) - 1} ta qator)")
    print(f"Parol: {args.password}  |  Rol: hodim  |  Login: Xodim ID")
    print()
    import_rows(rows, password=args.password, reset_password=args.reset_password, apply=args.apply)


if __name__ == "__main__":
    main()
