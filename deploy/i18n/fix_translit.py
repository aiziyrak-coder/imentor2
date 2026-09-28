"""Ruscha katakdagi o'zbek transliteratsiyasini topib, qayta tarjima qiladi.

`looks_wrong_language` aralash matnni o'tkazib yuboradi: "Даволаш иши
2021-2022 (Хориджий) 9-семестр Анестезиология, реаниматология" ichida
haqiqiy ruscha so'zlar ham bor, shuning uchun u "ruscha" deb sanaladi.
Shu sababli o'zbekcha so'zlarning kirillcha yozuvi bo'yicha ANIQ
qidiriladi.
"""
import json, re
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.content import CourseSyllabus
from app.services import openai_client as oai
from sqlalchemy import select

# Kirillda yozilgan o'zbekcha so'zlar — ruscha matnda uchramaydi.
MARKERS = [
    "иши", "Хориджий", "Миллий", "Даволаш", "Олий", "хамширалик", "ҳамширалик",
    "табобати", "Йўналиш", "йўналиш", "Тиббиёт", "тиббиёт", "муҳандислиги",
    "муxандислиги", "Халқ", "халқ", "фаолияти", "хавфсизлиги", "кириш",
    "семестр Тиббий", "иши ",
]
PAT = re.compile("|".join(re.escape(m) for m in MARKERS))

PROMPT = (
    "You translate MEDICAL UNIVERSITY SUBJECT names from Uzbek into Russian. "
    "CRITICAL: TRANSLATE every Uzbek word into real Russian. NEVER transliterate "
    "Uzbek words into Cyrillic. WRONG: 'Даволаш иши', 'Хориджий', 'Миллий', "
    "'Олий хамширалик иши', 'Халқ табобати'. "
    "CORRECT: 'Лечебное дело', 'Иностранный', 'Национальный', "
    "'Высшее сестринское дело', 'Народная медицина'. "
    "Keep course codes, semesters, years and abbreviations (DI, TPI, PI, BM, 8-s, "
    "2021-2022) exactly as they are. "
    'Input is a JSON array of strings. Return ONLY {"items": [...]} with the SAME '
    "length and SAME order."
)

db = SessionLocal()
rows = db.execute(select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True))).scalars().all()
bad = [r for r in rows if PAT.search(str((r.name_i18n or {}).get("ru") or ""))]
print("transliteratsiyaga o'xshagan ruscha tarjimalar:", len(bad))
for r in bad[:12]:
    print("  #%s %s" % (r.id, str(r.name_i18n["ru"])[:75]))

BATCH = 30
fixed = rejected = 0
for start in range(0, len(bad), BATCH):
    chunk = bad[start : start + BATCH]
    raw = oai.generate_openai_chat(
        get_settings().openai_api_key,
        messages=[{"role": "system", "content": PROMPT},
                  {"role": "user", "content": json.dumps([r.subject_name for r in chunk], ensure_ascii=False)}],
        model="gpt-4.1-nano", max_tokens=6000, temperature=0.0, timeout_sec=240,
        response_format={"type": "json_object"},
    )
    arr = (json.loads(raw or "{}")).get("items")
    if not isinstance(arr, list) or len(arr) != len(chunk):
        print("  bo'lak %d: javob uzunligi mos emas" % start)
        continue
    for row, value in zip(chunk, arr):
        value = str(value).strip()
        current = dict(row.name_i18n or {})
        if not value or PAT.search(value):
            # Hali ham transliteratsiya — yomon qiymatni SAQLAMAYMIZ va
            # eskisini ham olib tashlaymiz, API rostini aytsin.
            current.pop("ru", None)
            rejected += 1
        else:
            current["ru"] = value
            fixed += 1
        row.name_i18n = current
        db.add(row)
    db.commit()

print("tuzatildi %d, tozalandi %d" % (fixed, rejected))
left = sum(1 for r in rows if PAT.search(str((r.name_i18n or {}).get("ru") or "")))
have_ru = sum(1 for r in rows if (r.name_i18n or {}).get("ru"))
print("qolgan transliteratsiya:", left)
print("ruschasi bor:", have_ru, "/", len(rows))
db.close()
