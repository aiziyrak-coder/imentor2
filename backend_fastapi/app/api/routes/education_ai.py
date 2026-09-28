from __future__ import annotations

import hashlib
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.core.throttling import throttle_education_ai, _redis
from app.schemas.education_ai import (
    EducationAiBookReferencesRequest,
    EducationAiBookReferencesResponse,
    EducationAiCaseContextRequest,
    EducationAiCaseContextResponse,
    EducationAiCompletionRequest,
    EducationAiCompletionResponse,
)
from app.services import book_retrieval as rag
from app.services import protocol_library as protocols
from app.services import external_literature as extlit
from app.services import openai_client as oai
from app.services.education_ai_utils import clip_education_messages

router = APIRouter()
logger = logging.getLogger("imentor.education_ai")

AI_CACHE_TTL_SECONDS = 60 * 60 * 24 * 14
AI_MAX_OUTPUT_TOKENS = oai.ECONOMY_MAX_OUTPUT_TOKENS
AI_STREAM_MAX_OUTPUT_TOKENS = oai.ECONOMY_MAX_OUTPUT_TOKENS

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _economy_model(requested: str, settings) -> str:
    """iMentor ommaviy ishlatiladi: oddiy AI generatsiyalar eng arzon modelda yuradi."""
    return "gpt-4.1-nano"


def _clamped_tokens(value: int, *, stream: bool = False) -> int:
    limit = AI_STREAM_MAX_OUTPUT_TOKENS if stream else AI_MAX_OUTPUT_TOKENS
    return max(256, min(int(value or limit), limit))


def _cache_key(auth: AuthContext, payload: EducationAiCompletionRequest, messages: list[dict], *, stream: bool = False) -> str:
    body = {
        "stream": stream,
        "version": 2,
        "owner": auth.user.username,
        "model": "gpt-4.1-nano",
        "purpose": payload.purpose,
        "messages": messages,
        "subject_code": payload.subject_code.strip(),
        "topic_query": payload.topic_query.strip(),
        "response_format": payload.response_format,
        "temperature": round(float(payload.temperature or 0.35), 2),
        "max_tokens": _clamped_tokens(payload.max_tokens, stream=stream),
    }
    raw = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "education_ai:cache:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_get(key: str) -> dict | None:
    try:
        raw = _redis().get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def _cache_set(key: str, value: dict) -> None:
    try:
        _redis().setex(key, AI_CACHE_TTL_SECONDS, json.dumps(value, ensure_ascii=False))
    except Exception:
        pass


def _validated_messages(messages):
    try:
        return clip_education_messages(messages)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _release_db(db: Session) -> None:
    """DB ulanishini pool'ga qaytaradi.

    AI generatsiyasi 1–5 daqiqa davom etadi. Agar shu vaqt davomida Session
    ochiq tranzaksiyani ushlab tursa, har bir generatsiya bitta Postgres
    ulanishini band qiladi ("idle in transaction") va bir necha o'nlab
    o'qituvchi bir vaqtda ishlaganda pool tugab, butun API 500 qaytaradi.
    RAG so'rovlari tugagach ulanish darhol bo'shatiladi — keyingi murojaatda
    Session o'zi qayta ochiladi.
    """
    try:
        db.close()
    except Exception:  # noqa: BLE001 — bo'shatish hech qachon so'rovni yiqitmasin
        pass


def _protocol_message(db: Session, subject_code: str, topic_query: str, api_key: str) -> tuple[str, list[dict]]:
    """Kafedra protokollari (milliy klinik protokol, SanPin, SSV buyrug'i) — majburiy manba.

    Kafedra "javoblar bizning davolash protokollarimizga to'g'ri kelmayapti" deb
    shikoyat qilgan (2026-09-24). Endi kafedrada protokol bo'lsa, u darslik
    parchalaridan OLDIN qo'yiladi va ziddiyatda ustun deb ko'rsatiladi.
    """
    if not subject_code or not topic_query:
        return "", []
    try:
        dept_id = rag.resolve_book_department_id(db, subject_code)
        if not protocols.has_protocols(db, dept_id):
            return "", []
        chunks = protocols.retrieve(db, department_id=dept_id, queries=[topic_query], api_key=api_key)
    except Exception:  # noqa: BLE001 — protokol topilmasa generatsiya to'xtamaydi
        logger.exception("protokol konteksti olinmadi")
        return "", []
    block = protocols.context_block(chunks)
    refs = [{"title": c["title"], "kind": "protocol"} for c in chunks]
    return block, refs


