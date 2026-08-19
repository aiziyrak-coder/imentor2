from __future__ import annotations

import datetime as dt
import re

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.models.topic_content import TopicHandout, TopicPresentation, TopicVideo
from app.schemas.topic_content import TopicHandoutOut, TopicPresentationOut, TopicVideoCreateRequest, TopicVideoOut
from app.services import file_storage as storage
from app.services import topic_norm as tn
from app.services.pagination import paginate

router = APIRouter()

logger = logging.getLogger(__name__)

STAFF_ROLES = ("admin", "klinika_admin", "hodim")

PREVIEWABLE_PRESENTATION_KINDS = ("pptx", "ppt", "odp")


def _pregenerate_preview(rel_path: str) -> None:
    """Yuklashdan keyin fonda PDF preview'ni tayyorlab qo'yadi.

    Shunda o'qituvchi dars paytida taqdimotni ochganda kutmaydi — PDF
    allaqachon keshda bo'ladi. Xatolik bo'lsa jimgina o'tkazib yuboriladi:
    preview endpoint'i baribir talab bo'yicha qayta urinib ko'radi.
    """
    from app.services.pptx_preview import ensure_presentation_preview_pdf

    try:
        ensure_presentation_preview_pdf(storage.absolute_path(rel_path))
    except Exception as e:
        logger.warning("Preview oldindan tayyorlanmadi (%s): %s", rel_path, e)

HANDOUT_MAX_BYTES = 20 * 1024 * 1024
PRESENTATION_MAX_BYTES = 50 * 1024 * 1024
HANDOUT_LANGS = frozenset({"uz", "ru", "en"})

_YT_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:[^&]*&)*v=|embed/|shorts/|v/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def extract_youtube_id(url: str) -> str:
    if not url:
        return ""
    m = _YT_RE.search(url)
    if m:
        return m.group(1)
    s = url.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    return ""


def _handout_lang(value: str | None) -> str:
    s = (value or "uz").strip().lower()
    return s if s in HANDOUT_LANGS else "uz"


def _can_delete(owner_key: str, auth: AuthContext) -> bool:
    if owner_key == auth.user.username:
        return True
    return auth.role == "admin"


def _handout_out(h: TopicHandout, auth: AuthContext) -> TopicHandoutOut:
    return TopicHandoutOut(
        id=h.id, owner_key=h.owner_key, topic=h.topic, topic_norm=h.topic_norm, title=h.title, kind=h.kind,
        file_name=h.file_name, file_size=h.file_size, author_name=h.author_name,
        created_at=h.created_at, file_url=f"/api/v1/handouts/{h.id}/file/",
        can_delete=_can_delete(h.owner_key, auth), sort_order=h.sort_order,
        language=_handout_lang(getattr(h, "language", None)),
    )


def _presentation_out(p: TopicPresentation, auth: AuthContext) -> TopicPresentationOut:
    return TopicPresentationOut(
        id=p.id, owner_key=p.owner_key, topic=p.topic, topic_norm=p.topic_norm, title=p.title, kind=p.kind,
        file_name=p.file_name, file_size=p.file_size, author_name=p.author_name,
        created_at=p.created_at, file_url=f"/api/v1/presentations/{p.id}/file/",
        can_delete=_can_delete(p.owner_key, auth), sort_order=p.sort_order,
    )


def _video_out(v: TopicVideo) -> TopicVideoOut:
    return TopicVideoOut(
        id=v.id, topic=v.topic, topic_norm=v.topic_norm, title=v.title,
        youtube_id=v.youtube_id, youtube_url=v.youtube_url,
        embed_url=f"https://www.youtube.com/embed/{v.youtube_id}",
        author_name=v.author_name, created_at=v.created_at,
    )


def _resolve_norms(request: Request, topic_norm_list: list[str]) -> list[str]:
    return tn.norms_from_params(dict(request.query_params), topic_norm_list)


