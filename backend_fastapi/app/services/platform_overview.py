"""Bitta sahifada institutning HAMMA tizimi.

iMentor raqamlari shu yerda, jonli hisoblanadi. Qolgan platformalarning
bazasi alohida konteynerda, shuning uchun ular soatlik skript bilan
`core_platformstat` ga yig'iladi (`deploy/platforms/platform-stats.sh`) va
bu yerda faqat o'qiladi — iMentor boshqa loyihalarga ulanmaydi.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.platform_stat import PlatformStat

#: Sahifadagi tartib va har platformada ko'rsatiladigan ko'rsatkichlar.
#: `(kalit, sarlavha, qo'shimcha)` — qo'shimcha kichik harflarda yoziladi.
CARDS: dict[str, list[tuple[str, str, str]]] = {
    "imentor": [
        ("oqituvchi", "Nazoratdagi o‘qituvchi", "monitorli xonada darsi bor"),
        ("monitor_foiz", "Monitorda ishlatish", "oxirgi 7 kun, %"),
        ("material_hafta", "Yaratilgan material", "oxirgi 7 kun"),
        ("jonli_test", "Jonli test", "oxirgi 7 kun"),
        ("talaba_urinish", "Talaba urinishlari", "oxirgi 7 kun"),
    ],
    "itest": [
        ("imtihon_hafta", "Imtihon", "oxirgi 7 kun"),
        ("topshirgan_hafta", "Topshirgan talaba", "oxirgi 7 kun"),
        ("ortacha_ball", "O‘rtacha ball", "oxirgi 7 kun"),
        ("qoidabuzarlik_hafta", "Qoidabuzarlik", "oxirgi 7 kun"),
        ("imtihonlar", "Jami imtihon", "butun davr"),
    ],
    "icam": [
        ("kamera_ishlayapti", "Ishlayotgan kamera", "jami {kamera} tadan"),
        ("uzilish_ochiq", "Ochiq uzilish", "tuzatilmagan"),
        ("darslar_hafta", "Kuzatilgan dars", "oxirgi 7 kun"),
        ("oz_vaqtida", "O‘z vaqtida boshlangan", "%"),
        ("davomat_hafta", "Davomat yozuvi", "oxirgi 7 kun"),
    ],
    "ishifo": [
        ("konsultatsiya_hafta", "Konsultatsiya", "oxirgi 7 kun"),
        ("bemor", "Bemor", "ro‘yxatda"),
        ("shifokor", "Shifokor", "faol"),
        ("ai_tahlil_hafta", "AI tahlil", "oxirgi 7 kun"),
        ("jarayonda", "Jarayonda", "hozir"),
    ],
}

LABELS = {
    "imentor": "Darsga tayyorgarlik (iMentor)",
    "itest": "Online imtihon (iTest)",
    "icam": "Kamera nazorati (iCam)",
    "ishifo": "Teletibbiyot (iShifo)",
}

LINKS = {
    "imentor": "https://imentor.uz",
    "itest": "https://onlinetest.fermi.uz",
    "icam": "https://cam.fermi.uz",
    "ishifo": "https://ishifo.uz",
}


#: Hali ulanmagan tizimlar — sababi bilan.
MISSING = [
    {"key": "aishifokor", "label": "AI shifokor (aishifokor.uz)",
     "note": "bazaga kirish huquqi kerak"},
    {"key": "fermi", "label": "Institut sayti (fermi.uz)",
     "note": "bazaga kirish huquqi kerak"},
]


def _imentor(db: Session, start: dt.date, end: dt.date) -> dict:
    """iMentor raqamlari — jonli, o'z bazamizdan."""
    from app.services import control_report_service as control

    out = control.overview(db, start, end)
    h = out["headline"]
    created = out.get("created") or {}
    return {
        "oqituvchi": h["watched_teachers"],
        "monitor_foiz": h["monitor_percent"],
        "material_hafta": sum(
            int(created.get(k) or 0)
            for k in ("tests", "cases", "lectures", "presentations", "handouts", "videos")
        ),
        "jonli_test": int(created.get("live_sessions") or 0),
        "talaba_urinish": int(
            db.execute(text(
                "select count(*) from core_studenttestattempt "
                "where submitted_at >= :a"), {"a": start}).scalar() or 0
        ),
    }


def _cards(key: str, payload: dict) -> list[dict]:
    rows = []
    for metric, title, hint in CARDS.get(key, []):
        if metric not in payload:
            continue
        rows.append({
            "metric": metric,
            "title": title,
            "value": payload[metric],
            # "jami {kamera} tadan" kabi qo'shimchalar o'sha platformaning
            # boshqa raqamidan to'ldiriladi.
            "hint": hint.format(**{k: v for k, v in payload.items()}) if "{" in hint else hint,
        })
    return rows


def overview(db: Session, start: dt.date, end: dt.date, *, names_only: bool = False) -> dict:
    """Tizimlar ro'yxati va ko'rsatkichlari.

    `names_only` — bosh sahifa uchun: faqat nomlar kerak, raqamlar emas.
    iMentor raqamlarini hisoblash bir necha soniya oladi va bosh sahifa shu
    sababli ochilmay qolgandi (2026-10-08).
    """
    platforms: list[dict] = []

    if names_only:
        stored_ok = {r.platform: r for r in db.execute(select(PlatformStat)).scalars().all()}
        for key in ("imentor", "itest", "icam", "ishifo"):
            rec = stored_ok.get(key)
            platforms.append({
                "key": key, "label": (rec.label if rec else "") or LABELS[key],
                "link": LINKS.get(key, ""),
                "ok": True if key == "imentor" else bool(rec and rec.ok),
                "note": "" if key == "imentor" else ("" if rec else "hali yig\u2018ilmagan"),
                "collected_at": rec.collected_at.isoformat() if rec and rec.collected_at else None,
                "live": key == "imentor", "cards": [],
            })
        return {"from": start.isoformat(), "to": end.isoformat(),
                "platforms": platforms, "missing": MISSING}

    try:
        payload = _imentor(db, start, end)
        platforms.append({
            "key": "imentor", "label": LABELS["imentor"], "link": LINKS["imentor"],
            "ok": True, "note": "", "collected_at": None, "live": True,
            "cards": _cards("imentor", payload),
        })
    except Exception as exc:  # noqa: BLE001 — bitta platforma butun sahifani yiqitmasin
        # Yiqilgan so'rov tranzaksiyani "buzilgan" holatda qoldiradi va
        # keyingi SELECT ham ishlamaydi — shuning uchun tozalanadi.
        db.rollback()
        platforms.append({
            "key": "imentor", "label": LABELS["imentor"], "link": LINKS["imentor"],
            "ok": False, "note": str(exc)[:120], "collected_at": None, "live": True, "cards": [],
        })

    stored = {r.platform: r for r in db.execute(select(PlatformStat)).scalars().all()}
    for key in ("itest", "icam", "ishifo"):
        rec = stored.get(key)
        if rec is None:
            platforms.append({
                "key": key, "label": LABELS[key], "link": LINKS.get(key, ""),
                "ok": False, "note": "hali yig‘ilmagan", "collected_at": None,
                "live": False, "cards": [],
            })
            continue
        platforms.append({
            "key": key,
            "label": rec.label or LABELS[key],
            "link": LINKS.get(key, ""),
            "ok": bool(rec.ok),
            "note": rec.note or "",
            "collected_at": rec.collected_at.isoformat() if rec.collected_at else None,
            "live": False,
            "cards": _cards(key, rec.payload or {}),
        })

    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "platforms": platforms,
        "missing": MISSING,
    }
