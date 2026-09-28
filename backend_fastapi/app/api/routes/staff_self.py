"""O'qituvchining "Sozlamalar" bo'limi — o'zi bajara oladigan ishlar (2026-09-24).

Ilgari bu ishlarning ko'pini admin qo'lda qilardi: kafedra almashtirish, kitob
va protokol yuklash. Endi o'qituvchi o'zi bajaradi,
lekin ZIDDIYATSIZ:

* profil — faqat o'zining ismi, lavozimi va kafedrasi (kafedra faqat mavjud
  ro'yxatdan tanlanadi; login o'zgarmaydi);
* kafedra kutubxonasi — kitob/protokol faqat O'Z kafedrasiga qo'shiladi, kim
  yuklagani saqlanadi, o'chirishni faqat o'sha o'qituvchi yoki admin qiladi;

Monitor jadvalini o'qituvchi yuklamaydi — uni admin yuritadi (2026-09-24 qarori).
"""

from __future__ import annotations

import datetime as dt
import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import SessionLocal, get_db
from app.models.book import BookChunk, SubjectBook
from app.models.content import AcademicDepartment, CourseSyllabus
from app.models.face_template import FaceTemplate
from app.models.staff_location import StaffProfile
from app.models.staff_pinfl import StaffPinfl
from app.services import file_storage as storage
from app.services import protocol_library
from app.services import staff_department as staff_dept

logger = logging.getLogger("imentor.staff_self")
router = APIRouter()

TEACHER_ROLES = ("hodim", "admin")
LIBRARY_KINDS = ("book", "protocol")
LIBRARY_EXTENSIONS = (".pdf", ".docx", ".doc", ".txt")
MAX_LIBRARY_BYTES = 40 * 1024 * 1024
MAX_LIBRARY_UPLOADS_PER_DAY = 20


# ============================================================ profil


class ProfileOut(BaseModel):
    login: str
    first_name: str
    last_name: str
    job_title: str
    faculty: str
    department_id: int | None
    department: str
    face_linked: bool
    pinfl_linked: bool


class ProfileUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=150)
    last_name: str = Field(min_length=1, max_length=150)
    job_title: str = Field(default="", max_length=255)
    department_id: int | None = None


def _profile(db: Session, owner_key: str) -> StaffProfile:
    prof = db.execute(select(StaffProfile).where(StaffProfile.owner_key == owner_key)).scalar_one_or_none()
    if prof is None:
        prof = StaffProfile(owner_key=owner_key, updated_at=dt.datetime.now(dt.timezone.utc))
        db.add(prof)
        db.flush()
    return prof


def _profile_out(db: Session, auth: AuthContext, prof: StaffProfile) -> ProfileOut:
    login = auth.user.username
    face = db.execute(
        select(func.count()).select_from(FaceTemplate).where(
            FaceTemplate.owner_key == login, FaceTemplate.is_active.is_(True)
        )
    ).scalar() or 0
    pinfl = db.execute(
        select(func.count()).select_from(StaffPinfl).where(
            StaffPinfl.owner_key == login, StaffPinfl.is_active.is_(True)
        )
    ).scalar() or 0
    return ProfileOut(
        login=login, first_name=auth.user.first_name or "", last_name=auth.user.last_name or "",
        job_title=prof.job_title or "", faculty=prof.faculty or "", department_id=prof.department_id,
        department=prof.department or "", face_linked=bool(face), pinfl_linked=bool(pinfl),
    )


@router.get("/staff/me/profile/", response_model=ProfileOut)
def my_profile(db: Session = Depends(get_db), auth: AuthContext = Depends(require_roles(*TEACHER_ROLES))) -> ProfileOut:
    prof = _profile(db, auth.user.username)
    db.commit()
    return _profile_out(db, auth, prof)


@router.put("/staff/me/profile/", response_model=ProfileOut)
def update_my_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*TEACHER_ROLES)),
) -> ProfileOut:
    """Ism, lavozim va kafedra. Login (telefon/Xodim ID) bu yerda o'zgarmaydi.

    Kafedra almashsa, eski kafedra fanlaridan tanlov tozalanadi (`apply_staff_department`) —
    frontend buni oldindan ogohlantiradi.
    """
    user = auth.user
    user.first_name = payload.first_name.strip()[:150]
    user.last_name = payload.last_name.strip()[:150]
    prof = _profile(db, user.username)
    prof.job_title = payload.job_title.strip()[:255]
    if payload.department_id is not None and payload.department_id != prof.department_id:
        dept = db.get(AcademicDepartment, payload.department_id)
        if dept is None or payload.department_id not in _department_ids_with_subjects(db):
            raise HTTPException(status_code=400, detail="Kafedra ro'yxatdan tanlanishi kerak.")
        staff_dept.apply_staff_department(db, prof, department_id=dept.id)
    prof.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return _profile_out(db, auth, prof)


