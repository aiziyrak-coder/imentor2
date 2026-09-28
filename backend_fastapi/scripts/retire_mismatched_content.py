"""Klinik bo'lmagan fanga bemor ssenariysi bilan yozilgan keys/testni belgilash.

    python scripts/retire_mismatched_content.py            # faqat ko'rsatadi
    python scripts/retire_mismatched_content.py --apply    # belgilaydi
    python scripts/retire_mismatched_content.py --undo --apply   # belgini olib tashlaydi

Hech narsa O'CHIRILMAYDI. Material katalogdan va "oxirgi saqlangan"
yuklanishidan chiqadi, o'qituvchining tarixida belgi bilan qoladi.
Oldin `sync_clinical_departments.py` ishlagan bo'lishi kerak.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, "/app")

from app.core.db import SessionLocal  # noqa: E402
from app.services import content_domain_audit as audit  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="haqiqatan yozish (aks holda faqat ko'rsatadi)")
    ap.add_argument("--undo", action="store_true", help="belgini olib tashlash")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        stats = audit.retire(db, dry_run=not args.apply, undo=args.undo)
    finally:
        db.close()

    mode = "SAQLANDI" if args.apply else "DRY-RUN"
    if args.undo:
        print(f"qaytarildi: {stats['qaytarildi']} {mode}")
        return 0
    print(f"belgilandi: {stats['belgilandi']} turi: {stats['turi']} {mode}")
    for name, n in list(stats["kafedralar"].items())[:15]:
        print(f"  {n:4}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
