from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass
from functools import lru_cache


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


#: Fakultet va kafedralar — institutning rasmiy ro'yxati bo'yicha
#: ("Farg'ona jamoat salomatligi tibbiyot institutida faoliyat olib
#: borayotgan fakultetlar va kafedralar nomi", 2026-10-12 da berilgan).
#:
#: Ilgari bu yerda kafedralar aralashib ketgandi: Biotibbiyot va tillar
#: stomatologiya dekanida, Fiziologiya/Gistologiya/Tibbiy kimyo pediatriya
#: dekanida turardi, Xalq tabobati va Urologiya kabi kafedralar esa hech
#: kimda yo'q edi. Endi har bir dekan FAQAT o'z fakultetining kafedralarini
#: ko'radi.
#:
#: Nomlar HEMIS va katalogdagi yozilishiga `match_departments` orqali
#: moslashtiriladi — shuning uchun bu yerda rasmiy ro'yxatdagi yozuv turadi.
#: Fakultet -> kafedralari. Har kafedra: rasmiy nom va (kerak bo'lsa)
#: HEMIS/katalogdagi boshqacha yozilishi.
FACULTIES: tuple[tuple[str, str, tuple[tuple[str, ...], ...]], ...] = (
    ("dekan_tpi", "Tibbiy profilaktika va jamoat salomatligi fakulteti", (
        ("Kommunal va mehnat gigiyenasi",),
        ("Ovqatlanish, bolalar va o‘smirlar gigienasi",),
        ("Preventiv tibbiyot asoslari, jamoat salomatligi, jismoniy tarbiya va sport",),
        ("Epidemiologiya va yuqumli kasalliklar, hamshiralik ishi",),
        ("Mikrobiologiya, virusologiya va immunologiya",),
        ("Xalq tabobati va farmakologiya",),
        # HEMIS'da kafedra ism-sharifsiz yozilgan (1336 dars).
        ("M.Qoraboyev nomidagi Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
         "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari"),
    )),
    ("dekan_davolash", "Davolash fakulteti", (
        ("Ichki kasalliklar propedevtikasi",),
        ("Fakultativ terapiya (UASH)",),
        ("Travmatologiya va ortopediya",),
        # HEMIS'da familiya boshqacha yozilgan: "Nishonov" (1810 dars).
        ("Yu.Nishanov nomidagi Normal anatomiya", "Yu. Nishonov nomidagi Normal anatomiya"),
        ("Gospital terapiya (laboratoriya)",),
        # Katalogda bor, HEMIS jadvalida hozircha darsi yo'q (2026-10-12).
        ("Terapiya yo‘nalishidagi fanlar",),
        ("Umumiy jarrohlik",),
        ("Fakultet va gospital jarrohlik",),
        ("Akusherlik va ginekologiya",),
    )),
    ("dekan_pediatriya", "Pediatriya fakulteti", (
        ("Urologiya va onkologiya",),
        ("Nevrologiya va psixiatriya",),
        ("Pediatriya",),
        # "Pediatriya 2" shu kafedraning qisqa nomi: HEMIS uni
        # "Anesteziologiya va reanimotologiya, Pediatriya-2" deb yozadi,
        # institut hujjatida esa "Pediatriya 2 kafedrasi" deyilgan.
        ("Anesteziologiya va reanimotologiya, Pediatriya 2",
         "Anesteziologiya va reanimotologiya, Pediatriya-2", "Pediatriya 2"),
        ("Stomatologiya va otoloringologiya",),
        ("Dermatovenerologiya va allergologiya",),
        ("Endokrinologiya, gemotologiya",),
    )),
    ("dekan_xalqaro", "Xalqaro fakulteti", (
        ("O‘zbek va xorijiy tillar",),
        ("Lotin tili, pedagogika va psixologiya",),
        ("Tibbiy va biologik kimyo",),
        ("Ijtimoiy fanlar",),
        ("Gistologiya va biologiya",),
        ("Fiziologiya",),
        ("Patologik fiziologiya va patologik anatomiya",),
    )),
)

#: Rasmiy kafedralar — hisobotdagi YAGONA ro'yxat. Filtr, statistika va
#: dekan doirasi shundan quriladi, aks holda ro'yxatga xodim profilidagi
#: erkin matn tushib, "Ta'lim jarayonini tashkil etish bo'limi" kabi
#: kafedra bo'lmagan narsalar chiqib qolardi (2026-10-12).
OFFICIAL_DEPARTMENTS: tuple[dict, ...] = tuple(
    {"name": names[0], "faculty": faculty, "login": login, "spellings": names}
    for login, faculty, chairs in FACULTIES
    for names in chairs
)

DEANS: dict[str, DeanAccess] = {
    login: DeanAccess(
        login=login,
        label=f"{faculty} dekani",
        departments=tuple(n for names in chairs for n in names),
    )
    for login, faculty, chairs in FACULTIES
}


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


def _all_department_spellings(db) -> list[str]:
    from sqlalchemy import text

    rows = db.execute(text(
        "select department from core_staffprofile where coalesce(department,'') <> '' "
        "union "
        "select department from core_monitorschedule where coalesce(department,'') <> ''"
    )).all()
    return [r[0] for r in rows]


class ExclusionScope(list):
    """Dekan cheklovi YO'Q, lekin admin ba'zi kafedralarni hisobotdan chiqargan.

    Ro'yxat "chiqarilmagan hamma kafedra" — hisobot uni oddiy ruxsat ro'yxati
    kabi ishlatadi. Alohida tur kerak, chunki kafedrasi belgilanmagan fanlar
    dekan uchun yashiriladi, rektor uchun esa ko'rinishi kerak.
    """


