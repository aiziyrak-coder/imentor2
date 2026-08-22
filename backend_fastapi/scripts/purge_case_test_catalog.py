#!/usr/bin/env python3
"""Delete all case (keys) and test records from core_preparedcontent."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, func, select

from app.core.db import SessionLocal
from app.models.prepared_content import CATALOG_KINDS, PreparedContent


def main() -> None:
    parser = argparse.ArgumentParser(description="Purge all keys (case) and test catalog records.")
    parser.add_argument("--apply", action="store_true", help="Actually delete (default: dry-run only)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        counts = db.execute(
            select(PreparedContent.kind, func.count())
            .where(PreparedContent.kind.in_(CATALOG_KINDS))
            .group_by(PreparedContent.kind)
        ).all()
        total = sum(n for _, n in counts)
        print("before:", dict(counts), "total=", total)

        if not args.apply:
            print("dry-run — pass --apply to delete")
            return

        result = db.execute(delete(PreparedContent).where(PreparedContent.kind.in_(CATALOG_KINDS)))
        db.commit()
        print(f"deleted={result.rowcount}")

        after = db.execute(
            select(func.count()).select_from(PreparedContent).where(PreparedContent.kind.in_(CATALOG_KINDS))
        ).scalar_one()
        print("after total=", after)
    finally:
        db.close()


if __name__ == "__main__":
    main()
