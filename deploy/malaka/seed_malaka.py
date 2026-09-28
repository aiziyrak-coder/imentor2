"""Malaka oshirish bo'limi uchun boshlang'ich ma'lumot.

Nima yaratadi (bor narsaga tegilmaydi):
  * 2 ta malaka fani — mavzularsiz: mavzularni o'qituvchilar o'zi kiritadi;
  * farmoyishdagi 2 ta guruh, "Maxsus pedagogika" faniga ulangan;
  * 6 ta o'qituvchi (OQITUVCHI1..6), ikkala fanga biriktirilgan;
  * tinglovchilar: login va boshlang'ich parol — pasport seriyasi va raqami.

Hamma yangi hisob birinchi kirishda parolini almashtiradi.

Ishlatish (backend konteynerida):
    MALAKA_TEACHER_PASSWORD=... python seed_malaka.py tinglovchilar.json          # sinov
    MALAKA_TEACHER_PASSWORD=... python seed_malaka.py tinglovchilar.json --apply  # yozadi

Qayta ishga tushirish xavfsiz: MAVJUD foydalanuvchining paroli, ismi va
roli hech qachon o'zgartirilmaydi.

Tinglovchilar fayli repoga KIRITILMAYDI — unda pasport ma'lumotlari bor.
Shakli:
    {"1": [{"n": 1, "fio": "Familiya Ism Otasining ismi", "passport": "AD 1234567"}],
     "2": [...]}
O'qituvchilarning boshlang'ich paroli ham shu sababli muhitdan olinadi.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.environ.get("APP_ROOT", "/app"))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.core.staff_login import normalize_listener_login  # noqa: E402
from app.models.online_edu import (  # noqa: E402
    MalakaListener,
    OnlineGroup,
    OnlineGroupCourse,
    OnlineSyllabus,
    OnlineTeacher,
    OnlineTeacherCourse,
)
from app.services import auth_service  # noqa: E402
from app.services import password_policy_service as pwd_policy  # noqa: E402
from app.services.online_edu_service import unique_subject_code  # noqa: E402

DEPARTMENT = "Malaka oshirish va qayta tayyorlash fakulteti"

# (nomi, kod asosi, tartib)
SUBJECTS = [
    ("Maxsus pedagogika (Tibbiy pedagogika)", "malaka-tibbiy-pedagogika", 1),
    ("Klinik ultratovush diagnostikasi", "malaka-klinik-uzi", 2),
]
# Farmoyish "Tibbiy pedagogika" kursi bo'yicha — tinglovchilar shu fanga ulanadi.
PEDAGOGY = SUBJECTS[0][0]

GROUPS = {"1": "Tibbiy pedagogika — 1-guruh", "2": "Tibbiy pedagogika — 2-guruh"}

# (login, familiya, ism va otasining ismi, portalda ko'rinadigan to'liq nomi)
TEACHERS = [
    ("OQITUVCHI1", "Kadirova", "Munira Rasulovna", "Professor, DSc Kadirova Munira Rasulovna"),
    ("OQITUVCHI2", "Muydinov", "Firuzbek Farxodjonovich", "PhD Muydinov Firuzbek Farxodjonovich"),
    ("OQITUVCHI3", "Mamajonov", "Qosimjon Maripjon o'g'li", "Mamajonov Qosimjon Maripjon o'g'li"),
    ("OQITUVCHI4", "Iminaxunova", "Iroda Xuseynovna", "Professor, DSc Iminaxunova Iroda Xuseynovna"),
    ("OQITUVCHI5", "Qaxorova", "Tursunoy Ulug'bek qizi", "PhD Qaxorova Tursunoy Ulug'bek qizi"),
    ("OQITUVCHI6", "Abdumannonova", "Mohlaroyim Shavkatjon qizi", "Abdumannonova Mohlaroyim Shavkatjon qizi"),
]


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def build(model, **fields):
    """`created_at` ustuni bor jadvallarda uni ham to'ldiradi."""
    if hasattr(model, "created_at") and "created_at" not in fields:
        fields["created_at"] = now()
    return model(**fields)


def split_name(fio: str) -> tuple[str, str]:
    """(ism, familiya). Sarlavhada "Nodirbek Ismoilov" ko'rinadi, to'liq F.I.Sh. alohida saqlanadi."""
    parts = fio.split()
    return (parts[1] if len(parts) > 1 else ""), (parts[0] if parts else "")


