"""Keys va testlarni uch tilga (uz/ru/en) o'girish — server tomonida.

── Shakl ─────────────────────────────────────────────────────────────────
    {
      "questions": [ ... ],              # asosiy til
      "primaryLanguage": "uz",
      "translations": {
        "ru": {"questions": [ ... ]},    # testda "topic" ham
        "en": {"questions": [ ... ]}
      }
    }

Tarjima qilingan `questions` asl ro'yxat bilan bir xil uzunlik va tartibda
bo'ladi — tashqi API ularni INDEKS bo'yicha juftlaydi. `correctOptionIndex`,
`references` kabi tildan mustaqil maydonlarga tegilmaydi.

── Nimalar tuzatildi (2026-09-17 audit) ──────────────────────────────────
* Keysda `primaryLanguage` saqlanmasdi va standart "uz" olinardi: ruscha keysga
  "ruscha tarjima" sifatida o'z nusxasi yozilib, o'zbekchasi hech qachon
  yaratilmasdi. Endi asosiy til MATNNING O'ZIDAN aniqlanadi.
* Tarjima tekshirilmasdi: asl matnning nusxasi yoki kirilga o'girilgan
  o'zbekcha ("Ким иштирак этади") ruscha tarjima sifatida saqlanardi. Endi har
  bir savol tili tekshiriladi, yaroqsizi qayta so'raladi.
* OpenAI mijozi xabarni 8000 belgida kesadi — uzun klinik keys bitta so'rovga
  sig'masdi va JSON buzilib, keys butunlay tarjimasiz qolardi. Endi matnlar
  bo'laklarga bo'lib yuboriladi.
* Tahrirdan keyin eski tarjima qolib ketardi — `invalidate_stale_translations`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.services import openai_client as oai

logger = logging.getLogger(__name__)

SUPPORTED_LANGS = ("uz", "ru", "en")
LANG_NAMES = {
    "uz": "Uzbek (Latin script only — never Cyrillic)",
    "ru": "Russian",
    "en": "English",
}

#: Tur bo'yicha tarjima qilinadigan maydonlar: (matn maydonlari, ro'yxat maydonlari).
FIELDS = {
    KIND_CASE: (("scenario", "answer", "focus", "explanation"), ("options",)),
    KIND_TEST: (("question", "explanation"), ("options", "optionExplanations")),
}

#: Keys sarlavhalari — frontend (`aiService.ts`) jadvallari bilan bir xil. Tarjimada ular modelga
#: berilmaydi: "Kim ishtirok etadi" sarlavhasi "Participation of Kim" bo'lib chiqardi (model "Kim"ni
#: ism deb o'ylaydi). Sarlavha belgi bilan almashtiriladi va keyin aniq tarjimasi qo'yiladi.
CASE_HEADINGS: list[dict[str, str]] = [
    {"uz": "Bemor", "ru": "Пациент", "en": "Patient"},
    {"uz": "Shikoyatlar", "ru": "Жалобы", "en": "Complaints"},
    {"uz": "Anamnez", "ru": "Анамнез", "en": "History"},
    {"uz": "Hayot tarzi", "ru": "Образ жизни", "en": "Lifestyle"},
    {"uz": "Obyektiv ko'rik", "ru": "Объективный осмотр", "en": "Examination"},
    {"uz": "Laboratoriya", "ru": "Лаборатория", "en": "Investigations"},
    {"uz": "Kim ishtirok etadi", "ru": "Кто участвует", "en": "Who is involved"},
    {"uz": "Muammo", "ru": "Проблема", "en": "Problem"},
    {"uz": "Berilgan shartlar", "ru": "Условия", "en": "Given conditions"},
    {"uz": "Muhit va vositalar", "ru": "Среда и средства", "en": "Setting and tools"},
    {"uz": "Nima kuzatildi", "ru": "Что видно", "en": "What was observed"},
    {"uz": "Ma'lumotlar", "ru": "Данные", "en": "Data"},
    {"uz": "Klinik xulosa", "ru": "Клиническое заключение", "en": "Clinical impression"},
    {"uz": "Differensial tahlil", "ru": "Дифференциальный анализ", "en": "Differential analysis"},
    {"uz": "Keyingi tekshiruvlar", "ru": "Следующие обследования", "en": "Next investigations"},
    {"uz": "Davolash taktikasi", "ru": "Тактика лечения", "en": "Management plan"},
    {"uz": "Kuzatuv va ogohlantirish", "ru": "Наблюдение и предупреждения", "en": "Follow-up and red flags"},
    {"uz": "Asosiy xulosa", "ru": "Главный вывод", "en": "Main conclusion"},
    {"uz": "Boshqa tushuntirishlar", "ru": "Другие объяснения", "en": "Other explanations"},
    {"uz": "Qanday tekshirish", "ru": "Как проверить", "en": "How to check"},
    {"uz": "Qanday yechish", "ru": "Как решить", "en": "How to solve"},
    {"uz": "Xatolikni oldini olish", "ru": "Как не допустить ошибку", "en": "How to prevent the mistake"},
]


def _heading_key(text: str) -> str:
    return re.sub(r"['‘’`ʻʼ]", "'", (text or "").strip().lower())


_HEADING_INDEX = {_heading_key(v): i for i, row in enumerate(CASE_HEADINGS) for v in row.values()}
#: Model adashtiradigan sarlavhalar — tekshiruv faqat shular uchun. Klinik sarlavhalarning erkin
#: tarjimasi ("Bemor" → "Больной") to'g'ri, ular uchun eski tarjimani qayta qilish shart emas.
_AMBIGUOUS_HEADINGS = {i for i, row in enumerate(CASE_HEADINGS) if row["en"] in {
    "Who is involved", "Problem", "Given conditions", "Setting and tools", "What was observed", "Data",
    "Main conclusion", "Other explanations", "How to check", "How to solve", "How to prevent the mistake",
}}
_HEADING_LINE = re.compile(r"^(#{1,6}\s*)?(.+?)\s*$")
_HEADING_TOKEN = re.compile(r"§H(\d+)§")


def _protect_headings(text: str) -> str:
    out = []
    for line in (text or "").split("\n"):
        m = _HEADING_LINE.match(line)
        idx = _HEADING_INDEX.get(_heading_key(m.group(2))) if m and len(line) < 60 else None
        out.append(f"{m.group(1) or ''}§H{idx}§" if idx is not None else line)
    return "\n".join(out)


def _restore_headings(text: str, target: str) -> str:
    return _HEADING_TOKEN.sub(lambda m: (CASE_HEADINGS[int(m.group(1))].get(target, m.group(0)) if int(m.group(1)) < len(CASE_HEADINGS) else m.group(0)), text or "")


#: Bitta so'rovdagi matn hajmi. Mijoz xabarni 8000 belgida kesadi; JSON
#: qochirish belgilari va ko'rsatma uchun zaxira qoldiriladi.
CHUNK_CHARS = 5000

# ── Tilni aniqlash ─────────────────────────────────────────────────────────

_CYR = re.compile(r"[Ѐ-ӿ]")
_LAT = re.compile(r"[A-Za-z]")
_UZ_CYR_LETTERS = re.compile(r"[ўқғҳЎҚҒҲ]")
_UZ_CYR_WORDS = re.compile(r"\b(билан|учун|бўл\w*|ҳисобланади|қайси|ушбу|ёшли|касаллиги|иштирак|этади|тарихи)\b", re.I)
_UZ_LAT = re.compile(
    r"\b(va|bilan|uchun|hisoblanadi|qaysi|ushbu|yoshli|bemor\w*|kasallik\w*|davolash|bo['‘’`ʻ]l\w*|"
    r"qil\w*|ning|lar|emas|ham|yoki|shu|bu)\b",
    re.I,
)
_EN = re.compile(r"\b(the|and|of|with|is|are|which|for|patient|this|that|from|was|has)\b", re.I)


def detect_language(text: str) -> str:
    """"uz" | "ru" | "en" | "uz-cyr" (kirilga o'girilgan o'zbekcha) | "?" (qisqa/aniqlanmadi)."""
    s = text or ""
    cyr, lat = len(_CYR.findall(s)), len(_LAT.findall(s))
    if cyr + lat < 30:
        return "?"
    if cyr > lat:
        if _UZ_CYR_LETTERS.search(s) or len(_UZ_CYR_WORDS.findall(s)) >= 2:
            return "uz-cyr"
        return "ru"
    uz, en = len(_UZ_LAT.findall(s)), len(_EN.findall(s))
    if en == 0 and uz == 0:
        return "?"
    return "en" if en > uz else "uz"


def _questions_text(questions: list, kind: str) -> str:
    text_fields, list_fields = FIELDS.get(kind, FIELDS[KIND_CASE])
    parts: list[str] = []
    for q in questions or []:
        if not isinstance(q, dict):
            continue
        parts.extend(str(q.get(f) or "") for f in text_fields)
        for f in list_fields:
            values = q.get(f)
            if isinstance(values, list):
                parts.extend(str(v) for v in values)
    return "\n".join(p for p in parts if p)


def _kind_of(payload: dict) -> str:
    qs = payload.get("questions") if isinstance(payload, dict) else None
    first = next((q for q in qs or [] if isinstance(q, dict)), {})
    return KIND_TEST if "question" in first else KIND_CASE


def primary_language(payload: dict | None) -> str:
    """Asosiy til: avval matnning o'zidan aniqlanadi, aniqlanmasa saqlangan qiymat."""
    if not isinstance(payload, dict):
        return "uz"
    detected = detect_language(_questions_text(payload.get("questions") or [], _kind_of(payload)))
    if detected in SUPPORTED_LANGS:
        return detected
    raw = str(payload.get("primaryLanguage") or payload.get("primary_language") or "uz").strip().lower()
    return raw if raw in SUPPORTED_LANGS else "uz"


