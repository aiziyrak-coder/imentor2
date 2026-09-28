"""Parolni majburiy almashtirish belgisi.

Ba'zi hisoblar boshqa odam aytgan parol bilan yaratiladi: malaka
tinglovchilarida parol — pasport seriyasi, o'qituvchilarda — hammaga
bir xil boshlang'ich parol. Pasport raqami arizalar va ro'yxatlarda
yuradi, umumiy parolni esa hamma o'qituvchi biladi. Shuning uchun bunday
hisob birinchi kirishdayoq o'z parolini qo'yishga majbur.

Belgi `auth_user` da emas, ALOHIDA jadvalda: `auth_user` Django'ning
jadvali va unga ustun qo'shish Django migratsiyalari bilan to'qnashardi.
Nomi ham `auth_` bilan boshlanmaydi — bu prefiks Django'niki.
Qator yo'q — almashtirish talab qilinmaydi (odatiy holat).
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PasswordPolicy(Base):
    __tablename__ = "user_password_policy"

    username: Mapped[str] = mapped_column(String(150), primary_key=True)
    must_change: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
