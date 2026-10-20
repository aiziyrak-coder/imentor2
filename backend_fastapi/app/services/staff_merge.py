"""Bir o'qituvchining takror hisoblarini topish va birlashtirish.

Nega kerak: bitta odam ba'zan ikki hisobga ega bo'ladi — HEMIS/cam.fermi.uz dan ochilgan Xodim ID
hisobi va o'zi telefon raqami bilan ro'yxatdan o'tgan hisob. Fanlar, tayyor kontent, yuz
shabloni va JSHSHIR bog'lanishi turli hisobga tushib, hisobotlarda odam ikkiga bo'linadi.

Nomzod — QUYIDAGI UCHALA shart bajarilgan hisoblar:
  1. ikkalasi ham faol o'qituvchi (`hodim` roli);
  2. ism-familiya kamida 90% o'xshash (Zilolaxon Karimova ~ Zilola Karimova);
  3. kafedra bir xil.
Bundan tashqari, ikkalasiga TURLI JSHSHIR bog'langan bo'lsa — bular turli odam, birlashtirilmaydi.

Birlashtirish faqat admin tasdiqlagandan so'ng bajariladi: barcha ma'lumot asosiy hisobga
ko'chadi, ikkinchi hisob NOFAOL qilinadi (o'chirilmaydi) va tarix `core_staffmergelog` ga yoziladi.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from sqlalchemy import and_, delete, exists, func, select, update
from sqlalchemy.orm import Session, aliased

import app.models  # noqa: F401  — Base.metadata to'liq bo'lsin
from app.core.db import Base
from app.models.staff_location import StaffProfile
from app.models.staff_merge_log import StaffMergeLog
from app.models.staff_pinfl import StaffPinfl
from app.models.user import User
from app.services import auth_service
from app.services import face_login as fl
from app.services import password_policy_service as pwd_policy

#: Ism-familiya o'xshashligi chegarasi (1.0 = aynan bir xil).
NAME_SIMILARITY = 0.90
ROLE = "hodim"

#: `hisob logini` saqlanadigan ODDIY ustunlar. Unikal cheklovi bor jadvallarda takror qatorlar
#: asosiy hisobda allaqachon bo'lgani uchun qo'shilmaydi (`_move_plain`).
PLAIN_COLUMNS: tuple[tuple[str, str], ...] = (
    ("core_useractivityevent", "owner_key"),
    ("core_useractivitysession", "owner_key"),
    ("core_subjectbook", "owner_key"),
    ("core_clinicalgroupmember", "owner_key"),
    ("core_clinicalgrouppayment", "created_by"),
    ("core_coursesyllabus", "created_by"),
    ("core_staffcourseselection", "owner_key"),
    ("core_devicepairingsession", "owner_key"),
    ("core_facetemplate", "owner_key"),
    ("core_hemislesson", "teacher_username"),
    ("core_livetestsession", "owner_key"),
    ("core_monitorschedule", "teacher_username"),
    ("online_material", "owner_key"),
    ("online_lesson", "teacher_owner_key"),
    ("core_preparedcontent", "owner_key"),
    ("core_staffscheduleslot", "owner_key"),
    ("core_stafflocationping", "owner_key"),
    ("core_stafflocationalert", "owner_key"),
    ("core_startupprojectapplication", "owner_key"),
    ("core_syllabusdocument", "owner_key"),
    ("core_topichandout", "owner_key"),
    ("core_topicpresentation", "owner_key"),
    ("core_topicvideo", "owner_key"),
    ("core_clienterrorlog", "username"),
)

#: Maxsus qoidali jadvallar — `_move_special` ichida qayta ishlanadi.
SPECIAL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("core_staffprofile", "owner_key"),
    ("online_teacher", "owner_key"),
    ("core_staffpinfl", "owner_key"),
    ("user_password_policy", "username"),
    ("core_coursesyllabus", "allowed_owner_keys"),
)

#: Hisob loginini saqlamaydigan yoki ataylab tegilmaydigan ustunlar (test shu ro'yxatni tekshiradi:
#: yangi jadvalga `owner_key` qo'shilsa, u yuqoridagi ro'yxatga kiritilishi yoki shu yerga
#: sababi bilan yozilishi kerak — aks holda birlashtirishda ma'lumot yo'qolib qoladi).
IGNORED_COLUMNS: dict[tuple[str, str], str] = {
    ("malaka_listener", "username"): "malaka tinglovchisi — alohida odam turi, xodim hisobi emas",
    ("core_staffmergelog", "primary_key"): "birlashtirish tarixi",
    ("core_staffmergelog", "merged_key"): "birlashtirish tarixi",
}

#: Hisob loginini saqlashi mumkin bo'lgan ustun nomlari — ro'yxatda yo'q yangi ustunni test topadi.
OWNER_COLUMN_NAMES = ("owner_key", "teacher_username", "teacher_owner_key", "created_by", "username")


class MergeError(Exception):
    """Birlashtirib bo'lmaydi (foydalanuvchiga ko'rsatiladigan sabab bilan)."""


# ------------------------------------------------------------------ nomzodlarni topish


def _name_parts(user: User) -> tuple[str, str]:
    return (
        fl._norm_name(user.last_name, strip_suffix=False),
        fl._norm_name(user.first_name, strip_suffix=True),
    )


def name_similarity(a: User, b: User) -> float:
    """Ikki hisob ism-familiyasining o'xshashligi (0..1). Ism va familiya o'rni almashgan
    yozilish ("Karimova Zilola" / "Zilola Karimova") ham hisobga olinadi."""
    al, af = _name_parts(a)
    bl, bf = _name_parts(b)
    if not (al and af and bl and bf):
        return 0.0
    straight = SequenceMatcher(None, al + " " + af, bl + " " + bf).ratio()
    swapped = SequenceMatcher(None, al + " " + af, bf + " " + bl).ratio()
    return max(straight, swapped)


@dataclass
class AccountSummary:
    username: str
    first_name: str
    last_name: str
    department: str
    pinfl: str
    last_login: dt.datetime | None
    date_joined: dt.datetime
    activity: int
    is_phone_login: bool
    password_is_initial: bool


@dataclass
class MergeGroup:
    accounts: list[AccountSummary]
    primary: str
    similarity: float
    blocked: str = ""
    suggest_copy_password: bool = False
    reasons: list[str] = field(default_factory=list)


def _summaries(db: Session, users: list[User]) -> dict[str, AccountSummary]:
    names = [u.username for u in users]
    info = fl._account_info(db, names)
    depts = dict(
        db.execute(
            select(StaffProfile.owner_key, StaffProfile.department).where(StaffProfile.owner_key.in_(names or [""]))
        ).all()
    )
    pinfls = dict(
        db.execute(
            select(StaffPinfl.owner_key, StaffPinfl.pinfl).where(
                StaffPinfl.is_active.is_(True), StaffPinfl.owner_key.in_(names or [""])
            )
        ).all()
    )
    out: dict[str, AccountSummary] = {}
    for u in users:
        out[u.username] = AccountSummary(
            username=u.username,
            first_name=u.first_name or "",
            last_name=u.last_name or "",
            department=depts.get(u.username) or "",
            pinfl=pinfls.get(u.username) or "",
            last_login=u.last_login,
            date_joined=u.date_joined,
            activity=int(info.get(u.username, {}).get("activity", 0)),
            is_phone_login=fl._is_phone_login(u.username),
            password_is_initial=(u.last_login is None and bool(u.password) and not u.password.startswith("!")),
        )
    return out


def _teachers(db: Session) -> list[User]:
    users = db.execute(select(User).where(User.is_active.is_(True), User.is_superuser.is_(False))).scalars().all()
    return [u for u in users if auth_service.resolve_user_role_from_db(db, u) == ROLE]


def pick_primary(accounts: list[AccountSummary]) -> str:
    """Qaysi hisob qoladi: JSHSHIR bog'langani, keyin ko'proq ishi (fan/kontent), keyin oxirgi
    kirgani, keyin telefon hisobi (parolini odam o'zi qo'ygan)."""

    def rank(a: AccountSummary):
        return (
            bool(a.pinfl),
            a.activity,
            a.last_login.timestamp() if a.last_login else 0.0,
            a.is_phone_login,
        )

    return max(accounts, key=rank).username


def find_groups(db: Session, threshold: float = NAME_SIMILARITY) -> list[MergeGroup]:
    users = _teachers(db)
    summaries = _summaries(db, users)

    # Kafedra bo'yicha guruhlab, faqat ichida juft-juft solishtiramiz (n^2 butun ro'yxat emas).
    by_dept: dict[str, list[User]] = {}
    for u in users:
        dept = fl._dept_norm(summaries[u.username].department)
        if dept:
            by_dept.setdefault(dept, []).append(u)

    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    best: dict[frozenset, float] = {}
    for members in by_dept.values():
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                score = name_similarity(a, b)
                if score >= threshold:
                    parent[find(a.username)] = find(b.username)
                    best[frozenset((a.username, b.username))] = score

    clusters: dict[str, list[str]] = {}
    for key in list(parent):
        clusters.setdefault(find(key), []).append(key)

    groups: list[MergeGroup] = []
    for members in clusters.values():
        if len(members) < 2:
            continue
        accounts = sorted((summaries[m] for m in members), key=lambda a: (a.last_name, a.first_name, a.username))
        primary = pick_primary(accounts)
        pairs = [s for k, s in best.items() if k <= set(members)]
        group = MergeGroup(accounts=accounts, primary=primary, similarity=round(min(pairs), 3))
        distinct = {a.pinfl for a in accounts if a.pinfl}
        if len(distinct) > 1:
            group.blocked = "Hisoblarga turli JSHSHIR bog'langan — bu turli odamlar, birlashtirib bo'lmaydi."
        prim = next(a for a in accounts if a.username == primary)
        others = [a for a in accounts if a.username != primary]
        # Asosiy hisob hali hech kirilmagan (boshlang'ich parol), ikkinchisini odam o'zi
        # ishlatgan — asosiy hisobga o'sha paroli ko'chirilmasa, odam kira olmay qoladi.
        group.suggest_copy_password = prim.password_is_initial and any(
            a.last_login is not None and not a.password_is_initial for a in others
        )
        groups.append(group)
    groups.sort(key=lambda g: (bool(g.blocked), -g.similarity, g.accounts[0].last_name))
    return groups


# ------------------------------------------------------------------ ko'chirish


def _unique_column_sets(table, column: str) -> list[list[str]]:
    """`column` kirgan ko'p ustunli unikal cheklov va indekslarning QOLGAN ustunlari."""
    sets: list[list[str]] = []
    for constraint in table.constraints:
        cols = [c.name for c in getattr(constraint, "columns", [])]
        if constraint.__class__.__name__ == "UniqueConstraint" and column in cols and len(cols) > 1:
            sets.append([c for c in cols if c != column])
    for index in table.indexes:
        cols = [c.name for c in index.columns]
        if index.unique and column in cols and len(cols) > 1:
            sets.append([c for c in cols if c != column])
    return sets


