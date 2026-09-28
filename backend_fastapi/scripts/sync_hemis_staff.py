"""Xodim profilini HEMIS'dan to'ldirish: bo'sh kafedra, bo'sh lavozim, ish holati.

    python scripts/sync_hemis_staff.py --dry-run

Faqat BO'SH maydon to'ldiriladi; ish holati (ishlamoqda / ta'tilda / bo'shagan)
har safar yangilanadi. HEMIS'ga hech narsa yozilmaydi.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import hemis_client, hemis_schedule, hemis_staff  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not hemis_client.configured():
        print("HEMIS_API_URL / HEMIS_API_TOKEN sozlanmagan (.env) - to'xtatildi")
        return 2
    people = hemis_client.teachers()
    db = SessionLocal()
    try:
        link = hemis_schedule.teacher_map(db, people)
        stats = hemis_staff.sync(db, people, link, dry_run=args.dry_run)
    finally:
        db.close()
    left = stats.pop("boshagan_faol_hisob")
    print(" ".join(f"{k}: {v}" for k, v in stats.items()), f"boshagan_faol_hisob: {len(left)}",
          "DRY-RUN" if args.dry_run else "SAQLANDI")
    if left:
        print("ishdan ketgan, hisobi hali ochiq:", ", ".join(sorted(left)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
