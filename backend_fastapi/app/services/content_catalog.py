"""Keys va testlar umumiy bazasi — yaratilishi bilan e'lon qilinadi."""

from __future__ import annotations

import hashlib
import hmac
import re
from datetime import timedelta, timezone as dt_timezone
from datetime import datetime as dt_datetime

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.prepared_content import CATALOG_KINDS, KIND_CASE, PreparedContent
from app.services import case_i18n
from app.services.syllabus_access import exclude_restricted_prepared, like_prefix

PUBLISH_DELAY = timedelta(0)
_TOPIC_NORM_RE = re.compile(r"^(\d+)::([^:]+)::(.+)$")
TEST_QUESTION_LIMIT_MIN = 10
TEST_QUESTION_LIMIT_MAX = 30
SUPPORTED_TEST_LANGUAGES = ("uz", "ru", "en")


def parse_test_question_limit(value: str | None, *, param_name: str = "question_limit") -> tuple[int | None, str | None]:
    if value is None or not str(value).strip():
        return None, None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None, (
            f"{param_name} must be an integer between {TEST_QUESTION_LIMIT_MIN} and {TEST_QUESTION_LIMIT_MAX}."
        )
    if parsed < TEST_QUESTION_LIMIT_MIN or parsed > TEST_QUESTION_LIMIT_MAX:
        return None, (
            f"{param_name} must be between {TEST_QUESTION_LIMIT_MIN} and {TEST_QUESTION_LIMIT_MAX}."
        )
    return parsed, None


def parse_test_language(value: str | None, *, param_name: str = "language") -> tuple[str | None, str | None]:
    """Ixtiyoriy til: uz|ru|en. Bo'sh → None (primary til)."""
    if value is None or not str(value).strip():
        return None, None
    lang = str(value).strip().lower()
    if lang not in SUPPORTED_TEST_LANGUAGES:
        return None, f"{param_name} must be one of: {', '.join(SUPPORTED_TEST_LANGUAGES)}."
    return lang, None


def primary_test_language(payload: dict | None) -> str:
    if not isinstance(payload, dict):
        return "uz"
    raw = payload.get("primaryLanguage") or payload.get("primary_language") or "uz"
    lang = str(raw or "uz").strip().lower()
    return lang if lang in SUPPORTED_TEST_LANGUAGES else "uz"


def available_test_languages(payload: dict | None) -> list[str]:
    if not isinstance(payload, dict):
        return ["uz"]
    primary = primary_test_language(payload)
    langs = [primary]
    tr = payload.get("translations")
    primary_qs = payload.get("questions") if isinstance(payload.get("questions"), list) else []
    if isinstance(tr, dict):
        for code in SUPPORTED_TEST_LANGUAGES:
            if code in langs:
                continue
            block = tr.get(code)
            if not isinstance(block, dict):
                continue
            qs = block.get("questions")
            if not isinstance(qs, list) or not qs:
                continue
            usable = 0
            for i, tq in enumerate(qs):
                pq = primary_qs[i] if i < len(primary_qs) and isinstance(primary_qs[i], dict) else None
                if _is_usable_translation_block(
                    lang=code,
                    primary=primary,
                    primary_q=pq,
                    translated_q=tq if isinstance(tq, dict) else None,
                ):
                    usable += 1
            if usable >= max(1, int(len(qs) * 0.6)):
                langs.append(code)
    return langs


