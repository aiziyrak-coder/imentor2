"""Ma'ruza matni va taqdimotni uch tilga (uz/ru/en) o'girish — server tomonida.

Keys va test `case_i18n` da tarjima qilinadi (savollar ro'yxati). Bu yerda
qolgan ikki tur — erkin matnli materiallar:

── Shakl ─────────────────────────────────────────────────────────────────
    ma'ruza:   {"topic": "...", "content": "# Markdown ...",
                "primaryLanguage": "uz",
                "translations": {"ru": {"topic": "...", "content": "..."}, ...},
                "i18nSourceHash": "..."}
    taqdimot:  {"presentation_title": "...", "slides": [...], ...,
                "primaryLanguage": "uz",
                "translations": {"ru": {<butun deck, faqat matnlari o'girilgan>}}}

Til FAQAT to'liq tarjima bo'lganda saqlanadi — yarmi o'zbekcha "ruscha" nusxa
o'qituvchiga hech qachon ko'rsatilmaydi.
"""

from __future__ import annotations

import copy
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor

from app.core.config import get_settings
from app.models.prepared_content import KIND_LECTURE, KIND_PRESENTATION
from app.services import case_i18n as ci

logger = logging.getLogger(__name__)

SUPPORTED_LANGS = ci.SUPPORTED_LANGS
TEXT_KINDS = frozenset({KIND_LECTURE, KIND_PRESENTATION})

#: Ma'ruza bo'laklari parallel o'giriladi — 40 ming belgilik ma'ruza ketma-ket
#: o'girilsa 5-6 daqiqa ketardi, o'qituvchi esa yuklanish belgisiga qarab turadi.
_PARALLEL = 4
_ATTEMPTS = 3

#: Taqdimot slaydidagi tarjima qilinadigan matn maydonlari. Rasm so'rovi,
#: havolalar va manbalar (kitob/maqola nomlari) ataylab o'girilmaydi.
_SLIDE_TEXT_KEYS = ("title", "subtitle", "speaker_notes")
_BODY_TEXT_KEYS = ("quote_text", "quote_author")


# ── Manba matni ────────────────────────────────────────────────────────────


def _deck_slots(deck: dict) -> list[tuple[tuple, str]]:
    """Taqdimotdagi har bir o'giriladigan matn: (yo'l, qiymat). Tartib qat'iy."""
    slots: list[tuple[tuple, str]] = []

    def add(path: tuple, value) -> None:
        if isinstance(value, str) and value.strip():
            slots.append((path, value))

    for key in ("presentation_title", "subject_area"):
        add((key,), deck.get(key))
    for si, slide in enumerate(deck.get("slides") or []):
        if not isinstance(slide, dict):
            continue
        for key in _SLIDE_TEXT_KEYS:
            add(("slides", si, key), slide.get(key))
        body = slide.get("body") if isinstance(slide.get("body"), dict) else {}
        for key in _BODY_TEXT_KEYS:
            add(("slides", si, "body", key), body.get(key))
        for bi, bullet in enumerate(body.get("bullets") or []):
            add(("slides", si, "body", "bullets", bi), bullet)
        stat = body.get("key_stat") if isinstance(body.get("key_stat"), dict) else {}
        add(("slides", si, "body", "key_stat", "label"), stat.get("label"))
        for ci_, col in enumerate(body.get("columns") or []):
            if not isinstance(col, dict):
                continue
            add(("slides", si, "body", "columns", ci_, "heading"), col.get("heading"))
            for pi, point in enumerate(col.get("points") or []):
                add(("slides", si, "body", "columns", ci_, "points", pi), point)
        headers = body.get("comparison_headers") if isinstance(body.get("comparison_headers"), dict) else {}
        for key in ("left", "right"):
            add(("slides", si, "body", "comparison_headers", key), headers.get(key))
        for ri, row in enumerate(body.get("comparison_rows") or []):
            if not isinstance(row, dict):
                continue
            for key in ("criteria", "left", "right"):
                add(("slides", si, "body", "comparison_rows", ri, key), row.get(key))
        for pi, step in enumerate(body.get("process_steps") or []):
            if not isinstance(step, dict):
                continue
            for key in ("label", "description"):
                add(("slides", si, "body", "process_steps", pi, key), step.get(key))
        for ti, stat_ in enumerate(body.get("stats") or []):
            if isinstance(stat_, dict):
                add(("slides", si, "body", "stats", ti, "label"), stat_.get("label"))
        # Eski deck: {title, bullets, notes}
        for bi, bullet in enumerate(slide.get("bullets") or []):
            add(("slides", si, "bullets", bi), bullet)
        add(("slides", si, "notes"), slide.get("notes"))
    add(("title",), deck.get("title"))
    return slots


def _set_path(obj, path: tuple, value: str) -> None:
    for key in path[:-1]:
        obj = obj[key]
    obj[path[-1]] = value


def _base(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k not in ("translations", "i18nSourceHash", "primaryLanguage")}


def source_text(kind: str, payload: dict | None) -> str:
    if not isinstance(payload, dict):
        return ""
    if kind == KIND_LECTURE:
        return str(payload.get("content") or "")
    if kind == KIND_PRESENTATION:
        return "\n".join(v for _, v in _deck_slots(payload))
    return ""


def source_hash(kind: str, payload: dict | None) -> str:
    return hashlib.sha1(source_text(kind, payload).encode("utf-8")).hexdigest()[:16]