def _resolve_handout_topic_norm(
    topic: str,
    topic_norm: str,
    syllabus_id: int | None,
    variant_label: str,
    topic_code: str,
) -> str:
    """Django `TopicHandoutUploadSerializer.validate()` bilan bir xil: agar
    syllabus_id+variant_label+topic_code hammasi berilgan bo'lsa shulardan
    quriladi, aks holda berilgan topic_norm (yoki topic'dan) olinadi."""
    if syllabus_id and variant_label.strip() and topic_code.strip():
        built = tn.build_topic_norm(syllabus_id, variant_label, topic_code)
        if built:
            return built
    return tn.canonical_topic_norm(topic_norm or "", topic)


# ---------------- Handouts ----------------


@router.get("/handouts/", response_model=list[TopicHandoutOut])
def list_handouts(
    request: Request,
    topic_norm: list[str] = Query(default=[]),
    language: str = Query(""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> list[TopicHandoutOut]:
    norms = _resolve_norms(request, topic_norm)
    if not norms:
        raise HTTPException(status_code=400, detail="topic_norm parametri kerak.")
    cond = tn.topic_norm_query(TopicHandout.topic_norm, norms)
    if cond is None:
        return []
    stmt = select(TopicHandout).where(cond)
    if language.strip():
        stmt = stmt.where(TopicHandout.language == _handout_lang(language))
    rows = db.execute(stmt.distinct()).scalars().all()
    return [_handout_out(h, auth) for h in rows]


@router.post("/handouts/", response_model=TopicHandoutOut, status_code=201)
async def upload_handout(
    file: UploadFile,
    topic: str = Form(...),
    topic_norm: str = Form(""),
    syllabus_id: int | None = Form(None),
    variant_label: str = Form(""),
    topic_code: str = Form(""),
    title: str = Form(""),
    language: str = Form("uz"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> TopicHandoutOut:
    topic = (topic or "")[:255]
    title = (title or "")[:255]
    topic_norm = _resolve_handout_topic_norm(topic, topic_norm, syllabus_id, variant_label, topic_code)
    if not topic_norm:
        raise HTTPException(status_code=400, detail="Mavzu normallashtirilmadi.")
    if not storage.validate_extension(file.filename or ""):
        raise HTTPException(status_code=400, detail="Fayl turi qo'llab-quvvatlanmaydi.")
    content = await file.read()
    if len(content) > HANDOUT_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Fayl hajmi juda katta.")

    lang = _handout_lang(language)
    rel_path = storage.handout_relative_path(topic_norm, auth.user.username, file.filename or "file")
    storage.save_upload(rel_path, content)

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    max_order = db.execute(
        select(func.max(TopicHandout.sort_order)).where(TopicHandout.topic_norm == topic_norm)
    ).scalar_one() or 0

    obj = TopicHandout(
        owner_key=auth.user.username,
        author_name=display[:255],
        topic=topic,
        topic_norm=topic_norm,
        title=(title or file.filename or "")[:255],
        kind=storage.detect_handout_kind(file.filename or "", file.content_type or ""),
        file=rel_path,
        file_name=(file.filename or "file")[:512],
        file_size=len(content),
        language=lang,
        sort_order=int(max_order) + 1,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _handout_out(obj, auth)


@router.get("/handouts/{pk}/file/")
def download_handout(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> FileResponse:
    obj = db.get(TopicHandout, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    path = storage.absolute_path(obj.file)
    return FileResponse(path, filename=obj.file_name)


@router.delete("/handouts/{pk}/", status_code=204, response_model=None)
def delete_handout(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> None:
    obj = db.get(TopicHandout, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if obj.owner_key != auth.user.username and auth.role != "admin":
        raise HTTPException(status_code=403, detail="Faqat yuklagan o'qituvchi yoki admin o'chira oladi.")
    storage.delete_file(obj.file)
    db.delete(obj)
    db.commit()


# ---------------- Admin handouts (Django'da alohida admin-only yo'l — bir xil mantiq) ----------------


@router.get("/admin/handouts/")
def admin_list_handouts(
    request: Request,
    topic_norm: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    stmt = select(TopicHandout).order_by(TopicHandout.created_at.desc())
    norms = _resolve_norms(request, topic_norm)
    if norms:
        cond = tn.topic_norm_query(TopicHandout.topic_norm, norms)
        stmt = stmt.where(cond) if cond is not None else stmt.where(False)
    rows = db.execute(stmt).scalars().all()
    out = [_handout_out(h, auth).model_dump() for h in rows]
    return paginate(out, request, default_page_size=100, max_page_size=500)


@router.post("/admin/handouts/", response_model=TopicHandoutOut, status_code=201)
async def admin_upload_handout(
    file: UploadFile,
    topic: str = Form(...),
    topic_norm: str = Form(""),
    syllabus_id: int | None = Form(None),
    variant_label: str = Form(""),
    topic_code: str = Form(""),
    title: str = Form(""),
    language: str = Form("uz"),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> TopicHandoutOut:
    return await upload_handout(
        file, topic=topic, topic_norm=topic_norm, syllabus_id=syllabus_id,
        variant_label=variant_label, topic_code=topic_code, title=title,
        language=language, db=db, auth=auth,
    )


@router.delete("/admin/handouts/{pk}/", status_code=204, response_model=None)
def admin_delete_handout(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    obj = db.get(TopicHandout, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    storage.delete_file(obj.file)
    db.delete(obj)
    db.commit()


# ---------------- Presentations ----------------


@router.get("/presentations/", response_model=list[TopicPresentationOut])
def list_presentations(
    request: Request,
    topic_norm: list[str] = Query(default=[]),
    mine: bool = Query(default=False),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> list[TopicPresentationOut]:
    """Mavzu bo'yicha taqdimotlar.

    Standart — shu fan/mavzudagi BARCHA yuklangan fayllar (o'qituvchi
    sahifasida ham). `mine=1` — faqat joriy foydalanuvchiniki.
    """
    norms = _resolve_norms(request, topic_norm)
    if not norms:
        raise HTTPException(status_code=400, detail="topic_norm parametri kerak.")
    cond = tn.topic_norm_query(TopicPresentation.topic_norm, norms)
    if cond is None:
        return []
    stmt = select(TopicPresentation).where(cond)
    if mine:
        stmt = stmt.where(TopicPresentation.owner_key == auth.user.username)
    rows = db.execute(
        stmt.order_by(TopicPresentation.created_at.desc())
    ).scalars().all()
    return [_presentation_out(p, auth) for p in rows]


@router.post("/presentations/", response_model=TopicPresentationOut, status_code=201)
async def upload_presentation(
    file: UploadFile,
    background: BackgroundTasks,
    topic: str = Form(...),
    topic_norm: str = Form(""),
    syllabus_id: int | None = Form(None),
    variant_label: str = Form(""),
    topic_code: str = Form(""),
    title: str = Form(""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> TopicPresentationOut:
    topic_norm = _resolve_handout_topic_norm(topic, topic_norm, syllabus_id, variant_label, topic_code)
    if not topic_norm:
        raise HTTPException(status_code=400, detail="Mavzu normallashtirilmadi.")
    if not storage.validate_extension(file.filename or "", presentation=True):
        raise HTTPException(status_code=400, detail="Fayl turi qo'llab-quvvatlanmaydi.")
    content = await file.read()
    if len(content) > PRESENTATION_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Fayl hajmi juda katta.")

    rel_path = storage.presentation_relative_path(topic_norm, auth.user.username, file.filename or "file")
    storage.save_upload(rel_path, content)

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    max_order = db.execute(
        select(func.max(TopicPresentation.sort_order)).where(TopicPresentation.topic_norm == topic_norm)
    ).scalar_one() or 0

    obj = TopicPresentation(
        owner_key=auth.user.username,
        author_name=display[:255],
        topic=topic,
        topic_norm=topic_norm,
        title=(title or file.filename or "")[:255],
        kind=storage.detect_presentation_kind(file.filename or ""),
        file=rel_path,
        file_name=(file.filename or "file")[:512],
        file_size=len(content),
        sort_order=int(max_order) + 1,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)

    # Dars paytida kutish bo'lmasligi uchun PDF preview darhol, fonda tayyorlanadi.
    if obj.kind in PREVIEWABLE_PRESENTATION_KINDS:
        background.add_task(_pregenerate_preview, rel_path)

    return _presentation_out(obj, auth)


@router.get("/presentations/{pk}/file/")
def download_presentation(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> FileResponse:
    obj = db.get(TopicPresentation, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    path = storage.absolute_path(obj.file)
    return FileResponse(path, filename=obj.file_name)


@router.get("/presentations/{pk}/preview/")
def preview_presentation(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> FileResponse:
    """Brauzer preview: PPTX/PPT → PDF (LibreOffice). PDF o'zi qaytariladi."""
    from app.services.pptx_preview import ensure_presentation_preview_pdf

    obj = db.get(TopicPresentation, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    path = storage.absolute_path(obj.file)
    try:
        pdf_path = ensure_presentation_preview_pdf(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Fayl diskda topilmadi.") from None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Taqdimot preview tayyorlanmadi. Yuklab olib PowerPoint da oching.",
        ) from None

    preview_name = (obj.file_name or "presentation").rsplit(".", 1)[0] + ".pdf"
    return FileResponse(
        pdf_path,
        filename=preview_name,
        media_type="application/pdf",
        content_disposition_type="inline",
    )


@router.delete("/presentations/{pk}/", status_code=204, response_model=None)
def delete_presentation(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> None:
    obj = db.get(TopicPresentation, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if obj.owner_key != auth.user.username and auth.role != "admin":
        raise HTTPException(status_code=403, detail="Faqat yuklagan o'qituvchi yoki admin o'chira oladi.")
    storage.delete_file(obj.file)
    db.delete(obj)
    db.commit()


# ---------------- Topic videos ----------------


@router.get("/topic-videos/", response_model=list[TopicVideoOut])
def list_topic_videos(
    request: Request,
    topic_norm: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> list[TopicVideoOut]:
    norms = _resolve_norms(request, topic_norm)
    if not norms:
        raise HTTPException(status_code=400, detail="topic_norm parametri kerak.")
    cond = tn.topic_norm_query(TopicVideo.topic_norm, norms)
    if cond is None:
        return []
    rows = db.execute(select(TopicVideo).where(cond).distinct()).scalars().all()
    return [_video_out(v) for v in rows]


@router.get("/admin/topic-videos/")
def admin_list_topic_videos(
    request: Request,
    topic_norm: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    stmt = select(TopicVideo).order_by(TopicVideo.created_at.desc())
    norms = _resolve_norms(request, topic_norm)
    if norms:
        cond = tn.topic_norm_query(TopicVideo.topic_norm, norms)
        stmt = stmt.where(cond) if cond is not None else stmt.where(False)
    rows = db.execute(stmt).scalars().all()
    out = [_video_out(v).model_dump() for v in rows]
    return paginate(out, request, default_page_size=100, max_page_size=500)


@router.post("/admin/topic-videos/", response_model=TopicVideoOut, status_code=201)
def admin_create_topic_video(
    payload: TopicVideoCreateRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> TopicVideoOut:
    topic = payload.topic.strip()
    topic_norm = tn.build_topic_norm(payload.syllabus_id, payload.variant_label, payload.topic_code)
    if not topic_norm:
        topic_norm = tn.canonical_topic_norm("", topic)
    if not topic_norm:
        raise HTTPException(status_code=400, detail="Mavzu normallashtirilmadi.")

    youtube_id = extract_youtube_id(payload.youtube_url)
    if not youtube_id:
        raise HTTPException(status_code=400, detail="Yaroqli YouTube havolasi kiriting.")

    display = f"{auth.user.first_name} {auth.user.last_name}".strip() or auth.user.username
    max_order = db.execute(
        select(func.max(TopicVideo.sort_order)).where(TopicVideo.topic_norm == topic_norm)
    ).scalar_one() or 0

    obj = TopicVideo(
        owner_key=auth.user.username,
        author_name=display[:255],
        topic=topic,
        topic_norm=topic_norm,
        title=(payload.title or "").strip()[:255],
        youtube_url=payload.youtube_url.strip()[:512],
        youtube_id=youtube_id,
        sort_order=int(max_order) + 1,
        created_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _video_out(obj)


@router.delete("/admin/topic-videos/{pk}/", status_code=204, response_model=None)
def admin_delete_topic_video(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    obj = db.get(TopicVideo, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    db.delete(obj)
    db.commit()
