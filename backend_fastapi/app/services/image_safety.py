"""Slayd rasmlarining odob tekshiruvi (2026-10-20).

O'qituvchilar taqdimotda odobsiz rasm chiqqanini aytdi. Rasmlar Wikimedia
Commons'dan qidiriladi, Commons'da esa yalang'och fotosuratlar ham bor
(masalan "Human body" maqolasining bosh rasmi). Nom va kategoriya bo'yicha
filtr brauzerda ishlaydi, lekin u rasmning O'ZINI ko'rmaydi — shuning uchun
slaydga tushadigan har rasm shu yerda OpenAI moderatsiyasidan o'tadi (bepul).

Chegara standartdan qattiqroq: `flagged` faqat ochiq-oydin rasmda yonadi,
klassik yalang'och rasm (Botticelli "Venera") 0.098 oladi va o'tib ketardi.
Sinov (2026-10-20): yalang'och foto 0.93, klassik yalang'och rasm 0.098,
klinik rasmlar (teri toshmasi, UZI, ko'krak bilan emizish) 0.07 dan past.
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor

from app.services import openai_client as oai

logger = logging.getLogger("imentor.image_safety")

MODERATION_URL = "https://api.openai.com/v1/moderations"
MODERATION_MODEL = "omni-moderation-latest"
SEXUAL_LIMIT = float(os.environ.get("IMENTOR_IMAGE_SEXUAL_LIMIT") or 0.08)
MAX_IMAGES = 8


def verdict(result: dict) -> tuple[bool, float]:
    """(xavfsizmi, jinsiy baho) — moderatsiya javobining bitta natijasidan."""
    cats = result.get("categories") or {}
    scores = result.get("category_scores") or {}
    sexual = max(float(scores.get("sexual") or 0), float(scores.get("sexual/minors") or 0))
    unsafe = bool(cats.get("sexual") or cats.get("sexual/minors")) or sexual >= SEXUAL_LIMIT
    return not unsafe, sexual


def check_image(api_key: str, data_url: str) -> dict:
    """Bitta rasm. Tekshirib bo'lmasa — xavfsiz EMAS (rasm qo'yilmaydi)."""
    try:
        resp = oai._http_post(
            api_key,
            {
                "model": MODERATION_MODEL,
                "input": [{"type": "image_url", "image_url": {"url": data_url}}],
            },
            url=MODERATION_URL,
            timeout_sec=30,
        )
        result = (resp.get("results") or [None])[0]
        if not isinstance(result, dict):
            return {"safe": False, "sexual": None, "error": "javob bo'sh"}
        safe, sexual = verdict(result)
        return {"safe": safe, "sexual": round(sexual, 4)}
    except oai.OpenAiClientError as exc:
        logger.warning("image_safety: moderatsiya ishlamadi: %s", str(exc)[:200])
        return {"safe": False, "sexual": None, "error": "tekshirib bo'lmadi"}


def check_images(api_key: str, data_urls: list[str]) -> list[dict]:
    if len(data_urls) <= 1:
        return [check_image(api_key, u) for u in data_urls]
    with ThreadPoolExecutor(max_workers=min(4, len(data_urls))) as pool:
        return list(pool.map(lambda u: check_image(api_key, u), data_urls))
