"""Jonli test natijalari to'g'rimi — faqat O'QIYDI, faqat jami raqamlarni chiqaradi.

Ism, talaba ID, savol matni yoki sessiya kaliti chiqmaydi. Serverda:

    docker exec -i imentor-backend_fastapi-1 python - < scripts/check_live_test_results.py

Tekshiradi (berilgan vaqtdan keyin ochilgan sessiyalar, standart — 2026-10-16 06:10 UTC deploy):
  1. o'qituvchi jadvalidagi ball == sessiya kaliti bo'yicha qaytadan hisoblangan ball;
  2. har sessiyada kamida 10 savol va har savol kaliti yaroqli;
  3. to'g'ri javoblar harflar bo'yicha taqsimlanganmi (hammasi A emasmi);
  4. "hammasiga A" yoki "hammasiga B" belgilagan talaba yuqori ball olmaganmi.
"""

import collections
import datetime as dt
import os

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.live_test import LiveTestSession
from app.services import live_test_service as svc

SINCE = dt.datetime.fromisoformat(os.environ.get("SINCE", "2026-10-16T06:10:00+00:00"))
L = "ABCDE"

db = SessionLocal()
sessions = db.execute(select(LiveTestSession).where(LiveTestSession.created_at >= SINCE)).scalars().all()

mismatch = short = bad_key = skewed = subs_total = 0
key_letters = collections.Counter()
same_letter = []  # (javob harfi, ball %) — bir xil harf belgilaganlar
pct_buckets = collections.Counter()

for s in sessions:
    qs = svc.questions_of(s)
    if len(qs) < svc.MIN_LIVE_TEST_QUESTIONS:
        short += 1
    if svc.answer_key_problems(qs):
        bad_key += 1
    keys = [q.get("correctOptionIndex") for q in qs if isinstance(q, dict)]
    key_letters.update(L[k] for k in keys if isinstance(k, int) and 0 <= k < 5)
    if keys and max(collections.Counter(keys).values()) / len(keys) >= 0.7:
        skewed += 1
    for sub in s.submissions:
        subs_total += 1
        correct, total = svc.score_submission(qs, sub.answers)
        # Qo'lda qayta hisob — score_submission'ga tayanmasdan.
        manual = sum(1 for i, q in enumerate(qs) if i < len(sub.answers) and q.get("correctOptionIndex") == sub.answers[i])
        if manual != correct:
            mismatch += 1
        pct = round(100 * correct / total) if total else 0
        pct_buckets[min(pct // 20 * 20, 100)] += 1
        answered = [a for a in sub.answers if isinstance(a, int) and a >= 0]
        if len(answered) >= 8 and len(set(answered)) == 1:
            same_letter.append((L[answered[0]] if answered[0] < 5 else "?", pct))

print(f"Sessiyalar ({SINCE:%Y-%m-%d %H:%M} UTC dan): {len(sessions)}")
print(f"Topshiriqlar: {subs_total}")
print(f"1. Ko'rsatilgan ball != kalit bo'yicha hisob: {mismatch}")
print(f"2. 10 tadan kam savolli sessiya: {short} | kaliti yaroqsiz sessiya: {bad_key}")
total_keys = sum(key_letters.values()) or 1
print("3. To'g'ri javob harflari: " + ", ".join(f"{k}={100 * key_letters[k] // total_keys}%" for k in L))
print(f"   Kaliti 70%+ bitta harfda bo'lgan sessiya: {skewed}")
print(f"4. Hammasiga bir harf belgilaganlar: {len(same_letter)}; ularning ballari (%): "
      + ", ".join(f"{h}:{p}" for h, p in same_letter[:20]))
print("Ball taqsimoti (%): " + ", ".join(f"{b}-{min(b + 19, 100)}: {pct_buckets[b]}" for b in sorted(pct_buckets)))
