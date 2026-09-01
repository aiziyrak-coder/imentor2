"""RAG retrieval: subject_code bo'yicha eng mos kitob chunk'larini topish."""

from __future__ import annotations

import logging
import os
import re

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.book import BookChunk
from app.models.content import AcademicDepartment, CourseSyllabus
from app.services.openai_client import OpenAiClientError, create_embeddings

logger = logging.getLogger(__name__)

_EMBED_TEXT_MAX = 800


def resolve_book_department_id(
    db: Session,
    subject_code: str,
    *,
    syllabus_id: int | None = None,
) -> int | None:
    code = (subject_code or "").strip()
    if syllabus_id:
        try:
            sid = int(syllabus_id)
        except (TypeError, ValueError):
            sid = 0
        if sid > 0:
            syl = db.get(CourseSyllabus, sid)
            if syl and syl.department_id:
                return int(syl.department_id)

    if not code:
        return None

    syl = db.execute(
        select(CourseSyllabus).where(CourseSyllabus.subject_code == code)
    ).scalar_one_or_none()
    if syl and syl.department_id:
        return int(syl.department_id)

    # Online ta'lim fanlari alohida jadvalda turadi, lekin DARSLIKLAR umumiy:
    # `core_bookchunk` kafedra bo'yicha indekslangan. Shu qidiruvsiz online
    # fanda AI ma'ruza va testni darsliksiz, faqat o'z xotirasidan yozardi.
    #
    # Import shu yerda: modul yuklanishida aylanma bog'liqlik bo'lmasin.
    from app.models.online_edu import OnlineSyllabus

    online = db.execute(
        select(OnlineSyllabus).where(OnlineSyllabus.subject_code == code)
    ).scalar_one_or_none()
    if online and online.department_id:
        return int(online.department_id)

    dept_code = code.split("__", 1)[0].strip() if "__" in code else code

    syl = db.execute(
        select(CourseSyllabus)
        .join(AcademicDepartment, CourseSyllabus.department_id == AcademicDepartment.id, isouter=True)
        .where(
            or_(
                CourseSyllabus.subject_code.like(f"{dept_code}__%"),
                AcademicDepartment.code == dept_code,
            ),
            CourseSyllabus.department_id.is_not(None),
        )
    ).scalars().first()
    if syl and syl.department_id:
        return int(syl.department_id)

    dept = db.execute(
        select(AcademicDepartment).where(AcademicDepartment.code == dept_code)
    ).scalar_one_or_none()
    if dept:
        return int(dept.id)
    return None


# --- Kontekstni siqish: takror va shovqinni promptga yubormaslik --------------
#
# Ikkala funksiya ham BAZAGA TEGMAYDI — faqat qidiruv natijasini tozalaydi.
# Chunklar joyida qoladi, shunchaki promptga toza va zich matn boradi.

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|\n+")
_WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)

# Bitta parchadan promptga ketadigan maksimal belgi. Korpusda o'rtacha chunk
# ~3 200 belgi (mediana 3 900) — bu RAG uchun 3-4 barobar katta va kerakli
# jumla shovqin ichida ko'milib ketadi. Savolga eng yaqin oynani kesib olsak,
# model ham aniqroq javob beradi, token ham kamayadi.
FOCUS_WINDOW_CHARS = 1200

# Takrorlarni tashlagach yetarli noyob parcha qolishi uchun necha barobar
# ko'p nomzod olamiz. Korpusda takror ulushi ~57% bo'lgani uchun 3 barobar
# deyarli har doim yetadi.
OVERFETCH = 3

# Bundan qisqa parcha generatsiyaga hech narsa bermaydi.
#
# Korpusda 14 873 ta (1.95%) shunday yozuv bor — OCR chiqindisi, ba'zilari
# bitta belgidan iborat (".", "s"). Ularning vektorlari mazmunsiz bo'lgani
# uchun ISTALGAN savolga "yaqin" chiqishi va haqiqiy matnni siqib chiqarishi
# mumkin. Bir sinovda 30 nomzoddan atigi 127 belgi foydali matn qolgan edi.
MIN_CHUNK_CHARS = 200


