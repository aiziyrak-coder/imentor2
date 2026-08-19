"""O'qituvchini kafedraga bog'lash — fan tanlash staff self-select orqali."""

from __future__ import annotations

import re
import unicodedata

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.content import AcademicDepartment, StaffCourseSelection
from app.models.staff_location import StaffProfile

_APOSTROPHES = "'ʼʻ`´‘’‛′‵ʻʼʹʺˈˊˋ′″‴‵‶"
_PUNCT_RE = re.compile(r"[^a-z0-9а-яё\s]+")
_SPACE_RE = re.compile(r"\s+")
_SUFFIX_RE = re.compile(r"\b(kafedrasi|kafedra|sillabus|syllabus)\b")
_STOPWORDS = frozenset({"va", "bilan", "hamda", "yonalishidagi", "fanlar"})

# Excel / kadrlar yozuvi ↔ bazadagi imlo farqlari (normalize qilingan holda).
_SYNONYMS = (
    ("otoloringologiya", "otorinolaringologiya"),
    ("gematologiya", "gemotologiya"),
    ("epidemiyologiya", "epidemiologiya"),
    ("gigienasi", "gigiyenasi"),
    ("gigiena", "gigiyena"),
    ("gigiyenasi", "gigiyena"),
    ("jarroxlik", "xirurgiya"),
    ("jarrohlik", "xirurgiya"),
    ("psixiatriya", "psixatriya"),
    ("gistalogiya", "gistologiya"),
    ("kasallilar", "kasalliklar"),
    ("uralogiya", "urologiya"),
    ("psixalogiya", "psixologiya"),
    ("ortapediya", "ortopediya"),
    ("otorinoloringologiya", "otorinolaringologiya"),
    ("tilli", "tili"),
    ("ftizatriya", "ftiziatriya"),
    ("virusalogiya", "virusologiya"),
    ("fakultet va", "fakultativ va"),
)


def normalize_department_name(name: str) -> str:
    """Kafedra nomini taqqoslash uchun: unicode, apostrof, imlo, 'kafedrasi' qo'shimchasi."""
    s = unicodedata.normalize("NFKC", name or "").casefold()
    for ch in _APOSTROPHES:
        s = s.replace(ch, "")
    s = _SUFFIX_RE.sub(" ", s)
    s = _PUNCT_RE.sub(" ", s)
    s = _SPACE_RE.sub(" ", s).strip()
    for src, dst in _SYNONYMS:
        s = s.replace(src, dst)
    return s


def _tokens(norm: str) -> tuple[str, ...]:
    seen: list[str] = []
    for t in norm.split():
        if t and t not in _STOPWORDS and (len(t) >= 3 or t.isdigit()) and t not in seen:
            seen.append(t)
    return tuple(seen)


