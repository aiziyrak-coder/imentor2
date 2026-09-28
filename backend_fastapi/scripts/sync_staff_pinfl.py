"""cam.fermi.uz xodimlari JSHSHIRini iMentor hisoblariga bog'lash (JSHSHIR bilan kirish uchun).

Kirish (stdin): har qatorda TAB bilan ajratilgan `id, full_name, position, pinfl`.
Serverdagi `deploy/face/pinfl-sync.sh` cam.fermi.uz bazasidan FAQAT O'QIB shu formatda uzatadi.
Parollarga tegilmaydi.

Himoya: kelgan JSHSHIRlar soni hozirgi faol yozuvlarning yarmidan kam bo'lsa hech narsa
o'zgartirilmaydi (cam.fermi.uz bo'sh javob bergan bo'lishi mumkin). `--force` — himoyasiz,
`--dry-run` — faqat ko'rsatadi.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "/app")

from sqlalchemy import func, select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.staff_pinfl import StaffPinfl  # noqa: E402
from app.services import staff_pinfl as sp  # noqa: E402


def main() -> int:
    force = "--force" in sys.argv
    dry_run = "--dry-run" in sys.argv
    rows = []
    for line in sys.stdin.read().splitlines():
        parts = line.split("\t")
        if len(parts) != 4:
            continue
        rows.append({"id": parts[0], "full_name": parts[1], "position": parts[2], "pinfl": parts[3]})
    db = SessionLocal()
    try:
        active = db.execute(select(func.count()).select_from(StaffPinfl).where(StaffPinfl.is_active.is_(True))).scalar() or 0
        valid = len({r["pinfl"].strip() for r in rows if sp.is_pinfl(r["pinfl"].strip())})
        if not force and active and valid < active * 0.5:
            print(f"TO'XTATILDI: {valid} ta JSHSHIR keldi, bazada {active} ta faol. Hech narsa o'zgarmadi.")
            return 2
        result = sp.sync_pinfl(db, rows, dry_run=dry_run)
        print(
            f"{'SINOV (saqlanmadi)' if dry_run else 'OK'} keldi={result.received} yangi={result.created} "
            f"yuz/admin={result.linked_face} ism={result.linked_name} bog'lanmagan={result.unlinked} "
            f"o'chdi={result.deactivated} o'zgargan_bog'lanish={len(result.changed_links)}"
        )
        if dry_run:
            for full_name, old, new in result.changed_links:
                print(f"  {full_name}: {old or '-'} -> {new or '-'}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
