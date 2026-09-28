"""Xodim profilini HEMIS'dan to'ldirish (2026-09-26).

Auditda: 781 ta profilda lavozim bo'sh, 139 tasida kafedra bo'sh edi. Bu
rektor hisobotida "profil to'liq emas" va "kafedra —" bo'lib chiqardi, fan
tanlash sahifasi esa kafedra o'rniga butun katalogni ko'rsatardi.

HEMIS'da har xodimning kafedrasi, lavozimi va ish holati bor. Qoidalar:

  * faqat BO'SH maydon to'ldiriladi — o'qituvchi yoki admin yozgani o'zgarmaydi;
  * kafedra faqat iMentor kafedrasiga ishonchli bog'langan HEMIS bo'limidan
    olinadi (`AcademicDepartment.hemis_id`), taxmin qilinmaydi;
  * ish holati (`hemis_status`) har safar yangilanadi: ta'tildagi o'qituvchi
    nazorat hisobotida ayblanmaydi, ishdan ketganning ochiq hisobi ko'rinadi.

HEMIS'ga hech narsa YOZILMAYDI.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment
from app.models.staff_location import StaffProfile
from app.models.user import User

WORKING = "Ishlamoqda"
ON_LEAVE = "Ta’tilda"
LEFT = "Bo‘shagan"

# Bir odamning bir nechta HEMIS yozuvi bo'lsa (o'rindoshlik) — qaysi biri asosiy.
_STATUS_RANK = {WORKING: 0, ON_LEAVE: 1, LEFT: 2}


def _name(value: Any) -> str:
    return str((value or {}).get("name") or "").strip()


def status_of(record: dict) -> str:
    """HEMIS ish holati, apostrof shakli bir xil qilingan."""
    raw = _name(record.get("employeeStatus"))
    folded = raw.replace("'", "’").replace("ʼ", "’")
    if folded.lower().startswith("ta’til"):
        return ON_LEAVE
    if "shagan" in raw.lower():
        return LEFT
    if raw.lower().startswith("ishla"):
        return WORKING
    return raw


def primary_record(records: list[dict]) -> dict:
    """Asosiy yozuv: avval ishlayotgani, keyin asosiy shtat (o'rindosh emas)."""
    def rank(r: dict) -> tuple[int, int]:
        form = _name(r.get("employmentForm")).lower()
        return (_STATUS_RANK.get(status_of(r), 3), 0 if "asosiy" in form else 1)
    return sorted(records, key=rank)[0]


def _departments_by_hemis(db: Session) -> dict[str, AcademicDepartment]:
    """HEMIS kafedra id → iMentor kafedrasi.

    Bitta HEMIS kafedrasiga iMentor'da bir nechta yozuv bog'langan bo'lishi
    mumkin ("Pediatriya" va "Pediatriya 1"). Unda nomi HEMIS nomiga AYNAN mos
    keladigani olinadi; bunday bo'lmasa — hech biri (taxmin qilinmaydi).
    """
    from app.services.hemis_departments import norm

    groups: dict[str, list[AcademicDepartment]] = {}
    for d in db.execute(select(AcademicDepartment)).scalars():
        if d.hemis_id and d.is_active:
            groups.setdefault(d.hemis_id, []).append(d)
    out: dict[str, AcademicDepartment] = {}
    for hemis_id, deps in groups.items():
        if len(deps) == 1:
            out[hemis_id] = deps[0]
            continue
        exact = [d for d in deps if norm(d.name) == norm(d.hemis_name)]
        if len(exact) == 1:
            out[hemis_id] = exact[0]
    return out


def sync(db: Session, people: Iterable[dict], link: dict[Any, str], *, dry_run: bool = False) -> dict:
    """`link` — `hemis_schedule.teacher_map` natijasi (HEMIS id → login)."""
    by_login: dict[str, list[dict]] = {}
    for person in people:
        login = link.get(person.get("id"))
        if login:
            by_login.setdefault(login, []).append(person)

    departments = _departments_by_hemis(db)
    profiles = {
        p.owner_key: p
        for p in db.execute(select(StaffProfile).where(StaffProfile.owner_key.in_(list(by_login)))).scalars()
    }
    now = dt.datetime.now(dt.timezone.utc)
    stats = {"hemisda_boglangan": len(by_login), "kafedra_toldirildi": 0, "lavozim_toldirildi": 0,
             "profil_yaratildi": 0, "holat_ozgardi": 0, "tatilda": 0, "boshagan_faol_hisob": []}

    active = {u for (u,) in db.execute(select(User.username).where(User.is_active.is_(True)))}
    for login, records in by_login.items():
        record = primary_record(records)
        status = status_of(record)
        dep = departments.get(str((record.get("department") or {}).get("id") or ""))
        position = _name(record.get("staffPosition"))[:255]

        profile = profiles.get(login)
        if profile is None:
            profile = StaffProfile(owner_key=login, department=dep.name if dep else "",
                                   department_id=dep.id if dep else None, job_title=position,
                                   hemis_status=status, hemis_synced_at=now, updated_at=now)
            if not dry_run:
                db.add(profile)
            stats["profil_yaratildi"] += 1
        else:
            if dep is not None and not (profile.department or "").strip():
                if not dry_run:
                    profile.department = dep.name
                    profile.department_id = dep.id
                stats["kafedra_toldirildi"] += 1
            if position and not (profile.job_title or "").strip():
                if not dry_run:
                    profile.job_title = position
                stats["lavozim_toldirildi"] += 1
            if (profile.hemis_status or "") != status:
                stats["holat_ozgardi"] += 1
            if not dry_run:
                profile.hemis_status = status
                profile.hemis_synced_at = now

        if status == ON_LEAVE:
            stats["tatilda"] += 1
        if status == LEFT and login in active:
            stats["boshagan_faol_hisob"].append(login)

    if not dry_run:
        db.commit()
    return stats


def on_leave_logins(db: Session) -> set[str]:
    """Hozir HEMIS bo'yicha ta'tildagi xodimlar — hisobotda ayblanmaydi."""
    return {
        owner
        for (owner,) in db.execute(select(StaffProfile.owner_key).where(StaffProfile.hemis_status == ON_LEAVE))
    }
