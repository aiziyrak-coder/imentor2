"""Harf-harf ajralib ketgan mavzu sarlavhalarini tiklash.

Ba'zi sillabus PDF'lari matn qatlamida har bir harfni alohida probel bilan
saqlaydi ("F i z i o l o g i y a"). Yuklash bosqichida bu frontend'dagi
`undoLetterTracking` bilan tuzatiladi (so'z chegaralari 2+ probel bo'lgani
uchun tiklanadi). Lekin BAZAGA allaqachon tushib bo'lgan yozuvlarda parser
probellarni siqib yuborgan — so'z chegarasi haqidagi ma'lumot yo'q.

Shuning uchun eski ma'lumot ikki bosqichda tiklanadi:

  1. Deterministik: ajralgan harflar yopishtiriladi
     ("b o s q i c h l a r i" -> "bosqichlari").
  2. So'zlar bir-biriga yopishib qolgan bo'lsa ("Hujayramembranasining"),
     ularni ajratish uchun AI ishlatiladi — bu bosqichda matnning MAZMUNI
     o'zgartirilmaydi, faqat probellar tiklanadi.

Yangi yuklanadigan sillabuslar uchun bu modul kerak emas — frontend'dagi
tuzatish yetarli.
"""

from __future__ import annotations

import json
import logging
import re

from app.services import openai_client as oai

logger = logging.getLogger(__name__)

_BATCH = 25


def looks_letter_tracked(text: str) -> bool:
    """Sarlavha harf-harf ajralgan holatdami?"""
    tokens = [t for t in (text or "").strip().split() if t]
    if len(tokens) < 6:
        return False
    singles = sum(1 for t in tokens if len(t) == 1)
    return singles / len(tokens) >= 0.5


# Kamida 5 ta 1-3 belgili bo'lak, BITTA probel bilan ajratilgan.
# So'z chegarasi (2+ probel) bu naqshni uzadi — demak yopishtirish faqat
# haqiqiy "ajralgan harflar" ketma-ketligi ustida bajariladi.
_TRACKED_RUN = re.compile(r"(?<!\S)((?:\S{1,3} ){4,}\S{1,3})(?!\S)")


def _should_glue(run: str) -> bool:
    tokens = run.split(" ")
    singles = sum(1 for t in tokens if len(t) == 1)
    if singles < len(tokens) * 0.4:
        return False
    # Ketma-ketlik asosan HARFLARDAN iborat bo'lishi shart. Bu shart
    # baholash jadvallaridagi qatorlarni ("5 -5 9 E" -> "5-59E") va
    # formula/raqam bloklarini chetlab o'tadi — ular mavzu nomi emas va
    # ularni yopishtirish faqat zarar keltiradi.
    letters = sum(1 for ch in run if ch.isalpha())
    non_space = sum(1 for ch in run if not ch.isspace())
    return non_space > 0 and letters / non_space >= 0.6


def collapse_tracking(text: str) -> str:
    """Ajralgan harflarni yopishtiradi.

    "b o s q i c h l a r i , t o n l a r i" -> "bosqichlari, tonlari"

    Faqat mos keladigan ketma-ketliklar almashtiriladi — matnning qolgan
    qismiga va probellariga TEGILMAYDI. Shu sababli bir sarlavhada sog'lom
    matn va buzuq matn aralash bo'lsa, sog'lom qismi o'zgarishsiz qoladi.
    """
    if not text:
        return text

    def _replace(match: re.Match[str]) -> str:
        run = match.group(1)
        if not _should_glue(run):
            return run
        glued = run.replace(" ", "")
        # Tinish belgisidan keyin so'z chegarasi tiklanadi — harflar
        # yopishtirilgandan keyingi yagona ishonchli signal shu.
        return re.sub(r"([,.;:!?])(?=[^\s,.;:!?])", r"\1 ", glued)

    return _TRACKED_RUN.sub(_replace, text)


