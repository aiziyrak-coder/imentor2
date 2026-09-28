from __future__ import annotations

import datetime as dt

from pydantic import BaseModel


class SubjectBookOut(BaseModel):
    id: int
    department: int
    title: str
    department_id: int
    department_code: str
    department_name: str
    source_archive: str
    file_url: str
    file_size: int
    language: str
    page_count: int
    chunk_count: int
    # "book" — darslik; "protocol" — milliy klinik protokol / SanPin / SSV buyrug'i.
    kind: str = "book"
    is_active: bool
    created_at: dt.datetime


class DepartmentBookStats(BaseModel):
    id: int
    code: str
    name: str
    books_count: int
    chunks_count: int
    protocols_count: int = 0


class SubjectBookStatsOut(BaseModel):
    departments_count: int
    books_count: int
    by_department: list[DepartmentBookStats]


class BookSearchRequest(BaseModel):
    subject_code: str = ""
    syllabus_id: int | None = None
    query: str
    top_k: int = 5


class BookSearchResultItem(BaseModel):
    book_title: str
    page: str
    text: str
