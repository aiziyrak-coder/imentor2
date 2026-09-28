"""Protokollar kutubxonasi: milliy klinik protokollar, SanPin va SSV buyruqlari.

Nega alohida tur. Kafedra "bizning davolash protokollarimizga to'g'ri kelmayapti"
deb shikoyat qildi (2026-09-24): AI darslik matniga tayanib, O'zbekistonda amal
qiladigan hujjatdan chetga chiqardi. Endi kafedraning protokollari `core_subjectbook`
da `kind='protocol'` bilan saqlanadi va shu kafedra fanlarida generatsiyaga
MAJBURIY manba sifatida qo'shiladi — darslikdan oldin turadi.

Saqlash darsliklar bilan bir xil (`core_subjectbook` + `core_bookchunk`), shuning
uchun mavjud vektor qidiruvi va admin kutubxonasi qayta ishlatiladi.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.book import BookChunk, SubjectBook
from app.services.openai_client import create_embeddings

logger = logging.getLogger(__name__)

KIND = "protocol"
#: Parcha hajmi — darslik parchalariga yaqin, lekin protokol bandlari butun qolsin.
CHUNK_CHARS = 1600
CHUNK_OVERLAP = 200
#: Generatsiyaga qo'shiladigan protokol parchalari soni.
TOP_K = 4

_WS = re.compile(r"[ \t ]+")
_EMPTY_LINES = re.compile(r"\n{3,}")


def clean_text(raw: str) -> str:
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    text = _WS.sub(" ", text)
    return _EMPTY_LINES.sub("\n\n", text).strip()


def split_chunks(text: str, *, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Matnni parchalarga bo'ladi — imkon qadar band/paragraf chegarasidan."""
    body = clean_text(text)
    if not body:
        return []
    out: list[str] = []
    start = 0
    while start < len(body):
        end = min(len(body), start + size)
        if end < len(body):
            window = body[start:end]
            cut = max(window.rfind("\n\n"), window.rfind("\n"), window.rfind(". "))
            if cut > size // 2:
                end = start + cut + 1
        piece = body[start:end].strip()
        if len(piece) >= 120:
            out.append(piece)
        if end >= len(body):
            break
        start = max(end - overlap, start + 1)
    return out


def existing_titles(db: Session, department_id: int) -> set[str]:
    rows = db.execute(
        select(SubjectBook.title).where(SubjectBook.department_id == department_id, SubjectBook.kind == KIND)
    ).scalars().all()
    return {(t or "").strip().lower() for t in rows}


def add_protocol(
    db: Session,
    *,
    department_id: int,
    title: str,
    text: str,
    source_archive: str = "",
    file_name: str = "",
    language: str = "",
    api_key: str,
) -> tuple[SubjectBook | None, int]:
    """Bitta hujjatni protokol sifatida saqlaydi. Qaytaradi: (yozuv, parchalar soni)."""
    import datetime as dt

    chunks = split_chunks(text)
    if not chunks:
        return None, 0
    vectors = create_embeddings(api_key, chunks)
    if len(vectors) != len(chunks):
        raise RuntimeError(f"embedding soni mos emas: {len(vectors)} / {len(chunks)}")

    now = dt.datetime.now(dt.timezone.utc)
    book = SubjectBook(
        department_id=department_id, title=title[:512], source_archive=source_archive[:255],
        file=file_name[:512], language=(language or "")[:8], page_count=0, is_active=True,
        kind=KIND, created_at=now,
    )
    db.add(book)
    db.flush()
    for i, (piece, vec) in enumerate(zip(chunks, vectors)):
        db.add(BookChunk(
            book_id=book.id, department_id=department_id, chunk_index=i,
            page_start=0, page_end=0, text=piece, embedding=vec, created_at=now,
        ))
    return book, len(chunks)


def has_protocols(db: Session, department_id: int | None) -> bool:
    if not department_id:
        return False
    return bool(db.execute(
        select(func.count()).select_from(SubjectBook).where(
            SubjectBook.department_id == int(department_id),
            SubjectBook.kind == KIND,
            SubjectBook.is_active.is_(True),
        )
    ).scalar() or 0)