def project_test_payload_language(
    payload: dict | None, language: str | None
) -> tuple[dict, str]:
    """
    Top-level topic/questions ni so'ralgan tilga chiqaradi.
    Tarjima yo'q bo'lsa — primary tilga qaytadi.
    Qaytadi: (payload, actual_language).
    """
    base = dict(payload) if isinstance(payload, dict) else {}
    primary = primary_test_language(base)
    wanted = (language or primary).strip().lower()
    if wanted not in SUPPORTED_TEST_LANGUAGES:
        wanted = primary

    if wanted == primary:
        out = dict(base)
        if "primaryLanguage" not in out:
            out["primaryLanguage"] = primary
        return out, primary

    tr = base.get("translations")
    block = tr.get(wanted) if isinstance(tr, dict) else None
    if not isinstance(block, dict) or not isinstance(block.get("questions"), list) or not block["questions"]:
        out = dict(base)
        if "primaryLanguage" not in out:
            out["primaryLanguage"] = primary
        return out, primary

    # Soxta tarjima (uz matn ru kaliti ostida) — primaryga fallback
    primary_qs = base.get("questions") if isinstance(base.get("questions"), list) else []
    usable = 0
    for i, tq in enumerate(block["questions"]):
        pq = primary_qs[i] if i < len(primary_qs) and isinstance(primary_qs[i], dict) else None
        if _is_usable_translation_block(lang=wanted, primary=primary, primary_q=pq, translated_q=tq if isinstance(tq, dict) else None):
            usable += 1
    if usable < max(1, int(len(block["questions"]) * 0.6)):
        out = dict(base)
        if "primaryLanguage" not in out:
            out["primaryLanguage"] = primary
        return out, primary

    out = dict(base)
    out["topic"] = block.get("topic") or base.get("topic")
    out["questions"] = list(block["questions"])
    if isinstance(block.get("references"), list):
        out["references"] = list(block["references"])
    # Asosiy til kontentini translations ichida saqlab qolamiz (agar yo'q bo'lsa)
    translations = dict(tr) if isinstance(tr, dict) else {}
    if primary not in translations and isinstance(base.get("questions"), list):
        primary_block: dict = {
            "topic": base.get("topic"),
            "questions": list(base["questions"]),
        }
        if isinstance(base.get("references"), list):
            primary_block["references"] = list(base["references"])
        translations[primary] = primary_block
    out["translations"] = translations
    if "primaryLanguage" not in out:
        out["primaryLanguage"] = primary
    return out, wanted


def slice_test_payload(payload: dict | None, limit: int | None) -> tuple[dict, int, int]:
    base = dict(payload) if isinstance(payload, dict) else {}
    questions = base.get("questions")
    if not isinstance(questions, list):
        base["questions"] = []
        return base, 0, 0
    available = len(questions)
    if limit is None:
        return base, available, available
    taken = questions[:limit]
    base["questions"] = taken
    # Tarjimalarni ham bir xil uzunlikda kesamiz
    tr = base.get("translations")
    if isinstance(tr, dict):
        next_tr: dict = {}
        for lang, block in tr.items():
            if not isinstance(block, dict):
                continue
            qs = block.get("questions")
            if isinstance(qs, list):
                next_tr[lang] = {**block, "questions": qs[:limit]}
            else:
                next_tr[lang] = block
        base["translations"] = next_tr
    return base, available, len(taken)


