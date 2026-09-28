"""Sillabus tarjimalaridagi ikkilangan tutuq belgisini tuzatadi (2026-09-26).

    python scripts/fix_doubled_apostrophes.py            # faqat ko'rsatadi
    python scripts/fix_doubled_apostrophes.py --apply

AI tarjimasi ba'zan "Yallig''lanish" deb yozardi (12 650 tadan 30 tasi).
Yangi tarjimalar `syllabus_i18n` da allaqachon tozalanadi — bu eskilari uchun.
Faqat so'z ichidagi `''` tegiladi, asl (manba) sarlavhalarga tegilmaydi.
"""

from __future__ import annotations

import argparse
import sys

sys.path.insert(0, "/app")

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.content import CourseSyllabus  # noqa: E402
from app.services.syllabus_i18n import fix_doubled_apostrophes  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    fixed_values = fixed_rows = 0
    with SessionLocal() as db:
        for syl in db.execute(select(CourseSyllabus)).scalars():
            topics = {lang: dict(m or {}) for lang, m in (syl.topics_i18n or {}).items()}
            names = dict(syl.name_i18n or {})
            changed = False
            for mapping in topics.values():
                for key, value in mapping.items():
                    new = fix_doubled_apostrophes(str(value))
                    if new != value:
                        mapping[key] = new
                        fixed_values += 1
                        changed = True
            for lang, value in names.items():
                new = fix_doubled_apostrophes(str(value))
                if new != value:
                    names[lang] = new
                    fixed_values += 1
                    changed = True
            if changed:
                fixed_rows += 1
                if args.apply:
                    syl.topics_i18n = topics
                    syl.name_i18n = names
        if args.apply:
            db.commit()
    print(f"tuzatilgan qiymat: {fixed_values}, sillabus: {fixed_rows}", "SAQLANDI" if args.apply else "DRY-RUN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