_APOS = str.maketrans({"‘": "", "’": "", "'": "", "`": "", "ʻ": "", "ʼ": ""})
#: Papka nomidagi umumiy so'zlar — ular bo'yicha hujjat tanlanmaydi.
_GENERIC = {"virusli", "otkir", "surunkali", "agentli", "agentsiz", "infeksiyalar", "infeksiya",
            "kasalliklar", "kasalligi", "isitmasi", "mavzusi", "uchun", "delta", "gep"}


def _words(text: str) -> list[str]:
    low = (text or "").lower().translate(_APOS)
    return [w for w in re.findall(r"[a-zа-яё]{4,}", low)]


def topic_matches(title: str, query: str) -> bool:
    """Hujjat papkasi (kasallik nomi) so'rovda uchraydimi.

    Sarlavha "arxiv / Botulizm / fayl.pdf" ko'rinishida; kasallik — ikkinchi qism.
    So'zlar 5 harflik o'zak bo'yicha solishtiriladi ("botulizm" ~ "botulizmda").
    """
    parts = [p.strip() for p in (title or "").split(" / ")]
    folder = parts[1] if len(parts) >= 3 else ""
    key_words = [w for w in _words(folder) if w not in _GENERIC]
    if not key_words:
        return False
    q = " ".join(_words(query))
    return all(w[:5] in q for w in key_words)


def retrieve(
    db: Session,
    *,
    department_id: int | None,
    queries: list[str],
    api_key: str,
    top_k: int = TOP_K,
) -> list[dict]:
    """Kafedra protokollaridan so'rovga eng yaqin parchalar."""
    if not department_id or not api_key:
        return []
    wanted = [q.strip()[:800] for q in queries if (q or "").strip()]
    if not wanted:
        return []
    protocol_ids = select(SubjectBook.id).where(
        SubjectBook.department_id == int(department_id),
        SubjectBook.kind == KIND,
        SubjectBook.is_active.is_(True),
    )
    # Mavzuda kasallik nomi bo'lsa ("Vabo", "Botulizm") — avval AYNAN shu kasallik
    # hujjatlaridan qidiriladi. Faqat vektor qidiruvi 3000+ parcha ichida qo'shni
    # kasallik protokolini ham berib yuborardi.
    books = db.execute(
        select(SubjectBook.id, SubjectBook.title).where(SubjectBook.id.in_(protocol_ids))
    ).all()
    focused = [bid for bid, title in books if topic_matches(title, " ".join(wanted))]
    if focused:
        protocol_ids = select(SubjectBook.id).where(SubjectBook.id.in_(focused))
    try:
        vectors = create_embeddings(api_key, wanted, cache=True)
    except Exception:  # noqa: BLE001 — protokol topilmasa generatsiya to'xtamaydi
        logger.exception("protokol embeddingi olinmadi")
        return []

    seen: set[str] = set()
    out: list[dict] = []
    for vec in vectors:
        rows = db.execute(
            select(BookChunk, SubjectBook.title)
            .join(SubjectBook, SubjectBook.id == BookChunk.book_id)
            .where(BookChunk.book_id.in_(protocol_ids))
            .order_by(BookChunk.embedding.cosine_distance(vec))
            .limit(top_k)
        ).all()
        for chunk, title in rows:
            key = (chunk.text or "")[:200].strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            out.append({"title": title or "Protokol", "text": chunk.text, "book_id": chunk.book_id})
    return out[:top_k]


def context_block(chunks: list[dict]) -> str:
    """Generatsiya promptiga qo'shiladigan majburiy qism."""
    if not chunks:
        return ""
    parts = [
        "MAJBURIY MANBA — O'zbekiston Respublikasida amal qiladigan hujjatlar "
        "(milliy klinik protokol, SanPin, Sog'liqni saqlash vazirligi buyrug'i). "
        "Tashxis, davolash, profilaktika va sanitariya talablari AYNAN shu hujjatlarga mos bo'lsin; "
        "darslik yoki xalqaro manba ziddiyat qilsa, USTUNLIK shu hujjatlarda. "
        "Protokolda yo'q narsani o'zingizdan qo'shmang.",
    ]
    for i, c in enumerate(chunks, 1):
        parts.append(f"[{i}] {c['title']}\n{(c['text'] or '').strip()[:2000]}")
    return "\n\n".join(parts)