def allowed_departments(ctx: dict | None, db=None) -> list[str]:
    """Dekanga ruxsat etilgan kafedralar — MA'LUMOTDAGI yozilishida.

    `db` berilsa, sozlamadagi nomlar haqiqiy nomlarga o'giriladi. Busiz
    ro'yxat sozlamadagidek qaytadi (eski chaqiruvlar buzilmasin).

    Admin hisobotdan chiqargan kafedralar (`report_exclusion`) bu ro'yxatga
    hech qachon kirmaydi — rektorga ham, dekanga ham.
    """
    wanted = [str(x).strip() for x in ((ctx or {}).get("departments") or []) if str(x).strip()]
    if db is None:
        return wanted
    from app.services import report_exclusion

    excluded = report_exclusion.load(db)
    if not wanted and not excluded.departments:
        return wanted
    known = known_departments(db)
    if not wanted:
        # Hisobotlar kafedrani turli manbadan oladi va ro'yxatni AYNAN nom bilan
        # solishtiradi — shuning uchun hamma manbadagi yozilishlar kerak.
        names = set(known) | set(_all_department_spellings(db))
        return ExclusionScope(sorted(d for d in names if not excluded.department_excluded(d)))
    return [d for d in match_departments(wanted, known) if not excluded.department_excluded(d)]


#: Eng aniq (ko'p so'zli) yozuvdan boshlab tartiblangan ro'yxat.
_BY_SPECIFICITY = tuple(sorted(
    OFFICIAL_DEPARTMENTS,
    key=lambda d: -max(len(norm_department(x).split()) for x in d["spellings"]),
))


#: Ma'lumotdagi nom -> rasmiy kafedra. Bir marta hisoblanib saqlanadi:
#: har hisobotda 110 nomni qayta moslashtirish qimmat.
_canon_cache: dict[int, dict[str, str]] = {}


def canonical_map(db) -> dict[str, str]:
    """HEMIS/katalogdagi har bir yozilish -> RASMIY kafedra nomi.

    Hisobotda kafedra shu nom bilan ko'rsatiladi, aks holda bitta kafedra
    bir necha qator bo'lib ketardi: "Normal anatomiya" va "Yu. Nishonov
    nomidagi Normal anatomiya", "Umumiy xirurgiya" va "Umumiy jarrohlik"
    alohida chiqardi (2026-10-12).
    """
    known = known_departments(db)
    key = hash(tuple(sorted(set(known))))
    hit = _canon_cache.get(key)
    if hit is not None:
        return hit
    out: dict[str, str] = {}
    for dep in _BY_SPECIFICITY:
        for actual in match_departments(dep["spellings"], known):
            # Aniqrog'i yutadi: "Pediatriya 2" "Pediatriya" ga tushmasin.
            out.setdefault(actual, dep["name"])
    _canon_cache.clear()
    _canon_cache[key] = out
    return out


@lru_cache(maxsize=4096)
def official_of(name: str) -> str:
    """Nom qaysi RASMIY kafedraga tegishli (aniqrog'i ustun).

    "Pediatriya" ham, "Pediatriya 2" ham bor — qisqa nom uzunini tortib
    olmasligi uchun avval eng aniq (uzun) yozuvlardan qidiriladi.

    Natija saqlanadi: bu funksiya har dars uchun chaqirilardi va 7 kunlik
    hisobotning 11 soniyasi shu yerda ketardi (2026-10-13). Nomlar
    ro'yxati o'zgarmaydi, shuning uchun saqlash xavfsiz.
    """
    for dep in _BY_SPECIFICITY:
        if match_departments(dep["spellings"], [name]):
            return dep["name"]
    return ""


def canonical(name: str, mapping: dict[str, str]) -> str:
    """Nomni rasmiy kafedraga keltiradi; ro'yxatda yo'q bo'lsa — bo'sh."""
    return mapping.get((name or "").strip(), "")


def official_names() -> list[str]:
    """Filtr ro'yxati uchun: rasmiy kafedralar, hujjatdagi tartibda."""
    return [d["name"] for d in OFFICIAL_DEPARTMENTS]


def spellings_of(name: str) -> tuple[str, ...]:
    """Rasmiy nomning hamma yozilishi (filtr shular bo'yicha qidiradi)."""
    key = norm_department(name)
    for dep in OFFICIAL_DEPARTMENTS:
        if norm_department(dep["name"]) == key:
            return dep["spellings"]
    return (name,) if name else ()


def department_filter(db, selected: str):
    """Tanlangan kafedra uchun "shu kafedraningmi?" degan tekshiruv.

    Filtr RASMIY nom bilan keladi ("Ovqatlanish, bolalar va o'smirlar
    gigienasi"), HEMIS esa boshqacha yozadi ("Ovqatlanish,  bolalar va
    o'smirlar gigiyenasi" — ikki bo'sh joy va "gigiyena"). Oddiy matn
    solishtiruvi buni topmasdi va sahifa "bu kafedrada dars yo'q" deb
    turardi (2026-10-13).

    Shuning uchun solishtirish RASMIY RO'YXAT orqali: ikkala nom ham
    o'z kafedrasiga keltiriladi va kafedralar tengligi tekshiriladi.
    Ro'yxatdan tashqari nom kelsa (eski havola) — avvalgi o'xshashlik.
    """
    from app.services import monitor_schedule_service as ms

    want = official_of(selected)
    if want:
        canon = canonical_map(db)
        return lambda name: canon.get((name or "").strip(), "") == want
    needle = ms._norm(selected)
    return lambda name: bool(needle) and (
        needle in ms._norm(name) or ms._norm(name) in needle
    )