def _move_plain(db: Session, table_name: str, column: str, src: str, dst: str) -> tuple[int, int]:
    """`src` qatorlarini `dst` ga ko'chirish. Unikal cheklovga to'qnashadigan (asosiy hisobda
    aynan shunday qator bor) qatorlar ko'chirilmaydi va o'chiriladi. -> (ko'chdi, takror)."""
    table = Base.metadata.tables[table_name]
    col = table.c[column]
    if col.unique:
        raise MergeError(f"{table_name}.{column} unikal ustun — maxsus qoida kerak")
    stmt = update(table).where(col == src).values({column: dst})
    for others in _unique_column_sets(table, column):
        twin = aliased(table)
        stmt = stmt.where(
            ~exists().where(and_(twin.c[column] == dst, *[twin.c[o] == table.c[o] for o in others]))
        )
    moved = db.execute(stmt).rowcount or 0
    left = db.execute(select(func.count()).select_from(table).where(col == src)).scalar_one()
    if left:
        db.execute(delete(table).where(col == src))
    return moved, int(left)


def _fill_empty(target, source, fields: tuple[str, ...]) -> list[str]:
    changed = []
    for f in fields:
        if not getattr(target, f) and getattr(source, f):
            setattr(target, f, getattr(source, f))
            changed.append(f)
    return changed


