from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict


class StaffCourseSelectionOut(BaseModel):
    """Django `StaffCourseSelectionSerializer` bilan bir xil: `syllabus` — ichma-ich
    to'liq obyekt (frontend `sel.syllabus.id` shaklida foydalanadi, flat emas)."""

    id: int
    syllabus: dict
    variant_label: str
    selected_at: dt.datetime
    # O'qituvchi bu fanni Excel'dan o'zi yuklagan — "O'chirish" faqat shunda.
    is_own: bool = False


class AdminStaffCourseSelectionOut(BaseModel):
    id: int
    owner_key: str
    owner_name: str
    owner_phone_display: str
    syllabus: dict
    variant_label: str
    selected_at: dt.datetime


class AssignCourseSelectionRequest(BaseModel):
    phone_digits: str
    syllabus_id: int
    variant_labels: list[str] = []


class SetMyTeachingSubjectsRequest(BaseModel):
    syllabus_ids: list[int]
