"""Yuz orqali kirish: sinxronlash, avtomatik bog'lash va yuzni aniqlash.

Qaror qoidasi (login uchun davomatdan QATTIQROQ): brauzer ketma-ket ikki
kadr yuboradi va IKKALASIDA ham bitta hisob chiqishi shart —
  * o'xshashlik >= MATCH_THRESHOLD,
  * eng yaqin boshqa odamdan kamida MATCH_MARGIN uzoq.
Admin rollari yuz bilan kirmaydi (tiriklik tekshiruvi yo'q — rasm bilan
aldash mumkin, admin huquqi bunga arzimaydi).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import threading
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import numpy as np
import requests
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.staff_login import normalize_listener_login
from app.models.face_template import FaceTemplate
from app.models.online_edu import MalakaListener
from app.models.staff_location import StaffProfile
from app.models.user import User
from app.services import auth_service

logger = logging.getLogger("imentor.face_login")

MATCH_THRESHOLD = 0.52
MATCH_MARGIN = 0.07
EMBEDDING_DIM = 512
FACE_LOGIN_ROLES = ("hodim",)

_APOS = str.maketrans({"’": "", "‘": "", "`": "", "ʻ": "", "ʼ": "", "'": ""})
_CYR = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo", "ж": "j", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "h", "ц": "s", "ч": "ch", "ш": "sh", "щ": "sh", "ъ": "", "ы": "i", "ь": "",
    "э": "e", "ю": "yu", "я": "ya", "ў": "u", "қ": "k", "ғ": "g", "ҳ": "h",
})
# Ismdagi hurmat qo'shimchalari: Zilolaxon ~ Zilola, Mirzaolimjon ~ Mirzaolim.
_NAME_SUFFIXES = ("hon", "jon", "bek")


def _norm_name(value: str, *, strip_suffix: bool) -> str:
    s = (value or "").lower().translate(_CYR)
    # O'zbekcha "o'" ruscha yozuvda "u": Ro'zaliyev ~ Ruzaliyev ~ Рузалиев.
    s = re.sub(r"o[’‘`ʻʼ']", "u", s)
    s = s.translate(_APOS)
    s = s.replace("x", "h").replace("q", "k")
    s = re.sub(r"[^a-z]", "", s)
    s = re.sub(r"(?<=[aeiou])y(?=[aeiou])", "", s)  # Abdullayev ~ Абдуллаев
    s = s.replace("iy", "i")  # Satvaldiyev ~ Satvaldiev
    s = re.sub(r"(.)\1", r"\1", s)  # Abdullayev ~ Abdulayev
    if strip_suffix:
        for suffix in _NAME_SUFFIXES:
            if s.endswith(suffix) and len(s) - len(suffix) >= 3:
                s = s[: -len(suffix)]
                break
    return s


def name_key(last: str, first: str) -> tuple[str, str]:
    """Ism-familiyani solishtirish kaliti. Familiya aynan mos kelishi kerak;
    e'tiborga olinmaydi: katta-kichik harf, tutuq belgisi, kirill/lotin yozuvi,
    x/h va q/k, ikkilangan harflar va ismdagi -xon/-jon/-bek qo'shimchasi.
    Boshqa ism (Dilorom ~ Dildora, Sharofiddin ~ Shaxobidin) mos kelmaydi."""
    return _norm_name(last, strip_suffix=False), _norm_name(first, strip_suffix=True)


def person_key(full_name: str) -> str:
    """To'liq F.I.Sh. (otasining ismi bilan) — cam.fermi.uz'da bir odam ikki marta
    ro'yxatdan o'tganini aniqlash uchun."""
    return " ".join(_norm_name(p, strip_suffix=False) for p in (full_name or "").split())


def split_full_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").split()
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[1]


def parse_embedding(raw: str) -> list[float] | None:
    try:
        vec = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(vec, list) or len(vec) != EMBEDDING_DIM:
        return None
    try:
        arr = np.asarray(vec, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    norm = float(np.linalg.norm(arr))
    if not np.isfinite(norm) or norm == 0:
        return None
    return [float(x) for x in arr / norm]


def _is_phone_login(username: str) -> bool:
    return len(username) == 12 and username.isdigit() and username.startswith("998")


def _account_info(db: Session, usernames: list[str]) -> dict[str, dict]:
    """Hisob tanlash uchun: kafedra, faollik (fanlar + tayyor kontent), oxirgi kirish."""
    info = {u: {"department": "", "activity": 0, "last_login": None} for u in usernames}
    if not usernames:
        return info
    for owner, dept in db.execute(
        select(StaffProfile.owner_key, StaffProfile.department).where(StaffProfile.owner_key.in_(usernames))
    ).all():
        info[owner]["department"] = dept or ""
    for table in ("core_staffcourseselection", "core_preparedcontent"):
        for owner, cnt in db.execute(
            text(f"select owner_key, count(*) from {table} where owner_key = any(:u) group by owner_key"),
            {"u": usernames},
        ).all():
            if owner in info:
                info[owner]["activity"] += int(cnt)
    for username, last_login in db.execute(
        select(User.username, User.last_login).where(User.username.in_(usernames))
    ).all():
        info[username]["last_login"] = last_login
    return info


def _dept_norm(value: str) -> str:
    s = _norm_name(value, strip_suffix=False)
    return re.sub(r"(kafedrasi|kafedra|bolimi|bolim)$", "", s)


def choose_account(candidates: list, position: str, info: dict[str, dict]) -> str | None:
    """Bir ism-familiyaga mos iMentor hisoblaridan bittasini tanlash.

    * Bitta hisob — o'sha.
    * Ko'pi bilan bitta Xodim ID + telefon hisob(lar)i — bu BIR odamning ikki
      hisobi: o'qituvchi amalda ishlatayotgani (ko'proq fan/kontent, keyin
      oxirgi kirish, keyin telefon hisobi — parolini o'zi qo'ygan).
    * Bir nechta Xodim ID — turli odamlar: faqat kafedrasi yuz egasining
      bo'limiga mos kelgan yagona hisob; aks holda tanlanmaydi.
    """
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0].username
    staff_ids = [u for u in candidates if not _is_phone_login(u.username)]
    if len(staff_ids) <= 1:
        def rank(u):
            meta = info.get(u.username, {})
            last = meta.get("last_login")
            return (meta.get("activity", 0), last.timestamp() if last else 0.0, _is_phone_login(u.username))

        ordered = sorted(candidates, key=rank, reverse=True)
        return ordered[0].username if rank(ordered[0]) != rank(ordered[1]) else None
    pos = _dept_norm(position)
    if not pos:
        return None
    def same_dept(dept: str) -> bool:
        d = _dept_norm(dept)
        # cam.fermi.uz'da kafedra nomida imlo xatolari bor ("otoloringologiya").
        return bool(d) and (d in pos or pos in d or SequenceMatcher(None, d, pos).ratio() >= 0.85)

    matched = [u for u in candidates if same_dept(info.get(u.username, {}).get("department", ""))]
    return matched[0].username if len(matched) == 1 else None


# ---------------------------------------------------------------- sinxronlash


@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    deactivated: int = 0
    auto_linked: int = 0
    skipped_bad: int = 0
    links: list = field(default_factory=list)


def _face_login_users(db: Session) -> list[User]:
    users = db.execute(select(User).where(User.is_active.is_(True))).scalars().all()
    return [u for u in users if auth_service.resolve_user_role_from_db(db, u) in FACE_LOGIN_ROLES]


def _person_type(value) -> str:
    return "talaba" if str(value or "").strip().lower() == "talaba" else "xodim"


def sync_templates(
    db: Session, rows: list[dict], *, dry_run: bool = False, students: list[dict] | None = None
) -> SyncResult:
    """`rows`: cam.fermi.uz tasdiqlangan yuzlari — {id, full_name, position, embedding[, type, passport]}.
    `students`: OnlineTest talabalari — {id, name, group}; None bo'lsa talaba bog'lanishlariga tegilmaydi.

    Avtomatik bog'lash faqat IKKI TOMONDA HAM yagona moslikda: bir xil
    ism-familiyali ikki xodim yoki ikki iMentor hisobi bo'lsa, admin
    qaror qiladi. Admin bog'lagan qatorga tegilmaydi.
    """
    now = dt.datetime.now(dt.timezone.utc)
    result = SyncResult()
    existing = {t.source_person_id: t for t in db.execute(select(FaceTemplate)).scalars().all()}
    seen: set[str] = set()
    passports: dict[str, str] = {}

    for row in rows:
        pid = str(row.get("id") or "").strip()
        vec = parse_embedding(row.get("embedding") or "")
        if not pid or vec is None:
            result.skipped_bad += 1
            continue
        seen.add(pid)
        emb = json.dumps(vec, separators=(",", ":"))
        full_name = str(row.get("full_name") or "").strip()[:255]
        position = str(row.get("position") or "").strip()[:255]
        ptype = _person_type(row.get("type"))
        passports[pid] = str(row.get("passport") or "")
        tpl = existing.get(pid)
        if tpl is None:
            # Ustun sukutlari faqat INSERT paytida qo'llanadi — shu yurishdagi avtomatik
            # bog'lash ularni ko'rishi uchun qiymatlar aniq beriladi.
            tpl = FaceTemplate(
                source_person_id=pid, full_name=full_name, position=position, embedding=emb,
                owner_key="", link_source="", is_active=True, synced_at=now,
                person_type=ptype, group_name="",
            )
            db.add(tpl)
            existing[pid] = tpl
            result.created += 1
        else:
            if (tpl.embedding, tpl.full_name, tpl.position, tpl.is_active) != (emb, full_name, position, True):
                result.updated += 1
            tpl.embedding, tpl.full_name, tpl.position, tpl.is_active, tpl.synced_at = emb, full_name, position, True, now
            tpl.person_type = ptype

    for pid, tpl in existing.items():
        if pid not in seen and tpl.is_active:
            tpl.is_active = False
            result.deactivated += 1

    # --- avtomatik bog'lash
    users = _face_login_users(db)
    users_by_key: dict[tuple[str, str], list[User]] = defaultdict(list)
    for u in users:
        key = name_key(u.last_name, u.first_name)
        users_by_key[key].append(u)
        # Ro'yxatdan o'tishda ism va familiya joyi almashib yozilgan hisoblar ham bor
        # ("Zilolaxon Boynazarova") — ular ham shu odamning nomzodi.
        swapped = name_key(u.first_name, u.last_name)
        if swapped != key:
            users_by_key[swapped].append(u)
    # Xodimlarni bog'lash qoidalari faqat xodim yuzlariga; talabalar pastda alohida.
    active_tpls = [t for t in existing.values() if t.is_active and (t.person_type or "xodim") != "talaba"]
    valid_users = {u.username for u in users}
    info = _account_info(db, [u.username for u in users])

    # Bir odam (to'liq F.I.Sh. bir xil) — bitta guruh; turli odamlar bir xil ism-familiya bilan — noaniq.
    persons_by_key: dict[tuple[str, str], set[str]] = defaultdict(set)
    for t in active_tpls:
        persons_by_key[name_key(*split_full_name(t.full_name))].add(person_key(t.full_name))
    owner_of_person: dict[str, str] = {}
    for t in active_tpls:
        if t.owner_key and t.owner_key in valid_users:
            owner_of_person.setdefault(person_key(t.full_name), t.owner_key)
    taken_by_person: dict[str, str] = {}
    for t in active_tpls:
        if t.owner_key:
            taken_by_person.setdefault(t.owner_key, person_key(t.full_name))

    for tpl in active_tpls:
        if tpl.link_source == "admin":
            continue
        # Avtomatik bog'lanish endi yaroqsiz (hisob o'chirilgan) — bo'shatiladi.
        if tpl.owner_key and tpl.owner_key not in valid_users:
            tpl.owner_key, tpl.link_source, tpl.linked_at = "", "", None
        if tpl.owner_key:
            continue
        pkey = person_key(tpl.full_name)
        # Shu odamning boshqa yuzi allaqachon bog'langan — shu hisobga.
        chosen = owner_of_person.get(pkey)
        if not chosen:
            key = name_key(*split_full_name(tpl.full_name))
            if not all(key) or len(persons_by_key[key]) != 1:
                continue
            chosen = choose_account(users_by_key.get(key, []), tpl.position, info)
        if not chosen or taken_by_person.get(chosen, pkey) != pkey:
            continue
        tpl.owner_key, tpl.link_source, tpl.linked_at = chosen, "auto", now
        owner_of_person[pkey] = chosen
        taken_by_person[chosen] = pkey
        result.auto_linked += 1
        result.links.append((tpl.full_name, chosen))

    student_tpls = [t for t in existing.values() if t.is_active and t.person_type == "talaba"]
    _link_students(db, student_tpls, passports, students, now, result)

    if dry_run:
        db.rollback()
        return result
    db.commit()
    invalidate_cache()
    return result


def _link_students(
    db: Session,
    tpls: list[FaceTemplate],
    passports: dict[str, str],
    students: list[dict] | None,
    now: dt.datetime,
    result: SyncResult,
) -> None:
    """Talaba yuzini hisobga bog'lash (admin bog'lanishiga tegilmaydi):
      1. pasporti malaka tinglovchisiniki bo'lsa — tinglovchi hisobi;
      2. aks holda OnlineTest'da shu ism-familiyali YAGONA talaba bo'lsa (va kamerada ham
         shu ismli yagona odam) — `ot_<OnlineTest ID>`; guruhi ham yoziladi.
    OnlineTest ro'yxati kelmagan bo'lsa (None) talaba bog'lanishlari o'zgarmaydi."""
    listeners = set(
        db.execute(select(MalakaListener.username).where(MalakaListener.is_active.is_(True))).scalars().all()
    )
    by_key: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    group_of: dict[str, str] = {}
    for s in students or []:
        sid = str(s.get("id") or "").strip()
        if not sid:
            continue
        group_of[sid] = str(s.get("group") or "").strip()[:255]
        by_key[name_key(*split_full_name(str(s.get("name") or "")))].append((sid, group_of[sid]))

    persons_by_key: dict[tuple[str, str], set[str]] = defaultdict(set)
    for t in tpls:
        persons_by_key[name_key(*split_full_name(t.full_name))].add(person_key(t.full_name))
    taken: dict[str, str] = {}
    for t in tpls:
        if t.owner_key:
            taken.setdefault(t.owner_key, person_key(t.full_name))

    for t in tpls:
        if t.link_source == "admin":
            continue
        if t.owner_key:
            if t.owner_key in listeners:
                continue
            if t.owner_key.startswith("ot_") and (students is None or t.owner_key[3:] in group_of):
                if students is not None:
                    t.group_name = group_of[t.owner_key[3:]]
                continue
            t.owner_key, t.link_source, t.linked_at, t.group_name = "", "", None, ""
        if students is None and not passports.get(t.source_person_id):
            continue
        pkey = person_key(t.full_name)
        chosen, group = "", ""
        passport = normalize_listener_login(passports.get(t.source_person_id, ""))
        if passport and passport in listeners:
            chosen = passport
        elif students is not None:
            key = name_key(*split_full_name(t.full_name))
            candidates = by_key.get(key, [])
            if all(key) and len(persons_by_key[key]) == 1 and len(candidates) == 1:
                chosen, group = f"ot_{candidates[0][0]}", candidates[0][1]
        if not chosen or taken.get(chosen, pkey) != pkey:
            continue
        t.owner_key, t.link_source, t.linked_at, t.group_name = chosen, "auto", now, group
        taken[chosen] = pkey
        result.auto_linked += 1
        result.links.append((t.full_name, chosen))


# ---------------------------------------------------------------- aniqlash

_cache_lock = threading.Lock()
_cache: dict = {"stamp": None, "ids": [], "owners": [], "matrix": None}


def invalidate_cache() -> None:
    with _cache_lock:
        _cache["stamp"] = None


def _load_matrix(db: Session) -> tuple[list[int], list[str], np.ndarray | None]:
    # Bir nechta worker bor: admin bog'lashi boshqa worker keshini ham eskirtirishi
    # kerak. Arzon "versiya": sinxron/bog'lash vaqtlari, qatorlar soni va
    # bog'langan kalitlar uzunliklari yig'indisi (bog'lash olib tashlanganda ham o'zgaradi).
    key = tuple(
        db.execute(
            select(
                func.max(FaceTemplate.synced_at),
                func.max(FaceTemplate.linked_at),
                func.count(FaceTemplate.id).filter(FaceTemplate.is_active.is_(True)),
                func.coalesce(func.sum(func.length(FaceTemplate.owner_key)), 0),
            )
        ).one()
    )
    with _cache_lock:
        if _cache["stamp"] == key and _cache["matrix"] is not None:
            return _cache["ids"], _cache["owners"], _cache["matrix"]
    rows = db.execute(
        select(FaceTemplate.id, FaceTemplate.owner_key, FaceTemplate.embedding).where(FaceTemplate.is_active.is_(True))
    ).all()
    ids, owners, vecs = [], [], []
    for tid, owner, raw in rows:
        vec = parse_embedding(raw)
        if vec is None:
            continue
        ids.append(tid)
        owners.append(owner or "")
        vecs.append(vec)
    matrix = np.asarray(vecs, dtype=np.float32) if vecs else None
    with _cache_lock:
        _cache.update(stamp=key, ids=ids, owners=owners, matrix=matrix)
    return ids, owners, matrix


@dataclass
class FaceDecision:
    status: str  # "ok" | "unlinked" | "unknown" | "no_face"
    template_id: int | None = None
    owner_key: str = ""
    similarity: float = 0.0


def decide(embeddings: list[list[float] | None], ids: list[int], owners: list[str], matrix: np.ndarray | None) -> FaceDecision:
    """Barcha kadrlar bitta ODAMga ishonchli mos kelsagina qaror.

    "Odam" — bog'langan hisob (bir hisobga bir necha yuz bog'lanishi mumkin:
    cam.fermi.uz'da ikki marta ro'yxatdan o'tgan xodim) yoki bog'lanmagan shablon.
    Ajralish (margin) boshqa odamning eng yaqin yuziga nisbatan o'lchanadi —
    aks holda bir odamning ikki yuzi bir-biriga "raqib" bo'lib, u hech qachon kira olmasdi.
    """
    if not embeddings or any(e is None for e in embeddings):
        return FaceDecision("no_face")
    if matrix is None or matrix.shape[0] == 0:
        return FaceDecision("unknown")
    identities = [owner if owner else f"tpl:{tid}" for tid, owner in zip(ids, owners)]
    picked: set[str] = set()
    best_idx_for: dict[str, int] = {}
    worst = 1.0
    for emb in embeddings:
        vec = np.asarray(emb, dtype=np.float32)
        n = float(np.linalg.norm(vec))
        if n == 0:
            return FaceDecision("no_face")
        sims = matrix @ (vec / n)
        per_identity: dict[str, tuple[float, int]] = {}
        for idx, identity in enumerate(identities):
            value = float(sims[idx])
            if identity not in per_identity or value > per_identity[identity][0]:
                per_identity[identity] = (value, idx)
        ranked = sorted(per_identity.items(), key=lambda item: item[1][0], reverse=True)
        best_identity, (best, best_idx) = ranked[0]
        second = ranked[1][1][0] if len(ranked) > 1 else -1.0
        if best < MATCH_THRESHOLD or best - second < MATCH_MARGIN:
            return FaceDecision("unknown", similarity=best)
        picked.add(best_identity)
        best_idx_for[best_identity] = best_idx
        worst = min(worst, best)
    if len(picked) != 1:
        return FaceDecision("unknown", similarity=worst)
    identity = picked.pop()
    idx = best_idx_for[identity]
    owner = owners[idx]
    return FaceDecision("ok" if owner else "unlinked", template_id=ids[idx], owner_key=owner, similarity=worst)


def embed_image(face_api_url: str, data: bytes) -> list[float] | None:
    """face_api xizmatidan embedding. Yuz yo'q yoki juda kichik — None."""
    resp = requests.post(
        f"{face_api_url.rstrip('/')}/embed",
        files={"image": ("frame.jpg", data, "image/jpeg")},
        timeout=20,
    )
    if resp.status_code in (413, 422):
        return None
    resp.raise_for_status()
    payload = resp.json()
    emb = payload.get("embedding")
    return emb if isinstance(emb, list) and len(emb) == EMBEDDING_DIM else None


def identify(db: Session, face_api_url: str, frames: list[bytes]) -> FaceDecision:
    # Kadrlar parallel: kirish kutish vaqti ikki barobar qisqaradi (face_api 4 tagacha
    # so'rovni bir vaqtda ko'taradi).
    with ThreadPoolExecutor(max_workers=len(frames)) as pool:
        embeddings = list(pool.map(lambda f: embed_image(face_api_url, f), frames))
    ids, owners, matrix = _load_matrix(db)
    decision = decide(embeddings, ids, owners, matrix)
    logger.info(
        "FACE_LOGIN status=%s template=%s sim=%.3f",
        decision.status, decision.template_id, decision.similarity,
    )
    return decision
