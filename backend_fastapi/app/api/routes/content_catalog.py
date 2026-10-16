from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.db import get_db
from app.models import content as _content  # noqa: F401  (registers CourseSyllabus mapper)
from app.models.prepared_content import CATALOG_KINDS, PreparedContent
from app.services import content_catalog as svc
from app.services.case_i18n import without_stale_translations
from app.services.pagination import paginate

router = APIRouter()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _query_params(request: Request) -> dict:
    return dict(request.query_params)


# --- static-path routes first (subjects/, stats/) so they aren't shadowed by {pk} ---


@router.get("/content-catalog/subjects/")
def catalog_subjects(db: Session = Depends(get_db), auth=Depends(require_roles(*STAFF_ROLES))) -> list[dict]:
    return svc.catalog_subjects_summary(db)


@router.get("/public/content-catalog/subjects/")
def public_catalog_subjects(db: Session = Depends(get_db)) -> list[dict]:
    return svc.catalog_subjects_summary(db)


@router.get("/public/content-catalog/stats/")
def public_catalog_stats(kind: str = "", db: Session = Depends(get_db)) -> dict:
    if kind and kind not in CATALOG_KINDS:
        raise HTTPException(status_code=400, detail="kind must be case or test.")
    return svc.build_catalog_stats(db, published_only=True, kind=kind or None)


@router.get("/admin/content-catalog/stats/")
def admin_catalog_stats(kind: str = "", db: Session = Depends(get_db), auth=Depends(require_roles("admin"))) -> dict:
    if kind and kind not in CATALOG_KINDS:
        raise HTTPException(status_code=400, detail="kind must be case or test.")
    return svc.build_catalog_stats(db, published_only=False, kind=kind or None)


# --- list routes ---


@router.get("/content-catalog/")
def list_catalog(
    request: Request,
    db: Session = Depends(get_db),
    auth=Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    stmt = svc.filter_catalog_stmt(svc.published_catalog_stmt(), _query_params(request))
    items = db.execute(stmt).scalars().all()
    rows = [svc.catalog_item_summary(i) for i in items]
    return paginate(rows, request, default_page_size=50, max_page_size=200)


@router.get("/public/content-catalog/")
def public_list_catalog(request: Request, db: Session = Depends(get_db)) -> dict:
    stmt = svc.filter_catalog_stmt(svc.published_catalog_stmt(), _query_params(request))
    items = db.execute(stmt).scalars().all()
    rows = [svc.catalog_item_summary(i, include_verification=True) for i in items]
    return paginate(rows, request, default_page_size=50, max_page_size=200)


@router.get("/admin/content-catalog/")
def admin_list_catalog(
    request: Request,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    stmt = svc.filter_catalog_stmt(select(PreparedContent).where(PreparedContent.kind.in_(CATALOG_KINDS)), _query_params(request))
    items = db.execute(stmt).scalars().all()
    rows = [svc.catalog_item_summary(i) for i in items]
    return paginate(rows, request, default_page_size=50, max_page_size=200)


# --- {pk} detail/delete routes last ---


@router.get("/content-catalog/{pk}/")
def get_catalog_item(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles(*STAFF_ROLES)),
) -> dict:
    item = db.execute(svc.published_catalog_stmt().where(PreparedContent.id == pk)).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")
    data = svc.catalog_item_summary(item)
    data["payload"] = without_stale_translations(item.payload) if isinstance(item.payload, dict) else {}
    return data


@router.get("/public/content-catalog/{pk}/")
def public_get_catalog_item(pk: int, db: Session = Depends(get_db)) -> dict:
    item = db.execute(svc.published_catalog_stmt().where(PreparedContent.id == pk)).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")
    data = svc.catalog_item_summary(item, include_verification=True)
    data["payload"] = without_stale_translations(item.payload) if isinstance(item.payload, dict) else {}
    data["view_only"] = True
    return data


@router.get("/admin/content-catalog/{pk}/")
def admin_get_catalog_item(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> dict:
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk, PreparedContent.kind.in_(CATALOG_KINDS))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")
    data = svc.catalog_item_summary(item)
    data["payload"] = without_stale_translations(item.payload) if isinstance(item.payload, dict) else {}
    return data


@router.delete("/admin/content-catalog/{pk}/", status_code=204, response_model=None)
def admin_delete_catalog_item(
    pk: int,
    db: Session = Depends(get_db),
    auth=Depends(require_roles("admin")),
) -> None:
    item = db.execute(
        select(PreparedContent).where(PreparedContent.id == pk, PreparedContent.kind.in_(CATALOG_KINDS))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")
    db.delete(item)
    db.commit()