def primary_language(kind: str, payload: dict | None) -> str:
    """Asosiy til matnning o'zidan aniqlanadi; aniqlanmasa saqlangan qiymat."""
    detected = ci.detect_language(ci._without_references(source_text(kind, payload)))
    if detected in SUPPORTED_LANGS:
        return detected
    raw = str((payload or {}).get("primaryLanguage") or "uz").strip().lower()
    return raw if raw in SUPPORTED_LANGS else "uz"


def _language_ok(text: str, target: str) -> bool:
    got = ci.detect_language(ci._without_references(text))
    return got in ("?", target)


def has_translation(kind: str, payload: dict | None, lang: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if lang == primary_language(kind, payload):
        return True
    block = (payload.get("translations") or {}).get(lang)
    if not isinstance(block, dict) or payload.get("i18nSourceHash") != source_hash(kind, payload):
        return False
    text = source_text(kind, block)
    return bool(text.strip()) and _language_ok(text, lang)


# ── Tarjima ────────────────────────────────────────────────────────────────


def _translate_piece(api_key: str, model: str, kind: str, text: str, source: str, target: str) -> str | None:
    """Bitta bo'lak: to'g'ri tilda chiqmaguncha (3 urinish) qayta so'raladi."""
    if not text.strip():
        return text
    note = ""
    for _ in range(_ATTEMPTS):
        got = ci._translate_strings(api_key, model, [text], target, kind=kind, source=source, strict_note=note)
        out = got[0] if got else None
        if out and out.strip() and not ci._is_copy(text, out) and _language_ok(out, target):
            return out
        note = ci._rejected_note(target, ci.detect_language(out or ""))
    return None


def _translate_many(api_key: str, model: str, kind: str, texts: list[str], source: str, target: str) -> list[str] | None:
    with ThreadPoolExecutor(max_workers=_PARALLEL) as pool:
        results = list(pool.map(lambda t: _translate_piece(api_key, model, kind, t, source, target), texts))
    return None if any(r is None for r in results) else results  # type: ignore[return-value]


def _translate_lecture(api_key: str, model: str, payload: dict, source: str, target: str) -> dict | None:
    content = str(payload.get("content") or "")
    pieces = ci._split_long(content)
    translated = _translate_many(api_key, model, KIND_LECTURE, pieces, source, target)
    if translated is None:
        return None
    block = {"content": "".join(translated)}
    topic = str(payload.get("topic") or "").strip()
    if topic:
        got = ci._translate_strings(api_key, model, [topic], target, kind=KIND_LECTURE, source=source)
        block["topic"] = (got[0].strip() if got and got[0].strip() else topic)
    return block


def _translate_deck(api_key: str, model: str, payload: dict, source: str, target: str) -> dict | None:
    deck = _base(payload)
    slots = _deck_slots(deck)
    if not slots:
        return None
    # Qisqa matnlar bitta so'rovda (case_i18n bo'laklab yuboradi) — 25 slaydning
    # yuzlab punkti alohida so'rovga aylanmaydi.
    values = [v for _, v in slots]
    got = ci._translate_strings(api_key, model, values, target, kind=KIND_PRESENTATION, source=source)
    if got is None or len(got) != len(values):
        return None
    joined = "\n".join(got)
    if not _language_ok(joined, target):
        # Partiya noto'g'ri tilda chiqdi — har bir matn alohida, tekshiruv bilan.
        got = _translate_many(api_key, model, KIND_PRESENTATION, values, source, target)
        if got is None:
            return None
    out = copy.deepcopy(deck)
    for (path, original), value in zip(slots, got):
        _set_path(out, path, value.strip() or original)
    return out


def translate_payload(kind: str, payload: dict, lang: str) -> dict | None:
    """`lang` tilini to'ldirilgan YANGI payload qaytaradi.

    Allaqachon bor bo'lsa — o'sha payload (o'zgarishsiz). To'liq tarjima
    qilinmasa — None (yarim tarjima saqlanmaydi).
    """
    if kind not in TEXT_KINDS or not isinstance(payload, dict):
        return None
    primary = primary_language(kind, payload)
    current_hash = source_hash(kind, payload)
    if has_translation(kind, payload, lang):
        if payload.get("primaryLanguage") == primary and payload.get("i18nSourceHash") == current_hash:
            return payload
        return {**payload, "primaryLanguage": primary, "i18nSourceHash": current_hash}

    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        logger.info("OPENAI_API_KEY yo'q — %s tarjimasi o'tkazib yuborildi", kind)
        return None
    model = settings.openai_fast_model
    if kind == KIND_LECTURE:
        block = _translate_lecture(api_key, model, payload, primary, lang)
    else:
        block = _translate_deck(api_key, model, payload, primary, lang)
    if block is None:
        logger.warning("%s: %s tiliga to'liq tarjima bo'lmadi", kind, lang)
        return None

    translations = {}
    if payload.get("i18nSourceHash") == current_hash:
        # Manba o'zgarmagan — boshqa tillarning tarjimalari saqlanadi.
        translations = {k: v for k, v in (payload.get("translations") or {}).items() if isinstance(v, dict)}
    translations.pop(primary, None)
    translations[lang] = block
    return {**payload, "primaryLanguage": primary, "translations": translations, "i18nSourceHash": current_hash}
