"""HEMIS dars jadvalini monitor bandligiga ko'chirish.

    python scripts/sync_hemis_schedule.py --dry-run
    python scripts/sync_hemis_schedule.py --weeks 2

Sukut bo'yicha joriy hafta va keyingi hafta olinadi (jadval o'zgarganda keyingi
hafta ham darhol to'g'rilansin). Faqat `source_file='hemis'` yozuvlar
almashtiriladi — kafedralar Excel'iga tegilmaydi.
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
    ap.add_argument("--weeks", type=int, default=2, help="joriy haftadan boshlab nechta hafta")
    ap.add_argument("--year", default="", help="o'quv yili kodi (masalan 2026); bo'sh — hammasi")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not hemis_client.configured():
        print("HEMIS_API_URL / HEMIS_API_TOKEN sozlanmagan (.env) — to'xtatildi")
        return 2

    today = dt.date.today()
    start = today - dt.timedelta(days=today.weekday())
    end = start + dt.timedelta(days=7 * max(1, args.weeks) - 1)

    db = SessionLocal()
    try:
        stats = hemis_schedule.sync(db, start=start, end=end, education_year=args.year)
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
