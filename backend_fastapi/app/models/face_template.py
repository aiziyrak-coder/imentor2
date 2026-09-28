"""Yuz orqali kirish uchun yuz izlari (cam.fermi.uz'dan nusxa).

cam.fermi.uz'da xodimlar yuzini ro'yxatdan o'tkazgan. iMentor u bazaga
YOZMAYDI va unga to'g'ridan-to'g'ri ulanmaydi: serverdagi sinxronlash
skripti (`app/scripts/sync_face_templates.py`) tasdiqlangan yuzlarni shu
jadvalga nusxalaydi. Shu sabab cam.fermi.uz ishlamay qolsa ham yuz orqali
kirish ishlaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class FaceTemplate(Base):
    __tablename__ = "core_facetemplate"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # cam.fermi.uz `students_staff.id` (UUID) — sinxronlash kaliti.
    source_person_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255), default="")
    position: Mapped[str] = mapped_column(String(255), default="")
    # 512 o'lchamli L2-normallangan ArcFace vektori, JSON massiv.
    embedding: Mapped[str] = mapped_column(Text)
    # Bog'langan iMentor hisobi (`auth_user.username`). Bo'sh — hali bog'lanmagan.
    owner_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    # "xodim" | "talaba" (cam.fermi.uz `type`). Talaba yuzi `ot_<OnlineTest ID>` yoki malaka
    # tinglovchisi (pasport) hisobiga bog'lanadi — xodimlarni bog'lash qoidalari unga tegmaydi.
    person_type: Mapped[str] = mapped_column(String(16), default="xodim", server_default="xodim")
    # Talaba guruhi (OnlineTest'dagi nomi) — yuz bilan kirgan talaba tokeniga yoziladi.
    group_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    # "auto" — ism-familiya bo'yicha aniq moslik; "admin" — admin qo'lda bog'lagan.
    # Sinxronlash "admin" bog'lanishini hech qachon o'zgartirmaydi.
    link_source: Mapped[str] = mapped_column(String(16), default="")
    # cam.fermi.uz'dan o'chsa yoki tasdiq bekor qilinsa — False (qator qoladi,
    # admin bog'lanishi yo'qolmasin).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    synced_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    linked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