def _norm_for_dedup(text: str) -> str:
    """Takrorni aniqlash uchun matnni bir ko'rinishga keltiradi."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def dedupe_chunks(chunks: list[dict], limit: int) -> list[dict]:
    """Bir xil matnli parchalarni tashlab, `limit` tagacha noyobini qaytaradi.

    Korpusning 57 foizi aynan takror (bir kitob bir necha marta yuklangan).
    Filtrsiz `top_k=10` amalda 4-5 ta har xil manba beradi, qolgani nusxa —
    ya'ni pul ham ketadi, model ko'radigan manbalar xilma-xilligi ham kamayadi.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        key = _norm_for_dedup(str(c.get("text") or ""))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def focus_window(text: str, query: str, max_chars: int = FOCUS_WINDOW_CHARS) -> str:
    """Parchadan savolga eng aloqador uzluksiz qismni kesib oladi.

    Gap chegaralari bo'yicha ishlaydi, ya'ni jumla o'rtasidan kesilmaydi.
    Savol so'zlari umuman uchramasa — parchaning boshini qaytaradi (parcha
    baribir vektor qidiruvi bo'yicha eng yaqinlaridan biri).
    """
    body = (text or "").strip()
    if len(body) <= max_chars:
        return body

    terms = {w.lower() for w in _WORD.findall(query or "")}
    sentences = [s2.strip() for s2 in _SENTENCE_SPLIT.split(body) if s2.strip()]
    if not sentences:
        return body[:max_chars].rstrip()

    scores = []
    for sent in sentences:
        if not terms:
            scores.append(0)
            continue
        words = {w.lower() for w in _WORD.findall(sent)}
        scores.append(len(terms & words))

    # Belgilar bo'yicha cheklangan oyna ichida eng ko'p mos so'z to'plangan joy.
    best_start, best_end, best_score, best_len = 0, 0, -1, -1
    start = 0
    length = 0
    running = 0
    for end, sent in enumerate(sentences):
        length += len(sent) + 1
        running += scores[end]
        while length > max_chars and start < end:
            length -= len(sentences[start]) + 1
            running -= scores[start]
            start += 1
        # Ball teng bo'lsa - to'liqroq oyna. Busiz savol so'zlari umuman
        # uchramaganda (hamma ball 0) birinchi jumlagina qaytardi, ya'ni
        # 1200 belgilik joyga 10 belgi ketardi va ma'lumot yo'qolardi.
        if running > best_score or (running == best_score and length > best_len):
            best_start, best_end, best_score, best_len = start, end, running, length

    window = " ".join(sentences[best_start : best_end + 1]).strip()
    if not window:
        return body[:max_chars].rstrip()
    # Kesilganini bildirib qo'yamiz — model matn to'liq emasligini bilsin.
    if len(window) > max_chars:
        # Bitta gapning o'zi chegaradan uzun - so'z chegarasida kesamiz.
        cut = window[:max_chars]
        space = cut.rfind(" ")
        window = (cut[:space] if space > max_chars // 2 else cut).rstrip()
    prefix = "… " if best_start > 0 else ""
    suffix = " …" if best_end < len(sentences) - 1 else ""
    return prefix + window + suffix


def _chunk_to_dict(chunk: BookChunk) -> dict:
    return {
        "book_title": chunk.book.title,
        "page": (
            str(chunk.page_start)
            if chunk.page_start == chunk.page_end
            else f"{chunk.page_start}-{chunk.page_end}"
        ),
        "text": chunk.text,
    }


def retrieve_book_context(
    db: Session,
    subject_code: str,
    query_text: str,
    *,
    top_k: int = 10,
    syllabus_id: int | None = None,
) -> list[dict]:
    rows = retrieve_book_context_many(db, subject_code, [query_text], top_k=top_k, syllabus_id=syllabus_id)
    return rows[0] if rows else []


def retrieve_book_context_many(
    db: Session,
    subject_code: str,
    queries: list[str],
    *,
    top_k: int = 10,
    syllabus_id: int | None = None,
) -> list[list[dict]]:
    subject_code = (subject_code or "").strip()
    cleaned = [str(q or "").strip()[:2000] for q in (queries or [])]
    if not cleaned:
        return []
    if not subject_code and not syllabus_id:
        return [[] for _ in cleaned]

    dept_id = resolve_book_department_id(db, subject_code, syllabus_id=syllabus_id)
    if not dept_id:
        logger.warning("book RAG: department topilmadi subject_code=%r syllabus_id=%r", subject_code, syllabus_id)
        return [[] for _ in cleaned]

    settings = get_settings()
    api_key = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        logger.warning("book RAG: OPENAI_API_KEY yo'q")
        return [[] for _ in cleaned]

    embed_texts = [(q[:_EMBED_TEXT_MAX] if q else ".") for q in cleaned]
    try:
        vectors = create_embeddings(api_key, embed_texts)
    except OpenAiClientError as e:
        logger.warning("book RAG embedding xato: %s", e)
        return [[] for _ in cleaned]

    if len(vectors) != len(cleaned):
        logger.warning("book RAG embedding soni mos emas: got=%s want=%s", len(vectors), len(cleaned))
        return [[] for _ in cleaned]

    out: list[list[dict]] = []
    for q, vec in zip(cleaned, vectors):
        if not q.strip():
            out.append([])
            continue
        # Takrorlar tashlangach `top_k` ta NOYOB parcha qolishi uchun ortig'i
        # bilan olamiz. HNSW indeksi bilan bu ~20 ms, ya'ni deyarli tekin.
        chunks = (
            db.execute(
                select(BookChunk)
                .where(
                    BookChunk.department_id == dept_id,
                    func.length(BookChunk.text) >= MIN_CHUNK_CHARS,
                )
                .order_by(BookChunk.embedding.cosine_distance(vec))
                .limit(top_k * OVERFETCH)
            )
            .scalars()
            .all()
        )
        cands = [_chunk_to_dict(c) for c in chunks]
        picked = dedupe_chunks(cands, top_k)
        raw_chars = sum(len(c["text"]) for c in picked)
        for item in picked:
            item["text"] = focus_window(item["text"], q)
        logger.info(
            "RAG kontekst: %d nomzod -> %d noyob parcha, %d -> %d belgi",
            len(cands),
            len(picked),
            raw_chars,
            sum(len(c["text"]) for c in picked),
        )
        out.append(picked)
    return out


def retrieve_book_context_by_department_id(
    db: Session,
    department_id: int,
    query_text: str,
    *,
    top_k: int = 12,
) -> list[dict]:
    """Kafedra id bo'yicha to'g'ridan-to'g'ri RAG (subject_code shart emas)."""
    try:
        dept_id = int(department_id)
    except (TypeError, ValueError):
        return []
    if dept_id <= 0:
        return []
    q = str(query_text or "").strip()[:2000]
    if not q:
        q = "asosiy tushunchalar diagnostika davolash"

    settings = get_settings()
    api_key = (settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")).strip()
    if not api_key:
        logger.warning("book RAG: OPENAI_API_KEY yo'q")
        return []

    try:
        vectors = create_embeddings(api_key, [q[:_EMBED_TEXT_MAX] or "."])
    except OpenAiClientError as e:
        logger.warning("book RAG embedding xato: %s", e)
        return []
    if not vectors:
        return []
    vec = vectors[0]
    chunks = (
        db.execute(
            select(BookChunk)
            .where(
                BookChunk.department_id == dept_id,
                func.length(BookChunk.text) >= MIN_CHUNK_CHARS,
            )
            .order_by(BookChunk.embedding.cosine_distance(vec))
            .limit(top_k * OVERFETCH)
        )
        .scalars()
        .all()
    )
    picked = dedupe_chunks([_chunk_to_dict(c) for c in chunks], top_k)
    for item in picked:
        item["text"] = focus_window(item["text"], q)
    return picked


def format_book_context_message(chunks: list[dict]) -> str | None:
    if not chunks:
        return None
    parts = []
    for c in chunks:
        if not isinstance(c, dict):
            continue
        text = str(c.get("text") or "").strip()
        if not text:
            continue
        title = str(c.get("book_title") or "").strip() or "Darslik"
        page = str(c.get("page") or "").strip()
        head = f"[Manba: {title}, {page}-bet]" if page else f"[Manba: {title}]"
        parts.append(f"{head}\n{text}")
    if not parts:
        return None
    joined = "\n\n---\n\n".join(parts)
    return (
        "Quyida shu fanga tegishli RASMIY DARSLIK parchalari berilgan. "
        "MAJBURIY QOIDA — manba: javobingizni FAQAT shu quyidagi parchalardagi ma'lumotlarga "
        "asoslab tuzing.\n\n" + joined
    )


_TITLE_NOISE = frozenset({
    "pdf", "epub", "djvu", "doc", "docx", "txt", "scan", "scanned", "ocr",
    "final", "copy", "pca", "dr", "notes", "note", "book", "ebook", "free",
    "download", "compressed", "merged", "org", "com", "net", "www",
    "konkur", "in",
})

_BRACKET_URL_RE = re.compile(r"[\[\(]\s*(?:https?://|www\.)[^\]\)]*[\]\)]", re.I)
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\((?:[^)]*)\)")
_BARE_URL_RE = re.compile(r"(?:https?://\S+|www\.[^\s\]\)]+)", re.I)
_LETTER_YEAR_RE = re.compile(r"([A-Za-zЀ-ӿ])((?:19|20)\d{2})\b")


def clean_book_title(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s = _MD_LINK_RE.sub(r"\1", s)
    s = _BRACKET_URL_RE.sub(" ", s)
    s = _BARE_URL_RE.sub(" ", s)
    s = re.sub(r"\.(pdf|epub|djvu|docx?|txt)\b", " ", s, flags=re.I)
    s = re.sub(r"^\s*\d+[\s.)\-_]+", "", s)
    s = s.replace("_", " ").replace("-", " ")
    s = _LETTER_YEAR_RE.sub(r"\1 \2", s)

    kept: list[str] = []
    for i, part in enumerate(p for p in s.split() if p):
        low = re.sub(r"[^a-z0-9]", "", part.lower())
        if low in _TITLE_NOISE and i >= 1:
            continue
        if kept and kept[-1].lower() == part.lower():
            continue
        kept.append(part)

    out = re.sub(r"\s{2,}", " ", " ".join(kept)).strip(" .,-–—")
    for op, cl in (("(", ")"), ("[", "]"), ("{", "}")):
        extra = out.count(op) - out.count(cl)
        if extra > 0:
            out = out.replace(op, "", extra)
        elif extra < 0:
            out = out.replace(cl, "", -extra)
    out = re.sub(r"\s{2,}", " ", out).strip(" .,-–—")

    if len(out) < 3:
        return str(raw).strip()
    return out[0].upper() + out[1:] if out.islower() else out


def book_references_from_chunks(chunks: list[dict]) -> list[dict]:
    by_title: dict[str, list[str]] = {}
    for c in chunks or []:
        title = str((c or {}).get("book_title") or "").strip()
        page = str((c or {}).get("page") or "").strip()
        if not title:
            continue
        pages = by_title.setdefault(title, [])
        if page and page not in pages:
            pages.append(page)

    out: list[dict] = []
    for title, pages in by_title.items():
        ref: dict = {"title": clean_book_title(title)[:300]}
        if pages:
            def _first_page(p: str) -> int:
                head = p.split("-", 1)[0].strip()
                return int(head) if head.isdigit() else 0

            ordered = sorted(pages, key=_first_page)[:12]
            ref["pages"] = ", ".join(ordered)
        out.append(ref)
    out.sort(key=lambda r: -len(str(r.get("pages") or "")))
    return out[:8]


def retrieve_references_for_queries(
    db: Session,
    subject_code: str,
    queries: list[str],
    *,
    top_k: int = 3,
    syllabus_id: int | None = None,
) -> list[list[dict]]:
    chunk_lists = retrieve_book_context_many(db, subject_code, queries, top_k=top_k, syllabus_id=syllabus_id)
    return [book_references_from_chunks(chunks) for chunks in chunk_lists]
