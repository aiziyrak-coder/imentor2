"""HEMIS talabalar kontingentini iMentor'ga ko'chirish.

    python scripts/sync_hemis_students.py --dry-run
    python scripts/sync_hemis_students.py

Qo'lda kiritilgan yozuvlarga tegilmaydi; HEMIS'dan chiqib ketgan talaba
o'chirilmaydi, faqat "inactive" bo'ladi.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import hemis_client, hemis_students  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not hemis_client.configured():
        print("HEMIS_API_URL / HEMIS_API_TOKEN sozlanmagan (.env) — to'xtatildi")
        return 2

    db = SessionLocal()
    try:
        stats = hemis_students.sync(db)
        for key, value in stats.items():
            print(f"  {key}: {value}")
        if args.dry_run:
            db.rollback()
            print("SINOV (saqlanmadi)")
        else:
            db.commit()
            print("SAQLANDI")
        return 0
    except hemis_client.HemisError as exc:
        db.rollback()
        print(f"HEMIS xatosi: {exc}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
