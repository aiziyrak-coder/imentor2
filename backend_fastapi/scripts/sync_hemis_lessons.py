"""HEMIS dars jadvalining TO'LIQ nusxasini olish (monitorsiz xonalar ham).

    python scripts/sync_hemis_lessons.py --dry-run --weeks 4
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import hemis_client, hemis_schedule  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=6, help="joriy haftadan boshlab nechta hafta")
    ap.add_argument("--back-weeks", type=int, default=4, help="nechta o'tgan hafta ham olinsin")
    ap.add_argument("--year", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not hemis_client.configured():
        print("HEMIS_API_URL / HEMIS_API_TOKEN sozlanmagan (.env) — to'xtatildi")
        return 2

    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    start = monday - dt.timedelta(weeks=max(0, args.back_weeks))
    end = monday + dt.timedelta(days=7 * max(1, args.weeks) - 1)

    db = SessionLocal()
    try:
        stats = hemis_schedule.sync_lessons(db, start=start, end=end, education_year=args.year)
        print(f"  oraliq: {start}…{end}")
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