def _restore_words_batch(api_key: str, model: str, items: list[str]) -> dict[str, str]:
    """Yopishib qolgan so'zlarni AI yordamida ajratadi: {kirish: natija}."""
    if not items:
        return {}
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You repair OCR-damaged MEDICAL CURRICULUM topic titles. "
                        "The text is Uzbek (latin), Russian or English. Letter spacing has been "
                        "removed, so words are often stuck together "
                        "(e.g. 'Hujayramembranasiningtuzilishi' -> 'Hujayra membranasining tuzilishi'). "
                        "Your ONLY allowed edit is to INSERT or REMOVE SPACE characters. "
                        "Every other character must stay exactly as it is, in the same order: "
                        "same letters, same alphabet (do NOT transliterate Cyrillic to Latin), "
                        "same punctuation, same digits. Do NOT translate, summarise, complete, "
                        "or invent any word — if the title looks truncated, leave it truncated. "
                        "The output with all spaces removed MUST be character-for-character "
                        "identical to the input with all spaces removed. "
                        "If a title is already correct, return it unchanged. "
                        "Input is a JSON array of strings. Return ONLY a JSON array of strings, "
                        "same length, same order."
                    ),
                },
                {"role": "user", "content": json.dumps(items, ensure_ascii=False, separators=(",", ":"))},
            ],
            model=model,
            usage_kind="topic_text_repair",
            max_tokens=6000,
            temperature=0.0,
            timeout_sec=180,
        )
        text = (raw or "").strip()
        start, end = text.find("["), text.rfind("]")
        if start < 0 or end <= start:
            logger.warning("Tiklash javobida JSON massiv topilmadi")
            return {}
        arr = json.loads(text[start : end + 1])
        if not isinstance(arr, list) or len(arr) != len(items):
            logger.warning("Tiklash soni mos emas: kutilgan %s", len(items))
            return {}
        out: dict[str, str] = {}
        for src, dst in zip(items, arr):
            dst = str(dst or "").strip()
            if not dst:
                continue
            # XAVFSIZLIK QOIDASI: modelga faqat PROBEL qo'yish/olib tashlashga
            # ruxsat. Probelsiz uzunlik AYNAN bir xil qolishi shart.
            #
            # Bu qoida modelning eng xavfli xatolarini kesib tashlaydi:
            #   * matn oxiriga o'zidan so'z qo'shish ("... o'smalari. 4."
            #     -> "... o'smalari. 4. Neonatologiya"),
            #   * ruscha matnni lotinga o'girib yuborish,
            #   * sarlavhani qisqartirish yoki qayta yozish.
            # Buning evaziga uzunlikni o'zgartiradigan OCR tuzatishlari
            # ("sifath" -> "sifatli") o'tmaydi — sodiqlik chiroylilikdan muhim.
            if len(dst.replace(" ", "")) != len(src.replace(" ", "")):
                logger.info("Tiklash rad etildi (uzunlik o'zgardi): %r -> %r", src[:60], dst[:60])
                continue
            if dst != src:
                out[src] = dst[:500]
        return out
    except Exception:
        logger.warning("Tiklash xatosi", exc_info=True)
        return {}


def repair_titles(api_key: str, model: str, titles: list[str]) -> dict[str, str]:
    """Buzuq sarlavhalar ro'yxatini tiklaydi: {asl: tuzatilgan}.

    AI kaliti bo'lmasa — faqat deterministik bosqich qo'llanadi.
    """
    result: dict[str, str] = {}
    needs_ai: list[str] = []

    for title in titles:
        collapsed = collapse_tracking(title)
        if collapsed != title:
            result[title] = collapsed
        # Yopishib qolgan uzun so'zlar qoldimi?
        if any(len(w) > 22 for w in collapsed.split()):
            needs_ai.append(title)

    if not api_key or not needs_ai:
        return result

    for i in range(0, len(needs_ai), _BATCH):
        chunk = needs_ai[i : i + _BATCH]
        collapsed_chunk = [result.get(t, t) for t in chunk]
        restored = _restore_words_batch(api_key, model, collapsed_chunk)
        for original, collapsed in zip(chunk, collapsed_chunk):
            fixed = restored.get(collapsed)
            if fixed:
                result[original] = fixed
    return result
