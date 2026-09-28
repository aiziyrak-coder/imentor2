"""Parolni majburiy almashtirish belgisi — o'qish va yozish.

Qarang: `app.models.password_policy`. Qator yo'q bo'lsa almashtirish
talab qilinmaydi, shuning uchun oddiy foydalanuvchilarga bu hech qanday
ta'sir qilmaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from app.models.password_policy import PasswordPolicy


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def must_change(db: Session, username: str) -> bool:
    key = (username or "").strip()
    if not key:
        return False
    row = db.get(PasswordPolicy, key)
    return bool(row is not None and row.must_change)


def require_change(db: Session, username: str) -> None:
    """Keyingi kirishda parolni almashtirishni talab qiladi (commit chaqiruvchida)."""
    row = db.get(PasswordPolicy, username)
    if row is None:
        db.add(PasswordPolicy(username=username, must_change=True, updated_at=_now()))
        return
    row.must_change = True
    row.updated_at = _now()


def clear(db: Session, username: str) -> None:
    row = db.get(PasswordPolicy, username)
    if row is not None and row.must_change:
        row.must_change = False
        row.updated_at = _now()