def _move_special(db: Session, src: str, dst: str, moved: dict[str, int]) -> int:
    skipped = 0

    # --- profil: bo'sh maydonlar ikkinchisidan to'ldiriladi
    sp = db.execute(select(StaffProfile).where(StaffProfile.owner_key == src)).scalar_one_or_none()
    dp = db.execute(select(StaffProfile).where(StaffProfile.owner_key == dst)).scalar_one_or_none()
    if sp is not None:
        if dp is None:
            sp.owner_key = dst
            moved["core_staffprofile.owner_key"] = 1
        else:
            fields = (
                "photo", "faculty", "department", "department_id", "direction",
                "participant_kind", "study_group", "job_title", "hemis_status",
            )
            filled = _fill_empty(dp, sp, fields)
            dp.updated_at = dt.datetime.now(dt.timezone.utc)
            db.delete(sp)
            db.flush()
            moved["core_staffprofile.owner_key"] = len(filled)

    # --- online o'qituvchi: yozuv bittadan oshmasin, fanlari birlashadi
    from app.models.online_edu import OnlineTeacher, OnlineTeacherCourse

    st = db.execute(select(OnlineTeacher).where(OnlineTeacher.owner_key == src)).scalar_one_or_none()
    dt_ = db.execute(select(OnlineTeacher).where(OnlineTeacher.owner_key == dst)).scalar_one_or_none()
    if st is not None:
        if dt_ is None:
            st.owner_key = dst
            moved["online_teacher.owner_key"] = 1
        else:
            have = {
                (c.syllabus_id, c.variant_label)
                for c in db.execute(
                    select(OnlineTeacherCourse).where(OnlineTeacherCourse.teacher_id == dt_.id)
                ).scalars()
            }
            n = 0
            for c in db.execute(select(OnlineTeacherCourse).where(OnlineTeacherCourse.teacher_id == st.id)).scalars():
                if (c.syllabus_id, c.variant_label) in have:
                    skipped += 1
                    db.delete(c)
                else:
                    c.teacher_id = dt_.id
                    n += 1
            dt_.is_active = dt_.is_active or st.is_active
            db.flush()
            db.delete(st)
            moved["online_teacher_course.teacher_id"] = n

    # --- JSHSHIR bog'lanishi
    n = db.execute(
        update(StaffPinfl).where(StaffPinfl.owner_key == src).values(owner_key=dst, link_source="admin")
    ).rowcount or 0
    if n:
        moved["core_staffpinfl.owner_key"] = n

    # --- parol siyosati: ikkinchi hisob nofaol, uning belgisi keraksiz
    db.execute(delete(Base.metadata.tables["user_password_policy"]).where(
        Base.metadata.tables["user_password_policy"].c.username == src
    ))

    # --- fanga ruxsat berilgan hodimlar ro'yxati (JSONB massiv)
    syllabus = Base.metadata.tables["core_coursesyllabus"]
    n = 0
    rows = db.execute(
        select(syllabus.c.id, syllabus.c.allowed_owner_keys).where(syllabus.c.allowed_owner_keys.contains([src]))
    ).all()
    for sid, keys in rows:
        new = []
        for k in keys or []:
            k = dst if k == src else k
            if k not in new:
                new.append(k)
        db.execute(update(syllabus).where(syllabus.c.id == sid).values(allowed_owner_keys=new))
        n += 1
    if n:
        moved["core_coursesyllabus.allowed_owner_keys"] = n
    return skipped


