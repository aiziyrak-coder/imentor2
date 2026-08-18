from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, require_roles
from app.core.db import get_db
from app.core.throttling import throttle_staff_ping
from app.models.staff_location import CampusBuilding, StaffLocationAlert, StaffLocationPing, StaffScheduleSlot
from app.schemas.staff_location import (
    CampusBuildingIn,
    CampusBuildingPatch,
    CampusBuildingOut,
    LocationPingRequest,
    StaffScheduleBulkRequest,
    StaffScheduleSlotIn,
    StaffScheduleSlotOut,
    StaffScheduleSlotPatch,
)
from app.services import location_service as svc
from app.services.geo import (
    current_week_phase_code,
    iso_week_number,
    week_phase_choice_label_uz,
    week_phase_label_uz,
)
from app.services.pagination import paginate

router = APIRouter()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _slot_out(s: StaffScheduleSlot) -> StaffScheduleSlotOut:
    return StaffScheduleSlotOut(
        id=s.id,
        owner_key=s.owner_key,
        week_phase=s.week_phase,
        week_phase_label=week_phase_choice_label_uz(s.week_phase),
        weekday=s.weekday,
        start_time=s.start_time,
        end_time=s.end_time,
        building=CampusBuildingOut.model_validate(s.building) if s.building else None,
        building_id=s.building_id,
        building_name=s.building_name,
        latitude=s.latitude,
        longitude=s.longitude,
        radius_m=s.radius_m,
        title=s.title,
        is_active=s.is_active,
        applies_this_calendar_week=(
            s.week_phase == "every" or s.week_phase == current_week_phase_code(svc.now_local())
        ),
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


@router.post("/staff/location-ping/", status_code=status.HTTP_201_CREATED)
def staff_location_ping(
    payload: LocationPingRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("hodim")),
    _: None = Depends(throttle_staff_ping),
) -> dict:
    if payload.client_kind and payload.client_kind.strip().lower() != "mobile":
        raise HTTPException(status_code=400, detail="Joylashuv faqat telefon (mobil) qurilmadan qabul qilinadi.")
    try:
        ping, alerts = svc.record_ping_and_evaluate(
            db,
            auth.user.username,
            payload.latitude,
            payload.longitude,
            payload.accuracy_m,
            payload.client_ts_ms,
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Koordinata noto'g'ri.")

    if ping is None:
        return {"ok": True, "skipped": True, "reason": "accuracy_too_low", "alerts_created": 0, "alert_ids": []}
    return {"ok": True, "alerts_created": len(alerts), "alert_ids": [a.id for a in alerts]}


@router.get("/staff/schedule/", response_model=list[StaffScheduleSlotOut])
def my_schedule(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("hodim")),
) -> list[StaffScheduleSlotOut]:
    rows = (
        db.execute(
            select(StaffScheduleSlot)
            .where(StaffScheduleSlot.owner_key == auth.user.username, StaffScheduleSlot.is_active.is_(True))
            .order_by(StaffScheduleSlot.week_phase, StaffScheduleSlot.weekday, StaffScheduleSlot.start_time)
        )
        .scalars()
        .all()
    )
    return [_slot_out(r) for r in rows]


@router.get("/staff/schedule-week-info/")
def schedule_week_info(auth: AuthContext = Depends(require_roles(*STAFF_ROLES))) -> dict:
    now = svc.now_local()
    wn = iso_week_number(now)
    ph = current_week_phase_code(now)
    return {"iso_week": wn, "current_week_phase": ph, "current_week_phase_label_uz": week_phase_label_uz(ph)}


@router.get("/staff/buildings/", response_model=list[CampusBuildingOut])
def staff_buildings(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles(*STAFF_ROLES)),
) -> list[CampusBuildingOut]:
    rows = (
        db.execute(
            select(CampusBuilding)
            .where(CampusBuilding.is_active.is_(True))
            .order_by(CampusBuilding.sort_order, CampusBuilding.name)
        )
        .scalars()
        .all()
    )
    return [CampusBuildingOut.model_validate(r) for r in rows]