def _department_ids_with_subjects(db: Session) -> set[int]:
    return set(db.execute(
        select(CourseSyllabus.department_id).where(
            CourseSyllabus.is_active.is_(True), CourseSyllabus.department_id.is_not(None)
        ).distinct()
    ).scalars().all())


@router.get("/staff/departments/")
def list_departments(db: Session = Depends(get_db), auth: AuthContext = Depends(require_roles(*TEACHER_ROLES))) -> list[dict]:
    """Tanlash uchun kafedralar — faqat fanlari bor "haqiqiy" kafedralar.

    Bazada bir kafedraning bir necha yozuvi bor (importdan qolgan); fansiz nusxalar
    ro'yxatga chiqmaydi, aks holda o'qituvchi "bo'sh" kafedrani tanlab qo'yardi.
    """
    ids = _department_ids_with_subjects(db)
    rows = db.execute(
        select(AcademicDepartment.id, AcademicDepartment.name).where(AcademicDepartment.id.in_(ids or {0}))
        .order_by(AcademicDepartment.name)
    ).all()
    return [{"id": r.id, "name": r.name} for r in rows]


# ============================================================ kafedra kutubxonasi


def _my_department_id(db: Session, owner_key: str) -> int:
    prof = db.execute(select(StaffProfile).where(StaffProfile.owner_key == owner_key)).scalar_one_or_none()
    if prof is None or not prof.department_id:
        raise HTTPException(status_code=400, detail="Avval profilda kafedrangizni tanlang.")
    return int(prof.department_id)


def _library_item(book: SubjectBook, chunks: int, auth: AuthContext, uploader_name: str) -> dict:
    return {
        "id": book.id,
        "title": book.title,
        "kind": book.kind or "book",
        "status": book.status or "ready",
        "status_note": book.status_note or "",
        "chunk_count": chunks,
        "owner_key": book.owner_key or "",
        "uploader_name": uploader_name,
        "can_delete": auth.role == "admin" or bool(book.owner_key and book.owner_key == auth.user.username),
        "created_at": book.created_at.isoformat() if book.created_at else None,
    }


@router.get("/staff/library/")
def list_library(db: Session = Depends(get_db), auth: AuthContext = Depends(require_roles(*TEACHER_ROLES))) -> dict:
    from app.models.user import User

    dept_id = _my_department_id(db, auth.user.username)
    rows = db.execute(
        select(SubjectBook, func.count(BookChunk.id))
        .join(BookChunk, BookChunk.book_id == SubjectBook.id, isouter=True)
        .where(SubjectBook.department_id == dept_id)
        .group_by(SubjectBook.id)
        .order_by(SubjectBook.kind.desc(), SubjectBook.title)
    ).all()
    owners = {b.owner_key for b, _ in rows if b.owner_key}
    names = {
        u.username: f"{u.last_name} {u.first_name}".strip()
        for u in db.execute(select(User).where(User.username.in_(owners or {""}))).scalars().all()
    }
    dept = db.get(AcademicDepartment, dept_id)
    return {
        "department": dept.name if dept else "",
        "items": [_library_item(b, n, auth, names.get(b.owner_key, "")) for b, n in rows],
    }


def _safe_title(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:512]


