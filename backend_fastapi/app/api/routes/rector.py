"""Rektor hisobotlari — alohida kirish, faqat o'qish.

Rektor iMentor foydalanuvchisi emas: u hisob ochmaydi, rol tanlamaydi, fan
o'tmaydi. Unga bitta narsa kerak — institut bo'yicha to'liq manzara. Shu
sababli bu yerda alohida, sodda kirish bor: faqat parol.

Berilgan token DB foydalanuvchisiga bog'lanmagan (`scope` da'vosi bilan) va
SHU marshrutlardan boshqa hech qayerda ishlamaydi — qolgan endpointlar
haqiqiy foydalanuvchi talab qiladi. Admin ham shu sahifani ochib ko'ra oladi.

Hamma javob faqat O'QISH natijasi; bu yerda hech narsa yozilmaydi.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import RECTOR_SCOPE, require_rector, require_rector_wide
from app.services.dean_access import allowed_departments, allowed_groups, authenticate_dean, in_groups
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token
from app.core.throttling import throttle_login
from app.schemas.rector import RectorLoginRequest
from app.services import rector_admin_service as adm
from app.services import rector_coverage_service as cov
from app.services import rector_detail_service as detail
from app.services import control_report_service as control
from app.services import lesson_report_service as lessons
from app.services import monitor_day_service as monitor_day
from app.services import platform_overview as platforms_svc
from app.services import rector_report_service as svc
from app.services import monitor_schedule_service as monitor_svc

router = APIRouter()
settings = get_settings()

# Bir so'rovda qamrab olinadigan eng uzun oraliq. Cheklovsiz "hamma vaqt"
# so'rovi butun arxivni skanerlab, sahifani ham, bazani ham cho'ktirardi.
MAX_RANGE_DAYS = 366

# Xavf hisobotining davr kalitlari — `report_rollup_service.period_bounds` bilan bir xil.
RISK_PERIOD_PATTERN = "^(daily|weekly|monthly|quarterly|yearly)$"


def _today() -> dt.date:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=5))).date()


def _parse_day(raw: str | None, fallback: dt.date) -> dt.date:
    if not raw:
        return fallback
    try:
        return dt.date.fromisoformat(raw.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Sana YYYY-MM-DD shaklida bo'lishi kerak.")


def _range(date_from: str | None, date_to: str | None) -> tuple[dt.date, dt.date]:
    """Sana oralig'i; berilmasa — oxirgi 7 kun."""
    end = _parse_day(date_to, _today())
    start = _parse_day(date_from, end - dt.timedelta(days=6))
    if start > end:
        start, end = end, start
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Oraliq juda uzun. Eng ko'pi {MAX_RANGE_DAYS} kun.",
        )
    return start, end


# ============================ Kirish ============================


@router.post("/rector/login/")
def rector_login(
    payload: RectorLoginRequest,
    _: None = Depends(throttle_login),
) -> dict:
    """Faqat parol. Boshqa hech narsa so'ralmaydi."""
    configured = (settings.rector_report_password or "").strip()
    if not configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Rektor hisoboti uchun parol hali sozlanmagan. Administratorga murojaat qiling.",
        )
    login = (payload.username or "").strip().lower()
    password = (payload.password or "").strip()
    if not login or login in {"rektor", "rector"}:
        if not secrets.compare_digest(password, configured):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Parol noto'g'ri.")
        token = create_access_token(0, {"scope": RECTOR_SCOPE, "role": "rektor", "kind": "rektor", "label": "Rektor"})
        return {"access": token, "expires_minutes": settings.django_jwt_access_minutes, "kind": "rektor", "label": "Rektor"}

    dean = authenticate_dean(login, password)
    if dean is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login yoki parol noto'g'ri.")
    token = create_access_token(0, {
        "scope": RECTOR_SCOPE,
        "role": "dekan",
        "kind": "dekan",
        "login": dean.login,
        "label": dean.label,
        "departments": list(dean.departments),
        "groups": list(dean.groups),
    })
    return {"access": token, "expires_minutes": settings.django_jwt_access_minutes, "kind": "dekan", "label": dean.label, "departments": list(dean.departments)}


# ============================ Hisobotlar ============================