def _is_token_prefix(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    """Qisqa ketma-ketlik uzunining boshiga to'g'ri keladimi (tartib saqlanadi)."""
    if not a or not b:
        return False
    if len(a) <= len(b):
        return b[: len(a)] == a
    return a[: len(b)] == b


def pick_department_name(query: str, candidates: list[str]) -> str | None:
    """Excel/kadrlar nomidan bazadagi kanonik kafedra nomini tanlaydi."""
    raw = (query or "").strip()
    if not raw or not candidates:
        return None

    exact = [c for c in candidates if c == raw]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return max(exact, key=len)

    folded = raw.casefold()
    case_exact = [c for c in candidates if c.strip().casefold() == folded]
    if len(case_exact) == 1:
        return case_exact[0]
    if case_exact:
        return max(case_exact, key=len)

    qn = normalize_department_name(raw)
    if not qn:
        return None

    by_norm: dict[str, list[str]] = {}
    for c in candidates:
        by_norm.setdefault(normalize_department_name(c), []).append(c)

    if qn in by_norm:
        names = by_norm[qn]
        return min(names, key=lambda n: (abs(len(n) - len(raw)), -len(n)))

    q_tokens = _tokens(qn)
    if not q_tokens:
        return None

    scored: list[tuple[int, int, int, str]] = []
    for cn, names in by_norm.items():
        c_tokens = _tokens(cn)
        if not c_tokens or not _is_token_prefix(q_tokens, c_tokens):
            continue
        overlap = len(set(q_tokens) & set(c_tokens))
        if overlap <= 0:
            continue
        scored.append((overlap, len(c_tokens), len(max(names, key=len)), max(names, key=len)))

    if not scored:
        for cn, names in by_norm.items():
            c_tokens = _tokens(cn)
            if not c_tokens or len(q_tokens) < 2:
                continue
            if q_tokens[0] != c_tokens[0]:
                continue
            if set(q_tokens) <= set(c_tokens):
                overlap = len(set(q_tokens) & set(c_tokens))
                scored.append((overlap, len(c_tokens), len(max(names, key=len)), max(names, key=len)))
        if not scored:
            return None
    scored.sort(reverse=True)
    return scored[0][3]


def resolve_department(
    db: Session,
    *,
    department_id: int | None = None,
    department_name: str = "",
) -> AcademicDepartment | None:
    if department_id:
        obj = db.get(AcademicDepartment, department_id)
        if obj is not None:
            if not obj.is_active:
                obj.is_active = True
            return obj
    name = (department_name or "").strip()
    if not name:
        return None

    depts = list(db.execute(select(AcademicDepartment)).scalars().all())
    picked = pick_department_name(name, [d.name for d in depts])
    if not picked:
        return None
    for dept in depts:
        if dept.name == picked:
            if not dept.is_active:
                dept.is_active = True
            return dept
    return None


def _unique_dept_code(db: Session, name: str) -> str:
    base = re.sub(r"[^\w\s-]", "", (name or "").casefold(), flags=re.UNICODE)
    base = re.sub(r"[-\s]+", "-", base).strip("-") or "kafedra"
    base = base[:56]
    code = base
    n = 1
    while db.execute(select(AcademicDepartment.id).where(AcademicDepartment.code == code)).scalar_one_or_none():
        code = f"{base}-{n}"[:64]
        n += 1
        if n > 10_000:
            raise RuntimeError(f"department code exhausted for {name!r}")
    return code


def get_or_create_department(
    db: Session,
    *,
    department_id: int | None = None,
    department_name: str = "",
) -> AcademicDepartment | None:
    dept = resolve_department(db, department_id=department_id, department_name=department_name)
    if dept is not None:
        return dept
    name = (department_name or "").strip()
    if not name:
        return None
    import datetime as dt

    now = dt.datetime.now(dt.timezone.utc)
    dept = AcademicDepartment(
        name=name[:255],
        code=_unique_dept_code(db, name),
        sort_order=0,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(dept)
    db.flush()
    return dept


def clear_staff_course_selections(db: Session, owner_key: str) -> None:
    """Kafedra o'zgaganda eski fan tanlovlarini tozalaydi (qayta tanlash majburiy)."""
    db.execute(delete(StaffCourseSelection).where(StaffCourseSelection.owner_key == owner_key))


def sync_staff_to_department_courses(
    db: Session,
    owner_key: str,
    department: AcademicDepartment | None,
) -> None:
    """Kafedra o'zgaganda: eski biriktiruvlarni tozalaydi; yangi fanlar avtomatik yozilmaydi."""
    clear_staff_course_selections(db, owner_key)
    _ = department  # fanlar staff PUT /my/ orqali tanlanadi


def apply_staff_department(
    db: Session,
    profile: StaffProfile,
    *,
    department_id: int | None = None,
    department_name: str = "",
) -> AcademicDepartment | None:
    """Profilga kafedra FK + nom yozadi. Fan tanlovi faqat kafedra o'zgaganda tozalanadi."""
    old_id = profile.department_id
    dept = get_or_create_department(db, department_id=department_id, department_name=department_name)
    new_id = dept.id if dept else None
    profile.department_id = new_id
    profile.department = dept.name if dept else (department_name or "").strip()
    if old_id != new_id:
        sync_staff_to_department_courses(db, profile.owner_key, dept)
    return dept
