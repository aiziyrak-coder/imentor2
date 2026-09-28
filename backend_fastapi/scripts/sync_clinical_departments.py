"""Klinik kafedralar bayrog'ini institut hujjati bo'yicha qo'yadi.

    python scripts/sync_clinical_departments.py --dry-run

Ro'yxat: `app/data/clinical_departments.json`. Kafedra NOMI o'zgarmaydi —
faqat `is_clinical` bayrog'i yoziladi. AI keys/test/taqdimot shu bayroqqa
qarab klinik yoki klinik emas deb yaratiladi.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import clinical_departments  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        stats = clinical_departments.sync(db, dry_run=args.dry_run)
    finally:
        db.close()

    missing = stats.pop("royxatda_topilmadi", [])
    print(" ".join(f"{k}: {v}" for k, v in stats.items()), "DRY-RUN" if args.dry_run else "SAQLANDI")
    if missing:
        print(f"bazada topilmadi ({len(missing)}): " + "; ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
