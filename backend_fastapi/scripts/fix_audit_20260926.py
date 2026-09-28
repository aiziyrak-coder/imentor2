"""2026-09-26 auditida topilgan ma'lumot nuqsonlarini tuzatish.

    python scripts/fix_audit_20260926.py            # faqat ko'rsatadi
    python scripts/fix_audit_20260926.py --apply

Hech narsa O'CHIRILMAYDI. Har qadam alohida hisobot beradi. Qayta ishga
tushirilsa takror o'zgartirmaydi.

1. Takror kafedralar #94, #101 — fansiz va profilsiz, lekin asl kafedra bilan
   bir xil HEMIS kodida: profil sinxroni xodimni bo'sh nusxaga yozib qo'yishi
   mumkin edi. Nofaol qilinadi, HEMIS kodi olinadi.
2. O'qitish tili: mavzular o'zbekcha, fan "ingliz" deb belgilangan — AI o'zbek
   guruhiga inglizcha material yozardi. Faqat qo'lda tekshirilgan ro'yxat va
   faqat server aniqlagichi ham tasdiqlasa. Til fanlari ("O'zbek (rus) tili")
   ro'yxatda YO'Q — ularda aralash til tabiiy.
3. Kafedrasiz o'qituvchi fanlari — egasining profilidagi kafedra.
4. Yo'nalish kodi: bo'sh bo'lsa nomdan; to'liq nom yozilgan bo'lsa kodga.
5. Tayyor materialda `syllabus_id` bo'sh, lekin `topic_norm` fanni aniq
   ko'rsatadi — to'ldiriladi.
6. Profildagi kafedra nomi `department_id` dagi kafedradan farq qiladi — nom
   yozuvnikiga keltiriladi.
"""

from __future__ import annotations

import argparse
import re
import sys

sys.path.insert(0, "/app")

from sqlalchemy import func, select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.models.content import AcademicDepartment, CourseSyllabus  # noqa: E402
from app.models.prepared_content import PreparedContent  # noqa: E402
from app.models.staff_location import StaffProfile  # noqa: E402
from app.services.case_i18n import detect_language  # noqa: E402
from app.services.direction_code import infer_direction_code, normalize_direction_code  # noqa: E402

DUPLICATE_DEPARTMENTS = {94: 18, 101: 28}

# Ikki aniqlagich (frontend va server) bir xil javob bergan fanlar.
LANGUAGE_FIXES = {
    2735: "uz", 2669: "uz", 2667: "uz", 2668: "uz", 2672: "uz", 2694: "uz",
    2762: "uz", 2710: "uz", 2768: "uz", 2711: "uz", 2712: "uz", 2772: "uz",
    2774: "uz", 2782: "uz", 2783: "uz", 2729: "uz", 2781: "uz", 2581: "en",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    apply = args.apply

    with SessionLocal() as db:
        # 1 ---------------------------------------------------------------
        done = []
        for dup, canon in DUPLICATE_DEPARTMENTS.items():
            d = db.get(AcademicDepartment, dup)
            if d is None or not d.is_active:
                continue
            nsyl = db.execute(select(func.count()).select_from(CourseSyllabus).where(CourseSyllabus.department_id == dup)).scalar()
            nprof = db.execute(select(func.count()).select_from(StaffProfile).where(StaffProfile.department_id == dup)).scalar()
            if nsyl or nprof:
                print(f"  #{dup}: fan={nsyl} profil={nprof} — tegilmadi, qo'lda ko'rish kerak")
                continue
            if apply:
                d.is_active = False
                d.hemis_id = ""
                d.hemis_code = ""
            done.append(f"#{dup} (asli #{canon})")
        print("1. takror kafedra nofaol qilindi:", done or "yo'q")

        # 2 ---------------------------------------------------------------
        changed, skipped = [], []
        for sid, lang in LANGUAGE_FIXES.items():
            s = db.get(CourseSyllabus, sid)
            if s is None or s.instruction_language == lang:
                continue
            titles = " ".join(str(t.get("title") or "") for t in (s.topics or [])[:12] if isinstance(t, dict))
            server = detect_language(titles)
            server = "uz" if server == "uz-cyr" else server
            if server != lang:
                skipped.append(f"#{sid} (server={server})")
                continue
            if apply:
                s.instruction_language = lang
            changed.append(f"#{sid}→{lang}")
        print(f"2. o'qitish tili tuzatildi: {len(changed)}", changed, "| tasdiqlanmadi:", skipped)

        # 3 ---------------------------------------------------------------
        profiles = {p.owner_key: p for p in db.execute(select(StaffProfile)).scalars()}
        fixed = []
        for s in db.execute(select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True),
                                                         CourseSyllabus.department_id.is_(None),
                                                         CourseSyllabus.created_by != "")).scalars():
            p = profiles.get(s.created_by)
            if p is not None and p.department_id:
                if apply:
                    s.department_id = p.department_id
                fixed.append(s.id)
        print(f"3. kafedrasiz o'qituvchi fani kafedraga bog'landi: {len(fixed)}", fixed)

        # 4 ---------------------------------------------------------------
        filled = normalised = 0
        for s in db.execute(select(CourseSyllabus).where(CourseSyllabus.is_active.is_(True))).scalars():
            if not s.direction_code:
                code = infer_direction_code(s.subject_name) or infer_direction_code(s.file_name or "")
                if code:
                    filled += 1
                    if apply:
                        s.direction_code = code
            elif " " in s.direction_code:
                code = normalize_direction_code(s.direction_code)
                if code != s.direction_code:
                    normalised += 1
                    if apply:
                        s.direction_code = code
        print(f"4. yo'nalish kodi: bo'sh to'ldirildi {filled}, to'liq nom kodga keltirildi {normalised}")

        # 5 ---------------------------------------------------------------
        existing = {i for (i,) in db.execute(select(CourseSyllabus.id)).all()}
        linked = 0
        for item in db.execute(select(PreparedContent).where(PreparedContent.syllabus_id.is_(None))).scalars():
            m = re.match(r"^(\d+)::", item.topic_norm or "")
            if m and int(m.group(1)) in existing:
                linked += 1
                if apply:
                    item.syllabus_id = int(m.group(1))
        print(f"5. tayyor material fanga bog'landi: {linked}")

        # 6 ---------------------------------------------------------------
        deps = {d.id: d for d in db.execute(select(AcademicDepartment)).scalars()}
        renamed = []
        for p in profiles.values():
            d = deps.get(p.department_id) if p.department_id else None
            if d is not None and (p.department or "").strip() and p.department.strip() != d.name:
                def fold(x):
                    return re.sub(r"[\W_]+", "", x.lower().replace("kafedrasi", ""))
                if fold(p.department) != fold(d.name):
                    renamed.append((p.owner_key, p.department, d.name))
                    if apply:
                        p.department = d.name
        print(f"6. profil kafedra nomi yozuvga keltirildi: {len(renamed)}", renamed[:5])

        if apply:
            db.commit()
            print("SAQLANDI")
        else:
            db.rollback()
            print("DRY-RUN — hech narsa yozilmadi")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