_REFERENCE_LINE = re.compile(r"^\s*\[\d+\]|https?://|doi\.org|PubMed", re.I)


def _without_references(text: str) -> str:
    """Adabiyotlar ro'yxati (inglizcha maqola nomlari, havolalar) til aniqlashdan chiqariladi —
    aks holda to'g'ri ruscha tarjima "inglizcha" deb rad etiladi."""
    return "\n".join(line for line in text.split("\n") if not _REFERENCE_LINE.search(line))


def _translation_ok(source_q: dict, translated_q: dict, target: str, kind: str) -> bool:
    """Bitta savol tarjimasi yaroqlimi: to'g'ri tilda va asl matnning nusxasi emas."""
    src = _questions_text([source_q], kind).strip()
    dst = _questions_text([translated_q], kind).strip()
    if not dst:
        return False
    if len(src) > 40 and dst == src:
        return False
    text_fields, list_fields = FIELDS.get(kind, FIELDS[KIND_CASE])
    for f in list_fields:
        a, b = source_q.get(f), translated_q.get(f)
        if isinstance(a, list) and (not isinstance(b, list) or len(a) != len(b)):
            return False
    if kind == KIND_CASE and target in SUPPORTED_LANGS:
        # Keys sarlavhalari aniq tarjimasi bilan turishi shart ("Participation of Kim" — yaroqsiz).
        dst_lines = {_heading_key(line.lstrip("#").strip()) for line in dst.split("\n")}
        for line in src.split("\n"):
            idx = _HEADING_INDEX.get(_heading_key(line.lstrip("#").strip())) if len(line) < 60 else None
            if idx in _AMBIGUOUS_HEADINGS and _heading_key(CASE_HEADINGS[idx][target]) not in dst_lines:
                return False
    got = detect_language(_without_references(dst))
    if got == "?":
        return True  # qisqa matn — til aniqlab bo'lmaydi, uzunlik/nusxa tekshiruvi yetarli
    return got == target