@router.get("/admin/campus-buildings/", response_model=list[CampusBuildingOut])
def admin_list_buildings(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> list[CampusBuildingOut]:
    rows = db.execute(select(CampusBuilding).order_by(CampusBuilding.sort_order, CampusBuilding.name)).scalars().all()
    return [CampusBuildingOut.model_validate(r) for r in rows]


@router.post("/admin/campus-buildings/", response_model=CampusBuildingOut, status_code=status.HTTP_201_CREATED)
def admin_create_building(
    payload: CampusBuildingIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> CampusBuildingOut:
    now = dt.datetime.now(dt.timezone.utc)
    obj = CampusBuilding(**payload.model_dump(), created_at=now, updated_at=now)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return CampusBuildingOut.model_validate(obj)


@router.patch("/admin/campus-buildings/{pk}/", response_model=CampusBuildingOut)
def admin_update_building(
    pk: int,
    payload: CampusBuildingPatch,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> CampusBuildingOut:
    obj = db.get(CampusBuilding, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(obj)
    return CampusBuildingOut.model_validate(obj)


@router.delete("/admin/campus-buildings/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def admin_delete_building(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    obj = db.get(CampusBuilding, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    in_use = db.execute(
        select(StaffScheduleSlot).where(StaffScheduleSlot.building_id == pk)
    ).scalar_one_or_none()
    if in_use is not None:
        raise HTTPException(
            status_code=400,
            detail="Bu binoga boglangan jadval slotlari bor — avval ularni o'zgartiring.",
        )
    db.delete(obj)
    db.commit()


@router.post("/admin/staff-schedule/bulk/", status_code=status.HTTP_201_CREATED)
def admin_schedule_bulk(
    payload: StaffScheduleBulkRequest,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    if payload.replace_existing:
        existing = db.execute(
            select(StaffScheduleSlot).where(
                StaffScheduleSlot.owner_key == payload.owner_key,
                StaffScheduleSlot.week_phase == payload.week_phase,
            )
        ).scalars().all()
        for row in existing:
            db.delete(row)
        db.flush()

    now = dt.datetime.now(dt.timezone.utc)
    for x in payload.slots:
        if x.building_id is not None:
            b = db.get(CampusBuilding, x.building_id)
            if b is None or not b.is_active:
                raise HTTPException(status_code=404, detail="Bino topilmadi yoki faol emas.")
            slot = StaffScheduleSlot(
                owner_key=payload.owner_key,
                week_phase=payload.week_phase,
                weekday=x.weekday,
                start_time=x.start_time,
                end_time=x.end_time,
                building_id=b.id,
                building_name=b.name,
                latitude=b.latitude,
                longitude=b.longitude,
                radius_m=b.radius_m,
                title=x.title.strip(),
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        else:
            slot = StaffScheduleSlot(
                owner_key=payload.owner_key,
                week_phase=payload.week_phase,
                weekday=x.weekday,
                start_time=x.start_time,
                end_time=x.end_time,
                building_id=None,
                building_name=x.building_name.strip(),
                latitude=x.latitude,
                longitude=x.longitude,
                radius_m=x.radius_m,
                title=x.title.strip(),
                is_active=True,
                created_at=now,
                updated_at=now,
            )
        db.add(slot)

    db.commit()
    return {
        "ok": True,
        "created_count": len(payload.slots),
        "owner_key": payload.owner_key,
        "week_phase": payload.week_phase,
    }


@router.get("/admin/staff-schedule/", response_model=list[StaffScheduleSlotOut])
def admin_list_schedule(
    owner_key: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> list[StaffScheduleSlotOut]:
    stmt = select(StaffScheduleSlot).order_by(
        StaffScheduleSlot.owner_key, StaffScheduleSlot.week_phase, StaffScheduleSlot.weekday, StaffScheduleSlot.start_time
    )
    if owner_key.strip():
        stmt = stmt.where(StaffScheduleSlot.owner_key == owner_key.strip())
    rows = db.execute(stmt).scalars().all()
    return [_slot_out(r) for r in rows]


@router.post("/admin/staff-schedule/", response_model=StaffScheduleSlotOut, status_code=status.HTTP_201_CREATED)
def admin_create_schedule_slot(
    payload: StaffScheduleSlotIn,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> StaffScheduleSlotOut:
    now = dt.datetime.now(dt.timezone.utc)
    data = payload.model_dump()
    if data.get("building_id") is not None:
        b = db.get(CampusBuilding, data["building_id"])
        if b is None:
            raise HTTPException(status_code=404, detail="Bino topilmadi.")
        data["building_name"] = b.name
        data["latitude"] = b.latitude
        data["longitude"] = b.longitude
        data["radius_m"] = b.radius_m
    slot = StaffScheduleSlot(**data, created_at=now, updated_at=now)
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return _slot_out(slot)


@router.patch("/admin/staff-schedule/{pk}/", response_model=StaffScheduleSlotOut)
def admin_update_schedule_slot(
    pk: int,
    payload: StaffScheduleSlotPatch,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> StaffScheduleSlotOut:
    obj = db.get(StaffScheduleSlot, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    obj.updated_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    db.refresh(obj)
    return _slot_out(obj)


@router.delete("/admin/staff-schedule/{pk}/", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def admin_delete_schedule_slot(
    pk: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> None:
    obj = db.get(StaffScheduleSlot, pk)
    if obj is None:
        raise HTTPException(status_code=404, detail="Not found.")
    db.delete(obj)
    db.commit()


@router.get("/admin/staff-location-pings/")
def admin_location_pings(
    request: Request,
    owner_key: str = "",
    mode: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict | list[dict]:
    stmt = select(StaffLocationPing).order_by(StaffLocationPing.recorded_at.desc())
    if owner_key.strip():
        stmt = stmt.where(StaffLocationPing.owner_key == owner_key.strip())

    if mode.strip().lower() == "live":
        since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=svc.LIVE_PING_MAX_AGE_HOURS)
        stmt = stmt.where(StaffLocationPing.recorded_at >= since)
        rows = db.execute(stmt).scalars().all()
        latest: dict[str, StaffLocationPing] = {}
        for ping in rows:
            if ping.owner_key not in latest:
                latest[ping.owner_key] = ping
        rows = sorted(latest.values(), key=lambda p: p.owner_key)
        # Django: "live" rejimida pagination'siz oddiy ro'yxat qaytadi.
        return [
            {
                "id": p.id,
                "owner_key": p.owner_key,
                "latitude": p.latitude,
                "longitude": p.longitude,
                "accuracy_m": p.accuracy_m,
                "recorded_at": p.recorded_at.isoformat(),
                "client_ts_ms": p.client_ts_ms,
            }
            for p in rows
        ]

    rows = db.execute(stmt).scalars().all()
    out = [
        {
            "id": p.id,
            "owner_key": p.owner_key,
            "latitude": p.latitude,
            "longitude": p.longitude,
            "accuracy_m": p.accuracy_m,
            "recorded_at": p.recorded_at.isoformat(),
            "client_ts_ms": p.client_ts_ms,
        }
        for p in rows
    ]
    return paginate(out, request, default_page_size=100, max_page_size=500)


@router.get("/admin/staff-location-alerts/")
def admin_location_alerts(
    request: Request,
    owner_key: str = "",
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    stmt = select(StaffLocationAlert).order_by(StaffLocationAlert.created_at.desc())
    if owner_key.strip():
        stmt = stmt.where(StaffLocationAlert.owner_key == owner_key.strip())
    rows = db.execute(stmt).scalars().all()
    out = [
        {
            "id": a.id,
            "owner_key": a.owner_key,
            "slot": a.slot_id,
            "building_name": a.building_name,
            "expected_lat": a.expected_lat,
            "expected_lng": a.expected_lng,
            "actual_lat": a.actual_lat,
            "actual_lng": a.actual_lng,
            "distance_m": a.distance_m,
            "radius_m": a.radius_m,
            "slot_start": a.slot_start.isoformat() if a.slot_start else None,
            "slot_end": a.slot_end.isoformat() if a.slot_end else None,
            "message": a.message,
            "alert_date": a.alert_date.isoformat(),
            "created_at": a.created_at.isoformat(),
        }
        for a in rows
    ]
    return paginate(out, request, default_page_size=50, max_page_size=200)


@router.get("/admin/live-teaching-status/")
def admin_live_teaching_status(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(require_roles("admin")),
) -> dict:
    return svc.get_live_teaching_status(db)
