"""LiveTestSubmission yozuvlaridan StudentTestAttempt arxivini to'ldirish.

  python scripts/backfill_student_test_attempts.py --dry-run
  python scripts/backfill_student_test_attempts.py --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.analytics import StudentTestAttempt
from app.models.live_test import LiveTestSubmission
from app.services.analytics_service import create_student_attempt_from_submission


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply = bool(args.apply) and not args.dry_run

    db = SessionLocal()
    try:
        subs = db.execute(select(LiveTestSubmission).order_by(LiveTestSubmission.id)).scalars().all()
        created = skipped = 0
        for sub in subs:
            exists = db.execute(
                select(StudentTestAttempt).where(
                    StudentTestAttempt.session_id == sub.session_id,
                    StudentTestAttempt.student_id == (sub.student_id or ""),
                )
            ).scalar_one_or_none()
            if exists:
                skipped += 1
                continue
            if apply:
                create_student_attempt_from_submission(db, session=sub.session, submission=sub)
                db.commit()
            created += 1
        print(f"subs={len(subs)} created={created} skipped={skipped} apply={apply}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
