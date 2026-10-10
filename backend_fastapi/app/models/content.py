from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class AcademicDepartment(Base):
    __tablename__ = "core_academicdepartment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    #: Nom tarjimalari: {"ru": "...", "en": "..."}. `name` — o'zbekcha manba
    #: va u KALIT sifatida ishlatiladi, shuning uchun bu yerda takrorlanmaydi.
    name_i18n: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    code: Mapped[str] = mapped_column(String(64), unique=True)
    # HEMIS'dagi ayni kafedra. Nomlar bir xil yozilmagani uchun (imlo, "kafedrasi"
    # qo'shimchasi) bog'lanish shu yerda saqlanadi; `name` esa O'ZGARMAYDI —
    # u hamma joyda kalit sifatida ishlatiladi (2026-09-25).
    hemis_id: Mapped[str] = mapped_column(String(32), default="")
    hemis_code: Mapped[str] = mapped_column(String(64), default="")
    hemis_name: Mapped[str] = mapped_column(String(255), default="")
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Institut hujjatidagi klinik kafedrami (bemor yonida, shifoxona bazasida).
    # AI material shu bayroqqa qarab klinik yoki klinik emas deb yoziladi
    # (`app/data/clinical_departments.json`, 2026-09-25).
    is_clinical: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    #: Rektor hisobotidan chiqarilgan kafedra: uning o'qituvchilari, darslari
    #: va fanlari hisobotga tushmaydi (`app/services/report_exclusion.py`).
    report_excluded: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class CourseSyllabus(Base):
    __tablename__ = "core_coursesyllabus"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subject_name: Mapped[str] = mapped_column(String(255))
    subject_code: Mapped[str] = mapped_column(String(64), unique=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("core_academicdepartment.id"), nullable=True
    )
    # OnlineTest Direction.name (DI, TPI, PI, …). Bo'sh = hali belgilanmagan.
    direction_code: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(String(512), default="")
    instruction_language: Mapped[str] = mapped_column(String(8), default="uz")
    file_name: Mapped[str] = mapped_column(String(512))
    topics: Mapped[list] = mapped_column(JSONB, default=list)
    variants: Mapped[list] = mapped_column(JSONB, default=list)
    # Interfeys tiliga moslash uchun tarjimalar. ASL nom hech qachon
    # o'zgarmaydi — u kalit va AI promptlari uchun ishlatiladi; bu yerda
    # faqat KO'RSATISH uchun variantlar saqlanadi.
    #   name_i18n   -> {"ru": "...", "en": "..."}
    #   topics_i18n -> {"ru": {"<asl sarlavha>": "<tarjima>"}, "en": {...}}
    name_i18n: Mapped[dict] = mapped_column(JSONB, default=dict)
    topics_i18n: Mapped[dict] = mapped_column(JSONB, default=dict)
    #: Bu fanni ko'ra va tanlay oladigan hodimlar (`owner_key`). BO'SH —
    #: hammaga ochiq (odatiy holat). To'ldirilgan bo'lsa fan katalogda va
    #: kafedra ro'yxatida faqat shularga ko'rinadi va faqat ular uni o'ziga
    #: biriktira oladi. Admin cheklovdan tashqarida.
    allowed_owner_keys: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    #: Excel'dan o'zi yuklagan o'qituvchining `owner_key`. BO'SH — admin
    #: yaratgan umumiy fan. To'ldirilgan fan faqat shu o'qituvchiniki:
    #: `allowed_owner_keys` ham `[owner]`, o'chirishni faqat u qila oladi.
    created_by: Mapped[str] = mapped_column(String(128), default="", server_default="")
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    #: Rektor hisobotidan chiqarilgan fan: shu fan bo'yicha darslar va testlar
    #: hech bir o'qituvchining hisobotiga tushmaydi.
    report_excluded: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    department: Mapped[AcademicDepartment | None] = relationship(lazy="joined")


class StaffCourseSelection(Base):
    __tablename__ = "core_staffcourseselection"
    __table_args__ = (
        UniqueConstraint(
            "owner_key", "syllabus_id", "variant_label",
            name="core_staff_course_selection_variant_uniq",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    syllabus_id: Mapped[int] = mapped_column(ForeignKey("core_coursesyllabus.id", ondelete="CASCADE"))
    variant_label: Mapped[str] = mapped_column(String(128), default="")
    selected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    syllabus: Mapped[CourseSyllabus] = relationship(lazy="joined")
