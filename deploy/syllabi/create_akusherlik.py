"""«Akusherlik va ginekologiyadagi dolzarb muammolari» sillabusini yuklaydi.

Admin panelidagi yo'lning O'ZI chaqiriladi (`admin_create_syllabus`,
`admin_assign_course_selection`) — slug, yo'nalish kodi, tekshiruvlar va
tarjima aynan admin yuklagandagidek ishlaydi. Parol ishlatilmaydi: kod
server ichida, to'g'ridan-to'g'ri bajariladi.

Idempotent: shu kafedrada shu nomli fan bo'lsa, yangisi yaratilmaydi —
mavjudi olinadi. Biriktirish ham takrorlanmaydi.
"""

import json
import sys

from fastapi import BackgroundTasks
from sqlalchemy import select

from app.api.routes.syllabus_catalog import (
    _translate_syllabus_bg,
    admin_assign_course_selection,
    admin_create_syllabus,
)
from app.core.db import SessionLocal
from app.models.content import CourseSyllabus, StaffCourseSelection
from app.schemas.content import AssignCourseSelectionRequest
from app.schemas.course_syllabus import CourseSyllabusUpsertRequest

OWNER = "3442112070"  # Suyarkulova Madxiya Erkinovna


def main() -> int:
    with open("/app/akusherlik_syllabus.json", encoding="utf-8") as f:
        data = json.load(f)

    db = SessionLocal()
    try:
        existing = db.execute(
            select(CourseSyllabus).where(
                CourseSyllabus.subject_name == data["subject_name"],
                CourseSyllabus.department_id == data["department_id"],
            )
        ).scalar_one_or_none()

        if existing is not None:
            syllabus_id = existing.id
            print(f"fan allaqachon bor — yangisi yaratilmadi: id={syllabus_id}")
        else:
            payload = CourseSyllabusUpsertRequest(**data)
            created = admin_create_syllabus(payload, BackgroundTasks(), db, None)
            syllabus_id = created.id
            print(f"fan yaratildi: id={syllabus_id}, code={created.subject_code}")

        # Faqat shu o'qituvchiga.
        obj = db.get(CourseSyllabus, syllabus_id)
        obj.allowed_owner_keys = [OWNER]
        db.add(obj)
        db.commit()
        print(f"cheklov: allowed_owner_keys={obj.allowed_owner_keys}")

        # Biriktirish — mavjud fanlariga QO'SHILADI, almashtirmaydi.
        admin_assign_course_selection(
            AssignCourseSelectionRequest(phone_digits=OWNER, syllabus_id=syllabus_id, variant_labels=[]),
            db,
            None,
        )

        mine = db.execute(
            select(StaffCourseSelection, CourseSyllabus)
            .join(CourseSyllabus, CourseSyllabus.id == StaffCourseSelection.syllabus_id)
            .where(StaffCourseSelection.owner_key == OWNER)
        ).all()
        print(f"Madxiya fanlari ({len(mine)}):")
        for _sel, syl in mine:
            print(f"   id={syl.id} | {syl.subject_name}")

        db.refresh(obj)
        print(
            f"fan: dept={obj.department_id} | yo'nalish={obj.direction_code or '-'} | "
            f"til={obj.instruction_language} | mavzular={len(obj.topics or [])} | "
            f"variant={[(v.get('label'), len(v.get('topics') or [])) for v in (obj.variants or [])]}"
        )
    finally:
        db.close()

    # Nom va mavzularni ru/en ga — admin yuklaganda fonda bajariladigan
    # vazifaning o'zi, bu yerda to'g'ridan-to'g'ri.
    _translate_syllabus_bg(syllabus_id)
    db = SessionLocal()
    try:
        obj = db.get(CourseSyllabus, syllabus_id)
        print("tarjima nomi:", json.dumps(obj.name_i18n or {}, ensure_ascii=False))
        print("mavzu tarjimalari:", {k: len(v or {}) for k, v in (obj.topics_i18n or {}).items()})
    finally:
        db.close()
    print(f"SYLLABUS_ID={syllabus_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
