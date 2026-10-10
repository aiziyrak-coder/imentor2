from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class DeanAccess:
    login: str
    label: str
    departments: tuple[str, ...]
    #: Guruh boshlanmalari. Xalqaro fakultetning o'z kafedrasi yo'q: uning
    #: guruhlariga butun institut kafedralari dars beradi. Shu sababli bu
    #: dekan kafedra bilan emas, GURUH bilan cheklanadi (2026-10-09).
    groups: tuple[str, ...] = ()

    @property
    def password(self) -> str:
        """Parol kodda emas — server `.env`da: `DEAN_PASSWORD_<LOGIN>`
        (masalan `DEAN_PASSWORD_DEKAN_TPI`). Bo'sh bo'lsa bu dekan kira olmaydi."""
        return (os.environ.get(f"DEAN_PASSWORD_{self.login.upper()}") or "").strip()


DEANS: dict[str, DeanAccess] = {
    "dekan_davolash": DeanAccess(
        login="dekan_davolash",
        label="Davolash ishi dekani",
        # Fakultet 2026-10-05 da aniqlagan ro'yxat. Yozilishi muhim emas —
        # `match_departments` nomlarni moslashtiradi (pastga qarang).
        departments=(
            "Akusherlik va ginekologiya",
            "Fakultativ va gospital jarrohlik",
            "Gospital terapiya",
            "Ichki kasalliklar propedevtikasi",
            "Normal anatomiya",
            "Terapiya UASH",
            "Travmatologiya",
            "Umumiy xirurgiya",
        ),
    ),
    "dekan_tpi": DeanAccess(
        login="dekan_tpi",
        label="Tibbiy profilaktika ishi dekani",
        departments=(
            "Kommunal va mehnat gigiyenasi",
            "Ovqatlanish, bolalar va o�smirlar gigiyenasi",
            "Ovqatlanish, Bolalar va o 'smirlar gigienasi",
            "Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi",
            "Epidemiologiya va yuqumli kasalliklar hamshiralik ishi",
            "Mikrobiologiya,virusologiya,immunologiya",
            "Preventiv",
        ),
    ),
    "dekan_pediatriya": DeanAccess(
        login="dekan_pediatriya",
        label="Pediatriya dekani",
        departments=(
            "Pediatriya",
            "Pediatriya 1",
            "Pediatriya 2",
            "Fiziologiya",
            "Gistologiya va biologiya",
            "GISTOLOGIYA BIOLOGIYA",
            "Tibbiy va biologik kimyo",
        ),
    ),
    "dekan_stom": DeanAccess(
        login="dekan_stom",
        label="Stomatologiya dekani",
        departments=(
            "Stomatologiya va otorinolaringologiya",
            "Stomatologiya va otorinoloringologiya",
            "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
            "Ijtimoiy fanlar",
            "Lotin tili",
            "Lotin tilli, pedagogika va psixalogiya",
            "O�zbek va xorijiy tillar",
            "O'zbek va xorijiy tillar kafedrasi",
        ),
    ),
}


#: Xalqaro fakultet: guruhlari "MD-" bilan boshlanadi (bazada tekshirilgan,
#: 2026-10-09: 119 guruh, 27 kafedra dars beradi).
DEANS["dekan_xalqaro"] = DeanAccess(
    login="dekan_xalqaro",
    label="Xalqaro fakultet dekani",
    departments=(),
    groups=("MD-",),
)


def authenticate_dean(login: str, password: str) -> DeanAccess | None:
    dean = DEANS.get((login or "").strip().lower())
    if dean is None:
        return None
    expected = dean.password
    # Parol sozlanmagan bo'lsa bo'sh parol bilan kirib bo'lmasin.
    if not expected or not secrets.compare_digest(password or "", expected):
        return None
    return dean


def rector_context(payload: dict) -> dict:
    if payload.get("scope") == "rector-report":
        return {
            "kind": payload.get("kind") or payload.get("role") or "rektor",
            "login": payload.get("login") or "rektor",
            "label": payload.get("label") or "Rektor",
            "departments": [str(x).strip() for x in (payload.get("departments") or []) if str(x).strip()],
            "groups": [str(x).strip() for x in (payload.get("groups") or []) if str(x).strip()],
        }
    return {"kind": "admin", "login": "admin", "label": "Admin", "departments": [], "groups": []}


def allowed_groups(ctx: dict | None) -> tuple[str, ...]:
    """Dekanga ruxsat etilgan guruh boshlanmalari ("MD-"). Bo'sh — cheklov yo'q."""
    return tuple(str(x).strip() for x in ((ctx or {}).get("groups") or []) if str(x).strip())


def in_groups(name: str, prefixes: tuple[str, ...] | list[str] | None) -> bool:
    """Guruh nomi ruxsat etilgan boshlanmalardan biriga mos keladimi."""
    if not prefixes:
        return True
    value = (name or "").strip().casefold()
    return any(value.startswith(p.strip().casefold()) for p in prefixes if p.strip())