def main(path: str, apply: bool) -> None:
    teacher_password = os.environ.get("MALAKA_TEACHER_PASSWORD", "")
    if len(teacher_password) < 6:
        raise SystemExit("MALAKA_TEACHER_PASSWORD berilmagan (kamida 6 belgi).")
    data = json.load(io.open(path, encoding="utf-8"))
    unknown = set(data) - set(GROUPS)
    if unknown:
        raise SystemExit(f"Noma'lum guruh: {sorted(unknown)}")

    stats: Counter = Counter()
    db = SessionLocal()
    try:
        syllabi: dict[str, OnlineSyllabus] = {}
        for name, code, order in SUBJECTS:
            s = db.execute(
                select(OnlineSyllabus).where(
                    OnlineSyllabus.program == "malaka", OnlineSyllabus.subject_name == name
                )
            ).scalar_one_or_none()
            if s is None:
                s = OnlineSyllabus(
                    subject_name=name,
                    subject_code=unique_subject_code(db, code),
                    department_name=DEPARTMENT,
                    department_id=None,
                    description="Malaka oshirish va qayta tayyorlash",
                    instruction_language="uz",
                    file_name="",
                    topics=[],
                    variants=[],
                    name_i18n={},
                    topics_i18n={},
                    program="malaka",
                    sort_order=order,
                    is_active=True,
                    created_at=now(),
                    updated_at=now(),
                )
                db.add(s)
                db.flush()
                stats["fan"] += 1
            syllabi[name] = s

        groups: dict[str, OnlineGroup] = {}
        for key, gname in GROUPS.items():
            g = db.execute(select(OnlineGroup).where(OnlineGroup.name == gname)).scalar_one_or_none()
            if g is None:
                g = OnlineGroup(name=gname, program="malaka", is_active=True, created_at=now())
                db.add(g)
                db.flush()
                stats["guruh"] += 1
            elif (g.program or "online") != "malaka":
                raise SystemExit(f"'{gname}' nomli ONLINE guruh bor — tegmaymiz, nomni o'zgartiring.")
            groups[key] = g
            pedagogy = syllabi[PEDAGOGY]
            linked = db.execute(
                select(OnlineGroupCourse).where(
                    OnlineGroupCourse.group_id == g.id,
                    OnlineGroupCourse.syllabus_id == pedagogy.id,
                    OnlineGroupCourse.variant_label == "",
                )
            ).scalar_one_or_none()
            if linked is None:
                db.add(build(OnlineGroupCourse, group_id=g.id, syllabus_id=pedagogy.id, variant_label=""))
                stats["guruh-fan"] += 1

        for login, last, first, full in TEACHERS:
            user = auth_service.get_user_by_username(db, login)
            if user is None:
                auth_service.create_user(db, login, teacher_password, first, last)
                pwd_policy.require_change(db, login)
                stats["o'qituvchi hisobi"] += 1
            teacher = db.execute(
                select(OnlineTeacher).where(OnlineTeacher.owner_key == login)
            ).scalar_one_or_none()
            if teacher is None:
                teacher = OnlineTeacher(owner_key=login, full_name=full, is_active=True, created_at=now())
                db.add(teacher)
                db.flush()
                stats["online o'qituvchi"] += 1
            for s in syllabi.values():
                linked = db.execute(
                    select(OnlineTeacherCourse).where(
                        OnlineTeacherCourse.teacher_id == teacher.id,
                        OnlineTeacherCourse.syllabus_id == s.id,
                        OnlineTeacherCourse.variant_label == "",
                    )
                ).scalar_one_or_none()
                if linked is None:
                    db.add(build(OnlineTeacherCourse, teacher_id=teacher.id, syllabus_id=s.id, variant_label=""))
                    stats["o'qituvchi-fan"] += 1

        for key, rows in data.items():
            group = groups[key]
            for r in rows:
                login = normalize_listener_login(r["passport"])
                fio = " ".join(str(r["fio"]).split())
                if len(login) < 4 or not fio:
                    raise SystemExit(f"{key}-guruh #{r.get('n')}: pasport yoki F.I.Sh. bo'sh.")
                listener = db.execute(
                    select(MalakaListener).where(MalakaListener.username == login)
                ).scalar_one_or_none()
                user = auth_service.get_user_by_username(db, login)
                if user is None:
                    first, last = split_name(fio)
                    user = auth_service.create_user(db, login, login, first, last)
                    auth_service.set_user_role_group(db, user, "student")
                    pwd_policy.require_change(db, login)
                    stats["tinglovchi hisobi"] += 1
                elif listener is None:
                    # Shu nomli boshqa hisob bor — tegmaymiz, faqat xabar beramiz.
                    print(f"  ! {key}-guruh #{r.get('n')}: '{login}' nomli hisob allaqachon bor — o'tkazib yuborildi")
                    stats["o'tkazib yuborildi"] += 1
                    continue
                if listener is None:
                    db.add(
                        MalakaListener(
                            username=login,
                            full_name=fio[:255],
                            passport=str(r["passport"]).strip()[:32],
                            group_id=group.id,
                            is_active=True,
                            created_at=now(),
                        )
                    )
                    stats["tinglovchi"] += 1

        print(dict(stats) or "yangi narsa yo'q")
        if apply:
            db.commit()
            print("YOZILDI.")
        else:
            db.rollback()
            print("Sinov: hech narsa yozilmadi. Yozish uchun --apply qo'shing.")
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1], "--apply" in sys.argv[2:])
