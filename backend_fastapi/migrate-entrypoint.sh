#!/usr/bin/env sh
set -e

MEDIA_DIR="${DJANGO_MEDIA_ROOT:-/app/media}"
mkdir -p "$MEDIA_DIR"

alembic upgrade head

# HNSW qidiruv kengligi.
#
# pgvector avval indeksdan `ef_search` ta eng yaqin nomzodni oladi va FAQAT
# keyin `WHERE department_id = ...` filtrini qo'llaydi. Kafedra korpusning
# ~15 foizini tashkil qilgani uchun standart 40 qiymatda 10 ta parcha
# so'ralganda amalda 13 tagina nomzod qolar va ular kafedra bo'yicha
# HAQIQIY eng yaqinlari bo'lmasdi. 200 da to'liq 30 nomzod qaytadi.
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
    conn.execute(f'ALTER DATABASE "{name}" SET hnsw.ef_search = 200')
print(f"hnsw.ef_search = 200 ({name})")
PY