def normalize_question_text_key(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def filter_by_stored_question_count(
    stmt: Select, *, min_questions: int | None = None, max_questions: int | None = None
) -> Select:
    if min_questions is None and max_questions is None:
        return stmt
    # Postgres: payload.questions faqat massiv bo'lsa uzunligini tekshiramiz.
    stmt = stmt.where(func.jsonb_typeof(PreparedContent.payload["questions"]) == "array")
    if min_questions is not None:
        stmt = stmt.where(func.jsonb_array_length(PreparedContent.payload["questions"]) >= min_questions)
    if max_questions is not None:
        stmt = stmt.where(func.jsonb_array_length(PreparedContent.payload["questions"]) <= max_questions)
    return stmt


_UZ_MARKERS = (
    "bemor",
    "yoshli",
    "qaysi",
    "ushbu",
    "hisoblanadi",
    "murojaat",
    "aniqlanadi",
    "tavsiya",
    "bo'lib",
    "shifokorga",
    "davosida",
)


def _looks_like_uzbek(text: str) -> bool:
    s = (text or "").lower()
    return sum(1 for m in _UZ_MARKERS if m in s) >= 2


def _cyrillic_count(text: str) -> int:
    return sum(1 for ch in (text or "") if "\u0400" <= ch <= "\u04FF")


def _question_text_block(q: dict) -> dict | None:
    text = str(q.get("question") or q.get("text") or "").strip()
    if not text:
        return None
    options = q.get("options")
    block: dict = {
        "question": text,
        "options": list(options) if isinstance(options, list) else [],
        "explanation": str(q.get("explanation") or "").strip(),
    }
    opt_expl = q.get("optionExplanations")
    if isinstance(opt_expl, list) and any(str(x or "").strip() for x in opt_expl):
        block["optionExplanations"] = [str(x or "").strip() for x in opt_expl[:5]]
    return block


def _is_usable_translation_block(
    *,
    lang: str,
    primary: str,
    primary_q: dict | None,
    translated_q: dict | None,
) -> bool:
    """Soxta tarjimani (uz matnni ru deb saqlash) API javobidan chiqarib tashlaydi."""
    if lang == primary:
        return True
    if not isinstance(translated_q, dict):
        return False
    text = str(translated_q.get("question") or translated_q.get("text") or "").strip()
    if not text:
        return False
    src = ""
    if isinstance(primary_q, dict):
        src = str(primary_q.get("question") or primary_q.get("text") or "").strip()
    if src and normalize_question_text_key(text) == normalize_question_text_key(src):
        return False
    if lang == "ru":
        if _cyrillic_count(text) < 8:
            return False
        if _looks_like_uzbek(text):
            return False
    if lang == "en" and _looks_like_uzbek(text):
        return False
    return True


def _questions_lists_by_language(payload: dict) -> dict[str, list]:
    """Primary + translations → {uz: [q...], ru: [q...], en: [q...]}."""
    by_lang: dict[str, list] = {}
    primary = primary_test_language(payload)
    primary_qs = payload.get("questions")
    if isinstance(primary_qs, list):
        by_lang[primary] = primary_qs
    tr = payload.get("translations")
    if isinstance(tr, dict):
        for code in SUPPORTED_TEST_LANGUAGES:
            block = tr.get(code)
            if not isinstance(block, dict):
                continue
            qs = block.get("questions")
            if isinstance(qs, list) and qs:
                by_lang[code] = qs
    return by_lang


def collect_unique_questions_from_tests(
    items: list[PreparedContent],
    *,
    shuffle: bool = True,
    count: int | None = None,
    language: str | None = None,
) -> tuple[list[dict], int, int]:
    """
    Unique savollar pooli — har bir savol `languages` ichida mavjud tillarda
    (uz/ru/en) qaytadi. `language` berilsa faqat shu til qoldiriladi (ixtiyoriy).
    """
    import random as _random

    seen: set[str] = set()
    pool: list[dict] = []
    tests_scanned = 0
    only_lang = (language or "").strip().lower() or None
    if only_lang and only_lang not in SUPPORTED_TEST_LANGUAGES:
        only_lang = None

    for item in items:
        tests_scanned += 1
        raw_payload = item.payload if isinstance(item.payload, dict) else {}
        payload_refs = raw_payload.get("references")
        payload_refs = list(payload_refs) if isinstance(payload_refs, list) and payload_refs else []
        by_lang = _questions_lists_by_language(raw_payload)
        primary = primary_test_language(raw_payload)
        primary_qs = by_lang.get(primary) or next(iter(by_lang.values()), None)
        if not isinstance(primary_qs, list):
            continue
        source_id = int(item.id or 0)

        for i, q in enumerate(primary_qs):
            if not isinstance(q, dict):
                continue
            languages: dict[str, dict] = {}
            primary_q = primary_qs[i] if isinstance(primary_qs[i], dict) else None
            for code in SUPPORTED_TEST_LANGUAGES:
                qs = by_lang.get(code)
                if not isinstance(qs, list) or i >= len(qs) or not isinstance(qs[i], dict):
                    continue
                if not _is_usable_translation_block(
                    lang=code, primary=primary, primary_q=primary_q, translated_q=qs[i]
                ):
                    continue
                block = _question_text_block(qs[i])
                if block:
                    languages[code] = block
            if not languages:
                continue
            if only_lang:
                if only_lang not in languages:
                    continue
                languages = {only_lang: languages[only_lang]}

            # Unique kalit: primary matn (yo'q bo'lsa birinchi mavjud til)
            key_src = languages.get(primary) or next(iter(languages.values()))
            key = normalize_question_text_key(key_src.get("question") or "")
            if not key or key in seen:
                continue
            seen.add(key)

            correct = q.get("correctOptionIndex")
            if not isinstance(correct, int):
                correct = 0
            refs = q.get("references")
            if not (isinstance(refs, list) and refs):
                refs = payload_refs
            row: dict = {
                "correctOptionIndex": correct,
                "available_languages": list(languages.keys()),
                "languages": languages,
            }
            if isinstance(refs, list) and refs:
                row["references"] = list(refs)
            if source_id > 0:
                row["source_test_id"] = source_id
            pool.append(row)

    available = len(pool)
    if shuffle and pool:
        _random.shuffle(pool)
    if count is not None:
        pool = pool[: max(0, int(count))]
    return pool, available, tests_scanned


# ---------------- keys (case) ----------------
#
# Keyslar testlardan farqli: bitta tilda saqlanadi (translations bloki yo'q)
# va savol o'rniga `scenario` + `answer` juftligidan iborat. Shuning uchun
# ular uchun alohida parse/slice/collect yordamchilari bor.

CASE_QUESTION_LIMIT_MIN = 1
CASE_QUESTION_LIMIT_MAX = 50


def parse_case_question_limit(
    value: str | None, *, param_name: str = "question_limit"
) -> tuple[int | None, str | None]:
    if value is None or not str(value).strip():
        return None, None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None, (
            f"{param_name} must be an integer between {CASE_QUESTION_LIMIT_MIN} and {CASE_QUESTION_LIMIT_MAX}."
        )
    if parsed < CASE_QUESTION_LIMIT_MIN or parsed > CASE_QUESTION_LIMIT_MAX:
        return None, f"{param_name} must be between {CASE_QUESTION_LIMIT_MIN} and {CASE_QUESTION_LIMIT_MAX}."
    return parsed, None


#: Keys savolining tarjima qilinadigan maydonlari — `languages` obyekti
#: aynan shulardan yig'iladi. Qolganlari (`correctOptionIndex`,
#: `references`, `source_case_id`, `topic`) tildan mustaqil.
CASE_LOCALIZED_FIELDS = ("scenario", "answer", "focus", "options", "explanation")


def _case_language_block(q: dict) -> dict:
    options = q.get("options")
    return {
        "scenario": str(q.get("scenario") or q.get("question") or "").strip(),
        "answer": str(q.get("answer") or "").strip(),
        "focus": str(q.get("focus") or "").strip(),
        "options": [str(v) for v in options] if isinstance(options, list) else [],
        "explanation": str(q.get("explanation") or "").strip(),
    }


def _case_scenario_block(q: dict) -> dict | None:
    """Bitta keys savoli — UI to'g'ridan-to'g'ri chiqara oladigan shaklda."""
    scenario = str(q.get("scenario") or q.get("question") or "").strip()
    if not scenario:
        return None
    options = q.get("options")
    block: dict = {
        "scenario": scenario,
        "answer": str(q.get("answer") or "").strip(),
        "focus": str(q.get("focus") or "").strip(),
        "options": list(options) if isinstance(options, list) else [],
        "explanation": str(q.get("explanation") or "").strip(),
    }
    correct = q.get("correctOptionIndex")
    if isinstance(correct, int) and block["options"]:
        block["correctOptionIndex"] = correct
    refs = q.get("references")
    if isinstance(refs, list) and refs:
        block["references"] = list(refs)
    return block


def slice_case_payload(payload: dict | None, limit: int | None) -> tuple[dict, int, int]:
    base = dict(payload) if isinstance(payload, dict) else {}
    questions = base.get("questions")
    if not isinstance(questions, list):
        base["questions"] = []
        return base, 0, 0
    available = len(questions)
    if limit is None:
        return base, available, available
    base["questions"] = questions[:limit]
    return base, available, len(base["questions"])


def collect_case_scenarios(
    items: list[PreparedContent],
    *,
    shuffle: bool = True,
    count: int | None = None,
) -> tuple[list[dict], int, int]:
    """Unique keys-savollari pooli (scenario matni bo'yicha takrorlar olib tashlanadi)."""
    import random as _random

    seen: set[str] = set()
    pool: list[dict] = []
    cases_scanned = 0

    for item in items:
        cases_scanned += 1
        raw_payload = item.payload if isinstance(item.payload, dict) else {}
        questions = raw_payload.get("questions")
        if not isinstance(questions, list):
            continue
        payload_refs = raw_payload.get("references")
        payload_refs = list(payload_refs) if isinstance(payload_refs, list) and payload_refs else []
        source_id = int(item.id or 0)

        # Tarjimalar INDEKS bo'yicha juftlanadi — `case_i18n` tarjima
        # qilingan ro'yxatni asl bilan bir xil uzunlik va tartibda saqlaydi.
        primary_lang = case_i18n.primary_language(raw_payload)
        translated_by_lang: dict[str, list] = {}
        raw_translations = raw_payload.get("translations")
        if isinstance(raw_translations, dict):
            for code, blob in raw_translations.items():
                rows = (blob or {}).get("questions") if isinstance(blob, dict) else None
                if isinstance(rows, list) and rows:
                    translated_by_lang[str(code).strip().lower()] = rows
        item_languages = case_i18n.available_languages(raw_payload)

        for q_index, q in enumerate(questions):
            if not isinstance(q, dict):
                continue
            block = _case_scenario_block(q)
            if block is None:
                continue
            languages = {primary_lang: _case_language_block(q)}
            for code, rows in translated_by_lang.items():
                if q_index < len(rows) and isinstance(rows[q_index], dict):
                    languages[code] = _case_language_block(rows[q_index])
            block["languages"] = languages
            block["available_languages"] = [c for c in item_languages if c in languages]
            block["primary_language"] = primary_lang
            key = normalize_question_text_key(block["scenario"])
            if not key or key in seen:
                continue
            seen.add(key)
            if not block.get("references") and payload_refs:
                block["references"] = list(payload_refs)
            if source_id > 0:
                block["source_case_id"] = source_id
            block["topic"] = item.topic
            pool.append(block)

    available = len(pool)
    if shuffle and pool:
        _random.shuffle(pool)
    if count is not None:
        pool = pool[: max(0, int(count))]
    return pool, available, cases_scanned


def _now() -> dt_datetime:
    return dt_datetime.now(dt_timezone.utc)


def effective_subject_code(item: PreparedContent) -> str:
    code = (item.subject_code or "").strip()
    if code:
        return code
    if item.syllabus is not None:
        return (item.syllabus.subject_code or "").strip()
    return ""


def effective_subject_name(item: PreparedContent) -> str:
    name = (item.subject_name or "").strip()
    if name:
        return name
    if item.syllabus is not None:
        return (item.syllabus.subject_name or "").strip()
    return ""


def published_catalog_stmt() -> Select:
    """Umumiy (staff va login'siz ochiq) katalog. Cheklangan/shaxsiy fanlar
    kontenti bu yerga tushmaydi — u faqat egasining o'z sahifasida."""
    cutoff = _now() - PUBLISH_DELAY
    return exclude_restricted_prepared(
        select(PreparedContent).where(
            PreparedContent.kind.in_(CATALOG_KINDS),
            PreparedContent.created_at <= cutoff,
            # Eskirgan material boshqa o'qituvchiga tavsiya qilinmaydi.
            PreparedContent.retired_reason == "",
        ),
        PreparedContent,
    )


def is_published(item: PreparedContent) -> bool:
    return item.created_at <= _now() - PUBLISH_DELAY


def publish_at_iso(item: PreparedContent) -> str:
    return (item.created_at + PUBLISH_DELAY).isoformat()


def parse_topic_norm(topic_norm: str) -> dict[str, str]:
    raw = (topic_norm or "").strip()
    match = _TOPIC_NORM_RE.match(raw)
    if not match:
        return {"syllabus_id": "", "variant_label": "", "topic_code": ""}
    return {"syllabus_id": match.group(1), "variant_label": match.group(2), "topic_code": match.group(3)}


def enrich_catalog_meta(item: PreparedContent) -> tuple[str, str]:
    variant = (item.variant_label or "").strip()
    topic_code = (item.topic_code or "").strip()
    if variant and topic_code:
        return variant, topic_code
    parsed = parse_topic_norm(item.topic_norm)
    return variant or parsed["variant_label"], topic_code or parsed["topic_code"]


def question_count(item: PreparedContent) -> int:
    payload = item.payload if isinstance(item.payload, dict) else {}
    questions = payload.get("questions")
    return len(questions) if isinstance(questions, list) else 0


def catalog_verification_code(item: PreparedContent) -> str:
    settings = get_settings()
    raw = f"{item.id}:{item.created_at.isoformat()}:{item.kind}:{item.topic_norm}:{item.owner_key}"
    digest = hmac.new(settings.django_secret_key.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest[:16].upper()


def catalog_document_id(item: PreparedContent) -> str:
    return f"IM-{item.id:06d}-{catalog_verification_code(item)[:8]}"


def catalog_item_summary(item: PreparedContent, *, include_verification: bool = False) -> dict:
    variant_label, topic_code = enrich_catalog_meta(item)
    dept_name = ""
    dept_code = ""
    catalog_subject_name = ""
    if item.syllabus is not None:
        catalog_subject_name = (item.syllabus.subject_name or "").strip()
        department = item.syllabus.department
        if department is not None:
            dept_name = department.name or ""
            dept_code = department.code or ""
    data = {
        "id": item.id,
        "kind": item.kind,
        "topic": item.topic,
        "topic_norm": item.topic_norm,
        "subject_name": item.subject_name or catalog_subject_name or effective_subject_name(item) or "",
        "subject_code": effective_subject_code(item) or item.subject_code or "",
        "department_name": dept_name,
        "department_code": dept_code,
        "variant_label": variant_label,
        "topic_code": topic_code,
        "syllabus_id": item.syllabus_id,
        "author_display_name": item.author_display_name or item.owner_key,
        "owner_key": item.owner_key,
        "created_at": item.created_at.isoformat(),
        "question_count": question_count(item),
        "is_published": is_published(item),
        "publish_at": publish_at_iso(item),
    }
    if include_verification:
        data["document_id"] = catalog_document_id(item)
        data["verification_code"] = catalog_verification_code(item)
    return data


def filter_catalog_stmt(stmt: Select, params: dict) -> Select:
    kind = (params.get("kind") or "").strip()
    if kind in CATALOG_KINDS:
        stmt = stmt.where(PreparedContent.kind == kind)

    subject_code = (params.get("subject_code") or "").strip()
    if subject_code:
        conds = [
            PreparedContent.subject_code == subject_code,
            PreparedContent.syllabus.has(CourseSyllabus.subject_code == subject_code),
        ]
        if "__" in subject_code:
            dept = subject_code.split("__", 1)[0].strip()
            if dept:
                conds.append(PreparedContent.subject_code == dept)
                conds.append(
                    PreparedContent.syllabus.has(
                        CourseSyllabus.department.has(AcademicDepartment.code == dept)
                    )
                )
        stmt = stmt.where(or_(*conds))

    department_code = (params.get("department_code") or "").strip()
    if department_code:
        stmt = stmt.where(
            or_(
                PreparedContent.syllabus.has(
                    CourseSyllabus.department.has(AcademicDepartment.code == department_code)
                ),
                PreparedContent.subject_code == department_code,
                PreparedContent.syllabus.has(
                    CourseSyllabus.subject_code.like(f"{like_prefix(department_code)}\\_\\_%", escape="\\")
                ),
            )
        )

    syllabus_id = (params.get("syllabus_id") or "").strip()
    if syllabus_id:
        try:
            stmt = stmt.where(PreparedContent.syllabus_id == int(syllabus_id))
        except (TypeError, ValueError):
            pass

    variant_label = (params.get("variant_label") or "").strip()
    if variant_label:
        stmt = stmt.where(func.lower(PreparedContent.variant_label) == variant_label.lower())

    topic_code = (params.get("topic_code") or "").strip()
    if topic_code:
        stmt = stmt.where(func.lower(PreparedContent.topic_code) == topic_code.lower())

    q = (params.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                PreparedContent.topic.ilike(like),
                PreparedContent.subject_name.ilike(like),
                PreparedContent.author_display_name.ilike(like),
                PreparedContent.topic_norm.ilike(like),
                PreparedContent.variant_label.ilike(like),
                PreparedContent.topic_code.ilike(like),
            )
        )

    author = (params.get("author") or "").strip()
    if author:
        stmt = stmt.where(PreparedContent.author_display_name.ilike(f"%{author}%"))

    sort = (params.get("sort") or "subject").strip()
    if sort == "newest":
        return stmt.order_by(PreparedContent.created_at.desc())
    if sort == "topic":
        return stmt.order_by(PreparedContent.subject_name, PreparedContent.topic, PreparedContent.created_at.desc())
    return stmt.order_by(
        PreparedContent.subject_name,
        PreparedContent.variant_label,
        PreparedContent.topic_code,
        PreparedContent.topic,
        PreparedContent.created_at.desc(),
    )


def catalog_subjects_summary(db: Session) -> list[dict]:
    cutoff = _now() - PUBLISH_DELAY
    rows = db.execute(
        select(
            PreparedContent.subject_code,
            PreparedContent.subject_name,
            func.count(PreparedContent.id).filter(PreparedContent.kind == KIND_CASE).label("case_count"),
            func.count(PreparedContent.id).filter(PreparedContent.kind != KIND_CASE).label("test_count"),
        )
        .where(
            PreparedContent.kind.in_(CATALOG_KINDS),
            PreparedContent.created_at <= cutoff,
            PreparedContent.subject_name != "",
            PreparedContent.id.in_(published_catalog_stmt().with_only_columns(PreparedContent.id)),
        )
        .group_by(PreparedContent.subject_code, PreparedContent.subject_name)
        .order_by(PreparedContent.subject_name)
    ).all()
    return [
        {
            "subject_code": r.subject_code or "",
            "subject_name": r.subject_name or "",
            "case_count": r.case_count,
            "test_count": r.test_count,
            "total_count": r.case_count + r.test_count,
        }
        for r in rows
    ]


def _clean_i18n(raw: object, source: str) -> dict[str, str]:
    """`{"ru": "...", "en": "..."}` — bo'sh va asl bilan bir xil qiymatlarsiz.

    Asl matnning o'zi tarjima sifatida qaytarilsa, mijoz uni "ruscha bor"
    deb qabul qilib, ruscha saytda o'zbekcha matnni ko'rsatib qo'yardi.
    Shuning uchun bunday yozuvlar tashlab yuboriladi.
    """
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for code in SUPPORTED_TEST_LANGUAGES:
        value = str(raw.get(code) or "").strip()
        if value and value != (source or "").strip():
            out[code] = value
    return out


def _syllabus_department_lookup(db: Session) -> dict[str, dict]:
    rows = db.execute(
        select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True))
    ).scalars().all()
    lookup: dict[str, dict] = {}
    for obj in rows:
        dept = obj.department
        lookup[obj.subject_code] = {
            "subject_name": obj.subject_name,
            "subject_name_i18n": _clean_i18n(obj.name_i18n, obj.subject_name),
            "department_name": dept.name if dept else "",
            "department_name_i18n": (
                _clean_i18n(getattr(dept, "name_i18n", None), dept.name) if dept else {}
            ),
            "department_code": dept.code if dept else "",
        }
    return lookup


