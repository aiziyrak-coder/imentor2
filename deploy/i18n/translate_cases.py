"""Mavjud klinik keyslarni ru/en ga o'giradi.

Yangi keyslar brauzerda yaratilganda uchala tilni birdan oladi, lekin
bazadagi eskilarida `translations` yo'q. Bu skript o'shalarni to'ldiradi.

`ensure_case_translations` idempotent — skriptni qayta ishga tushirish
xavfsiz va yarim tugagan ish davom etadi.
"""

import json
import sys

from app.core.db import SessionLocal
from app.models.prepared_content import KIND_CASE, PreparedContent
from app.services.case_i18n import available_languages, ensure_case_translations
from sqlalchemy import select


def main() -> int:
    db = SessionLocal()
    try:
        items = db.execute(
            select(PreparedContent).where(PreparedContent.kind == KIND_CASE)
        ).scalars().all()
        print(f"keyslar: {len(items)}")

        changed = skipped = 0
        for item in items:
            before = available_languages(item.payload)
            if len(before) >= 3:
                skipped += 1
                continue
            questions = (item.payload or {}).get("questions")
            n = len(questions) if isinstance(questions, list) else 0
            print(f"  #{item.id} ({n} savol) {before} ...", end=" ", flush=True)
            if ensure_case_translations(db, item):
                db.commit()
                changed += 1
                print(available_languages(item.payload), flush=True)
            else:
                print("o'zgarmadi", flush=True)

        print(f"tarjima qilindi: {changed}, allaqachon tayyor: {skipped}")

        done = sum(1 for i in items if len(available_languages(i.payload)) >= 3)
        print(f"natija: {done}/{len(items)} keys uch tilda")

        sample = next((i for i in items if len(available_languages(i.payload)) >= 3), None)
        if sample:
            tr = (sample.payload or {}).get("translations") or {}
            ru = ((tr.get("ru") or {}).get("questions") or [{}])[0]
            print("namuna (ru):", json.dumps(str(ru.get("scenario") or "")[:150], ensure_ascii=False))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
