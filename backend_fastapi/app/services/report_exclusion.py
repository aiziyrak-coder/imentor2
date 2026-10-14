"""Rektor hisobotidan chiqarilgan kafedra va fanlar.

Admin "Kafedralar" bo'limida kafedrani yoki uning ichidagi bitta fanni
hisobotdan chiqara oladi (2026-10-10):

* kafedra chiqarilsa — uning BARCHA o'qituvchilari, darslari va fanlari
  rektor hisobotiga tushmaydi;
* fan chiqarilsa — shu fan bo'yicha darslar va testlar hech bir
  o'qituvchining statistikasiga qo'shilmaydi.

Kafedra nomi HEMIS'da boshqacha yozilgan bo'lishi mumkin, shuning uchun
solishtirish `dean_access.match_departments` orqali (dekan cheklovi bilan
bir xil qoida). Fan nomi esa harf/apostrof farqisiz solishtiriladi.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment, CourseSyllabus

logger = logging.getLogger(__name__)

#: Hisobotdan chiqarilgan XODIMLAR ro'yxati (HEMIS ichki `employee_id`).
#: Ishdan bo'shagan, lekin jadvalda darsi qolgan xodim uchun — unga hisob
#: ochish to'g'ri emas, hisobsiz dars esa "hisobi bog'lanmagan" bo'lib
#: rektorni chalg'itadi (2026-10-13).
STAFF_FILE = Path(__file__).resolve().parent.parent / "data" / "report_excluded_staff.json"


@lru_cache(maxsize=1)
def excluded_staff() -> frozenset[str]:
    """Chiqarilgan xodimlarning `employee_id` lari. Fayl yo'q bo'lsa — bo'sh."""
    try:
        raw = json.loads(STAFF_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return frozenset()
    except (OSError, ValueError):
        # Hisobot buzilgan fayl tufayli ishdan chiqmasligi kerak.
        logger.exception("chiqarilgan xodimlar ro'yxati o'qilmadi: %s", STAFF_FILE)
        return frozenset()
    out = {
        str(row.get("employee_id") or "").strip()
        for row in (raw.get("staff") or [])
        if str(row.get("employee_id") or "").strip()
    }
    return frozenset(out)


#: iMentor orqali dars o'tishi TALAB QILINMAYDIGAN kafedralar (rektor,
#: 2026-10-13): hisobotga umuman kirmaydi — monitor bor-yo'qligidan qat'i
#: nazar, rektorga ham, dekanga ham.
#:
#: Katalog bayrog'i (`report_excluded`) o'zi yetarli emas: HEMIS sinxroni
#: yoki katalog qayta to'ldirilishi kafedraning YANGI yozilishini bayroqsiz
#: qo'shib qo'yishi mumkin va kafedra jimgina hisobotga qaytardi. Shu ro'yxat
#: esa nomning har qanday yozilishini tutadi.
#:
#: Qaytarish kerak bo'lsa: shu ro'yxatdan olib tashlash va katalogdagi
#: bayroqni o'chirish.
ALWAYS_EXCLUDED = (
    "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
    "O‘zbek va xorijiy tillar",
    "Lotin tili, pedagogika va psixologiya",
    "Ijtimoiy fanlar",
    "Xalq tabobati va farmakologiya",
)


def norm_subject(name: str | None) -> str:
    text = (name or "").casefold()
    for ch in "‘’ʻʼ`'′":
        text = text.replace(ch, "")
    return " ".join(re.sub(r"[^\w]+", " ", text).split())


@dataclass
class Exclusions:
    departments: list[str] = field(default_factory=list)
    #: Admin panelida YONIQ turgan yozuvlar. Bitta kafedra katalogda bir
    #: necha yozuv bo'lishi mumkin (turli yozilish); biri yoniq bo'lsa
    #: kafedra hisobotda qoladi — "yoniq turgani qolsin" (2026-10-12).
    included_departments: list[str] = field(default_factory=list)
    subject_names: set[str] = field(default_factory=set)
    subject_codes: set[str] = field(default_factory=set)
    _dept_cache: dict[str, bool] = field(default_factory=dict)
    _official: tuple[set[str], set[str]] | None = field(default=None, repr=False)
    _never: set[str] | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        # Rektor qarori qanday qurilishdan ham kuchli: ro'yxat `load` dan ham,
        # testdan ham, boshqa chaqiruvdan ham bir xil ishlashi kerak.
        self.departments.extend(n for n in ALWAYS_EXCLUDED if n not in self.departments)

    def __bool__(self) -> bool:
        # Xodim ro'yxati ham hisobga olinadi: `_lessons` shu bayroqqa qarab
        # filtrni ishga soladi, aks holda chiqarilgan xodim o'tib ketardi.
        return bool(self.departments or self.subject_names or self.subject_codes
                    or excluded_staff())

    def department_excluded(self, name: str | None) -> bool:
        if not self.departments or not (name or "").strip():
            return False
        hit = self._dept_cache.get(name)
        if hit is None:
            hit = self._decide(name)
            self._dept_cache[name] = hit
        return hit

    def _official_sets(self) -> tuple[set[str], set[str]]:
        """Chiqarilgan va yoniq RASMIY kafedralar — bir marta hisoblanadi.

        Ilgari har bir dars uchun butun ro'yxat qayta moslashtirilardi:
        7 kunlik hisobotda `match_departments` 31 957 marta chaqirilib,
        11 soniya ketardi (2026-10-13).
        """
        if self._official is None:
            from app.services.dean_access import official_of

            self._official = (
                {o for o in (official_of(x) for x in self.departments) if o},
                {o for o in (official_of(x) for x in self.included_departments) if o},
            )
        return self._official

    def _decide(self, name: str) -> bool:
        """RASMIY kafedra faqat O'ZI chiqarilgan bo'lsa chiqadi.

        Katalogda qisqa, yo'nalish nomli yozuvlar bor ("Nevrologiya",
        "Urologiya", "Endokrinologiya", "Normal anatomiya"). Admin ularni
        hisobotdan chiqarsa, o'xshashlik qoidasi chiqarishni HAQIQIY
        kafedraga ham yoyib yuborardi: "Nevrologiya" → "Nevrologiya va
        psixiatriya", "Urologiya" → "Urologiya va onkologiya". Shu sababli
        rektor hisobotidan klinik kafedralarning ko'pi yo'qolib ketgandi
        (2026-10-12: 29 kafedradan 7 tasi qolgan edi).
        """
        from app.services.dean_access import match_departments, official_of

        mine = official_of(name)
        # iMentor talab qilinmaydigan kafedra — yoniq turgan katalog yozuvi ham
        # uni qaytarib olib kelmaydi, shuning uchun tekshiruv eng boshida.
        if self._never is None:
            self._never = {o for o in (official_of(n) for n in ALWAYS_EXCLUDED) if o}
        if mine and mine in self._never:
            return True
        if not mine and match_departments(list(ALWAYS_EXCLUDED), [name]):
            return True
        if mine:
            excluded, included = self._official_sets()
            return mine not in included and mine in excluded
        return bool(match_departments(self.departments, [name]))

    def subject_excluded(self, name: str | None = None, code: str | None = None) -> bool:
        if code and code in self.subject_codes:
            return True
        return bool(name) and norm_subject(name) in self.subject_names

    def staff_excluded(self, employee_id) -> bool:
        """Ishdan bo'shagan, lekin jadvalda darsi qolgan xodimmi."""
        key = str(employee_id or "").strip()
        return bool(key) and key in excluded_staff()

    def lesson_excluded(self, lesson) -> bool:
        return (
            self.staff_excluded(getattr(lesson, "employee_id", ""))
            or self.department_excluded(getattr(lesson, "department_name", ""))
            or self.subject_excluded(getattr(lesson, "subject_name", ""))
        )


def load(db: Session) -> Exclusions:
    """Chiqarilganlar ro'yxati. Chiqarilgan kafedraning fanlari ham shu yerga qo'shiladi."""
    ex = Exclusions()
    dept_rows = db.execute(
        select(AcademicDepartment.id, AcademicDepartment.name, AcademicDepartment.hemis_name)
        .where(AcademicDepartment.report_excluded.is_(True))
    ).all()
    dept_ids: set[int] = set()
    for r in dept_rows:
        dept_ids.add(r.id)
        for name in (r.name, r.hemis_name):
            if (name or "").strip() and name not in ex.departments:
                ex.departments.append(name)
    # Yoniq turgan yozuvlar ham kerak: bitta kafedra katalogda ikki marta
    # bo'lsa va bittasi yoniq bo'lsa, kafedra hisobotda qoladi.
    for r in db.execute(
        select(AcademicDepartment.name, AcademicDepartment.hemis_name)
        .where(AcademicDepartment.report_excluded.is_not(True))
    ).all():
        for name in (r.name, r.hemis_name):
            if (name or "").strip() and name not in ex.included_departments:
                ex.included_departments.append(name)
    # iMentor talab qilinmaydigan kafedralar — katalogda nima yozilganidan
    # qat'i nazar. Yoniq turgan yozuv ularni hisobotda QOLDIRIB yubormasligi
    # kerak, shuning uchun ro'yxatdan ham olib tashlanadi.
    if ALWAYS_EXCLUDED:
        from app.services.dean_access import official_of

        ex.departments.extend(n for n in ALWAYS_EXCLUDED if n not in ex.departments)
        never = {o for o in (official_of(n) for n in ALWAYS_EXCLUDED) if o}
        if never:
            ex.included_departments = [n for n in ex.included_departments
                                       if official_of(n) not in never]
    subj_rows = db.execute(
        select(CourseSyllabus.subject_name, CourseSyllabus.subject_code, CourseSyllabus.department_id)
        .where(
            (CourseSyllabus.report_excluded.is_(True))
            | (CourseSyllabus.department_id.in_(dept_ids or {-1}))
        )
    ).all()
    for r in subj_rows:
        if r.subject_code:
            ex.subject_codes.add(r.subject_code)
        if r.subject_name:
            ex.subject_names.add(norm_subject(r.subject_name))
    return ex
