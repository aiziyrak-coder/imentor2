"""Sillabus nomi va mavzu nomlarini interfeys tillariga tarjima qilish.

Qoidalar:
  * ASL nom hech qachon o'zgarmaydi — u saqlash kaliti va AI promptlari
    uchun ishlatiladi. Bu yerda faqat KO'RSATISH uchun tarjima saqlanadi.
  * Bitta sillabusning HAMMA mavzusi BITTA so'rovda tarjima qilinadi —
    shunda terminologiya izchil bo'ladi (mavzuma-mavzu tarjima qilinsa,
    bir atama har xil chiqishi mumkin).
  * Allaqachon tarjima qilingan sarlavhalar qayta tarjima qilinmaydi.
"""

from __future__ import annotations

import json
import logging
import re

from app.core.config import get_settings
from app.services import openai_client as oai

logger = logging.getLogger(__name__)

_NUM_PREFIX = re.compile(r"^\s*\d+[.)]\s*(.+)$", re.S)

SUPPORTED_LANGS = ("uz", "ru", "en")
LANG_NAMES = {"uz": "Uzbek (Latin script only — never Cyrillic)", "ru": "Russian", "en": "English"}

# Bitta so'rovda tarjima qilinadigan maksimal sarlavha (juda katta sillabusda
# javob token chegarasiga urilmasin).
_BATCH = 30

# O'zbek kiril → lotin (asosiy harflar). AI tarjimasi ishlamasa zaxira.
_UZ_CYR_TO_LAT = str.maketrans(
    {
        "А": "A", "а": "a", "Б": "B", "б": "b", "В": "V", "в": "v", "Г": "G", "г": "g",
        "Д": "D", "д": "d", "Е": "E", "е": "e", "Ё": "Yo", "ё": "yo", "Ж": "J", "ж": "j",
        "З": "Z", "з": "z", "И": "I", "и": "i", "Й": "Y", "й": "y", "К": "K", "к": "k",
        "Л": "L", "л": "l", "М": "M", "м": "m", "Н": "N", "н": "n", "О": "O", "о": "o",
        "П": "P", "п": "p", "Р": "R", "р": "r", "С": "S", "с": "s", "Т": "T", "т": "t",
        "У": "U", "у": "u", "Ф": "F", "ф": "f", "Х": "X", "х": "x", "Ц": "Ts", "ц": "ts",
        "Ч": "Ch", "ч": "ch", "Ш": "Sh", "ш": "sh", "Щ": "Sh", "щ": "sh", "Ъ": "", "ъ": "",
        "Ы": "I", "ы": "i", "Ь": "", "ь": "", "Э": "E", "э": "e", "Ю": "Yu", "ю": "yu",
        "Я": "Ya", "я": "ya",
        "Ў": "O'", "ў": "o'", "Қ": "Q", "қ": "q", "Ғ": "G'", "ғ": "g'", "Ҳ": "H", "ҳ": "h",
    }
)


def collect_topic_titles(syllabus) -> list[str]:
    """Sillabusdagi barcha noyob mavzu sarlavhalari (asl holida)."""
    titles: list[str] = []
    seen: set[str] = set()

    def _add(items) -> None:
        if not isinstance(items, list):
            return
        for t in items:
            if not isinstance(t, dict):
                continue
            title = str(t.get("title") or "").strip()
            if title and title not in seen:
                seen.add(title)
                titles.append(title)

    variants = syllabus.variants if isinstance(syllabus.variants, list) else []
    for v in variants:
        if isinstance(v, dict):
            _add(v.get("topics"))
    _add(syllabus.topics if isinstance(syllabus.topics, list) else [])
    return titles


# ---------------------------------------------------------------- til nazorati

_CYRILLIC = re.compile(r"[\u0400-\u04FF]")
_LATIN = re.compile(r"[A-Za-z]")
# Faqat o'zbek kirilida bor harflar — rus alifbosida yo'q.
_UZ_ONLY_CYRILLIC = re.compile(r"[\u049B\u049A\u0493\u0492\u04B3\u04B2\u045E\u040E]")
# Lotin yozuvidagi o'zbekchani ingliz tilidan ajratuvchi so'zlar.
_UZ_LATIN_WORDS = (
    " va ", " bilan ", "kasallik", "davolash", "tekshir", "asoslari", "usullari",
    "belgilari", "tizimi", "haqida", "uchun", "o'quv", "ma'ruza", "amaliy",
)


_LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9'’\-]*")


def _letters(text: str) -> int:
    return len(_CYRILLIC.findall(text)) + len(_LATIN.findall(text))


def _drop_shared_latin(text: str, source: str) -> str:
    """Asl sarlavhada ham bor lotin so'zlarini olib tashlaydi.

    Mahsulot nomlari tarjima qilinmaydi ("Internet Explorer, Mozilla Firefox,
    Google Chrome"). Ular ko'p bo'lsa, to'g'ri ruscha tarjimada ham lotin
    harflari kirilchadan ko'p bo'lib qolardi va tarjima rad etilardi (2026-09-23).
    """
    if not source:
        return text
    shared = {w.lower() for w in _LATIN_WORD.findall(source) if len(w) > 2}
    if not shared:
        return text
    return _LATIN_WORD.sub(lambda m: "" if m.group(0).lower() in shared else m.group(0), text)


def looks_wrong_language(text: str, lang: str, source: str = "") -> bool:
    """Matn `lang` tilida EMASLIGI aniq bo'lsa True.

    Ehtiyotkor: qisqa yoki harfsiz matnlarga (raqam, kod) tegmaydi — faqat
    yozuv tizimi ochiq-oydin mos kelmasa rad etadi. Asosiy maqsad — model
    rus tili so'ralganda inglizcha (yoki aksincha) qaytargan holatni tutish.
    """
    value = _drop_shared_latin((text or "").strip(), source or "")
    if _letters(value) < 8:
        return False
    cyr = len(_CYRILLIC.findall(value))
    lat = len(_LATIN.findall(value))
    total = cyr + lat
    if lang == "ru":
        # Rus matni asosan kirilcha bo'ladi va o'zbek kiril harflari uchramaydi.
        return cyr / total < 0.6 or bool(_UZ_ONLY_CYRILLIC.search(value))
    if lang == "en":
        if cyr / total > 0.15:
            return True
        low = f" {value.lower()} "
        return any(w in low for w in _UZ_LATIN_WORDS)
    if lang == "uz":
        # O'zbekcha lotin yozuvida.
        return cyr / total > 0.2
    return False


def _parse_translation_list(raw: str) -> list | None:
    """Model javobidan tarjimalar ro'yxatini ajratib oladi.

    Kutilgani — `{"items": [...]}`. Eski javoblar (va JSON rejimini
    qo'llab-quvvatlamaydigan modellar) oddiy massiv qaytarishi mumkin,
    shuning uchun ikkalasi ham qabul qilinadi.
    """
    text = (raw or "").strip()
    if not text:
        return None

    def _from_obj(value) -> list | None:
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for key in ("items", "translations", "result", "data"):
                inner = value.get(key)
                if isinstance(inner, list):
                    return inner
            # Bitta kalitli obyekt bo'lsa — o'sha qiymatni olamiz.
            values = list(value.values())
            if len(values) == 1 and isinstance(values[0], list):
                return values[0]
        return None

    try:
        return _from_obj(json.loads(text))
    except json.JSONDecodeError:
        pass

    # Zaxira: matn ichidagi eng tashqi JSON bo'lagini qirqib olamiz.
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = text.find(opener), text.rfind(closer)
        if start >= 0 and end > start:
            try:
                return _from_obj(json.loads(text[start : end + 1]))
            except json.JSONDecodeError:
                continue
    return None


_DOUBLED_APOSTROPHE = re.compile(r"(?<=\w)''(?=\w)")


def fix_doubled_apostrophes(text: str) -> str:
    """So'z ichidagi ikkilangan tutuq belgisini bittaga keltiradi: o''zgarish → o'zgarish.

    Faqat harflar orasidagi `''` tegiladi — tirnoq sifatida ishlatilgani qoladi.
    """
    return _DOUBLED_APOSTROPHE.sub("'", text or "")


