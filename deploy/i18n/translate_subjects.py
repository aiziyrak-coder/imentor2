"""Fan NOMLARINI ru/en ga o'giradi.

`ensure_syllabus_translations` dan farqi: u nom bilan birga BARCHA mavzu
sarlavhalarini ham tarjima qiladi (480 fan x ~30 mavzu = o'n minglab satr).
fermi.uz ga esa faqat fan nomi kerak, shuning uchun bu skript nomlar bilan
cheklanadi va ancha arzon tushadi.

Nomlar 40 tadan bo'lib yuboriladi: bitta so'rovga 480 tasini sig'dirsa,
model ro'yxatning oxirini qisqartirib yuborishi mumkin va uzunlik mos
kelmagani uchun butun to'plam bekor bo'lardi.

Idempotent: tarjimasi bor fan qayta so'ralmaydi.
"""

import json
import sys

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.content import CourseSyllabus
from app.services import openai_client as oai
from sqlalchemy import select

LANG_NAMES = {"ru": "Russian", "en": "English"}
BATCH = 40


def translate_batch(names: list[str], target: str) -> list[str] | None:
    raw = oai.generate_openai_chat(
        get_settings().openai_api_key,
        messages=[
            {
                "role": "system",
                "content": (
                    "You translate MEDICAL UNIVERSITY SUBJECT names. "
                    f"Translate into {LANG_NAMES[target]}. "
                    "Keep medical terminology accurate. "
                    "Keep course codes, semester markers, years and abbreviations "
                    "(DI, TPI, PI, BM, 8-s, 2020-2021, ...) EXACTLY as they are. "
                    "Do NOT add explanations. "
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
        return None
    return [str(v).strip() for v in arr]


def main() -> int:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True))
        ).scalars().all()
        print(f"faol fanlar: {len(rows)}")

        for target in ("ru", "en"):
            pending = [r for r in rows if not (r.name_i18n or {}).get(target)]
            print(f"{target}: tarjima kerak — {len(pending)} ta", flush=True)
            done = failed = 0
            for start in range(0, len(pending), BATCH):
                chunk = pending[start : start + BATCH]
                translated = translate_batch([r.subject_name for r in chunk], target)
                if translated is None:
                    failed += len(chunk)
                    continue
                for row, value in zip(chunk, translated):
                    if not value or value == row.subject_name:
                        continue
                    current = dict(row.name_i18n or {})
                    current[target] = value
                    row.name_i18n = current
                    db.add(row)
                    done += 1
                db.commit()
                print(f"  {start + len(chunk)}/{len(pending)}", flush=True)
            print(f"{target}: saqlandi {done}, muvaffaqiyatsiz {failed}", flush=True)

        ok = sum(1 for r in rows if (r.name_i18n or {}).get("ru") and (r.name_i18n or {}).get("en"))
        print(f"natija: {ok}/{len(rows)} fan ikkala tilda")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
