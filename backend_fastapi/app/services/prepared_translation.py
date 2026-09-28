from __future__ import annotations
import copy
import logging
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.prepared_content import PreparedContent
from app.services.case_i18n import ensure_translations
logger = logging.getLogger(__name__)


def translate_saved_content(db: Session, item: PreparedContent, lang: str) -> PreparedContent:
    pk = item.id
    original = copy.deepcopy(item.payload or {})
    draft = PreparedContent(id=item.id, kind=item.kind, payload=copy.deepcopy(original))
    # No database connection is held while the AI works.
    db.close()
    try:
        changed = ensure_translations(db, draft, (lang,))
        result = copy.deepcopy(draft.payload or {})
        if changed:
            db.expunge(draft)
    except Exception as exc:
        db.rollback()
        logger.warning("On-demand translation failed for #%s", pk, exc_info=True)
        raise HTTPException(status_code=502, detail="Translation failed. Please retry.") from exc
    current = db.execute(select(PreparedContent).where(PreparedContent.id == pk).with_for_update(of=PreparedContent)).scalar_one_or_none()
    if current is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    def source(payload):
        return {k: v for k, v in payload.items() if k not in ("translations", "i18nSourceHash")}
    if source(current.payload or {}) != source(original):
        raise HTTPException(status_code=409, detail="Content changed. Reload before translating.")
    if lang != result.get("primaryLanguage") and lang not in result.get("translations", {}):
        raise HTTPException(status_code=502, detail="A complete translation could not be generated.")
    merged = {**(current.payload or {}), "primaryLanguage": result.get("primaryLanguage")}
    merged["translations"] = {**merged.get("translations", {}), **result.get("translations", {})}
    if result.get("i18nSourceHash"):
        merged["i18nSourceHash"] = result["i18nSourceHash"]
    current.payload = merged
    db.commit()
    db.refresh(current)
    return current