@router.get("/rector/filters/")
def rector_filters(
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Smart filtrlar uchun ro'yxatlar: kafedra, fan, guruh, o'quv yili, baho."""
    data = svc.filter_options(db)
    scope_groups = allowed_groups(ctx)
    if scope_groups:
        data["groups"] = [g for g in data.get("groups", []) if in_groups(g, scope_groups)]
    allowed = set(allowed_departments(ctx, db))
    if allowed:
        data["departments"] = [d for d in data.get("departments", []) if d in allowed]
        data["scope"] = {"kind": ctx.get("kind"), "label": ctx.get("label"), "departments": data["departments"]}
    else:
        data["scope"] = {"kind": ctx.get("kind"), "label": ctx.get("label"), "departments": []}
    return data


@router.get("/rector/monitor-report/")
def rector_monitor_report(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    monitor_id: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    """Monitor/xona bandligi asosidagi yangi rektor hisoboti.

    Bu hisobot umumiy 700+ o'qituvchi ro'yxatini ko'rsatmaydi. Faqat monitor
    inventari va import qilingan haftalik bandlik jadvalidagi o'qituvchilar
    hisobga olinadi.
    """
    return monitor_svc.build_report(
        db,
        date_from=date_from,
        date_to=date_to,
        department=department,
        monitor_id=monitor_id,
        query=q,
        allowed_departments=allowed_departments(ctx, db),
    )


@router.get("/rector/control/")
def rector_control(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Rektor nazorat paneli: monitorli darslarda iMentor ishlatilishi.

    Bitta so'rovda butun sahifa — asosiy ko'rsatkich, e'tibor talab qiladigan
    o'qituvchilar, kunlik kesim, kafedralar va o'qituvchilar ro'yxati.
    """
    start, end = _range(date_from, date_to)
    out = control.overview(db, start, end, department=department, query=q, groups=allowed_groups(ctx))
    allowed = allowed_departments(ctx, db)
    if allowed:
        keys = {monitor_svc._norm(d) for d in allowed}

        def ok(name: str) -> bool:
            value = monitor_svc._norm(name)
            return any(k in value or value in k for k in keys)

        out["departments"] = [r for r in out["departments"] if ok(r["department"])]
        out["teachers"] = [r for r in out["teachers"] if ok(r["department"])]
        out["attention"] = [r for r in out["attention"] if ok(r["department"])]
    return out


@router.get("/rector/platforms/")
def rector_platforms(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    names_only: bool = Query(default=False, alias="names"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Institut tizimlari.

    iMentor raqamlari jonli hisoblanadi, qolganlari soatlik yig'ilgan
    nusxadan o'qiladi — boshqa loyihalarning xizmatlariga tegilmaydi.
    Dekan ham ko'ra oladi: bu raqamlar kafedra kesimida emas, umumiy.
    """
    start, end = _range(date_from, date_to)
    return platforms_svc.overview(db, start, end, names_only=names_only)


@router.get("/rector/monitor-day/")
def rector_monitor_day(
    day: str | None = Query(default=None),
    faculty: str = Query(default=""),
    department: str = Query(default=""),
    monitor_id: str = Query(default="", alias="monitor"),
    teacher: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta kun: monitorli xonalardagi HAR BIR dars bo'yicha alohida javob.

    Umumiy ko'rsatkich emas: har dars qator bo'lib chiqadi — qaysi xona,
    qaysi vaqt, qaysi o'qituvchi, qaysi fan, sillabus bo'yicha qaysi mavzu,
    qancha ishlagan va "nega" degan savolga aniq sabab. Fakultet, kafedra,
    monitor va o'qituvchi bo'yicha filtrlanadi (2026-10-09 talabi).
    """
    try:
        target = dt.date.fromisoformat(day) if day else lessons.current_time().date()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Sana YYYY-MM-DD ko'rinishida bo'lishi kerak.") from exc
    allowed = allowed_departments(ctx, db)
    if allowed and not department:
        # Dekan uchun: kafedra tanlanmagan bo'lsa ham o'z kafedralaridan tashqarisi chiqmasin.
        out = monitor_day.day_report(db, target, faculty=faculty, monitor_id=monitor_id,
                                     teacher=teacher, groups=allowed_groups(ctx))
        keys = {monitor_svc._norm(d) for d in allowed}

        def ok(name: str) -> bool:
            value = monitor_svc._norm(name)
            return any(k in value or value in k for k in keys)

        out["lessons"] = [r for r in out["lessons"] if ok(r["department"])]
        out["teachers"] = [r for r in out["teachers"] if ok(r["department"])]
        out["filters"]["departments"] = [d for d in out["filters"]["departments"] if ok(d)]
        return out
    return monitor_day.day_report(db, target, faculty=faculty, department=department,
                                  monitor_id=monitor_id, teacher=teacher,
                                  groups=allowed_groups(ctx))


@router.get("/rector/control/students/")
def rector_control_students(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Talabalar nazorati: test faolligi va guruhlar qamrovi."""
    start, end = _range(date_from, date_to)
    return control.students(db, start, end, only_groups=allowed_groups(ctx))


@router.get("/rector/control/people/")
def rector_control_people(
    metric: str,
    key: str = Query(default=""),
    department: str = Query(default=""),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Sahifadagi bitta RAQAM ortidagi odamlar — rektor raqamni bosganda ochiladi."""
    start, end = _range(date_from, date_to)
    try:
        return control.people(db, start, end, metric=metric, key=key, department=department,
                              groups=allowed_groups(ctx))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rector/control/teacher/{owner_key}/")
def rector_control_teacher(
    owner_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta o'qituvchining batafsil hisoboti — ro'yxatdagi ismga bosilganda."""
    start, end = _range(date_from, date_to)
    return control.teacher_detail(db, owner_key, start, end, groups=allowed_groups(ctx))


@router.get("/rector/control/student/{student_key}/")
def rector_control_student(
    student_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Bitta talabaning batafsil hisoboti."""
    start, end = _range(date_from, date_to)
    try:
        return control.student_detail(db, student_key, start, end, groups=allowed_groups(ctx))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.get("/rector/lessons/teachers/")
def rector_lesson_teachers(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Dars jadvali bo'yicha nazorat: har bir xodim va uning har bir darsi.

    Monitor hisobotidan farqi — bu yerda HAMMA dars bor, xonasida monitor
    bor-yo'qligidan qat'i nazar, va HEMIS'dagi har bir o'qituvchi ko'rinadi.
    """
    start, end = _range(date_from, date_to)
    allowed = allowed_departments(ctx, db)
    out = lessons.teacher_rows(db, start, end, department=department, query=q, groups=allowed_groups(ctx))
    if allowed:
        keys = {monitor_svc._norm(d) for d in allowed}
        out["results"] = [
            r for r in out["results"]
            if any(k in monitor_svc._norm(r["department"]) or monitor_svc._norm(r["department"]) in k for k in keys)
        ]
    return out


@router.get("/rector/lessons/departments/")
def rector_lesson_departments(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    start, end = _range(date_from, date_to)
    rows = lessons.department_rows(db, start, end, groups=allowed_groups(ctx))
    allowed = allowed_departments(ctx, db)
    if allowed:
        keys = {monitor_svc._norm(d) for d in allowed}
        rows = [r for r in rows
                if any(k in monitor_svc._norm(r["department"]) or monitor_svc._norm(r["department"]) in k for k in keys)]
    return {"from": start.isoformat(), "to": end.isoformat(), "results": rows}


@router.get("/rector/lessons/")
def rector_lessons(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    teacher: str = Query(default="", max_length=128),
    department: str = Query(default=""),
    only_missed: bool = Query(default=False),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector),
) -> dict:
    """Darslar ro'yxati (bitta o'qituvchi yoki kafedra bo'yicha)."""
    start, end = _range(date_from, date_to)
    rows = lessons.lesson_rows(db, start, end, teacher=teacher, department=department,
                               only_missed=only_missed, groups=allowed_groups(ctx))
    allowed = allowed_departments(ctx, db)
    if allowed:
        keys = {monitor_svc._norm(d) for d in allowed}
        rows = [r for r in rows
                if any(k in monitor_svc._norm(r["department"]) or monitor_svc._norm(r["department"]) in k for k in keys)]
    return {"from": start.isoformat(), "to": end.isoformat(), "count": len(rows), "results": rows}


class MonitorScheduleImportRequest(BaseModel):
    file_name: str = Field(default="", max_length=255)
    # Brauzer Excel faylni o'qib qatorlarni yuboradi (serverda openpyxl yo'q).
    rows: list[list[str | int | float | None]] = Field(max_length=monitor_svc.MAX_IMPORT_ROWS)


@router.post("/rector/monitor-schedule/import/")
def rector_monitor_schedule_import(
    payload: MonitorScheduleImportRequest,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    """Kafedra to'ldirgan haftalik monitor bandligi jadvalini yuklash.

    Faylda o'qituvchi yozilgan kafedralarning jadvali almashtiriladi, boshqalarga
    tegilmaydi. Dekan faqat o'z kafedralarini yuklay oladi.
    """
    try:
        return monitor_svc.import_rows(
            db,
            payload.rows,
            source_file=payload.file_name,
            imported_by=str(ctx.get("login") or ctx.get("kind") or ""),
            allowed_departments=allowed_departments(ctx, db),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rector/overview/")
def rector_overview(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    return svc.overview(db, start_day=start, end_day=end, department=department, allowed_departments=allowed_departments(ctx, db))


@router.get("/rector/teachers/")
def rector_teachers(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    only_active: bool = Query(default=False),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    rows = svc.teacher_report(
        db,
        start_day=start,
        end_day=end,
        department=department,
        query=q,
        only_active=only_active,
        allowed_departments=allowed_departments(ctx, db),
    )
    return {"from": start.isoformat(), "to": end.isoformat(), "count": len(rows), "results": rows}


@router.get("/rector/teachers/{owner_key}/")
def rector_teacher_detail(
    owner_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    return svc.teacher_detail(db, owner_key.strip(), start_day=start, end_day=end, allowed_departments=allowed_departments(ctx, db))


@router.get("/rector/students/{student_key}/")
def rector_student_detail(
    student_key: str,
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    return svc.student_detail(db, student_key.strip(), start_day=start, end_day=end, allowed_departments=allowed_departments(ctx, db))


@router.get("/rector/students/")
def rector_students(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    subject_code: str = Query(default=""),
    q: str = Query(default="", max_length=128),
    band: str = Query(default=""),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    rows = svc.student_report(
        db,
        start_day=start,
        end_day=end,
        subject_code=subject_code,
        query=q,
        band=band,
        allowed_departments=allowed_departments(ctx, db),
    )
    return {"from": start.isoformat(), "to": end.isoformat(), "count": len(rows), "results": rows}


@router.get("/rector/lessons/")
def rector_lessons(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    teacher: str = Query(default=""),
    subject_code: str = Query(default=""),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    start, end = _range(date_from, date_to)
    rows = svc.lesson_report(
        db, start_day=start, end_day=end, teacher=teacher, subject_code=subject_code, allowed_departments=allowed_departments(ctx, db)
    )
    return {"from": start.isoformat(), "to": end.isoformat(), "count": len(rows), "results": rows}


@router.get("/rector/departments/")
def rector_departments(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Kafedralar kesimi: nechta sillabus, mavzu, qaysi material bor-yo'q."""
    start, end = _range(date_from, date_to)
    rows = cov.department_report(db, start_day=start, end_day=end)
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "count": len(rows),
        "kinds": [{"key": k, "label": cov.KIND_LABEL[k]} for k in cov.COVERAGE_KINDS],
        "results": rows,
    }


@router.get("/rector/gaps/")
def rector_gaps(
    limit: int = Query(default=50, ge=1, le=300),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Kamchiliklar: sillabusi yo'q kafedra, mavzusi yo'q fan, materialsiz mavzu."""
    return cov.coverage_gaps(db, limit=limit)


@router.get("/rector/trend/")
def rector_trend(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    bucket: str = Query(default="day", pattern="^(day|week|month|quarter)$"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Kunlik / haftalik / oylik / choraklik dinamika."""
    start, end = _range(date_from, date_to)
    return cov.trend_report(db, start_day=start, end_day=end, bucket=bucket)


@router.get("/rector/detail/")
def rector_metric_detail(
    metric: str = Query(min_length=2, max_length=64),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    limit: int = Query(default=detail.MAX_ROWS, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Bitta raqamning ortidagi ro'yxat: bu nima, qanday hisoblangan, kim/nima."""
    start, end = _range(date_from, date_to)
    data = detail.metric_detail(
        db,
        metric=metric.strip(),
        start_day=start,
        end_day=end,
        department=department,
        limit=limit,
    )
    if data is None:
        raise HTTPException(status_code=404, detail="Bunday ko'rsatkich yo'q.")
    return data


@router.get("/rector/metrics/")
def rector_metrics(_: str = Depends(require_rector_wide)) -> dict:
    """Tafsiloti bor ko'rsatkichlar ro'yxati — sahifa qaysi raqam bosiladiganini biladi."""
    return {
        "results": [
            {"metric": key, "title": meta["title"]} for key, meta in detail.METRICS.items()
        ]
    }


# ============================ Admin hisobotlari ============================
#
# Admin endpointlari faqat admin roliga ochiq; rektor tokeni ularga yaramaydi.
# Bu marshrutlar o'sha xizmatlarni `require_rector` ostida chaqiradi — admin
# kodi o'zgarmaydi.


@router.get("/rector/attendance/live/")
def rector_attendance_live(
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Ayni daqiqada jadval bo'yicha darsda bo'lishi kerak bo'lganlar va GPS holati."""
    return adm.attendance_live(db)


@router.get("/rector/attendance/alerts/")
def rector_attendance_alerts(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Davr bo'yicha "belgilangan binoda bo'lmagan" ogohlantirishlari."""
    start, end = _range(date_from, date_to)
    return adm.attendance_alerts(db, start_day=start, end_day=end)


@router.get("/rector/risk/")
def rector_risk(
    period: str = Query(default="weekly", pattern=RISK_PERIOD_PATTERN),
    anchor: str | None = Query(default=None),
    department: str = Query(default=""),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """O'qituvchi xavf darajasi, bayroqlari va GPS muvofiqligi."""
    return adm.risk_report(
        db,
        period=period,
        anchor=_parse_day(anchor, _today()),
        department=department,
    )


@router.get("/rector/subjects/")
def rector_subjects(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Fanlar kesimida test natijasi va o'tish foizi."""
    start, end = _range(date_from, date_to)
    return adm.subjects_report(db, start_day=start, end_day=end)


@router.get("/rector/online-groups/")
def rector_online_groups(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Online va malaka guruhlari: davomat va o'zlashtirish."""
    start, end = _range(date_from, date_to)
    return adm.online_groups(db, start_day=start, end_day=end)


@router.get("/rector/content-bank/")
def rector_content_bank(
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """Butun kontent bazasi hajmi — sana oralig'iga bog'liq emas."""
    return adm.content_bank(db)


@router.get("/rector/ai-usage/")
def rector_ai_usage(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
    _: str = Depends(require_rector_wide),
) -> dict:
    """AI sarfi: funksiya va model bo'yicha token va taxminiy narx."""
    start, end = _range(date_from, date_to)
    return adm.ai_usage(db, start_day=start, end_day=end)


# ============================ Yuklab olish ============================


@router.get("/rector/teachers/export.csv")
def rector_teachers_csv(
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    department: str = Query(default=""),
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> Response:
    """O'qituvchilar jadvalini Excel'da ochish uchun."""
    start, end = _range(date_from, date_to)
    rows = svc.teacher_report(db, start_day=start, end_day=end, department=department, allowed_departments=allowed_departments(ctx, db))

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(
        [
            "F.I.Sh.", "Login", "Kafedra", "Daqiqa", "Faol kun",
            "Vaziyatli masala", "Test", "Tarqatma", "Video", "Taqdimot",
            "Jonli test", "Online dars", "Talaba", "O'rtacha ball (%)", "Hisob holati",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r["display_name"], r["owner_key"] if r.get("schedule_linked") else "", r["department"], r["minutes"], r["active_days"],
                r["cases_created"], r["tests_created"], r["handouts_created"],
                r["videos_created"], r["presentations_created"],
                r["live_sessions"], r["online_lessons"], r["students_taught"],
                "" if r["avg_student_score"] is None else r["avg_student_score"],
                "Biriktirilgan" if r.get("schedule_linked") else "Hisob biriktirilmagan; baholanmaydi",
            ]
        )

    stamp = f"{start.isoformat()}_{end.isoformat()}"
    # BOM — Excel CSV ni UTF-8 deb tanishi uchun (aks holda o'/g' buziladi).
    return Response(
        content="﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="rektor-oqituvchilar-{stamp}.csv"'},
    )


# ============================ Familiya va dalillarga tayangan AI ============================
from app.schemas.rector_intelligence import IntelligenceAnalysisRequest, IntelligenceQuery
from app.services import rector_intelligence as intelligence


@router.get("/rector/intelligence/")
def rector_intelligence_report(
    filters: Annotated[IntelligenceQuery, Query()],
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    return intelligence.build_report(db, filters, allowed_departments=allowed_departments(ctx, db))


@router.post("/rector/intelligence/analyze/")
def rector_intelligence_analysis(
    payload: IntelligenceAnalysisRequest,
    request: Request,
    db: Session = Depends(get_db),
    ctx: dict = Depends(require_rector_wide),
) -> dict:
    from app.core.throttling import client_ip, enforce
    from app.services.openai_client import OpenAiClientError
    enforce(f"throttle:rector_intelligence:{client_ip(request)}", "6/minute")
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI tahlili hozir mavjud emas. Raqamli hisobotdan foydalanishingiz mumkin.")
    report = intelligence.build_report(db, payload, allowed_departments=allowed_departments(ctx, db))
    db.rollback()  # Release the read transaction before waiting for the model.
    try:
        return intelligence.analyze_report(report, payload, api_key, settings.openai_fast_model)
    except OpenAiClientError:
        raise HTTPException(status_code=503, detail="AI tahlilini olib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.")
    except (ValueError, TypeError, KeyError):
        raise HTTPException(status_code=422, detail="Tahlil dalillarga mos kelmadi yoki tanlangan ro‘yxat o‘zgargan. Hisobotni yangilab qayta urinib ko‘ring.")
