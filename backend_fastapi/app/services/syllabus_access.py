"""Fanga kirish qoidasi — bitta joyda.

Ikki xil fan bor:
  * umumiy (admin yuklagan) — `allowed_owner_keys` bo'sh, hammaga ochiq;
  * cheklangan — `allowed_owner_keys` to'ldirilgan. O'qituvchi Excel'dan
    o'zi yuklagan fan shunday bo'ladi (`created_by = owner`, ro'yxat
    `[owner]`), admin ham ayrim fanlarni bitta o'qituvchiga cheklaydi.

Materiallar fanga `topic_norm = "{syllabus_id}::{variant}::{kod}"` orqali
bog'lanadi. Shuning uchun tarqatma, taqdimot, video va tayyor kontentning
har bir o'qish/yozish/yuklab olish yo'li `topic_norm` dagi fan id'si bo'yicha
shu qoidadan o'tadi — aks holda begona o'qituvchi id'ni qo'lda yozib, yopiq
fanning fayllarini olardi yoki unga o'zinikini qo'shib qo'yardi.

Rad etilganda javob "topilmadi" (404) — fan borligi oshkor qilinmaydi.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import String, and_, cast, exists, func, or_, select
from sqlalchemy.orm import Session

from app.models.content import CourseSyllabus


def visible_to(allowed: list | None, username: str, role: str) -> bool:
    """Bo'sh ro'yxat — hammaga ochiq. Admin cheklovdan tashqarida."""
    if role == "admin":
        return True
    keys = [str(k).strip() for k in (allowed or []) if str(k).strip()]
    return not keys or username in keys


def syllabus_id_from_norm(topic_norm: str | None) -> int | None:
    """`"2660::9-semestr::a2"` → 2660. Tuzilmasiz (sarlavha) kalit → None."""
    head = (topic_norm or "").split("::", 1)[0].strip()
    if not head.isdigit() or "::" not in (topic_norm or ""):
        return None
    sid = int(head)
    return sid or None


def _access_row(db: Session, sid: int):
    return db.execute(
        select(
            CourseSyllabus.allowed_owner_keys, CourseSyllabus.created_by, CourseSyllabus.is_active
        ).where(CourseSyllabus.id == sid)
    ).first()


def can_access_syllabus(db: Session, sid: int | None, username: str, role: str) -> bool:
    """Id yo'q (sarlavha kalitli eski material) — ochiq. Id bor-u fan bazada yo'q
    (admin o'chirgan) — yopiq: aks holda o'chirilgan shaxsiy fanning fayllari
    id'ni taxmin qilgan har kimga ochilib qolardi."""
    if role == "admin" or not sid:
        return True
    row = _access_row(db, sid)
    if row is None:
        return False
    # O'qituvchi o'chirgan shaxsiy fan yopiq: eski brauzer holatidan unga
    # material yozilib, ko'rinmas joyda to'planib qolmasin.
    if row[1] and not row[2]:
        return False
    return visible_to(row[0], username, role)


def is_subject_owner(db: Session, sid: int | None, username: str) -> bool:
    """O'qituvchi bu fanni o'zi yuklaganmi (o'z fanidagi har materialni boshqaradi)."""
    if not sid or not username:
        return False
    row = _access_row(db, sid)
    return bool(row is not None and row[1] and row[1] == username)


def require_topic_access(db: Session, topic_norms: list[str] | str, username: str, role: str) -> None:
    """Birorta kalit yopiq fanga tegishli bo'lsa — 404."""
    norms = [topic_norms] if isinstance(topic_norms, str) else list(topic_norms or [])
    checked: set[int] = set()
    for norm in norms:
        sid = syllabus_id_from_norm(norm)
        if not sid or sid in checked:
            continue
        checked.add(sid)
        if not can_access_syllabus(db, sid, username, role):
            raise HTTPException(status_code=404, detail="Topilmadi.")


def restricted_syllabus_ids_stmt():
    """Cheklangan (shaxsiy) fanlar id'lari — umumiy katalogdan chiqarish uchun."""
    return select(CourseSyllabus.id).where(func.jsonb_array_length(CourseSyllabus.allowed_owner_keys) > 0)


def public_syllabus_clause():
    """Umumiy (tashqi API, statistika, rektor filtri) ro'yxatlarga tushadigan fan:
    faol va cheklanmagan. O'qituvchining shaxsiy fani va uning `own-<telefon>`
    kodi institutdan tashqariga chiqmaydi."""
    return and_(
        CourseSyllabus.is_active.is_(True),
        func.jsonb_array_length(CourseSyllabus.allowed_owner_keys) == 0,
        CourseSyllabus.created_by == "",
    )


def exclude_restricted_prepared(stmt, prepared_model):
    """Umumiy/ochiq test-keys katalogidan cheklangan fanlarning kontentini olib tashlaydi.

    Ochiq katalog (`/public/content-catalog/`) login so'ramaydi: shaxsiy fan
    kontenti u yerga tushsa, fan kodi (`own-<telefon>-…`) bilan birga
    o'qituvchining telefon raqami ham chiqib qolardi.
    """
    # `syllabus_id` bo'sh qolgan yozuv ham `topic_norm` ("123::…") orqali
    # cheklangan fanga tegishli bo'lishi mumkin — uni ham tekshiramiz.
    restricted_by_norm = exists(
        select(CourseSyllabus.id).where(
            func.jsonb_array_length(CourseSyllabus.allowed_owner_keys) > 0,
            prepared_model.topic_norm.like(func.concat(cast(CourseSyllabus.id, String), "::%")),
        )
    )
    return stmt.where(
        and_(
            or_(
                prepared_model.syllabus_id.is_(None),
                prepared_model.syllabus_id.not_in(restricted_syllabus_ids_stmt()),
            ),
            ~prepared_model.subject_code.like("own-%"),
            ~restricted_by_norm,
        )
    )


def like_prefix(value: str) -> str:
    """LIKE uchun literal prefiks: `_` va `%` belgilari ekranlanadi (escape='\\')."""
    return (value or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