def _valid_block(payload: dict, lang: str, kind: str) -> bool:
    questions = [q for q in payload.get("questions") or [] if isinstance(q, dict)]
    block = (payload.get("translations") or {}).get(lang)
    rows = block.get("questions") if isinstance(block, dict) else None
    if not isinstance(rows, list) or len(rows) != len(questions) or not questions:
        return False
    bad = sum(1 for s, t in zip(questions, rows) if not isinstance(t, dict) or not _translation_ok(s, t, lang, kind))
    # Bitta-yarimta shubhali qisqa savol butun tilni rad etmasin, lekin nusxa/ noto'g'ri til ko'p bo'lsa — yaroqsiz.
    return bad <= max(0, len(questions) // 5)


def available_languages(payload: dict | None) -> list[str]:
    """Shu yozuvda haqiqatan mavjud va yaroqli tillar."""
    if not isinstance(payload, dict):
        return ["uz"]
    kind = _kind_of(payload)
    primary = primary_language(payload)
    out = [primary]
    for code in SUPPORTED_LANGS:
        if code != primary and _valid_block(payload, code, kind):
            out.append(code)
    return out


# ── Tarjima ────────────────────────────────────────────────────────────────


def _extract_strings(questions: list, kind: str = KIND_CASE) -> list[str]:
    """Savollardan tarjima qilinadigan matnlarni QAT'IY tartibda yig'adi (`_apply_strings` bilan bir xil).

    Ro'yxat maydonlari (variantlar, variant izohlari) HAR ELEMENTI alohida satr bo'lib ketadi:
    ilgari ular JSON massiv satri sifatida yuborilardi va arzon model massivni
    bo'laklarga ajratib, kutilgan sondan ko'p element qaytarardi — tarjima yiqilardi.
    """
    text_fields, list_fields = FIELDS.get(kind, FIELDS[KIND_CASE])
    out: list[str] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        for field in text_fields:
            out.append(str(q.get(field) or ""))
        for field in list_fields:
            values = q.get(field)
            out.extend(str(v) for v in (values if isinstance(values, list) else []))
    return out


def _apply_strings(questions: list, translated: list[str], kind: str = KIND_CASE) -> list[dict]:
    """`_extract_strings` tartibidagi tarjimalarni savollarga qaytarib joylaydi."""
    text_fields, list_fields = FIELDS.get(kind, FIELDS[KIND_CASE])
    out: list[dict] = []
    cursor = 0
    for q in questions:
        if not isinstance(q, dict):
            continue
        item = dict(q)
        for field in text_fields:
            if cursor < len(translated) and field in q:
                value = translated[cursor].strip()
                item[field] = value or str(q.get(field) or "")
            cursor += 1
        for field in list_fields:
            original = q.get(field) if isinstance(q.get(field), list) else []
            if field in q and isinstance(q.get(field), list):
                # Element soni asl ro'yxatdan olinadi — `correctOptionIndex` o'sha javobga ishora qilib qoladi.
                chunk = translated[cursor : cursor + len(original)]
                item[field] = [
                    (value.strip() or str(orig)) for value, orig in zip(chunk, original)
                ] + [str(v) for v in original[len(chunk):]]
            cursor += len(original)
        out.append(item)
    return out


def _chunks(items: list[str]) -> list[list[int]]:
    """Indekslarni ~CHUNK_CHARS belgili bo'laklarga ajratadi (bitta uzun matn — alohida bo'lak)."""
    groups: list[list[int]] = []
    current: list[int] = []
    size = 0
    for i, s in enumerate(items):
        n = len(s)
        if current and size + n > CHUNK_CHARS:
            groups.append(current)
            current, size = [], 0
        current.append(i)
        size += n
    if current:
        groups.append(current)
    return groups


def _split_long(text: str) -> list[str]:
    """CHUNK_CHARS dan uzun bitta matnni paragraflar bo'yicha bo'laklaydi."""
    if len(text) <= CHUNK_CHARS:
        return [text]
    parts: list[str] = []
    buf = ""
    for para in re.split(r"(\n\s*\n)", text):
        if len(buf) + len(para) > CHUNK_CHARS and buf:
            parts.append(buf)
            buf = ""
        buf += para
    if buf:
        parts.append(buf)
    return parts


def _system_prompt(kind: str, source: str, target: str, strict_note: str = "") -> str:
    # "CLINICAL" emas: keys klinik bo'lmagan fanda ham bor (IT, til, gigiyena) va
    # tarjimon "klinik" deb bilgan matnga tibbiy atamalar qo'shardi (2026-09-26).
    what = {
        KIND_CASE: "CASE STUDIES",
        KIND_TEST: "MULTIPLE-CHOICE TEST QUESTIONS",
        "lecture": "UNIVERSITY LECTURE NOTES (Markdown)",
        "presentation": "PRESENTATION SLIDE TEXTS",
    }.get(kind, "EDUCATIONAL TEXTS")
    rules = (
        f"You translate {what} for a medical institute from {LANG_NAMES.get(source, source)} "
        f"into {LANG_NAMES.get(target, target)}. Translate the MEANING into natural, professional "
        f"{LANG_NAMES.get(target, target).split(' ')[0]} as a native university lecturer would write it. "
        "Tokens like §H3§ are placeholders — copy them unchanged. "
        "Keep the subject's own terminology accurate (medical terms, drug names, dosages, units, lab values, "
        "Latin terms, formulas, code). Do not add medical content to a non-medical text. "
        "Every array element is ONE independent text (a scenario, an answer option, an explanation) — translate "
        "each element separately; never merge, split or reorder elements. "
        "Empty strings stay empty. Keep Markdown headings (###) and line breaks. "
        "A text may mix languages (e.g. English sentences inside Uzbek) — translate ALL of it into the target "
        "language, never leave a passage in the original language. "
        "Do NOT add explanations, numbering or commentary. Do NOT leave any sentence untranslated. "
    )
    if target == "uz":
        rules += "Uzbek must use the LATIN alphabet (o', g', sh, ch); never output Cyrillic letters. "
    if target == "ru":
        rules += (
            "The result must be genuine Russian. Writing Uzbek words in Cyrillic letters is NOT Russian "
            "and is forbidden; the letters ў, қ, ғ, ҳ must never appear. "
        )
    if strict_note:
        rules += strict_note + " "
    return rules + (
        'Input is a JSON object mapping keys ("t0", "t1", ...) to texts. Return ONLY {"items": {...}} with '
        "EXACTLY the same keys, each value being the translation of that key's text."
    )


def _output_budget(chars: int) -> int:
    """Javob uchun token chegarasi matn hajmiga qarab. Arzon model JSON rejimida ba'zan tiqilib,
    chegaragacha bo'sh joy/takror chiqaradi — 12000 tokengacha kutish o'rniga tez to'xtatiladi."""
    return max(1500, min(12000, int(chars * 1.2) + 1000))


def _call(api_key: str, model: str, items: list[str], kind: str, source: str, target: str, strict_note: str) -> list[str] | None:
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[
                {"role": "system", "content": _system_prompt(kind, source, target, strict_note)},
                {
                    "role": "user",
                    "content": json.dumps({f"t{i}": v for i, v in enumerate(items)}, ensure_ascii=False, separators=(",", ":")),
                },
            ],
            model=model,
            usage_kind=f"{kind}_translate",
            max_tokens=_output_budget(sum(len(v) for v in items)),
            temperature=0.1,
            timeout_sec=240,
            response_format={"type": "json_object"},
        )
        data = json.loads(raw or "{}")
        got = data.get("items", data) if isinstance(data, dict) else None
        # Kalitlar bo'yicha qabul qilinadi: massivda model elementlarni bo'lib/qo'shib yuborib, butun bo'lak yiqilardi.
        if isinstance(got, dict) and all(f"t{i}" in got for i in range(len(items))):
            return [str(got[f"t{i}"]) for i in range(len(items))]
        if isinstance(got, list) and len(got) == len(items):
            return [str(v) for v in got]
        logger.warning("tarjima: kutilgan %d ta, kelgani %s", len(items), len(got) if isinstance(got, (list, dict)) else "-")
        return None
    except Exception as exc:  # noqa: BLE001 — tarjima yiqilsa yozuv asl tilida qoladi
        logger.warning("tarjima muvaffaqiyatsiz (%s): %s", target, exc)
        return None


