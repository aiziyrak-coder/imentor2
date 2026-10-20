"""Yakuniy imtihon savollarining ekspert tekshiruvi (2026-10-20).

OnlineTest `generate-mcq` savollarni bitta so'rovda yozib, to'g'ridan-to'g'ri
imtihonga berardi. Lokal o'lchovda xato kalit va "ikki variant ham to'g'ri"
savollarni faqat alohida tekshiruv ushladi, kuchli tekshiruvchi (`gpt-5.4`)
esa zaif fanlarda ham yaroqli savollar ulushini 64% dan 78% ga chiqardi.

Tekshiruv iMentor testlaridagi `test_repair` bosqichi bilan bir xil
(`frontend/src/services/aiService.ts`): har savolga `ok`, `fix` yoki `drop`.
Model `exam_review` purpose orqali tanlanadi (`openai_client.model_for`).

Tekshiruv yiqilsa yoki javob buzuq bo'lsa savollar o'zgarishsiz qaytadi:
imtihon kuni test berilmay qolgandan ko'ra tekshiruvsiz test yaxshiroq.

Savollar 5 talik bo'laklarda PARALLEL tekshiriladi: nginx `/api/` ni 300 s
da uzadi, 20 savolni gpt-5.4 bitta so'rovda 2–3 daqiqa tekshiradi, bunga
yozish vaqti ham qo'shiladi.
"""
from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor

from app.services import openai_client as oai
from app.services.question_quality import ungradable_flaws

logger = logging.getLogger(__name__)

PURPOSE = "exam_review"
CHUNK_SIZE = 5
MAX_PARALLEL = 6


def _system_prompt(lang_name: str) -> str:
    return (
        "Siz tibbiyot imtihoni savollarini tekshiruvchi ekspertsiz. Har savolni mustaqil yeching, keyin tekshiring: "
        "(1) kalit haqiqatan YAGONA eng to'g'ri javobmi — guideline va standart darsliklarga ko'ra; "
        "(2) boshqa variant ham himoya qilinadimi; (3) stemdagi faktlar kalitga olib keladimi, kalit stemning o'zida "
        "aytilmaganmi; (4) variantlar bir xil turdami — hammasi tashxis YOKI hammasi dori YOKI hammasi tekshiruv/usul; "
        "(5) ikki variant bir xil ma'noda yoki bir xil so'zlarning boshqa tartibimi; (6) tibbiy xato yoki uydirma raqam "
        "bormi; (7) stemdagi bemor kalitdagi dorini allaqachon olmayaptimi; (8) teng darajada to'g'ri bo'lgan bir-birining "
        "o'rnini bosuvchi usul yoki dorilar orasidan stemda farqlovchi faktsiz tanlov emasmi. "
        "HAR savol uchun AVVAL `reason` yozing: kalit nega to'g'ri, har distraktorni stemdagi qaysi fakt rad etadi. "
        'verdict: "ok" — hammasi joyida; "fix" — tuzatsa bo\'ladi: TO\'LIQ tuzatilgan text, options (aynan 5 ta), '
        'correctIndex (0-4) va explanation yozing; "drop" — tuzatib bo\'lmaydi. Shubha bo\'lsa "ok" demang. '
        'JSON: {"reviews":[{"i":1,"reason":"","verdict":"ok|fix|drop","text":"","options":[],"correctIndex":0,'
        '"explanation":""}]}. "ok" bo\'lsa text/options/explanation ni BO\'SH qoldiring. '
        f"Til: {lang_name}."
    )


def _listing(questions: list[dict]) -> str:
    rows = []
    for n, q in enumerate(questions, start=1):
        opts = "\n".join(f"  {chr(65 + k)}) {o}" for k, o in enumerate(q["options"]))
        rows.append(f"{n}. {q['text']}\n{opts}\n  Kalit: {chr(65 + q['correctIndex'])}")
    return "\n\n".join(rows)


def _fixed(review: dict) -> dict | None:
    text = str(review.get("text") or "").strip()
    opts = review.get("options")
    if not text or not isinstance(opts, list) or len(opts) != 5:
        return None
    opts = [str(o).strip() for o in opts]
    try:
        ci = int(review.get("correctIndex"))
    except (TypeError, ValueError):
        return None
    if not 0 <= ci <= 4 or ungradable_flaws(opts):
        return None
    return {
        "text": text,
        "options": opts,
        "correctIndex": ci,
        "explanation": str(review.get("explanation") or "").strip(),
    }


def _review_chunk(api_key: str, questions: list[dict], user_head: str, lang_name: str, timeout_sec: int) -> dict[int, dict]:
    """Bo'lak tekshiruvi: savol indeksi (0 dan) → review. Xatoda bo'sh."""
    try:
        content = oai.generate_openai_chat(
            api_key,
            messages=[
                {"role": "system", "content": _system_prompt(lang_name)},
                {"role": "user", "content": f"{user_head}\n\n{_listing(questions)}"},
            ],
            model=oai.model_for(PURPOSE),
            max_tokens=len(questions) * 900 + 400,
            temperature=0,
            timeout_sec=timeout_sec,
            response_format={"type": "json_object"},
            usage_kind=PURPOSE,
        )
        parsed = json.loads(content)
    except (oai.OpenAiClientError, ValueError) as exc:
        logger.warning("EXAM_REVIEW_FAILED: %s", str(exc)[:200])
        return {}
    reviews = parsed.get("reviews") if isinstance(parsed, dict) else None
    by_index: dict[int, dict] = {}
    for r in reviews if isinstance(reviews, list) else []:
        if not isinstance(r, dict):
            continue
        try:
            i = int(r.get("i"))
        except (TypeError, ValueError):
            continue
        if 1 <= i <= len(questions):
            by_index[i - 1] = r
    return by_index


def review_exam_questions(
    api_key: str,
    questions: list[dict],
    *,
    subject: str,
    department: str,
    lang_name: str,
    timeout_sec: int = 240,
) -> list[dict]:
    """`{text, options[5], correctIndex, explanation}` ro'yxatini tekshiradi.

    `ok` — o'zgarishsiz, `fix` — tuzatilgani bilan almashtiriladi, `drop` va
    buzuq tuzatish — olib tashlanadi. Tekshiruvchi javob bermagan savol qoladi.
    """
    if not questions:
        return questions
    head = f"Kafedra: {department}\nFan: {subject}"
    starts = list(range(0, len(questions), CHUNK_SIZE))
    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL, len(starts))) as pool:
        parts = list(
            pool.map(
                lambda a: _review_chunk(api_key, questions[a : a + CHUNK_SIZE], head, lang_name, timeout_sec),
                starts,
            )
        )
    by_index = {a + i: r for a, part in zip(starts, parts) for i, r in part.items()}

    out: list[dict] = []
    fixed = dropped = 0
    for k, q in enumerate(questions):
        r = by_index.get(k)
        verdict = str((r or {}).get("verdict") or "ok").strip().lower()
        if verdict == "drop":
            dropped += 1
            continue
        if verdict == "fix":
            repaired = _fixed(r)
            if repaired is None:
                dropped += 1
                continue
            fixed += 1
            out.append({**q, **repaired})
            continue
        out.append(q)
    logger.info("EXAM_REVIEW total=%s reviewed=%s fixed=%s dropped=%s", len(questions), len(by_index), fixed, dropped)
    return out
