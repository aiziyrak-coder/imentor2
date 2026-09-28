#!/usr/bin/env sh
set -e

MEDIA_DIR="${DJANGO_MEDIA_ROOT:-/app/media}"
mkdir -p "$MEDIA_DIR"

alembic upgrade head

# HNSW qidiruv kengligi.
#
# pgvector avval indeksdan `ef_search` ta eng yaqin nomzodni oladi va FAQAT
# keyin filtrlarni qo'llaydi. Ikkita filtr bor: kafedra (korpusning ~15%) va
# parcha uzunligi (bo'sh OCR yozuvlari tashlanadi). Standart 40 da 10 ta
# parcha so'ralganda amalda 4 tasi qolar va ular jami 127 belgi edi —
# ya'ni AI deyarli darsliksiz yozardi. 800 da to'liq 30 nomzod keladi va
# ulardan 10 ta noyob parcha (~9-12 ming belgi) tanlanadi.
#
# Sozlama bazada saqlanadi, shuning uchun bu buyruq qayta ishga tushirishda
# zararsiz takrorlanadi — lekin baza noldan qurilsa yo'qolmasligi uchun shu
# yerda turadi.
python - <<'PY'
import re

from app.core.config import get_settings

s = get_settings()
name = s.django_db_name
if not re.fullmatch(r"[A-Za-z0-9_]+", name or ""):
    raise SystemExit(f"baza nomi kutilmagan ko'rinishda: {name!r}")

import psycopg

dsn = (
    f"postgresql://{s.django_db_user}:{s.django_db_password}"
    f"@{s.django_db_host}:{s.django_db_port}/{name}"
)
with psycopg.connect(dsn, autocommit=True) as conn:
    conn.execute(f'ALTER DATABASE "{name}" SET hnsw.ef_search = 800')
print(f"hnsw.ef_search = 800 ({name})")
PY