def build_catalog_stats(db: Session, *, published_only: bool = False, kind: str | None = None) -> dict:
    now = _now()
    cutoff = now - PUBLISH_DELAY
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    stmt = select(PreparedContent)
    if kind in CATALOG_KINDS:
        stmt = stmt.where(PreparedContent.kind == kind)
    else:
        stmt = stmt.where(PreparedContent.kind.in_(CATALOG_KINDS))
    if published_only:
        stmt = exclude_restricted_prepared(
            stmt.where(PreparedContent.created_at <= cutoff, PreparedContent.retired_reason == ""),
            PreparedContent,
        )

    items = list(db.execute(stmt.order_by(PreparedContent.created_at.desc())).scalars().all())
    questions_total = sum(question_count(i) for i in items)
    published_count = sum(1 for i in items if is_published(i))
    pending_publish_count = len(items) - published_count

    authors = {i.owner_key for i in items}
    subjects = {(i.subject_code or "", i.subject_name or "") for i in items if i.subject_code}
    variants: set[tuple[str, str]] = set()
    topics: set[tuple[str, str, str]] = set()

    by_subject_map: dict[str, dict] = {}
    by_variant_map: dict[str, dict] = {}
    by_topic_map: dict[str, dict] = {}
    by_author_map: dict[str, dict] = {}

    for item in items:
        variant, topic_code = enrich_catalog_meta(item)
        subj_code = effective_subject_code(item)
        subj_name = effective_subject_name(item) or item.subject_name or ""
        qc = question_count(item)
        pub = is_published(item)
        is_case = item.kind == KIND_CASE

        if variant:
            variants.add((item.subject_code or "", variant))
        topics.add((item.subject_code or "", variant, topic_code or item.topic_norm or item.topic))

        subj_row = by_subject_map.setdefault(
            subj_code,
            {
                "subject_code": subj_code,
                "subject_name": subj_name,
                "case_count": 0,
                "test_count": 0,
                "questions_total": 0,
                "pending_publish_count": 0,
                "variants_distinct": set(),
                "topics_distinct": set(),
            },
        )
        subj_row["case_count" if is_case else "test_count"] += 1
        subj_row["questions_total"] += qc
        if not pub:
            subj_row["pending_publish_count"] += 1
        if variant:
            subj_row["variants_distinct"].add(variant)
        subj_row["topics_distinct"].add(topic_code or item.topic)

        if variant:
            var_key = f"{subj_code}::{variant}"
            var_row = by_variant_map.setdefault(
                var_key,
                {
                    "subject_code": subj_code,
                    "subject_name": subj_name,
                    "variant_label": variant,
                    "case_count": 0,
                    "test_count": 0,
                    "questions_total": 0,
                    "topics_distinct": set(),
                },
            )
            var_row["case_count" if is_case else "test_count"] += 1
            var_row["questions_total"] += qc
            var_row["topics_distinct"].add(topic_code or item.topic)

        topic_key = f"{subj_code}::{variant}::{topic_code or item.topic}"
        topic_row = by_topic_map.setdefault(
            topic_key,
            {
                "subject_code": subj_code,
                "subject_name": subj_name,
                "variant_label": variant,
                "topic_code": topic_code,
                "topic": item.topic,
                "case_count": 0,
                "test_count": 0,
                "questions_total": 0,
            },
        )
        topic_row["case_count" if is_case else "test_count"] += 1
        topic_row["questions_total"] += qc

        author_row = by_author_map.setdefault(
            item.owner_key,
            {
                "owner_key": item.owner_key,
                "author_display_name": item.author_display_name or item.owner_key,
                "case_count": 0,
                "test_count": 0,
                "questions_total": 0,
            },
        )
        author_row["case_count" if is_case else "test_count"] += 1
        author_row["questions_total"] += qc

    case_count = sum(1 for i in items if i.kind == KIND_CASE)
    test_count = sum(1 for i in items if i.kind != KIND_CASE)

    dept_lookup = _syllabus_department_lookup(db)

    def _apply_department_meta(row: dict) -> dict:
        meta = dept_lookup.get(row.get("subject_code") or "", {})
        row["department_name"] = meta.get("department_name", "")
        row["department_code"] = meta.get("department_code", "")
        if meta.get("subject_name") and not row.get("subject_name"):
            row["subject_name"] = meta["subject_name"]
        # Tarjimalar — mavjud bo'lganicha. Yo'q tilni to'ldirib qo'ymaymiz:
        # mijoz `available_languages` ga qarab o'zi asl tilga qaytadi.
        subject_i18n = meta.get("subject_name_i18n") or {}
        department_i18n = meta.get("department_name_i18n") or {}
        row["subject_name_i18n"] = subject_i18n
        row["department_name_i18n"] = department_i18n
        row["available_languages"] = sorted(
            {"uz", *subject_i18n.keys()},
            key=lambda c: SUPPORTED_TEST_LANGUAGES.index(c)
            if c in SUPPORTED_TEST_LANGUAGES
            else 99,
        )
        return row

    def _finalize_subject(row: dict) -> dict:
        out = dict(row)
        out["variants_distinct"] = len(out.pop("variants_distinct"))
        out["topics_distinct"] = len(out.pop("topics_distinct"))
        out["total_count"] = out["case_count"] + out["test_count"]
        return _apply_department_meta(out)

    def _finalize_variant(row: dict) -> dict:
        out = dict(row)
        out["topics_distinct"] = len(out.pop("topics_distinct"))
        out["total_count"] = out["case_count"] + out["test_count"]
        return _apply_department_meta(out)

    by_subject = sorted(
        (_finalize_subject(row) for row in by_subject_map.values()),
        key=lambda r: (r["subject_name"] or r["subject_code"] or "zzz"),
    )
    by_variant = sorted(
        (_finalize_variant(row) for row in by_variant_map.values()),
        key=lambda r: (r["subject_name"], r["variant_label"]),
    )
    by_topic = sorted(
        ({**row, "total_count": row["case_count"] + row["test_count"]} for row in by_topic_map.values()),
        key=lambda r: (-(r["test_count"] + r["case_count"]), r["subject_name"], r["topic"]),
    )[:50]
    by_author = sorted(
        ({**row, "total_count": row["case_count"] + row["test_count"]} for row in by_author_map.values()),
        key=lambda r: -r["total_count"],
    )[:30]

    recent = [catalog_item_summary(item) for item in items[:15]]

    return {
        "generated_at": now.isoformat(),
        "kind": kind or "all",
        "totals": {
            "case_count": case_count,
            "test_count": test_count,
            "total_count": len(items),
            "questions_total": questions_total,
            "published_count": published_count,
            "pending_publish_count": pending_publish_count,
            "authors_distinct": len(authors),
            "subjects_distinct": len(subjects),
            "variants_distinct": len(variants),
            "topics_distinct": len(topics),
            "created_last_7d": sum(1 for i in items if i.created_at >= week_ago),
            "created_last_30d": sum(1 for i in items if i.created_at >= month_ago),
        },
        "by_subject": by_subject,
        "by_variant": by_variant,
        "by_topic": by_topic,
        "by_author": by_author,
        "recent": recent,
    }