@router.post("/education-ai/completion/", response_model=EducationAiCompletionResponse)
def education_ai_completion(
    payload: EducationAiCompletionRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    _: None = Depends(throttle_education_ai),
) -> EducationAiCompletionResponse:
    settings = get_settings()
    api_key = settings.openai_api_key.strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API kaliti serverda sozlanmagan.",
        )

    messages = _validated_messages(payload.messages)
    if not messages:
        raise HTTPException(status_code=400, detail="Xabarlar bo'sh.")

    subject_code = payload.subject_code.strip()
    topic_query = payload.topic_query.strip()
    book_references: list[dict] = []
    if subject_code and topic_query:
        chunks = rag.retrieve_book_context(db, subject_code, topic_query)
        context_message = rag.format_book_context_message(chunks)
        if context_message:
            messages = [m for m in messages if m.get("role") == "system"] + [{"role": "system", "content": context_message}] + [m for m in messages if m.get("role") != "system"]
            book_references = rag.book_references_from_chunks(chunks)
        protocol_block, protocol_refs = _protocol_message(db, subject_code, topic_query, api_key)
        if protocol_block:
            # Protokol darslikdan KEYIN qo'shiladi — ya'ni modelga oxirgi va eng kuchli ko'rsatma.
            messages = [m for m in messages if m.get("role") == "system"] + [{"role": "system", "content": protocol_block}] + [m for m in messages if m.get("role") != "system"]
            book_references = protocol_refs + book_references
    messages = _validated_messages(messages)

    _release_db(db)

    model = _economy_model(payload.model, settings)
    try:
        content = oai.generate_openai_chat(
            api_key,
            messages=messages,
            model=model,
            max_tokens=_clamped_tokens(payload.max_tokens),
            temperature=min(float(payload.temperature or 0.35), 0.7),
            timeout_sec=280,
            response_format=payload.response_format,
            usage_kind=payload.purpose or "chat",
        )
    except oai.OpenAiClientError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return EducationAiCompletionResponse(content=content, book_references=book_references)


@router.post("/education-ai/completion/stream/")
def education_ai_completion_stream(
    payload: EducationAiCompletionRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    _: None = Depends(throttle_education_ai),
) -> StreamingResponse:
    """`/education-ai/completion/` bilan bir xil, lekin javobni SSE orqali
    oqim (stream) sifatida qaytaradi — frontend matnni generatsiya bo'lgan
    sari darhol ko'rsatishi mumkin (kutish tuyg'usini kamaytiradi)."""
    settings = get_settings()
    api_key = settings.openai_api_key.strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API kaliti serverda sozlanmagan.",
        )

    messages = _validated_messages(payload.messages)
    if not messages:
        raise HTTPException(status_code=400, detail="Xabarlar bo'sh.")

    subject_code = payload.subject_code.strip()
    topic_query = payload.topic_query.strip()
    book_references: list[dict] = []
    if subject_code and topic_query:
        chunks = rag.retrieve_book_context(db, subject_code, topic_query)
        context_message = rag.format_book_context_message(chunks)
        if context_message:
            messages = [m for m in messages if m.get("role") == "system"] + [{"role": "system", "content": context_message}] + [m for m in messages if m.get("role") != "system"]
            book_references = rag.book_references_from_chunks(chunks)
        protocol_block, protocol_refs = _protocol_message(db, subject_code, topic_query, api_key)
        if protocol_block:
            # Protokol darslikdan KEYIN qo'shiladi — ya'ni modelga oxirgi va eng kuchli ko'rsatma.
            messages = [m for m in messages if m.get("role") == "system"] + [{"role": "system", "content": protocol_block}] + [m for m in messages if m.get("role") != "system"]
            book_references = protocol_refs + book_references
    messages = _validated_messages(messages)

    # Stream javobida `Depends(get_db)` tozalanishi butun oqim tugagunicha
    # kechikadi — ulanishni shu yerda qo'lda qaytaramiz.
    _release_db(db)

    model = payload.model.strip() or settings.openai_chat_model

    stream_key = _cache_key(auth, payload, messages, stream=True)

    def _gen():
        cached = _cache_get(stream_key)
        if cached and cached.get("content"):
            yield f"data: {json.dumps({'delta': cached['content']})}\n\n"
            yield f"data: {json.dumps({'done': True, 'book_references': book_references})}\n\n"
            return
        parts = []
        try:
            for delta in oai.stream_openai_chat(
                api_key,
                messages=messages,
                model=model,
                max_tokens=payload.max_tokens,
                temperature=payload.temperature,
                timeout_sec=280,
            ):
                parts.append(delta)
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        except oai.OpenAiClientError as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            return
        if parts:
            _cache_set(stream_key, {"content": "".join(parts)})
        yield f"data: {json.dumps({'done': True, 'book_references': book_references})}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={
            # nginx bufferlamasin — aks holda matn bo'lak-bo'lak emas,
            # to'planib bir zarbda keladi va "oqim" effekti yo'qoladi.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


@router.post("/education-ai/book-references/", response_model=EducationAiBookReferencesResponse)
def education_ai_book_references(
    payload: EducationAiBookReferencesRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    _: None = Depends(throttle_education_ai),
) -> EducationAiBookReferencesResponse:
    subject_code = payload.subject_code.strip()
    queries = [str(q or "") for q in payload.queries][:40]
    results = rag.retrieve_references_for_queries(db, subject_code, queries, top_k=payload.top_k)
    return EducationAiBookReferencesResponse(subject_code=subject_code, results=results)


