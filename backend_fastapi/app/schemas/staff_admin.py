from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, field_validator

from app.core.staff_login import normalize_staff_login


def _normalize_phone(value: str) -> str:
    """Telefon yoki Xodim ID — ikkalasi ham `auth_user.username`."""
    return normalize_staff_login(value)


class MeOut(BaseModel):
    id: int
    username: str
    role: str
    first_name: str = ""
    last_name: str = ""
    photo_url: str = ""
    student_id: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminStaffUpsertRequest(BaseModel):
    phone_digits: str
    password: str = ""
    role: str = "hodim"
    first_name: str = ""
    last_name: str = ""
    faculty: str = ""
    department: str = ""
    department_id: int | None = None
    direction: str = ""
    participant_kind: str = ""
    study_group: str = ""
    job_title: str = ""

    @field_validator("phone_digits")
    @classmethod
    def _v_phone(cls, v: str) -> str:
        return _normalize_phone(v)

    @field_validator("role")
    @classmethod
    def _v_role(cls, v: str) -> str:
        v = (v or "hodim").strip().lower()
        return v if v in ("admin", "klinika_admin", "hodim") else "hodim"


class AdminDeprovisionStaffRequest(BaseModel):
    phone_digits: str

    @field_validator("phone_digits")
    @classmethod
    def _v_phone(cls, v: str) -> str:
        return _normalize_phone(v)


class AvatarResponse(BaseModel):
    photo_url: str = ""


class AdminStaffListEntry(BaseModel):
    phone_digits: str
    phone_display: str
    first_name: str
    last_name: str
    display_name: str
    role: str
    faculty: str = ""
    department: str = ""
    department_id: int | None = None
    direction: str = ""
    participant_kind: str = ""
    study_group: str = ""
    job_title: str = ""
    is_active: bool
    date_joined: dt.datetime
    last_login: dt.datetime | None
    # Xodim hali bir marta ham kirmagan — paroli hamon import qo'ygan
    # boshlang'ich parol. Admin login ro'yxatini shu bo'yicha chop etadi.
    password_is_initial: bool = False
