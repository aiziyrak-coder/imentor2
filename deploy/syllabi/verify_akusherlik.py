"""Cheklov haqiqatan ishlayotganini haqiqiy marshrutlar orqali tekshiradi.

XAVFSIZLIK: `PUT /course-syllabuses/my/` haqiqiy hamkasb bilan
SINALMAYDI — cheklov ishlamasa, u hamkasbning haqiqiy fanlarini o'chirib,
o'rniga cheklangan fanni yozib qo'yardi. Saqlash bazada YO'Q, vaqtincha
yaratilgan foydalanuvchi obyekti bilan sinaladi; oxirida uning nomiga
biror qator tushib qolgan bo'lsa ham tozalanadi. O'qish so'rovlari (katalog,
kafedra) esa zararsiz — ular haqiqiy hamkasb bilan tekshiriladi.
"""

import sys

from fastapi import HTTPException
from sqlalchemy import delete, select
from starlette.requests import Request

from app.api.deps import AuthContext
from app.api.routes.syllabus_catalog import (
    _catalog_cache,
    department_course_syllabuses,
    set_my_teaching_subjects,
    syllabus_catalog,
)
from app.core.db import SessionLocal
from app.models.content import CourseSyllabus, StaffCourseSelection
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.schemas.content import SetMyTeachingSubjectsRequest

OWNER = "3442112070"
PROBE = "verify_probe_akusherlik"
SID = int(sys.argv[1])


def req() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [],
                    "query_string": b"page_size=1000"})


def ids_of(page: dict) -> set[int]:
    return {int(r["id"]) for r in page.get("results") or []}


def main() -> int:
    db = SessionLocal()
    ok = True
    try:
        madxiya = db.execute(select(User).where(User.username == OWNER)).scalar_one()
        colleague_key = db.execute(
            select(StaffProfile.owner_key).where(
                StaffProfile.department_id == 1, StaffProfile.owner_key != OWNER
            ).limit(1)
        ).scalar_one_or_none()
        colleague = (
            db.execute(select(User).where(User.username == colleague_key)).scalar_one_or_none()
            if colleague_key else None
        )

        def check(label: str, cond: bool) -> None:
            nonlocal ok
            ok = ok and cond
            print(f"  {'OK ' if cond else 'XATO'} {label}")

        _catalog_cache.clear()
        a_m = AuthContext(madxiya, "hodim")
        print("Madxiya (ruxsat bor):")
        check("katalogda ko'rinadi", SID in ids_of(syllabus_catalog(req(), True, db, a_m)))
        check("kafedra ro'yxatida ko'rinadi", SID in ids_of(department_course_syllabuses(req(), db, a_m)))
        cat = syllabus_catalog(req(), True, db, a_m)
        leaked = any("_allowed" in r for r in cat.get("results") or [])
        check("javobda cheklov ro'yxati yo'q (oshkor qilinmaydi)", not leaked)

        if colleague is not None:
            a_c = AuthContext(colleague, "hodim")
            print(f"Hamkasb {colleague.username} (shu kafedra, ruxsat yo'q):")
            check("katalogda ko'rinmaydi", SID not in ids_of(syllabus_catalog(req(), True, db, a_c)))
            dept = department_course_syllabuses(req(), db, a_c)
            check("kafedra ro'yxatida ko'rinmaydi", SID not in ids_of(dept))
            check(f"kafedraning qolgan fanlari ko'rinadi ({len(ids_of(dept))} ta)", len(ids_of(dept)) > 0)

        # Saqlash — bazada YO'Q foydalanuvchi bilan.
        probe = User(username=PROBE)
        a_p = AuthContext(probe, "hodim")
        print("Begona foydalanuvchi qo'lda saqlashga urinsa:")
        try:
            set_my_teaching_subjects(SetMyTeachingSubjectsRequest(syllabus_ids=[SID]), db, a_p)
            check("rad etildi", False)
        except HTTPException as exc:
            check(f"rad etildi ({exc.status_code}: {exc.detail})", exc.status_code == 400)

        print("Admin:")
        admin_like = AuthContext(madxiya, "admin")
        check("katalogda ko'rinadi (cheklovdan tashqarida)",
              SID in ids_of(syllabus_catalog(req(), True, db, admin_like)))

        others = db.execute(
            select(CourseSyllabus.id).where(
                CourseSyllabus.is_active.is_(True),
                CourseSyllabus.allowed_owner_keys != [],
            )
        ).scalars().all()
        print(f"cheklangan fanlar jami: {others}  (faqat shu bitta bo'lishi kerak)")
        ok = ok and others == [SID]
    finally:
        # Tozalash: sinov foydalanuvchisi nomiga hech narsa qolmasin.
        n = db.execute(delete(StaffCourseSelection).where(StaffCourseSelection.owner_key == PROBE)).rowcount
        db.commit()
        db.close()
        print(f"sinov qoldiqlari tozalandi: {n}")
    print("NATIJA:", "HAMMASI TO'G'RI" if ok else "MUAMMO BOR")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