def _translate_batch(api_key: str, model: str, items: list[str], target: str) -> dict[str, str]:
    """`items` ni `target` tiliga tarjima qiladi: {asl: tarjima}."""
    if not items:
        return {}
    payload = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You translate MEDICAL CURRICULUM topic titles for a university. "
                        f"Translate into {LANG_NAMES.get(target, target)}. "
                        "Keep official medical terminology accurate and consistent across the whole list "
                        "(the same term must be translated the same way everywhere). "
                        "Keep topic codes, numbers, abbreviations and Latin anatomical terms as they are. "
                        "Do NOT add explanations. "
                        + (
                            "For Uzbek: use LATIN Uzbek orthography only (o', g', sh, ch). "
                            "Never output Cyrillic letters. "
                            if target == "uz"
                            else ""
                        )
                        + "Input is a JSON array of strings. Return ONLY a JSON object of the form "
                        '{"items": ["...", "..."]} where "items" has the SAME length and SAME order '
                        "as the input. Do not add numbering or any extra text. Every double quote "
                        "inside a title must be escaped so that the JSON stays valid."
                    ),
                },
                {"role": "user", "content": payload},
            ],
            model=model,
            usage_kind="syllabus_translate",
            max_tokens=8000,
            temperature=0.1,
            timeout_sec=180,
            # JSON rejimi: model qaytargan matn har doim to'g'ri JSON bo'ladi.
            # Ilgari oddiy matn so'ralardi va sarlavha ichidagi qo'shtirnoq
            # javobni buzib, butun to'plam tarjimasiz qolardi.
            response_format={"type": "json_object"},
        )
        arr = _parse_translation_list(raw or "")
        if arr is None:
            logger.warning("Tarjima javobidan JSON ro'yxat o'qib bo'lmadi (%s)", target)
            return {}
        if len(arr) != len(items):
            logger.warning(
                "Tarjima soni mos emas (%s): kutilgan %s, kelgan %s",
                target,
                len(items),
                len(arr) if isinstance(arr, list) else "?",
            )
            return {}
        out: dict[str, str] = {}
        for src, dst in zip(items, arr):
            dst = str(dst or "").strip()
            # Model ba'zan ro'yxat raqamini ham qaytaradi ("14. Gas exchange")
            # — asl sarlavhada bunday prefiks bo'lmasa, olib tashlaymiz.
            m = _NUM_PREFIX.match(dst)
            if m and not _NUM_PREFIX.match(src):
                dst = m.group(1).strip()
            # Model ba'zan tutuq belgisini ikkilab yozadi ("Yallig''lanish") —
            # SQL qochirishiga o'xshaydi, lekin matnda hech qachon kerak emas.
            dst = fix_doubled_apostrophes(dst)
            if not dst or dst == src:
                continue
            if looks_wrong_language(dst, target, src):
                # Model boshqa tilda qaytardi (masalan "ru" so'ralganda
                # inglizcha) — bunday "tarjima" saqlansa, interfeys butunlay
                # noto'g'ri tilda ko'rinadi. Saqlamaymiz: asl sarlavha qoladi.
                logger.warning(
                    "Tarjima %s tilida emas, tashlab yuborildi: %s", target, dst[:60]
                )
                continue
            if target == "uz" and _CYRILLIC.search(dst):
                logger.warning("O'zbek tarjimada kirill qoldi, tashlandi: %s", dst[:60])
                continue
            out[src] = dst[:512]
        return out
    except Exception:
        logger.warning("Tarjima xatosi (%s)", target, exc_info=True)
        return {}


def _titles_look_foreign(titles: list[str], lang: str) -> bool:
    """Sarlavhalarning ko'pchiligi `lang` tilida EMASmi?

    `instruction_language` noto'g'ri bo'lsa (masalan ruscha sillabus "uz" deb
    belgilangan), shu tekshiruv uni ushlaydi va tarjima baribir bajariladi.
    """
    checked = [t for t in titles if _letters(t) >= 8][:20]
    if len(checked) < 3:
        return False
    wrong = sum(1 for t in checked if looks_wrong_language(t, lang))
    return wrong > len(checked) * 0.6


def _has_cyrillic(text: str) -> bool:
    return bool(_CYRILLIC.search(text or ""))


