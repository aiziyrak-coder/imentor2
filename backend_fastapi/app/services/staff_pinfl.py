"""JSHSHIR bilan kirish: cam.fermi.uz xodimlari JSHSHIRini iMentor hisoblariga bog'lash.

Bog'lash tartibi (har JSHSHIR uchun):
  1. "admin" bog'lanishi — tegilmaydi;
  2. "face" — shu odamning (cam.fermi.uz `id`) yuzi iMentor hisobiga bog'langan bo'lsa, o'sha hisob;
  3. "name" — ism-familiya bo'yicha, yuzlarni bog'lashdagi bilan bir xil qoida: kamerada shu
     ism-familiyali yagona odam va iMentor'da yagona mos hisob (`face_login.choose_account`).
Bitta hisob faqat bitta JSHSHIRga beriladi: ikki JSHSHIR bir hisobni talab qilsa, "name"
bo'yicha bog'lanish qilinmaydi (admin hal qiladi).
"""

from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.face_template import FaceTemplate
from app.models.staff_pinfl import StaffPinfl
from app.services import face_login as fl

PINFL_RE = re.compile(r"^\d{14}$")

#: Sinxronlash tegmaydigan bog'lanishlar: "admin" — qo'lda; "cam" — xodim JSHSHIR bilan
#: kirganda cam.fermi.uz tasdig'i asosida yaratilgan (`cam_login`). Aks holda soatlik
#: sinxron uni ism bo'yicha topa olmay bo'shatib, xodim keyingi kirishda yana yangi hisob olardi.
KEPT_SOURCES = ("admin", "cam")


def is_pinfl(value: str) -> bool:
    return bool(PINFL_RE.match(value or ""))


def owner_for(db: Session, pinfl: str) -> str | None:
    """JSHSHIRga bog'langan hisob logini (faol yozuvdan) yoki None."""
    if not is_pinfl(pinfl):
        return None
    rec = db.get(StaffPinfl, pinfl)
    if rec is None or not rec.is_active or not rec.owner_key:
        return None
    return rec.owner_key


@dataclass
class PinflSyncResult:
    received: int = 0
    created: int = 0
    deactivated: int = 0
    linked_face: int = 0
    linked_name: int = 0
    unlinked: int = 0
    changed_links: list = field(default_factory=list)


def plan_links(
    rows: list[dict],
    face_owner_by_person: dict[str, str],
    users: list,
    info: dict[str, dict],
    admin_links: dict[str, str],
    kept_sources: dict[str, str] | None = None,
) -> dict[str, tuple[str, str]]:
    """JSHSHIR → (owner_key, link_source). Bog'lab bo'lmaganlari ("", "")."""
    by_pinfl: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_pinfl[r["pinfl"]].append(r)

    users_by_key: dict[tuple[str, str], list] = defaultdict(list)
    for u in users:
        key = fl.name_key(u.last_name, u.first_name)
        users_by_key[key].append(u)
        swapped = fl.name_key(u.first_name, u.last_name)
        if swapped != key:
            users_by_key[swapped].append(u)
    valid_users = {u.username for u in users}

    # Ism-familiya kalitidagi turli odamlar (turli JSHSHIR) — bir nechta bo'lsa, ism bo'yicha bog'lanmaydi.
    pinfls_by_key: dict[tuple[str, str], set[str]] = defaultdict(set)
    for pinfl, rs in by_pinfl.items():
        pinfls_by_key[fl.name_key(*fl.split_full_name(rs[0]["full_name"]))].add(pinfl)

    plan: dict[str, tuple[str, str]] = {}
    taken: dict[str, str] = {}
    for pinfl, owner in admin_links.items():
        if pinfl in by_pinfl and owner:
            plan[pinfl] = (owner, (kept_sources or {}).get(pinfl, "admin"))
            taken[owner] = pinfl

    for pinfl, rs in by_pinfl.items():
        if pinfl in plan:
            continue
        owners = {face_owner_by_person[r["id"]] for r in rs if face_owner_by_person.get(r["id"]) in valid_users}
        if len(owners) == 1:
            owner = owners.pop()
            if owner not in taken:
                plan[pinfl] = (owner, "face")
                taken[owner] = pinfl

    name_claims: dict[str, list[str]] = defaultdict(list)
    for pinfl, rs in by_pinfl.items():
        if pinfl in plan:
            continue
        key = fl.name_key(*fl.split_full_name(rs[0]["full_name"]))
        if not all(key) or len(pinfls_by_key[key]) != 1:
            continue
        chosen = fl.choose_account(users_by_key.get(key, []), rs[0].get("position", ""), info)
        if chosen and chosen not in taken:
            name_claims[chosen].append(pinfl)
    for owner, pinfls in name_claims.items():
        if len(pinfls) == 1:
            plan[pinfls[0]] = (owner, "name")

    for pinfl in by_pinfl:
        plan.setdefault(pinfl, ("", ""))
    return plan


def sync_pinfl(db: Session, rows: list[dict], *, dry_run: bool = False) -> PinflSyncResult:
    """`rows`: cam.fermi.uz xodimlari — {id, full_name, position, pinfl}. Yaroqsiz JSHSHIR tashlab yuboriladi."""
    now = dt.datetime.now(dt.timezone.utc)
    rows = [
        {**r, "pinfl": str(r.get("pinfl") or "").strip(), "full_name": str(r.get("full_name") or "").strip()}
        for r in rows
    ]
    rows = [r for r in rows if is_pinfl(r["pinfl"])]
    result = PinflSyncResult(received=len({r["pinfl"] for r in rows}))

    existing = {p.pinfl: p for p in db.execute(select(StaffPinfl)).scalars().all()}
    face_owner_by_person = {
        t.source_person_id: t.owner_key
        for t in db.execute(select(FaceTemplate)).scalars().all()
        if t.is_active and t.owner_key
    }
    users = fl._face_login_users(db)
    info = fl._account_info(db, [u.username for u in users])
    kept = {p.pinfl: p for p in existing.values() if p.link_source in KEPT_SOURCES and p.owner_key}
    admin_links = {pinfl: p.owner_key for pinfl, p in kept.items()}

    plan = plan_links(rows, face_owner_by_person, users, info, admin_links,
                      {pinfl: p.link_source for pinfl, p in kept.items()})
    names = {r["pinfl"]: r["full_name"][:255] for r in rows}
    for pinfl, (owner, source) in plan.items():
        rec = existing.get(pinfl)
        if rec is None:
            rec = StaffPinfl(pinfl=pinfl, full_name="", owner_key="", link_source="", is_active=True, synced_at=now)
            db.add(rec)
            existing[pinfl] = rec
            result.created += 1
        if rec.owner_key != owner:
            result.changed_links.append((names[pinfl], rec.owner_key, owner))
        rec.full_name, rec.owner_key, rec.link_source, rec.is_active, rec.synced_at = (
            names[pinfl], owner, source, True, now,
        )
        if source == "name":
            result.linked_name += 1
        elif source in ("face", *KEPT_SOURCES):
            result.linked_face += 1
        else:
            result.unlinked += 1

    for pinfl, rec in existing.items():
        if pinfl not in plan and rec.is_active:
            rec.is_active = False
            result.deactivated += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return result
