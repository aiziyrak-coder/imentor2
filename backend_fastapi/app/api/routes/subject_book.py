from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.models.book import BookChunk, SubjectBook
from app.models.content import AcademicDepartment
from app.schemas.book import (
    BookSearchRequest,
    BookSearchResultItem,
    DepartmentBookStats,
    SubjectBookOut,
    SubjectBookStatsOut,
)
from app.services import book_retrieval as rag
from app.services import file_storage as storage
from app.services.pagination import paginate

router = APIRouter()


@router.get("/admin/subject-books/stats/", response_model=SubjectBookStatsOut)
def admin_subject_book_stats(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> SubjectBookStatsOut:
    rows = db.execute(
        select(
            AcademicDepartment.id,
            AcademicDepartment.code,
            AcademicDepartment.name,
            func.count(func.distinct(SubjectBook.id)).label("books_count"),
            func.count(func.distinct(BookChunk.id)).label("chunks_count"),
            func.count(func.distinct(SubjectBook.id)).filter(SubjectBook.kind == "protocol").label("protocols_count"),
        )
        .select_from(AcademicDepartment)
        .join(SubjectBook, SubjectBook.department_id == AcademicDepartment.id)
        .join(BookChunk, BookChunk.book_id == SubjectBook.id, isouter=True)
        .group_by(AcademicDepartment.id, AcademicDepartment.code, AcademicDepartment.name)
        .having(func.count(func.distinct(SubjectBook.id)) > 0)
        .order_by(AcademicDepartment.name)
    ).all()

    by_department = [
        DepartmentBookStats(
            id=r.id, code=r.code, name=r.name, books_count=r.books_count,
            chunks_count=r.chunks_count, protocols_count=r.protocols_count,
        )
        for r in rows
    ]
    total_books = db.execute(select(func.count()).select_from(SubjectBook)).scalar_one()
    return SubjectBookStatsOut(
        departments_count=len(by_department),
        books_count=total_books,
        by_department=by_department,
    )


@router.get("/admin/subject-books/")
def admin_list_subject_books(
    request: Request,
    department_code: str = "",
    q: str = "",
    kind: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    """`kind=protocol` — faqat protokollar (klinik protokol, SanPin, SSV buyrug'i)."""
    stmt = (
        select(
            SubjectBook,
            AcademicDepartment.code,
            AcademicDepartment.name,
            func.count(func.distinct(BookChunk.id)).label("chunk_count"),
        )
        .join(AcademicDepartment, SubjectBook.department_id == AcademicDepartment.id)
        .join(BookChunk, BookChunk.book_id == SubjectBook.id, isouter=True)
        .group_by(SubjectBook.id, AcademicDepartment.code, AcademicDepartment.name)
        .order_by(AcademicDepartment.name, SubjectBook.title)
    )
    if department_code.strip():
        stmt = stmt.where(AcademicDepartment.code == department_code.strip())
    if q.strip():
        stmt = stmt.where(SubjectBook.title.ilike(f"%{q.strip()}%"))
    if kind.strip():
        stmt = stmt.where(SubjectBook.kind == kind.strip())

    rows = db.execute(stmt).all()
    media_url = get_settings().django_media_url.rstrip("/")
    out = []
    for book, dept_code, dept_name, chunk_count in rows:
        if book.file:
            try:
                file_size = os.path.getsize(storage.absolute_path(book.file))
            except OSError:
                file_size = 0
            file_url = str(request.base_url).rstrip("/") + f"{media_url}/{book.file}"
        else:
            file_size = 0
            file_url = ""
        out.append(
            SubjectBookOut(
                id=book.id,
                department=book.department_id,
                title=book.title,
                department_id=book.department_id,
                department_code=dept_code,
                department_name=dept_name,
                source_archive=book.source_archive,
                file_url=file_url,
                file_size=file_size,
                language=book.language,
                page_count=book.page_count,
                chunk_count=chunk_count,
                is_active=book.is_active,
                kind=book.kind or "book",
                created_at=book.created_at,
            ).model_dump()
        )
    return paginate(out, request, default_page_size=100, max_page_size=300)


@router.delete("/admin/subject-books/{pk}/", status_code=204, response_model=None)
def admin_delete_subject_book(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    obj = db.get(SubjectBook, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Topilmadi.")
    db.delete(obj)
    db.commit()


@router.post("/admin/subject-books/search/", response_model=list[BookSearchResultItem])
def admin_book_rag_search(
    payload: BookSearchRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> list[BookSearchResultItem]:
    """Admin uchun RAG diagnostika — subject_code bo'yicha eng mos chunk'larni ko'rsatadi."""
    chunks = rag.retrieve_book_context(
        db, payload.subject_code, payload.query, top_k=payload.top_k, syllabus_id=payload.syllabus_id
    )
    return [BookSearchResultItem(**c) for c in chunks]
