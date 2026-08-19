from __future__ import annotations

import hashlib
import re

from sqlalchemy import func, or_

_STRUCTURED_RE = re.compile(r"^\d+::[^:]*::[a-zа-яё]{1,4}\d{1,3}$")


def canonical_topic_norm(raw: str, topic: str = "") -> str:
    s = (raw or topic or "").strip().lower()
    if len(s) > 255:
        digest = hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]
        s = f"{s[:240]}::{digest}"
    return s[:255]


def build_topic_norm(syllabus_id: int, variant_label: str, topic_code: str) -> str:
    # Bo'sh variant = "asosiy" (yo'nalish UI olib tashlangan; teacher/admin bir xil kalit).
    variant = (variant_label or "").strip().lower()[:48] or "asosiy"
    code = (topic_code or "").strip().lower().replace(" ", "")[:16]
    if not code:
        return ""
    return canonical_topic_norm(f"{int(syllabus_id)}::{variant}::{code}")


def is_structured_topic_norm(value: str) -> bool:
    """`{syllabus_id}::{variant}::{topic_code}` — sarlavha emas."""
    s = (value or "").strip().lower()
    return bool(s and _STRUCTURED_RE.match(s))


def structured_aliases(syllabus_id: int, variant_label: str, topic_code: str) -> list[str]:
    """Asosiy kalit + bo'sh variant alias (eski yozuvlar `id::::code`)."""
    primary = build_topic_norm(syllabus_id, variant_label, topic_code)
    if not primary:
        return []
    out = [primary]
    variant = (variant_label or "").strip().lower()[:48] or "asosiy"
    if variant == "asosiy":
        empty = canonical_topic_norm(f"{int(syllabus_id)}::::{topic_code.strip().lower().replace(' ', '')[:16]}")
        if empty and empty not in out:
            out.append(empty)
    return out


def topic_norm_query(column, norms: list[str]):
    variants: set[str] = set()
    for raw in norms:
        piece = (raw or "").strip()
        if not piece:
            continue
        variants.add(piece)
        variants.add(piece.lower())
        variants.add(canonical_topic_norm(piece))
    if not variants:
        return None
    return or_(*[func.lower(column) == v.lower() for v in variants])


def norms_from_params(params: dict, topic_norms: list[str] | None = None) -> list[str]:
    """So'rovdan qidiruv kalitlari.

    `syllabus_id` + `topic_code` bo'lsa FAQAT tuzilmali kalit ishlatiladi.
    Aks holda sarlavha kalitlari OR qilinib tarqatma/video/taqdimot
    boshqa fanlarga aralashib ketardi.
    """
    syllabus_raw = str(params.get("syllabus_id") or "").strip()
    variant_label = str(params.get("variant_label") or "").strip()
    topic_code = str(params.get("topic_code") or "").strip()
    if syllabus_raw and topic_code:
        try:
            sid = int(syllabus_raw)
        except (TypeError, ValueError):
            sid = 0
        if sid:
            built = structured_aliases(sid, variant_label, topic_code)
            if built:
                return built

    norms: list[str] = []
    for n in topic_norms or []:
        n = (n or "").strip()
        if n:
            norms.append(n)
    single = str(params.get("topic_norm") or "").strip()
    if single and single not in norms:
        norms.append(single)
    # Sarlavha-only kalitlar aralashtiradi — tuzilmalisi bo'lsa faqat ular.
    structured = [n for n in norms if is_structured_topic_norm(n)]
    return structured or norms
