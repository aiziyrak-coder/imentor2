from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class CampusBuilding(Base):
    __tablename__ = "core_campusbuilding"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    short_code: Mapped[str] = mapped_column(String(64), default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer, default=100)
    boundary: Mapped[list] = mapped_column(JSONB, default=list)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0)
    notes: Mapped[str] = mapped_column(String(512), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class StaffScheduleSlot(Base):
    __tablename__ = "core_staffscheduleslot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    week_phase: Mapped[str] = mapped_column(String(16), default="every")
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_time: Mapped[dt.time] = mapped_column(Time)
    end_time: Mapped[dt.time] = mapped_column(Time)
    building_id: Mapped[int | None] = mapped_column(ForeignKey("core_campusbuilding.id"), nullable=True)
    building_name: Mapped[str] = mapped_column(String(255))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer, default=100)
    title: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    building: Mapped[CampusBuilding | None] = relationship(lazy="joined")

    def geofence(self) -> tuple[float, float, int, str]:
        if self.building_id and self.building is not None:
            b = self.building
            return b.latitude, b.longitude, int(b.radius_m), b.name
        return self.latitude, self.longitude, int(self.radius_m), self.building_name


class StaffProfile(Base):
    __tablename__ = "core_staffprofile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128), unique=True)
    photo: Mapped[str] = mapped_column(String(512), default="")
    faculty: Mapped[str] = mapped_column(String(255), default="")
    department: Mapped[str] = mapped_column(String(255), default="")
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("core_academicdepartment.id", ondelete="SET NULL"),
        nullable=True,
    )
    direction: Mapped[str] = mapped_column(String(255), default="")
    participant_kind: Mapped[str] = mapped_column(String(16), default="")
    study_group: Mapped[str] = mapped_column(String(128), default="")
    job_title: Mapped[str] = mapped_column(String(255), default="")
    # HEMIS'dagi ish holati: "Ishlamoqda" / "Ta’tilda" / "Bo‘shagan" (`hemis_staff`).
    hemis_status: Mapped[str] = mapped_column(String(32), default="", server_default="")
    hemis_synced_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    academic_department = relationship("AcademicDepartment", lazy="joined")


class StaffLocationPing(Base):
    __tablename__ = "core_stafflocationping"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    recorded_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    client_ts_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class StaffLocationAlert(Base):
    __tablename__ = "core_stafflocationalert"
    __table_args__ = (
        UniqueConstraint(
            "owner_key", "slot_id", "alert_date",
            name="core_stafflocationalert_owner_slot_day_uniq",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_key: Mapped[str] = mapped_column(String(128))
    slot_id: Mapped[int | None] = mapped_column(ForeignKey("core_staffscheduleslot.id"), nullable=True)
    building_name: Mapped[str] = mapped_column(String(255), default="")
    expected_lat: Mapped[float] = mapped_column(Float)
    expected_lng: Mapped[float] = mapped_column(Float)
    actual_lat: Mapped[float] = mapped_column(Float)
    actual_lng: Mapped[float] = mapped_column(Float)
    distance_m: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(Integer)
    slot_start: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    slot_end: Mapped[dt.time | None] = mapped_column(Time, nullable=True)
    message: Mapped[str] = mapped_column(String(512), default="")
    alert_date: Mapped[dt.date] = mapped_column(Date)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
