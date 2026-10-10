"""JSHSHIR va pasport bo'yicha shaxsni topish + cam.fermi.uz dan sinxronlash.

Kirishda parol so'ralmaydi: raqamning o'zi kalit. Shuning uchun qidiruv
ANIQ bo'lishi kerak — bitta qiymat bitta odamni topsin, ikkita topilsa
kirish rad etiladi.

Manbadagi pasport yozuvi tartibsiz: `AD1234567`, `AD 1234567`, kirillcha
`АD`, seriyaga yopishgan raqam (`AD06`) ham uchraydi. Shuning uchun seriya
va raqam saqlashdan oldin BIR KO'RINISHGA keltiriladi, keltirib bo'lmagan
yozuv esa saqlanmaydi (kirishda yanglish odamni topmasin).
"""

from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.person_identity import STAFF, STUDENT, PersonIdentity

PINFL_RE = re.compile(r"^\d{14}$")

#: Pasportda kirill harflari lotincha ko'rinishga o'xshaydi va manbada
#: aralash yozilgan. Ularsiz "АD" (kirill А) hech qachon topilmaydi.
CYRILLIC_LOOKALIKE = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "К": "K", "М": "M",
    "Н": "H", "О": "O", "Р": "P", "Т": "T", "Х": "X", "У": "Y",
})

#: Seriya 1-3 harf, raqam 5-9 raqam. Qolgani tanilmagan yozuv.
PASSPORT_RE = re.compile(r"^([A-Z]{1,3})(\d{5,9})$")

#: O'zbekiston fuqarosining pasport seriyalari — tanlash ro'yxati uchun.
SERIES_CHOICES = tuple(f"A{c}" for c in "ABCDEFGHIJKLMNOPQRSTUVXYZ") + ("ID",)


def is_pinfl(value: str) -> bool:
    return bool(PINFL_RE.match((value or "").strip()))


def fold(value: str) -> str:
    """Katta harf, kirill o'xshashlari lotinga, ortiqcha belgilar olib tashlanadi."""
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper().translate(CYRILLIC_LOOKALIKE))


def parse_passport(series: str, number: str) -> tuple[str, str] | None:
    """(seriya, raqam) yoki tanib bo'lmasa None.

    Seriya va raqam birlashtirib tekshiriladi: manbada ular chalkash
    bo'lingan (`AD06` + `12345`), foydalanuvchi esa ro'yxatdan seriyani
    tanlab, qolganini o'zi yozadi.
    """
    joined = fold(series) + fold(number)
    m = PASSPORT_RE.match(joined)
    if m is None:
        return None
    return m.group(1), m.group(2)


# ---------------------------------------------------------------- qidiruv

def by_pinfl(db: Session, value: str) -> PersonIdentity | None:
    key = (value or "").strip()
    if not is_pinfl(key):
        return None
    rows = db.execute(
        select(PersonIdentity).where(
            PersonIdentity.pinfl == key, PersonIdentity.is_active.is_(True)
        )
    ).scalars().all()
    # Ikkita odam bitta JSHSHIRda bo'lsa — ma'lumotda xato; kirish berilmaydi.
    return rows[0] if len(rows) == 1 else None


def by_passport(db: Session, series: str, number: str) -> PersonIdentity | None:
    parsed = parse_passport(series, number)
    if parsed is None:
        return None
    s, n = parsed
    rows = db.execute(
        select(PersonIdentity).where(
            PersonIdentity.passport_series == s,
            PersonIdentity.passport_number == n,
            PersonIdentity.is_active.is_(True),
        )
    ).scalars().all()
    return rows[0] if len(rows) == 1 else None


def find(db: Session, *, pinfl: str = "", series: str = "", number: str = "") -> PersonIdentity | None:
    if (pinfl or "").strip():
        return by_pinfl(db, pinfl)
    return by_passport(db, series, number)


# ---------------------------------------------------------------- sinxron

def sync(db: Session, rows: list[dict], *, dry_run: bool = False) -> dict:
    """cam.fermi.uz qatorlari: {id, kind, full_name, pinfl, passport, hemis_id}.

    Ro'yxatdan tushib qolgan odam O'CHIRILMAYDI, nofaol qilinadi — shaxsiy
    ma'lumot tarixini yo'qotmaslik uchun va kirish darhol yopilsin deb.
    """
    now = dt.datetime.now(dt.timezone.utc)
    existing = {p.source_id: p for p in db.execute(select(PersonIdentity)).scalars().all()}
    seen: set[str] = set()
    out = {"received": len(rows), "created": 0, "updated": 0, "deactivated": 0,
           "no_pinfl": 0, "bad_passport": 0, "skipped": 0}

    for raw in rows:
        source_id = str(raw.get("id") or "").strip()
        kind = STAFF if str(raw.get("kind") or "").strip() == STAFF else STUDENT
        if not source_id:
            out["skipped"] += 1
            continue
        pinfl = str(raw.get("pinfl") or "").strip()
        if not is_pinfl(pinfl):
            pinfl = ""
            out["no_pinfl"] += 1
        parsed = parse_passport(str(raw.get("passport_series") or ""),
                               str(raw.get("passport_number") or ""))
        if parsed is None and (raw.get("passport_series") or raw.get("passport_number")):
            out["bad_passport"] += 1
        series, number = parsed or ("", "")
        if not pinfl and not number:
            # Tanish uchun hech narsa yo'q — saqlashdan foyda yo'q.
            out["skipped"] += 1
            continue

        seen.add(source_id)
        rec = existing.get(source_id)
        if rec is None:
            rec = PersonIdentity(source_id=source_id)
            db.add(rec)
            existing[source_id] = rec
            out["created"] += 1
        else:
            out["updated"] += 1
        rec.kind = kind
        rec.pinfl = pinfl
        rec.passport_series = series
        rec.passport_number = number
        rec.full_name = str(raw.get("full_name") or "").strip()[:255]
        rec.hemis_id = str(raw.get("hemis_id") or "").strip()[:64]
        rec.is_active = True
        rec.synced_at = now

    for source_id, rec in existing.items():
        if source_id not in seen and rec.is_active:
            rec.is_active = False
            out["deactivated"] += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return out


def coverage(db: Session) -> dict:
    """Kimda tanish uchun ma'lumot bor — kadrlar bo'limiga hisobot uchun."""
    rows = db.execute(
        select(
            PersonIdentity.kind,
            func.count().label("jami"),
            func.count().filter(PersonIdentity.pinfl != "").label("pinfl"),
            func.count().filter(PersonIdentity.passport_number != "").label("passport"),
        )
        .where(PersonIdentity.is_active.is_(True))
        .group_by(PersonIdentity.kind)
    ).all()
    return {r.kind: {"jami": r.jami, "pinfl": r.pinfl, "passport": r.passport} for r in rows}
