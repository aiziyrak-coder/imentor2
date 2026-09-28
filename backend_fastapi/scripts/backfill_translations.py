"""Mavjud keys va testlarning yetishmayotgan yoki yaroqsiz tarjimalarini to'ldirish.

    python scripts/backfill_translations.py --dry-run          # nechta yozuvga ish borligini ko'rsatadi
    python scripts/backfill_translations.py --workers 6         # bajarish
    python scripts/backfill_translations.py --kind case --limit 20

Idempotent: yaroqli tarjimaga tegilmaydi, to'xtatib qayta ishga tushirish xavfsiz.
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent  # noqa: E402
from app.services import case_i18n  # noqa: E402


def needs_work(item: PreparedContent) -> bool:
    payload = item.payload if isinstance(item.payload, dict) else {}
    if not payload.get("questions"):
        return False
    return len(case_i18n.available_languages(payload)) < len(case_i18n.SUPPORTED_LANGS) or (
        case_i18n.primary_language(payload) in (payload.get("translations") or {})
    )


def run_one(pk: int) -> tuple[int, str]:
    db = SessionLocal()
    try:
        item = db.get(PreparedContent, pk)
        if item is None:
            return pk, "yo'q"
        changed = case_i18n.ensure_translations(db, item)
        if changed:
            db.commit()
        return pk, "+".join(case_i18n.available_languages(item.payload)) if changed else "o'zgarmadi"
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        return pk, f"xato: {exc}"
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--kind", choices=[KIND_CASE, KIND_TEST])
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    kinds = [args.kind] if args.kind else [KIND_CASE, KIND_TEST]
    with SessionLocal() as db:
        items = db.execute(
            select(PreparedContent).where(PreparedContent.kind.in_(kinds)).order_by(PreparedContent.created_at.desc())
        ).scalars().all()
        todo = [(i.id, i.kind) for i in items if needs_work(i)]
    if args.limit:
        todo = todo[: args.limit]
    print(f"Ish bor: {len(todo)} ta ({sum(1 for _, k in todo if k == KIND_CASE)} keys, {sum(1 for _, k in todo if k == KIND_TEST)} test)")
    if args.dry_run or not todo:
        return
    started = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        for fut in as_completed([pool.submit(run_one, pk) for pk, _ in todo]):
            pk, result = fut.result()
            done += 1
            print(f"[{done}/{len(todo)}] #{pk}: {result}  ({int(time.time() - started)} s)", flush=True)


if __name__ == "__main__":
    main()