@router.post("/staff/library/", status_code=201)
async def upload_library_item(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    kind: str = Form("book"),
    title: str = Form(""),
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*TEACHER_ROLES)),
) -> dict:
    """Kitob yoki protokol — O'Z kafedrasiga. Matn fonda ajratilib, AI uchun indekslanadi."""
    kind = (kind or "book").strip()
    if kind not in LIBRARY_KINDS:
        raise HTTPException(status_code=400, detail="Turi: book yoki protocol.")
    name = file.filename or "fayl"
    if not name.lower().endswith(LIBRARY_EXTENSIONS):
        raise HTTPException(status_code=400, detail="Faqat PDF, Word (.docx, .doc) yoki .txt fayl.")
    content = await file.read(MAX_LIBRARY_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="Fayl bo'sh.")
    if len(content) > MAX_LIBRARY_BYTES:
        raise HTTPException(status_code=413, detail="Fayl 40 MB dan katta.")

    dept_id = _my_department_id(db, auth.user.username)
    day_ago = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    recent = db.execute(
        select(func.count()).select_from(SubjectBook).where(
            SubjectBook.owner_key == auth.user.username, SubjectBook.created_at >= day_ago
        )
    ).scalar() or 0
    if recent >= MAX_LIBRARY_UPLOADS_PER_DAY and auth.role != "admin":
        raise HTTPException(status_code=429, detail="Bir kunda 20 tadan ortiq fayl yuklab bo'lmaydi.")

    clean_title = _safe_title(title) or _safe_title(name.rsplit(".", 1)[0])
    duplicate = db.execute(
        select(SubjectBook.id).where(
            SubjectBook.department_id == dept_id,
            SubjectBook.kind == kind,
            func.lower(SubjectBook.title) == clean_title.lower(),
        )
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Kafedrada shu nomli hujjat allaqachon bor.")

    now = dt.datetime.now(dt.timezone.utc)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)[-120:]
    rel_path = f"books/uploads/{dept_id}/{auth.user.username}/{int(now.timestamp())}_{safe_name}"
    storage.save_upload(rel_path, content)
    book = SubjectBook(
        department_id=dept_id, title=clean_title, source_archive="O'qituvchi yukladi",
        file=rel_path, language="", page_count=0, is_active=False, kind=kind,
        owner_key=auth.user.username, status="processing", status_note="", created_at=now,
    )
    db.add(book)
    db.commit()
    background.add_task(_index_library_item, book.id)
    return _library_item(book, 0, auth, f"{auth.user.last_name} {auth.user.first_name}".strip())


def _index_library_item(book_id: int) -> None:
    """Fonda: matnni ajratish, parchalash, embedding. Tugagach hujjat faollashadi."""
    from app.core.config import get_settings
    from app.services import malaka_service as mk

    db = SessionLocal()
    try:
        book = db.get(SubjectBook, book_id)
        if book is None:
            return
        try:
            with open(storage.absolute_path(book.file), "rb") as fh:
                text = mk.extract_text(book.file, fh.read())
        except Exception as exc:  # noqa: BLE001
            book.status, book.status_note = "failed", f"Faylni o'qib bo'lmadi: {str(exc)[:180]}"
            db.commit()
            return
        pieces = protocol_library.split_chunks(text)
        if not pieces:
            book.status = "failed"
            book.status_note = "Matn topilmadi. Skanerlangan PDF bo'lsa, matnli nusxasini (Word yoki matnli PDF) yuklang."
            db.commit()
            return
        api_key = (get_settings().openai_api_key or "").strip()
        try:
            vectors = protocol_library.create_embeddings(api_key, pieces)
        except Exception as exc:  # noqa: BLE001
            logger.exception("kutubxona embeddingi")
            book.status, book.status_note = "failed", f"Indekslab bo'lmadi: {str(exc)[:180]}"
            db.commit()
            return
        now = dt.datetime.now(dt.timezone.utc)
        for i, (piece, vec) in enumerate(zip(pieces, vectors)):
            db.add(BookChunk(
                book_id=book.id, department_id=book.department_id, chunk_index=i,
                page_start=0, page_end=0, text=piece, embedding=vec, created_at=now,
            ))
        book.status, book.status_note, book.is_active = "ready", "", True
        db.commit()
    finally:
        db.close()


@router.delete("/staff/library/{book_id}/", status_code=204, response_model=None)
def delete_library_item(
    book_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*TEACHER_ROLES)),
) -> None:
    book = db.get(SubjectBook, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    if auth.role != "admin" and (not book.owner_key or book.owner_key != auth.user.username):
        raise HTTPException(status_code=403, detail="Faqat yuklagan o'qituvchi yoki admin o'chira oladi.")
    db.query(BookChunk).filter(BookChunk.book_id == book.id).delete(synchronize_session=False)
    if book.file and book.owner_key:
        storage.delete_file(book.file)
    db.delete(book)
    db.commit()
