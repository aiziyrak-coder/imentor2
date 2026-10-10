from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.core.staff_login import normalize_staff_login


class LocalLoginRequest(BaseModel):
    """`phone_digits` — telefon raqami YOKI Xodim ID (ikkalasi ham username)."""

    phone_digits: str = Field(max_length=32)
    password: str = Field(min_length=6, max_length=128)
    role: str | None = None
    first_name: str = ""
    last_name: str = ""
    faculty: str = ""
    department: str = ""
    direction: str = ""
    register: bool = False

    @field_validator("phone_digits")
    @classmethod
    def _validate_login(cls, value: str) -> str:
        return normalize_staff_login(value)

    @field_validator("role")
    @classmethod
    def _validate_role(cls, value: str | None) -> str | None:
        if value is None:
            return value
        v = value.strip().lower()
        if v not in ("admin", "hodim"):
            raise ValueError("role must be admin or hodim")
        return v


class LoginResponse(BaseModel):
    access: str
    refresh: str
    role: str
    username: str
    first_name: str = ""
    last_name: str = ""
    photo_url: str = ""
    student_id: str | None = None
    group_name: str | None = None
    # Hisob boshqa odam bergan parol bilan yaratilgan (masalan pasport
    # seriyasi) — foydalanuvchi avval o'z parolini qo'yishi kerak.
    must_change_password: bool = False


class TokenRefreshRequest(BaseModel):
    refresh: str


class TokenRefreshResponse(BaseModel):
    access: str
    refresh: str


class IdLoginRequest(BaseModel):
    """Parolsiz kirish: JSHSHIR yoki pasport (seriya ro'yxatdan + raqam).

    Parol maydoni YO'Q — 2026-10-02 da kirish shaxs raqamiga o'tkazildi.
    """

    pinfl: str = Field(default="", max_length=32)
    passport_series: str = Field(default="", max_length=8)
    passport_number: str = Field(default="", max_length=24)
    #: Institut bergan raqam — talabada Talaba ID, xodimda Xodim ID.
    #: Yangi kelgan va xorijiy talabalarda JSHSHIR/pasport hali yo'q, shuning
    #: uchun kirish faqat shu raqam bilan mumkin (2026-10-05).
    institute_id: str = Field(default="", max_length=32)