def _call_plain(api_key: str, model: str, text: str, kind: str, source: str, target: str, strict_note: str) -> str | None:
    """Bitta matn — JSON rejimisiz va QISQA ko'rsatma bilan. Arzon model uzun ko'rsatmada (ayniqsa
    "lotin atamalarini saqla") lotin yozuvidagi o'zbekcha matnni ba'zan tarjima qilmay qaytaradi yoki
    JSON rejimida tiqilib qoladi; qisqa ko'rsatma bilan o'sha matn odatda to'g'ri o'giriladi."""
    src_name = LANG_NAMES.get(source, source).split(" ")[0]
    dst_name = LANG_NAMES.get(target, target).split(" ")[0]
    system = (
        f"You are a professional academic translator. Translate the user's text from {src_name} into {dst_name}. "
        "Output only the translation — no quotes, no commentary."
    )
    if "§H" in text:
        system += " Tokens like §H3§ are placeholders — copy them unchanged."
    if target == "uz":
        system += " Use the Latin Uzbek alphabet."
    if strict_note:
        system += " " + strict_note
    try:
        raw = oai.generate_openai_chat(
            api_key,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": text}],
            model=model,
            usage_kind=f"{kind}_translate",
            max_tokens=_output_budget(len(text)),
            temperature=0.2,
            timeout_sec=240,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("tarjima (oddiy) muvaffaqiyatsiz (%s): %s", target, exc)
        return None
    out = (raw or "").strip()
    return out or None


def _is_copy(source_text: str, translated: str) -> bool:
    src = (source_text or "").strip()
    return len(_LAT.findall(src)) + len(_CYR.findall(src)) >= 40 and (translated or "").strip() == src


def _halves(text: str) -> tuple[str, str] | None:
    """Matnni o'rtasiga eng yaqin paragraf, qator yoki gap chegarasidan ikkiga bo'ladi."""
    mid = len(text) // 2
    for sep in ("\n\n", "\n", ". "):
        cuts = [m.end() for m in re.finditer(re.escape(sep), text) if 0 < m.end() < len(text)]
        if cuts:
            cut = min(cuts, key=lambda c: abs(c - mid))
            return text[:cut], text[cut:]
    return None


def _call_piecewise(
    api_key: str, model: str, text: str, kind: str, source: str, target: str, strict_note: str, depth: int = 0,
    *, already_failed: bool = False,
) -> str | None:
    """Bitta matnni o'giradi; javob kesilsa (ruscha matn ko'proq token oladi) — ikkiga bo'lib qayta so'raydi."""
    if not text.strip():
        return text
    res = None if already_failed else _call(api_key, model, [text], kind, source, target, strict_note)
    if res is not None:
        return res[0]
    plain = _call_plain(api_key, model, text, kind, source, target, strict_note)
    if plain is not None:
        return plain
    halves = _halves(text) if depth < 3 and len(text) > 600 else None
    if halves is None:
        return None
    parts = [_call_piecewise(api_key, model, h, kind, source, target, strict_note, depth + 1) for h in halves]
    if any(x is None for x in parts):
        return None
    # Bo'linish joyidagi ajratgich (yangi qator/bo'shliq) saqlanadi: model uni odatda olib tashlaydi.
    tail = halves[0][len(halves[0].rstrip()):]
    return parts[0].rstrip() + tail + parts[1].lstrip()


def _translate_strings(
    api_key: str, model: str, items: list[str], target: str, *, kind: str = KIND_CASE, source: str = "uz", strict_note: str = ""
) -> list[str] | None:
    """Matnlar ro'yxatini `target` tiliga o'giradi — bo'lak-bo'lak, tartib va uzunlik saqlanadi."""
    if not items:
        return []
    # Juda uzun bitta matn paragraflarga bo'linadi va keyin qayta yig'iladi.
    flat: list[str] = []
    owners: list[int] = []
    for i, s in enumerate(items):
        for piece in _split_long(_protect_headings(s)):
            flat.append(piece)
            owners.append(i)
    out_flat: list[str] = [""] * len(flat)
    for group in _chunks(flat):
        part = [flat[i] for i in group]
        if not any(p.strip() for p in part):
            continue
        res = _call(api_key, model, part, kind, source, target, strict_note)
        if res is None and len(group) == 1:
            one = _call_piecewise(api_key, model, flat[group[0]], kind, source, target, strict_note, already_failed=True)
            res = None if one is None else [one]
        if res is None and len(group) > 1:
            # Bo'lak yiqildi (ko'pincha javob kesilgan yoki soni adashgan) — elementlarni bittadan so'raymiz.
            res = []
            for i in group:
                one = _call_piecewise(api_key, model, flat[i], kind, source, target, strict_note)
                if one is None:
                    return None
                res.append(one)
        if res is None:
            return None
        for i, value in zip(group, res):
            # Model matnni tarjima qilmay aynan qaytargan — qisqa ko'rsatma bilan qayta so'raladi.
            if _is_copy(flat[i], value):
                value = _call_plain(api_key, model, flat[i], kind, source, target, strict_note) or value
            out_flat[i] = value
    merged = [""] * len(items)
    for owner, value in zip(owners, out_flat):
        merged[owner] += value
    for i, src in enumerate(items):
        protected = _protect_headings(src)
        wanted = _HEADING_TOKEN.findall(protected)
        if wanted and sorted(_HEADING_TOKEN.findall(merged[i])) != sorted(wanted):
            # Model uzun keysda bo'lim sarlavhasini ("Muammo", "Berilgan shartlar") tashlab
            # yubordi — keys bo'limma-bo'lim qayta o'giriladi, sarlavhalar aniq joyida qoladi.
            sectioned = _translate_sections(api_key, model, protected, kind, source, target, strict_note)
            if sectioned is not None:
                merged[i] = sectioned
    return [_restore_headings(m, target) for m in merged]


def _translate_sections(
    api_key: str, model: str, protected: str, kind: str, source: str, target: str, strict_note: str
) -> str | None:
    """Sarlavha belgilari (§H..§) bo'yicha bo'lib, faqat matn qismlarini o'giradi."""
    lines = protected.split("\n")
    blocks: list[tuple[str, list[str]]] = [("", [])]
    for line in lines:
        if _HEADING_TOKEN.search(line) and len(line) < 40:
            blocks.append((line, []))
        else:
            blocks[-1][1].append(line)
    bodies = ["\n".join(body).strip("\n") for _, body in blocks]
    translated = _translate_strings(api_key, model, [b for b in bodies if b.strip()], target,
                                    kind=kind, source=source, strict_note=strict_note)
    if translated is None:
        return None
    it = iter(translated)
    out: list[str] = []
    for (head, _), body in zip(blocks, bodies):
        if head:
            out.append(head)
        if body.strip():
            out.append(next(it))
    return "\n".join(out)


def _rejected_note(target: str, got: str) -> str:
    return (
        f"PREVIOUS ATTEMPT WAS REJECTED: the output was not {LANG_NAMES[target]} "
        f"(detected: {got}) or was left untranslated. Translate every sentence properly."
    )


def _translate_question(
    api_key: str, model: str, q: dict, kind: str, source: str, target: str, note: str = ""
) -> dict | None:
    source_strings = _extract_strings([q], kind)
    for _attempt in range(3):
        translated = _translate_strings(api_key, model, source_strings, target, kind=kind, source=source, strict_note=note)
        if translated is not None:
            candidate = _apply_strings([q], translated, kind)[0]
            if _translation_ok(q, candidate, target, kind):
                return candidate
            note = _rejected_note(target, detect_language(_questions_text([candidate], kind)))
    return None


def _source_hash(questions: list, kind: str) -> str:
    return hashlib.sha1(_questions_text(questions, kind).encode("utf-8")).hexdigest()[:16]


def ensure_translations(
    db: Session,
    item: PreparedContent,
    langs: tuple[str, ...] = SUPPORTED_LANGS,
) -> bool:
    """Yetishmayotgan yoki yaroqsiz tillarni to'ldiradi. O'zgarish bo'lsa True.

    Idempotent: yaroqli tarjimaga tegilmaydi, yarim ish keyingi chaqiruvda davom etadi.
    """
    if item.kind not in FIELDS:
        return False
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        logger.info("OPENAI_API_KEY yo'q — tarjima o'tkazib yuborildi")
        return False

    payload = dict(item.payload) if isinstance(item.payload, dict) else {}
    questions = [q for q in payload.get("questions") or [] if isinstance(q, dict)]
    if not questions:
        return False
    kind = item.kind
    primary = primary_language(payload)
    translations = {k: dict(v) for k, v in (payload.get("translations") or {}).items() if isinstance(v, dict)}

    changed = False
    # Asosiy til tarjimalar ichida turmasin (ruscha keysning "ruscha tarjimasi" — nusxa).
    if primary in translations:
        translations.pop(primary)
        changed = True
    if payload.get("primaryLanguage") != primary:
        changed = True

    probe = {**payload, "translations": translations}
    missing = [lang for lang in langs if lang != primary and not _valid_block(probe, lang, kind)]

    model = settings.openai_fast_model
    for lang in missing:
        # Avval hamma savol bitta partiyada (bo'laklab) — keyin faqat yaroqsiz chiqqan savol alohida qayta so'raladi.
        rows: list[dict] = []
        batch = _translate_strings(api_key, model, _extract_strings(questions, kind), lang, kind=kind, source=primary)
        first_pass = _apply_strings(questions, batch, kind) if batch is not None else [None] * len(questions)
        for q, candidate in zip(questions, first_pass):
            if candidate is None or not _translation_ok(q, candidate, lang, kind):
                note = _rejected_note(lang, detect_language(_questions_text([candidate], kind))) if candidate else ""
                candidate = _translate_question(api_key, model, q, kind, primary, lang, note)
            if candidate is None:
                break
            rows.append(candidate)
        # Til FAQAT to'liq tarjima bo'lganda saqlanadi — yarmi o'zbekcha "ruscha" nusxa bo'lmasin.
        if len(rows) != len(questions):
            logger.warning("%s #%s: %s tili to'liq tarjima bo'lmadi", kind, item.id, lang)
            if lang in translations and not _valid_block(probe, lang, kind):
                translations.pop(lang)  # yaroqsiz eski blok ham qolmasin
                changed = True
            continue
        block = dict(translations.get(lang) or {})
        block["questions"] = rows
        if kind == KIND_TEST and payload.get("topic"):
            topic = _translate_strings(api_key, model, [str(payload["topic"])], lang, kind=kind, source=primary)
            if topic and topic[0].strip():
                block["topic"] = topic[0].strip()
        translations[lang] = block
        changed = True

    if not changed:
        return False
    payload["primaryLanguage"] = primary
    payload["translations"] = translations
    payload["i18nSourceHash"] = _source_hash(questions, kind)
    # JSONB o'zgarishi sezilishi uchun butun obyekt qayta biriktiriladi.
    item.payload = payload
    db.add(item)
    return True


def ensure_case_translations(db: Session, item: PreparedContent, langs: tuple[str, ...] = SUPPORTED_LANGS) -> bool:
    """Eski nom — keys uchun `ensure_translations`."""
    return ensure_translations(db, item, langs)


def invalidate_stale_translations(kind: str, old_payload: dict | None, new_payload: dict | None) -> dict | None:
    """Tahrirdan keyin: asosiy savollar o'zgargan-u, tarjimalar o'zgarmagan bo'lsa — ular eskirgan.

    Eskirgan tillar olib tashlanadi (keyin fonda qayta tarjima qilinadi). O'zgartirilgan
    payload qaytadi; hech narsa o'zgarmasa None.
    """
    if kind not in FIELDS or not isinstance(new_payload, dict) or not isinstance(old_payload, dict):
        return None
    old_q = [q for q in old_payload.get("questions") or [] if isinstance(q, dict)]
    new_q = [q for q in new_payload.get("questions") or [] if isinstance(q, dict)]
    if _source_hash(old_q, kind) == _source_hash(new_q, kind):
        return None
    old_tr = old_payload.get("translations") or {}
    new_tr = new_payload.get("translations") or {}
    stale = [lang for lang, block in new_tr.items() if block == old_tr.get(lang)]
    if not stale:
        return None
    payload = dict(new_payload)
    payload["translations"] = {k: v for k, v in new_tr.items() if k not in stale}
    return payload