def _english_search_keywords(api_key: str, model: str, topic: str) -> str:
    """Mavzu nomidan (istalgan tilda) PubMed/Semantic Scholar uchun 3-4 ta
    ingliz tilidagi MeSH-uslubidagi qidiruv so'zini chiqaradi. Xato bo'lsa
    mavzuni o'zgarishsiz qaytaradi (ingliz bo'lmasa qidiruv kam natija
    berishi mumkin, lekin generatsiya to'xtamaydi)."""
    try:
        out = oai.generate_openai_chat(
            api_key,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "The user message is a medical education topic, usually written in Uzbek or "
                        "Russian. First understand its MEANING (do not transliterate Uzbek/Russian words "
                        "as if they were English proper names or surnames — e.g. Uzbek 'me'yor' means "
                        "'normal/standard', NOT the English surname 'Meyer'). Then output ONLY 3-4 "
                        "concise English medical/MeSH-style search keywords that capture that meaning, "
                        "separated by spaces, no punctuation, no explanation, no quotes."
                    ),
                },
                {"role": "user", "content": topic[:300]},
            ],
            model=model,
            max_tokens=60,
            temperature=0.1,
            timeout_sec=20,
        )
        cleaned = " ".join(out.strip().split())
        return cleaned or topic
    except oai.OpenAiClientError:
        return topic


@router.post("/education-ai/case-context/", response_model=EducationAiCaseContextResponse)
def education_ai_case_context(
    payload: EducationAiCaseContextRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
    _: None = Depends(throttle_education_ai),
) -> EducationAiCaseContextResponse:
    """Klinik keys generatsiyasi uchun RAG kontekst: kitob chunk'lari
    (mavjud bo'lsa) + PubMed/Semantic Scholar'dan REAL maqolalar — barchasi
    raqamlangan bitta manba to'plamiga yig'iladi. LLM shu manbalar asosida
    yozadi va faqat shu ro'yxatdagi raqam/havolalardan foydalanishi kerak —
    o'zi link/PMID o'ylab topmaydi (bu backend'da tayyorlanadi)."""
    settings = get_settings()
    api_key = settings.openai_api_key.strip()
    topic = payload.topic.strip()
    subject_code = payload.subject_code.strip()

    sources: list[dict] = []

    if subject_code and api_key:
        try:
            chunks = rag.retrieve_book_context(db, subject_code, topic, top_k=8)
        except Exception:
            chunks = []
        for c in chunks:
            text = str((c or {}).get("text") or "").strip()
            if not text:
                continue
            sources.append(
                {
                    "type": "book",
                    "title": rag.clean_book_title(str(c.get("book_title") or "")),
                    "meta": f"{c.get('page', '')}-bet" if c.get("page") else "",
                    "url": "",
                    "text": text[:1200],
                }
            )

    # Bundan keyin faqat tashqi tarmoq (OpenAI, PubMed, Scholar, Wikipedia) —
    # DB kerak emas, ulanishni pool'ga qaytaramiz.
    _release_db(db)

    keywords = topic
    if api_key:
        keywords = _english_search_keywords(api_key, settings.openai_fast_model, topic)

    # Kitob (yuklangan darslik) + xalqaro jurnallar (PubMed Lancet/NEJM/JAMA/BMJ/Cochrane).
    # Wikipedia keys uchun olinmaydi — saviya past va mavzuga mos kelmasligi mumkin.
    pubmed = extlit.search_pubmed(keywords, retmax=8, prefer_core=True)
    scholar = extlit.search_semantic_scholar(keywords, limit=4)
    external = extlit.dedupe_external_sources(pubmed + scholar)

    for e in external:
        if e["type"] == "pubmed":
            meta_bits = [b for b in (e.get("journal"), e.get("year")) if b]
            meta = ", ".join(meta_bits)
        else:
            meta = e.get("year", "")
        sources.append(
            {
                "type": e["type"],
                "title": e.get("title", ""),
                "authors": e.get("authors", ""),
                "meta": meta,
                "url": e.get("url", ""),
                "text": e.get("abstract", ""),
            }
        )

    numbered: list[dict] = []
    context_lines: list[str] = []
    for i, s in enumerate(sources, start=1):
        idx_source = {**s, "index": i}
        numbered.append(idx_source)
        kind_label = {
            "book": "Darslik",
            "pubmed": "PubMed maqola",
            "scholar": "Ilmiy maqola",
            "wikipedia": "Wikipedia",
        }.get(s["type"], "Manba")
        head = f"[{i}] ({kind_label}) {s.get('title', '')}"
        if s.get("authors"):
            head += f" — {s['authors']}"
        if s.get("meta"):
            head += f" ({s['meta']})"
        if s.get("url"):
            head += f" — {s['url']}"
        body = s.get("text", "")
        context_lines.append(f"{head}\n{body}" if body else head)

    context_text = "\n\n---\n\n".join(context_lines)
    return EducationAiCaseContextResponse(sources=numbered, context_text=context_text)