#: Bir kafedra uch joyda uch xil yozilgan: institut hujjatida, HEMIS'da va
#: iMentor bazasida. Shuning uchun nomlar AYNAN solishtirilmaydi — avval
#: bir ko'rinishga keltiriladi. Misollar (2026-10-05 da tekshirilgan):
#:   hujjat "Umumiy xirurgiya"   → HEMIS "Umumiy jarrohlik"
#:   hujjat "Terapiya UASH"      → HEMIS "Fakultativ  terapiya (UASH)"
#:   hujjat "Normal anatomiya"   → HEMIS "Yu. Nishonov nomidagi Normal anatomiya"
#:   hujjat "Gospital terapiya"  → HEMIS "Gospital terapiya (laboratoriya)"
#: Bir so'zning turli yozilishi va o'zbekcha/ruscha varianti bitta o'zakka
#: keltiriladi. Qo'shimchasi bilan birga almashtiriladi, aks holda
#: "xirurgiya" -> "jarrohlikya" bo'lib qolardi.
SYNONYMS = (
    (re.compile(r"\b[xh]irurgi\w*"), "jarrohlik"),
    (re.compile(r"\bjarrohl\w*"), "jarrohlik"),
    (re.compile(r"\bfakultativ\w*"), "fakultet"),
    (re.compile(r"\bpsix[ai]atri\w*|\bpsixiatri\w*|\bpsixatri\w*"), "psixiatriya"),
    (re.compile(r"\bort[ao]ped\w*"), "ortopediya"),
    (re.compile(r"\bgigi[ye]*en\w*"), "gigiyena"),
    (re.compile(r"\bkasall\w*"), "kasallik"),
    (re.compile(r"\bge[mo]+atolog\w*|\bgematolog\w*|\bgemotolog\w*"), "gematologiya"),
    (re.compile(r"\botorino\w*|\botolaring\w*|\botoloring\w*"), "otolaringologiya"),
    (re.compile(r"\bepidemi\w*"), "epidemiologiya"),
    (re.compile(r"\bpropedevt\w*"), "propedevtika"),
    (re.compile(r"\bginekolog\w*"), "ginekologiya"),
    (re.compile(r"\bakusher\w*"), "akusherlik"),
    (re.compile(r"\bterapi\w*"), "terapiya"),
    (re.compile(r"\banatomi\w*"), "anatomiya"),
    (re.compile(r"\btravmatolog\w*"), "travmatologiya"),
)

#: Nomga ma'no qo'shmaydigan so'zlar.
_NOISE = re.compile(
    r"\b(kafedrasi|kafedra|nomidagi|yo.nalishidagi|fanlar|laboratoriya)\b", re.I
)


def norm_department(name: str) -> str:
    """Kafedra nomini solishtirishga yaroqli ko'rinishga keltiradi."""
    text = (name or "").lower()
    # � — sozlamadagi buzilgan apostrof ("o�smirlar"); u ham
    # apostrof kabi tashlanadi, aks holda so'z ikkiga bo'linib ketadi.
    for ch in "\u2018\u2019\u02bb\u02bc`'\u2032�":
        text = text.replace(ch, "")
    text = _NOISE.sub(" ", text)
    text = re.sub(r"[^a-z0-9\u0400-\u04ff]+", " ", text)
    for pattern, dst in SYNONYMS:
        text = pattern.sub(dst, text)
    return " ".join(text.split())


def _words(name: str) -> set[str]:
    """Ma'noli so'zlar. Raqam ham ma'noli: "Pediatriya 2" — alohida kafedra."""
    return {w for w in norm_department(name).split() if len(w) > 2 or w.isdigit()}


def match_departments(wanted: list[str] | tuple[str, ...], actual: list[str]) -> list[str]:
    """Dekan ro'yxatidagi nomlarni MA'LUMOTDAGI nomlarga o'giradi.

    Aynan moslik topilmasa, bir nomning so'zlari ikkinchisining ichida
    to'liq bo'lsa ham mos deb hisoblanadi: "Gospital terapiya" HEMIS'dagi
    "Gospital terapiya (laboratoriya)" ni topadi.
    """
    out: list[str] = []
    norm_actual = [(a, norm_department(a), _words(a)) for a in actual]
    for w in wanted:
        key = norm_department(w)
        if not key:
            continue
        ww = _words(w)
        for a, akey, aw in norm_actual:
            if a in out:
                continue
            # Bitta so'zli nom faqat BOSHIDAN mos kelsa qabul qilinadi:
            # "Fiziologiya" "Patologik fiziologiya va patologik anatomiya" ni
            # tortib olmasin. Ikki va undan ortiq so'zli nomda ichma-ichlik
            # yetarli: "Normal anatomiya" → "Yu. Nishonov nomidagi Normal anatomiya".
            # Moslik faqat BIR TOMONLAMA: so'ralgan nom haqiqiy nomning
            # ichida bo'lishi kerak, teskarisi emas. Aks holda "Pediatriya 2"
            # oddiy "Pediatriya"ni ham tortib olardi — ular boshqa kafedra.
            if akey == key:
                out.append(a)
            elif len(ww) >= 2 and ww <= aw:
                out.append(a)
            elif akey.startswith(key + " "):
                out.append(a)
    return out


def known_departments(db) -> list[str]:
    """Ma'lumotda haqiqatan uchraydigan kafedra nomlari.

    Hisobot HEMIS darslaridagi nomni ko'rsatadi, katalog esa kafedra
    jadvalidagini — ikkalasi ham kerak.
    """
    from sqlalchemy import text

    rows = db.execute(text(
        "select name from core_academicdepartment where coalesce(name,'') <> '' "
        "union "
        "select department_name from core_hemislesson where coalesce(department_name,'') <> ''"
    )).all()
    return [r[0] for r in rows]


def allowed_departments(ctx: dict | None, db=None) -> list[str]:
    """Dekanga ruxsat etilgan kafedralar — MA'LUMOTDAGI yozilishida.

    `db` berilsa, sozlamadagi nomlar haqiqiy nomlarga o'giriladi. Busiz
    ro'yxat sozlamadagidek qaytadi (eski chaqiruvlar buzilmasin).
    """
    wanted = [str(x).strip() for x in ((ctx or {}).get("departments") or []) if str(x).strip()]
    if db is None or not wanted:
        return wanted
    return match_departments(wanted, known_departments(db))