def validate(db: Session, primary: str, secondaries: list[str]) -> tuple[User, list[User]]:
    if not secondaries:
        raise MergeError("Birlashtiriladigan ikkinchi hisob ko'rsatilmagan.")
    if primary in secondaries:
        raise MergeError("Asosiy hisob o'zi bilan birlashtirilmaydi.")
    if len(set(secondaries)) != len(secondaries):
        raise MergeError("Hisoblar takrorlangan.")
    prim = auth_service.get_user_by_username(db, primary)
    secs = [auth_service.get_user_by_username(db, s) for s in secondaries]
    if prim is None or any(s is None for s in secs):
        raise MergeError("Hisob topilmadi.")
    for u in [prim, *secs]:
        if u.is_superuser:
            raise MergeError(f"{u.username}: administrator hisobini birlashtirib bo'lmaydi.")
        if not u.is_active:
            raise MergeError(f"{u.username}: hisob allaqachon nofaol.")
        if auth_service.resolve_user_role_from_db(db, u) != ROLE:
            raise MergeError(f"{u.username}: faqat o'qituvchi hisoblari birlashtiriladi.")
    owners = [u.username for u in [prim, *secs]]
    linked = {
        owner: pinfl
        for owner, pinfl in db.execute(
            select(StaffPinfl.owner_key, StaffPinfl.pinfl).where(
                StaffPinfl.is_active.is_(True), StaffPinfl.owner_key.in_(owners)
            )
        ).all()
    }
    if len(set(linked.values())) > 1:
        raise MergeError("Hisoblarga turli JSHSHIR bog'langan — bu turli odamlar, birlashtirib bo'lmaydi.")
    return prim, secs  # type: ignore[return-value]


