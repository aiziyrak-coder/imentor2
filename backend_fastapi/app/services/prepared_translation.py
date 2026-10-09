from __future__ import annotations

import copy
import logging
import threading

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.services import content_i18n
from app.services.case_i18n import SUPPORTED_LANGS, ensure_translations, primary_language

logger = logging.getLogger(__name__)

#: Tarjima qilinadigan turlar: keys/test (`case_i18n`), ma'ruza/taqdimot (`content_i18n`).
TRANSLATABLE_KINDS = frozenset({KIND_CASE, KIND_TEST}) | content_i18n.TEXT_KINDS

#: (yozuv, til) bo'yicha qulf. Fon tarjimasi ketayotganda o'qituvchi shu tilni
#: so'rasa — ikkinchi marta AI chaqirilmaydi, birinchisi tugashi kutiladi va
#: tayyor natija qaytadi (aks holda bir tarjima uchun ikki marta pul ketardi).
_locks: dict[tuple[int, str], threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(pk: int, lang: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault((pk, lang), threading.Lock())


def _source(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k not in ("translations", "i18nSourceHash", "primaryLanguage")}


def _primary(kind: str, payload: dict) -> str:
    if kind in content_i18n.TEXT_KINDS:
        return content_i18n.primary_language(kind, payload)
    return primary_language(payload)


def _translate_payload(db: Session, item: PreparedContent, lang: str) -> dict | None:
    """Yangi payload (tarjima qo'shilgan) yoki None (to'liq tarjima bo'lmadi)."""
    original = copy.deepcopy(item.payload or {})
    if item.kind in content_i18n.TEXT_KINDS:
        return content_i18n.translate_payload(item.kind, original, lang)
    if lang == primary_language(original):
        return {**original, "primaryLanguage": lang}
    draft = PreparedContent(id=item.id, kind=item.kind, payload=copy.deepcopy(original))
    changed = ensure_translations(db, draft, (lang,))
    result = copy.deepcopy(draft.payload or {})
    if changed:
        db.expunge(draft)
    if lang != result.get("primaryLanguage") and lang not in (result.get("translations") or {}):
        return None
    return result


def translate_saved_content(db: Session, item: PreparedContent, lang: str) -> PreparedContent:
    pk = item.id
    kind = item.kind
    with _lock_for(pk, lang):
        # Qulf kutilgan bo'lishi mumkin — yozuv bazadan YANGIDAN o'qiladi.
        db.expire_all()
        fresh = db.get(PreparedContent, pk)
        if fresh is None:
            raise HTTPException(status_code=404, detail="Topilmadi.")
        original = copy.deepcopy(fresh.payload or {})
        # AI ishlayotganda bazaga ulanish ushlab turilmaydi.
        db.close()
        try:
            result = _translate_payload(db, PreparedContent(id=pk, kind=kind, payload=original), lang)
        except Exception as exc:
            db.rollback()
            logger.warning("Translation failed for #%s (%s)", pk, lang, exc_info=True)
            raise HTTPException(status_code=502, detail="Translation failed. Please retry.") from exc
        if result is None:
            raise HTTPException(status_code=502, detail="A complete translation could not be generated.")
        current = db.execute(
            select(PreparedContent).where(PreparedContent.id == pk).with_for_update(of=PreparedContent)
        ).scalar_one_or_none()
        if current is None:
            raise HTTPException(status_code=404, detail="Topilmadi.")
        if _source(current.payload or {}) != _source(original):
            raise HTTPException(status_code=409, detail="Content changed. Reload before translating.")
        merged = {**(current.payload or {}), "primaryLanguage": result.get("primaryLanguage")}
        merged["translations"] = {**(merged.get("translations") or {}), **(result.get("translations") or {})}
        if result.get("i18nSourceHash"):
            merged["i18nSourceHash"] = result["i18nSourceHash"]
        if merged != (current.payload or {}):
            current.payload = merged
            db.commit()
            db.refresh(current)
        else:
            db.rollback()
        return current


def missing_languages(item: PreparedContent) -> list[str]:
    """Hali tarjimasi yo'q tillar (asosiy tildan tashqari)."""
    payload = item.payload if isinstance(item.payload, dict) else {}
    if item.kind not in TRANSLATABLE_KINDS or not payload:
        return []
    primary = _primary(item.kind, payload)
    if item.kind in content_i18n.TEXT_KINDS:
        return [l for l in SUPPORTED_LANGS if not content_i18n.has_translation(item.kind, payload, l)]
    have = payload.get("translations") or {}
    return [l for l in SUPPORTED_LANGS if l != primary and l not in have]


def translate_in_background(pk: int) -> None:
    """Material saqlangach qolgan tillarga FONDA tarjima — o'qituvchi tilni
    almashtirganda tarjima odatda allaqachon tayyor turadi.

    Har bir til alohida oqimda; o'qituvchi shu tilni so'rasa, qulf tufayli
    shu ish kutiladi (ikkinchi AI chaqiruvi bo'lmaydi).
    """
    db = SessionLocal()
    try:
        item = db.get(PreparedContent, pk)
        langs = missing_languages(item) if item is not None else []
    finally:
        db.close()

    def one(lang: str) -> None:
        session = SessionLocal()
        try:
            translate_saved_content(session, PreparedContent(id=pk, kind=item.kind), lang)
        except HTTPException as exc:
            logger.info("Fon tarjimasi #%s %s: %s", pk, lang, exc.detail)
        except Exception:  # noqa: BLE001 — fon ishi so'rovni yiqitmasin
            logger.warning("Fon tarjimasi #%s %s yiqildi", pk, lang, exc_info=True)
        finally:
            session.close()

    threads = [threading.Thread(target=one, args=(lang,), daemon=True) for lang in langs]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


def merge_on_update(kind: str, old: dict | None, new: dict) -> dict:
    """PATCH paytida tarjimalarni to'g'ri saqlash.

    * Asosiy matn o'zgarmagan — eski tarjimalar saqlanadi (mijozdagi nusxada
      ular bo'lmasligi mumkin: fon tarjimasi keyinroq qo'shgan), yangi
      yuborilgani (o'qituvchi tarjimani tahrirlagan) ustun turadi.
    * Asosiy matn o'zgargan — eskirgan tarjimalar olib tashlanadi va fonda
      qaytadan tarjima qilinadi.
    """
    old = old if isinstance(old, dict) else {}
    if kind in content_i18n.TEXT_KINDS:
        if content_i18n.source_hash(kind, old) == content_i18n.source_hash(kind, new):
            translations = {**(old.get("translations") or {}), **(new.get("translations") or {})}
            out = {**new, "translations": translations}
            for key in ("i18nSourceHash", "primaryLanguage"):
                if key not in new and key in old:
                    out[key] = old[key]
            return out
        return {k: v for k, v in new.items() if k not in ("translations", "i18nSourceHash")}
    from app.services.case_i18n import _source_hash, _kind_of, invalidate_stale_translations

    refreshed = invalidate_stale_translations(kind, old, new)
    if refreshed is not None:
        return refreshed
    qkind = _kind_of(new)
    if _source_hash(old.get("questions") or [], qkind) == _source_hash(new.get("questions") or [], qkind):
        translations = {**(old.get("translations") or {}), **(new.get("translations") or {})}
        out = {**new, "translations": translations}
        for key in ("i18nSourceHash", "primaryLanguage"):
            if key not in new and key in old:
                out[key] = old[key]
        return out
    return new