def latinize_uzbek_text(text: str) -> str:
    """O'zbek kirill matnini lotinga o'tkazadi (zaxira transliteratsiya)."""
    value = (text or "").strip()
    if not value or not _has_cyrillic(value):
        return value
    return value.translate(_UZ_CYR_TO_LAT)


def _rewrite_topic_titles(syllabus, mapping: dict[str, str]) -> bool:
    """variants/topics ichidagi title'larni mapping bo'yicha almashtiradi."""
    if not mapping:
        return False
    changed = False

    def _map_list(items):
        nonlocal changed
        if not isinstance(items, list):
            return items
        out = []
        for t in items:
            if not isinstance(t, dict):
                out.append(t)
                continue
            title = str(t.get("title") or "").strip()
            new_title = mapping.get(title)
            if new_title and new_title != title:
                changed = True
                out.append({**t, "title": new_title[:512]})
            else:
                out.append(t)
        return out

    variants = syllabus.variants if isinstance(syllabus.variants, list) else []
    if variants:
        syllabus.variants = [
            {**v, "topics": _map_list(v.get("topics"))} if isinstance(v, dict) else v
            for v in variants
        ]
    if isinstance(syllabus.topics, list):
        syllabus.topics = _map_list(syllabus.topics)

    name = (syllabus.subject_name or "").strip()
    if name in mapping and mapping[name] != name:
        syllabus.subject_name = mapping[name][:255]
        changed = True
    return changed


def ensure_uzbek_latin_source(db, syllabus, api_key: str, model: str) -> bool:
    """Manba o'zbekcha (yoki o'zbek kirill) bo'lsa — sarlavhalarni lotinga o'tkazadi.

    Ruscha sillabusga tegmaydi. Maqsad: interfeysda o'zbekcha hech qachon
    kirillcha ko'rinmasin.
    """
    # O'qituvchi o'zi yuklagan fan — uning asl matni. Uni fonda qayta yozish
    # mavzularni nomi bo'yicha birlashtirishni buzardi (kirillcha Excel qayta
    # yuklansa hamma mavzu "yangi" bo'lib qolardi) va orada saqlangan tahrir
    # ustidan eski variantlarni yozib yuborishi mumkin edi.
    if getattr(syllabus, "created_by", ""):
        return False
    source_lang = (syllabus.instruction_language or "uz").strip().lower()
    titles = collect_topic_titles(syllabus)
    name = (syllabus.subject_name or "").strip()
    sample = [name, *titles[:20]]
    uz_cyr = any(_UZ_ONLY_CYRILLIC.search(t or "") for t in sample)
    any_cyr = any(_has_cyrillic(t or "") for t in sample if _letters(t or "") >= 4)

    # Faqat o'zbek manba yoki aniq o'zbek-kirill belgilarida.
    if source_lang != "uz" and not uz_cyr:
        return False
    if not any_cyr:
        return False

    # instruction_language xato "ru" bo'lishi mumkin — o'zbek kirill topilsa uz qilamiz.
    if uz_cyr and source_lang != "uz":
        syllabus.instruction_language = "uz"
        source_lang = "uz"

    items = [t for t in ([name] if name else []) + titles if _has_cyrillic(t)]
    if not items:
        return False

    # Avval AI orqali to'g'ri lotin o'zbek; muvaffaqiyatsiz bo'lsa translit.
    mapping: dict[str, str] = {}
    for i in range(0, len(items), _BATCH):
        chunk = items[i : i + _BATCH]
        got = _translate_batch(api_key, model, chunk, "uz")
        for src in chunk:
            dst = (got.get(src) or "").strip()
            if not dst or _has_cyrillic(dst):
                dst = latinize_uzbek_text(src)
            if dst and dst != src:
                mapping[src] = dst

    if not mapping:
        return False

    changed = _rewrite_topic_titles(syllabus, mapping)
    if changed:
        # Eski i18n kalitlari asl kirill title'larga bog'langan — tozalaymiz,
        # keyin ensure_syllabus_translations qayta to'ldiradi.
        syllabus.topics_i18n = {}
        name_i18n = dict(syllabus.name_i18n or {})
        name_i18n.pop("uz", None)
        syllabus.name_i18n = name_i18n
        db.commit()
        logger.info("Sillabus %s o'zbek kirill → lotin qilindi (%s ta)", syllabus.id, len(mapping))
    return changed