def merge(
    db: Session,
    primary: str,
    secondaries: list[str],
    *,
    actor: str,
    copy_password: bool = False,
    note: str = "",
) -> list[dict]:
    """Ikkinchi hisoblarni asosiyga birlashtirish. Hammasi bitta tranzaksiyada: xato bo'lsa
    hech narsa o'zgarmaydi. Chaqiruvchi `db.commit()` qiladi."""
    prim, secs = validate(db, primary, secondaries)
    results = []
    for sec in secs:
        src, dst = sec.username, prim.username
        # Odamning JSHSHIRi: qaysi hisobga bog'langan bo'lsa (validate ikkalasida turlisi yo'qligini
        # kafolatlaydi) — tarixga shu yoziladi.
        linked = (
            db.execute(
                select(StaffPinfl.pinfl).where(
                    StaffPinfl.owner_key.in_([src, dst]), StaffPinfl.is_active.is_(True)
                )
            ).scalars().first()
        )
        moved: dict[str, int] = {}
        duplicates = 0
        for table, column in PLAIN_COLUMNS:
            n, dup = _move_plain(db, table, column, src, dst)
            if n:
                moved[f"{table}.{column}"] = n
            duplicates += dup
        duplicates += _move_special(db, src, dst, moved)

        if copy_password and sec.password and not sec.password.startswith("!"):
            prim.password = sec.password
            pwd_policy.clear(db, prim.username)
            moved["parol"] = 1
        # Ikkinchi hisob: nofaol. Parolga tegilmaydi — kirmoqchi bo'lsa, "eski hisob, X bilan kiring"
        # xabari chiqadi (`auth._disabled_account_message`).
        sec.is_active = False
        db.add(
            StaffMergeLog(
                primary_key=dst,
                merged_key=src,
                pinfl=linked or "",
                merged_name=f"{sec.last_name} {sec.first_name}".strip(),
                moved=moved,
                skipped_duplicates=duplicates,
                actor=actor,
                note=note,
            )
        )
        results.append({"merged": src, "into": dst, "moved": moved, "skipped_duplicates": duplicates})
    db.flush()
    fl.invalidate_cache()
    return results


def merged_usernames(db: Session) -> set[str]:
    """Birlashtirilib nofaol qilingan hisoblar — admin ro'yxatida ko'rsatilmaydi."""
    return set(db.execute(select(StaffMergeLog.merged_key)).scalars().all())
