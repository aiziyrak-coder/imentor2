"""Kafedra nomlarini ru/en ga o'giradi.

Kafedralar soni oz (~40) va nomlari qisqa, shuning uchun hammasi BITTA
so'rovda ketadi. Idempotent: tarjimasi bor kafedra qayta so'ralmaydi,
ya'ni skriptni qayta ishga tushirish xavfsiz.
"""

import json
import sys

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.content import AcademicDepartment
from app.services import openai_client as oai
from sqlalchemy import select

LANG_NAMES = {"ru": "Russian", "en": "English"}


def translate_all(names: list[str], target: str) -> list[str] | None:
    raw = oai.generate_openai_chat(
        get_settings().openai_api_key,
        messages=[
            {
                "role": "system",
                "content": (
                    "You translate MEDICAL UNIVERSITY DEPARTMENT names. "
                    f"Translate into {LANG_NAMES[target]}. "
                    "Use the standard academic naming used by medical universities "
                    "(e.g. 'Kafedra ...' / 'Department of ...'). "
                    "Keep medical and Latin terms accurate. Do NOT add explanations. "
                    'Input is a JSON array of strings. Return ONLY {"items": [...]} '
                    "with the SAME length and SAME order as the input."
                ),
            },
            {"role": "user", "content": json.dumps(names, ensure_ascii=False)},
        ],
        model=get_settings().openai_fast_model,
        max_tokens=8000,
        temperature=0.1,
        timeout_sec=240,
        response_format={"type": "json_object"},
    )
    arr = (json.loads(raw or "{}")).get("items")
    if not isinstance(arr, list) or len(arr) != len(names):
        print(f"  {target}: kutilgan {len(names)}, kelgani {len(arr) if isinstance(arr, list) else '—'}")
        return None
    return [str(v).strip() for v in arr]


def main() -> int:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(AcademicDepartment).where(AcademicDepartment.is_active.is_(True))
        ).scalars().all()
        print(f"faol kafedralar: {len(rows)}")

        for target in ("ru", "en"):
            pending = [r for r in rows if not (r.name_i18n or {}).get(target)]
            print(f"{target}: tarjima kerak — {len(pending)} ta")
            if not pending:
                continue
            translated = translate_all([r.name for r in pending], target)
            if translated is None:
                print(f"  {target}: o'tkazib yuborildi")
                continue
            for row, value in zip(pending, translated):
                if not value or value == row.name:
                    continue
                current = dict(row.name_i18n or {})
                current[target] = value
                # JSONB ustunini butunlay almashtirish shart — ichki lug'atni
                # o'zgartirish SQLAlchemy tomonidan sezilmaydi.
                row.name_i18n = current
                db.add(row)
            db.commit()
            print(f"  {target}: saqlandi")

        done = sum(1 for r in rows if (r.name_i18n or {}).get("ru") and (r.name_i18n or {}).get("en"))
        print(f"natija: {done}/{len(rows)} kafedra ikkala tilda")
        for r in rows[:3]:
            print(f"  {r.name} -> {json.dumps(r.name_i18n or {}, ensure_ascii=False)}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