def ensure_syllabus_translations(db, syllabus, langs: tuple[str, ...] = SUPPORTED_LANGS) -> bool:
    """Yetishmayotgan tarjimalarni to'ldiradi. O'zgarish bo'lsa True.

    Idempotent: to'g'ri tarjimalarga tegmaydi, faqat yetishmayotganini
    qo'shadi. Bundan tashqari NOTO'G'RI TILDAGI eski yozuvlarni tozalaydi
    (masalan "ru" katagida inglizcha matn) va ularni qaytadan tarjima qiladi.
    """
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        logger.info("OPENAI_API_KEY yo'q — sillabus tarjimasi o'tkazib yuborildi")
        return False

    model = settings.openai_fast_model
    changed = False

    # Avval o'zbek manbani lotinga keltiramiz (kirill qolmasin).
    if ensure_uzbek_latin_source(db, syllabus, api_key, model):
        changed = True
        db.refresh(syllabus)

    source_lang = (syllabus.instruction_language or "uz").strip().lower()
    titles = collect_topic_titles(syllabus)

    name_i18n = dict(syllabus.name_i18n or {})
    topics_i18n = {k: dict(v or {}) for k, v in (syllabus.topics_i18n or {}).items()}

    # Saqlangan noto'g'ri tildagi tarjimalarni tozalaymiz — ular `instruction_language`
    # xato bo'lgan sillabuslarda paydo bo'lgan (masalan "ru" katagida inglizcha matn).
    for lang, mapping in list(topics_i18n.items()):
        bad = [k for k, v in mapping.items() if looks_wrong_language(str(v or ""), lang)]
        if bad:
            logger.warning(
                "Sillabus %s: %s ta noto'g'ri tildagi (%s) tarjima tozalandi",
                syllabus.id, len(bad), lang,
            )
            for k in bad:
                mapping.pop(k, None)
            changed = True
    for lang, value in list(name_i18n.items()):
        if looks_wrong_language(str(value or ""), lang):
            name_i18n.pop(lang, None)
            changed = True

    for lang in langs:
        # `instruction_language` ba'zan xato (PDF'dan aniqlangan). Shuning uchun
        # asl sarlavhalar HAQIQATDAN shu tilda ekanini tekshiramiz — aks holda
        # "asl til" deb o'tkazib yuborilsa, interfeys tarjimasiz qolardi.
        if lang == source_lang and not _titles_look_foreign(titles, lang):
            continue  # asl til — tarjima kerak emas

        # --- fan nomi ---
        if not str(name_i18n.get(lang) or "").strip() and syllabus.subject_name:
            got = _translate_batch(api_key, model, [syllabus.subject_name], lang)
            if got:
                name_i18n[lang] = list(got.values())[0]
                changed = True

        # --- mavzu sarlavhalari (faqat yetishmayotganlari) ---
        have = topics_i18n.get(lang) or {}
        missing = [t for t in titles if not str(have.get(t) or "").strip()]
        if missing:
            merged = dict(have)
            for i in range(0, len(missing), _BATCH):
                chunk = missing[i : i + _BATCH]
                got = _translate_batch(api_key, model, chunk, lang)
                if not got and len(chunk) > 1:
                    # To'plam yiqildi (javob kesilgan yoki soni mos emas) —
                    # ikkiga bo'lib qayta urinamiz, shunda hech bo'lmasa
                    # yarmi tarjima bo'ladi.
                    half = len(chunk) // 2
                    got = _translate_batch(api_key, model, chunk[:half], lang)
                    got.update(_translate_batch(api_key, model, chunk[half:], lang))
                merged.update(got)
            if merged != have:
                topics_i18n[lang] = merged
                changed = True

    if changed:
        syllabus.name_i18n = name_i18n
        syllabus.topics_i18n = topics_i18n
        db.commit()
        logger.info("Sillabus %s tarjimalari yangilandi", syllabus.id)
    return changed
