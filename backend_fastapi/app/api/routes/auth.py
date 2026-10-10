from __future__ import annotations

import datetime as dt
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import NO_ROLE, AuthContext, require_roles
from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.core.staff_login import normalize_listener_login
from app.core.throttling import throttle_login_account
from app.models.online_edu import MalakaListener
from app.models.face_template import FaceTemplate
from app.models.person_identity import STAFF
from app.models.staff_location import StaffProfile
from app.models.student_contingent import StudentContingent
from app.models.user import User
from app.schemas.auth import (
    IdLoginRequest,
    LocalLoginRequest,
    LoginResponse,
    TokenRefreshRequest,
    TokenRefreshResponse,
)
from app.schemas.auth_extra import OnlineTestStudentLoginRequest
from app.schemas.malaka import MalakaLoginRequest
from app.services import auth_service
from app.services import password_policy_service as pwd_policy
from app.services import staff_department as staff_dept
from app.services import online_test_client as otc
from app.services import person_identity as pid
from app.services import staff_pinfl
from app.services import staff_profile as sp
from app.services.analytics_service import record_activity_event

router = APIRouter()
settings = get_settings()

STAFF_ROLES = ("admin", "klinika_admin", "hodim")


def _login_response(
    db: Session,
    user: User,
    role: str,
    *,
    student_id: str | None = None,
    group_name: str | None = None,
    must_change: bool = False,
) -> LoginResponse:
    extra = {"role": role}
    if student_id:
        extra["student_id"] = student_id
    # Guruh nomi ham tokenga: online ta'limda mavzu qulfi va davomat AYNAN
    # guruh bo'yicha ishlaydi, shuning uchun uni brauzerdan so'rab bo'lmaydi —
    # aks holda talaba boshqa guruh nomini yozib, o'zgalarning darsiga
    # qo'shilib olardi. Bu QO'SHIMCHA da'vo: mavjud kod uni o'qimaydi va
    # eski tokenlar ham ishlaydi.
    if group_name:
        extra["group_name"] = group_name
    # Parol almashtirilmaguncha token faqat parol almashtirishga yaraydi
    # (qarang: `deps.get_current_auth`). Da'vo faqat belgi — haqiqiy holat
    # bazadan o'qiladi, shuning uchun parol almashtirilgach shu token ham
    # darhol to'liq ishlay boshlaydi.
    if must_change:
        extra["mcp"] = 1
    access = create_access_token(user.id, extra)
    refresh = create_refresh_token(user.id, extra)
    return LoginResponse(
        access=access,
        refresh=refresh,
        role=role,
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        photo_url=sp.staff_photo_url_for_user(user.username, db),
        student_id=student_id,
        group_name=group_name,
        must_change_password=must_change,
    )


def _mask_login(username: str) -> str:
    """`998939838000` -> `+998 93 ••• •• 00`; boshqa login -> `3442•••031`."""
    if len(username) == 12 and username.isdigit() and username.startswith("998"):
        return f"+998 {username[3:5]} ••• •• {username[-2:]}"
    if len(username) > 6:
        return f"{username[:4]}•••{username[-3:]}"
    return "•••"


def _disabled_account_message(db: Session, user: User) -> str:
    """O'chirilgan hisob uchun xabar. Ko'p xodimning eski Xodim ID hisobi o'chirilgan,
    ishlaydigani esa o'zi ro'yxatdan o'tgan telefon hisobi — avgustdagi qog'oz
    ro'yxatdan Xodim ID yozib "parol xato" deb qolishardi. Parol to'g'ri kiritilgandan
    keyingina (shu funksiya shundan so'ng chaqiriladi) ishlaydigan loginning yashirilgan
    ko'rinishi aytiladi."""
    first = (user.first_name or "").strip().lower()
    last = (user.last_name or "").strip().lower()
    if first and last:
        twins = db.execute(
            select(User.username).where(
                User.is_active.is_(True),
                User.id != user.id,
                func.lower(func.trim(User.first_name)) == first,
                func.lower(func.trim(User.last_name)) == last,
            ).limit(2)
        ).scalars().all()
        if len(twins) == 1:
            return (
                "Bu eski hisob o'chirilgan. Siz boshqa login bilan ro'yxatdan o'tgansiz: "
                f"{_mask_login(twins[0])}. Shu login va o'zingiz qo'ygan parol bilan kiring."
            )
    return "Bu hisob o'chirilgan. Telefon raqamingiz bilan kiring yoki administratorga murojaat qiling."


@router.post("/auth/local-login/", response_model=LoginResponse)
def local_login(
    payload: LocalLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    username = payload.phone_digits
    throttle_login_account(request, username)
    user = auth_service.get_user_by_username(db, username)

    # JSHSHIR (14 raqam) — hisob logini emas: cam.fermi.uz'dan bog'langan hisob topiladi,
    # parol o'sha hisobning o'z paroli. JSHSHIR nomi bilan yangi hisob ochilmaydi.
    if user is None and staff_pinfl.is_pinfl(username):
        owner = staff_pinfl.owner_for(db, username)
        user = auth_service.get_user_by_username(db, owner) if owner else None
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bu JSHSHIR hali iMentor hisobingizga bog'lanmagan. Xodim ID yoki telefon raqamingiz "
                "bilan kiring yoki administratorga murojaat qiling.",
            )

    if user is None:
        if not payload.register:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
        if not settings.django_allow_open_registration:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ro'yxatdan o'tish faqat administrator orqali mumkin.",
            )
        reg_role = "hodim"
        user = auth_service.create_user(
            db, username, payload.password, payload.first_name.strip(), payload.last_name.strip()
        )
        auth_service.set_user_role_group(db, user, reg_role)
        role = reg_role
        now = dt.datetime.now(dt.timezone.utc)
        profile = db.execute(select(StaffProfile).where(StaffProfile.owner_key == user.username)).scalar_one_or_none()
        if profile is None:
            profile = StaffProfile(owner_key=user.username, updated_at=now)
            db.add(profile)
        profile.faculty = payload.faculty.strip()
        profile.direction = payload.direction.strip()
        staff_dept.apply_staff_department(db, profile, department_name=payload.department.strip())
        profile.updated_at = now
        record_activity_event(db, owner_key=user.username, role=role, event_type="register")
        db.commit()
        db.refresh(user)
        return _login_response(db, user, role)

    if not verify_password(payload.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Telefon yoki parol noto'g'ri.")
    # O'chirilgan hisobga token berilmaydi. Ilgari kirish "muvaffaqiyatli" bo'lib,
    # keyingi so'rovdayoq 401 bilan chiqarib yuborardi — xodim sababini bilmasdi
    # (masalan, ikkita hisobdan keraksizi o'chirilgan Xodim ID hisobi).
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user))
    # Hisobi bor, parolni to'g'ri yozgan, lekin "Ro'yxatdan o'tish"ni bosgan —
    # rad etmaymiz, shunchaki kiritamiz (parol tekshirildi, yangi hisob ochilmaydi).

    role = auth_service.resolve_login_role(db, user, payload.role)
    if not role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_ROLE)
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role=role, event_type="login")
    db.commit()
    return _login_response(db, user, role, must_change=pwd_policy.must_change(db, user.username))


# ======================= Parolsiz kirish: JSHSHIR yoki pasport =======================
#
# 2026-10-02: xodim ham, talaba ham parol yozmaydi — o'zining JSHSHIRi yoki
# pasporti bilan kiradi (uchinchi yo'l — yuz skaneri). Raqamlar HEMIS'da YO'Q
# (tekshirildi: talabada 62, xodimda 33 maydon, bunday maydon yo'q), ular
# cam.fermi.uz dan FAQAT O'QIB olinadi — qarang `core_personidentity`.
#
# Parol bo'lmagani uchun xabar ham umumiy: qaysi raqam topilmagani aytilmaydi,
# aks holda bu raqam tekshirish vositasiga aylanardi.

ID_DENIED = (
    "Bu ma'lumot bilan hisob topilmadi. Raqamni tekshirib qayta urining "
    "yoki kadrlar bo'limiga murojaat qiling."
)


def _staff_owner(db: Session, person) -> str:
    """Xodimning iMentor hisobi: avval JSHSHIR bog'lanishi, keyin yuz yozuvi."""
    owner = staff_pinfl.owner_for(db, person.pinfl) if person.pinfl else None
    if owner:
        return owner
    # Pasporti bor, lekin JSHSHIRi yo'q xodim ham kira olsin: yuz shabloni
    # cam.fermi.uz dagi AYNAN shu odamga bog'langan.
    row = db.execute(
        select(FaceTemplate).where(
            FaceTemplate.source_person_id == person.source_id,
            FaceTemplate.is_active.is_(True),
        )
    ).scalars().first()
    return (row.owner_key or "") if row is not None else ""


def _student_user(db: Session, person) -> tuple[User, str] | None:
    """Talabaning hisobi; birinchi kirishda ochiladi.

    Kontingentdagi `student_id` bo'yicha topiladi — cam.fermi.uz shu raqamni
    `hemis_id` ustunida saqlaydi (7031 tasining hammasi mos tushdi).
    Hisob nomi `ot_<student_id>`: test topshiriqlari ilgaridan shu nom bilan
    yozilgan, shuning uchun eski natijalar yo'qolmaydi.
    """
    sid = (person.hemis_id or "").strip()
    if not sid:
        return None
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    if row is None:
        return None
    username = f"ot_{sid}"
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        # Parol o'rniga tasodifiy qiymat: bu hisobga parol bilan kirilmaydi.
        user = auth_service.create_user(
            db, username, secrets.token_urlsafe(32),
            (row.first_name or "").strip(), (row.last_name or "").strip(),
        )
        auth_service.set_user_role_group(db, user, "student")
    return user, sid


def _student_by_id(db: Session, student_id: str) -> tuple[User, str] | None:
    """Talabani KONTINGENTDAN topadi — cam.fermi.uz kerak emas.

    JSHSHIR va pasport faqat cam.fermi.uz da bor, u esa biometrik ro'yxatdan
    o'tgandan keyin to'ladi. Yangi kelgan va xorijiy talaba u yerda hali yo'q,
    shuning uchun ular kira olmasdi (2026-10-05 shikoyati). Kontingent esa
    HEMIS'dan to'g'ridan-to'g'ri keladi va BARCHA talabani qamraydi.
    """
    sid = (student_id or "").strip()
    if not sid:
        return None
    row = db.execute(
        select(StudentContingent).where(StudentContingent.student_id == sid)
    ).scalars().first()
    if row is None:
        return None
    username = f"ot_{sid}"
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        user = auth_service.create_user(
            db, username, secrets.token_urlsafe(32),
            (row.first_name or "").strip(), (row.last_name or "").strip(),
        )
        auth_service.set_user_role_group(db, user, "student")
    return user, sid


def _staff_by_id(db: Session, staff_id: str) -> User | None:
    """Xodimni Xodim ID bo'yicha topadi — iMentor logini aynan shu raqam."""
    key = (staff_id or "").strip()
    if not key:
        return None
    user = auth_service.get_user_by_username(db, key)
    if user is None or not user.is_active:
        return None
    # Faqat xodim: talaba hisobiga bu yo'l bilan kirilmaydi (uning o'z yo'li bor).
    return user if auth_service.resolve_user_role_from_db(db, user) in STAFF_ROLES else None


def _issue(db: Session, user: User, role: str, student_id: str | None = None) -> LoginResponse:
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role=role, event_type="login")
    db.commit()
    return _login_response(db, user, role, student_id=student_id)


@router.post("/auth/id-login/", response_model=LoginResponse)
def id_login(
    payload: IdLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """JSHSHIR, pasport yoki institut raqami bilan kirish. Parol so'ralmaydi."""
    denied = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ID_DENIED)
    pinfl = (payload.pinfl or "").strip()
    institute_id = (payload.institute_id or "").strip()
    throttle_login_account(
        request,
        institute_id or pinfl or f"{payload.passport_series}{payload.passport_number}",
    )

    # Institut bergan raqam (Talaba ID / Xodim ID) — HEMIS ma'lumotidan
    # to'g'ridan-to'g'ri, cam.fermi.uz ga bog'liq emas.
    if institute_id:
        staff = _staff_by_id(db, institute_id)
        if staff is not None:
            return _issue(db, staff, auth_service.resolve_user_role_from_db(db, staff))
        found_student = _student_by_id(db, institute_id)
        if found_student is None:
            raise denied
        user, student_id = found_student
        if not user.is_active:
            raise denied
        return _issue(db, user, "student", student_id)

    person = pid.find(
        db, pinfl=pinfl,
        series=payload.passport_series, number=payload.passport_number,
    )
    if person is None:
        raise denied

    if person.kind == STAFF:
        owner = _staff_owner(db, person)
        user = auth_service.get_user_by_username(db, owner) if owner else None
        if user is None:
            raise denied
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=_disabled_account_message(db, user)
            )
        role = auth_service.resolve_user_role_from_db(db, user)
        if not role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NO_ROLE)
        return _issue(db, user, role)

    found = _student_user(db, person)
    if found is None:
        raise denied
    user, student_id = found
    if not user.is_active:
        raise denied
    return _issue(db, user, "student", student_id)


@router.get("/auth/passport-series/")
def passport_series() -> dict:
    """Pasport seriyasi ro'yxati — kirish oynasidagi tanlov uchun."""
    return {"series": list(pid.SERIES_CHOICES)}


@router.post("/auth/token/refresh/", response_model=TokenRefreshResponse)
def token_refresh(payload: TokenRefreshRequest, db: Session = Depends(get_db)) -> TokenRefreshResponse:
    try:
        claims = decode_token(payload.refresh)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token yaroqsiz yoki muddati o'tgan.")
    if claims.get("token_type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token talab qilinadi.")

    user_id = claims.get("user_id")
    user = db.get(User, int(user_id)) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Foydalanuvchi topilmadi.")

    # Rol faqat bazadan: guruhi olib tashlangan foydalanuvchi eski tokendagi
    # rol bilan yangilanib yuravermasin (2026-09-26).
    role = auth_service.resolve_user_role_from_db(db, user)
    if not role:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=NO_ROLE)
    extra: dict = {"role": role}
    student_id = auth_service.resolve_student_id(user, claims.get("student_id"))
    if student_id:
        extra["student_id"] = student_id

    # Guruh nomi ham ko'chirilishi SHART. Online ta'limda talabaning guruhi
    # faqat shu da'vodan olinadi — yangilangan tokenda u yo'qolsa, talaba
    # tizimda ko'rinib turadi, lekin har bir so'rov "guruhingiz aniqlanmadi"
    # deb rad etiladi va chiqib-kirishdan boshqa yo'l qolmaydi.
    group_name = str(claims.get("group_name") or "").strip()
    if group_name:
        extra["group_name"] = group_name

    # Bazadan qayta o'qiladi: parol almashtirilgan bo'lsa belgi tushib qoladi.
    if pwd_policy.must_change(db, user.username):
        extra["mcp"] = 1

    return TokenRefreshResponse(
        access=create_access_token(user.id, extra),
        refresh=create_refresh_token(user.id, extra),
    )


@router.post("/auth/online-test-login/", response_model=LoginResponse)
def online_test_student_login(
    payload: OnlineTestStudentLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    student_id = (payload.id or payload.student_id or payload.username or "").strip()
    throttle_login_account(request, student_id)
    password = (payload.password or "").strip()
    if not student_id or not password:
        raise HTTPException(status_code=400, detail="Talaba ID va parol majburiy.")

    try:
        ot = otc.online_test_login(student_id, password)
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    user_info = ot["user"]
    first_name, last_name = otc.split_person_name(str(user_info.get("name") or ""))
    sid = str(user_info.get("id") or student_id).strip()
    username = f"ot_{sid}"[:150]

    user = auth_service.get_user_by_username(db, username)
    if user is None:
        user = auth_service.create_user(db, username, "", first_name, last_name)
        user.password = ""
    else:
        user.first_name = first_name
        user.last_name = last_name
    auth_service.set_user_role_group(db, user, "student")
    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login")
    db.commit()
    db.refresh(user)

    group_name = str(user_info.get("group_name") or "").strip() or None
    return _login_response(db, user, "student", student_id=sid, group_name=group_name)


@router.post("/auth/malaka-login/", response_model=LoginResponse)
def malaka_login(
    payload: MalakaLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Malaka oshirish tinglovchisi: login — pasport seriyasi va raqami.

    Tinglovchi OnlineTest'da yo'q, u farmoyish bo'yicha qabul qilinadi.
    Guruhi tokenga SHU yerda, `malaka_listener` jadvalidan yoziladi —
    online talabadagi kabi tashqaridan olinmaydi.

    Boshlang'ich parol ham pasport. U almashtirilmaguncha parol maydoni
    ham login kabi erkin o'qiladi ("aa 1111111" = "AA1111111"): pasportni
    har kim o'zicha yozadi va birinchi kirishning o'zi to'siq bo'lmasin.

    2026-09-19: bu marshrut serverdagi manba kodda yo'q edi (faqat eski
    image'da bor edi) va backend qayta yig'ilganda yo'qolib, tinglovchilar
    "Not Found" olgan — `tests/test_malaka_login_route.py` qaytmasligini tekshiradi.
    """
    denied = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Login yoki parol noto'g'ri."
    )
    username = normalize_listener_login(payload.login)
    if not username:
        raise denied
    throttle_login_account(request, username)
    listener = db.execute(
        select(MalakaListener).where(MalakaListener.username == username)
    ).scalar_one_or_none()
    user = auth_service.get_user_by_username(db, username) if listener else None
    if listener is None or not listener.is_active or user is None or not user.is_active:
        raise denied

    pending = pwd_policy.must_change(db, username)
    ok = verify_password(payload.password, user.password or "")
    if not ok and pending:
        ok = verify_password(normalize_listener_login(payload.password), user.password or "")
    if not ok:
        raise denied

    group = listener.group
    if group is None or not group.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Guruhingiz hali faollashtirilmagan. Fakultetga murojaat qiling.",
        )

    auth_service.touch_last_login(db, user)
    record_activity_event(db, owner_key=user.username, role="student", event_type="login")
    db.commit()
    return _login_response(
        db, user, "student", student_id=username, group_name=group.name, must_change=pending
    )


@router.get("/academic-catalog/")
def academic_catalog(auth: AuthContext = Depends(require_roles(*STAFF_ROLES, "student"))) -> dict:
    try:
        return otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/public/kafedralar/")
def public_kafedralar() -> list[dict]:
    """Ro'yxatdan o'tish formasi uchun kafedra ro'yxati — faqat nom/kod, talaba ma'lumotisiz."""
    try:
        catalog = otc.fetch_academic_catalog()
    except otc.OnlineTestAuthError:
        return []
    rows: list[dict] = []
    for kafedra in catalog.get("kafedralar") or []:
        name = str(kafedra.get("name") or "").strip()
        if not name:
            continue
        rows.append(
            {
                "id": kafedra.get("id"),
                "name": name,
                "code": kafedra.get("code"),
                "directions": [
                    str(d.get("name") or "").strip()
                    for d in (kafedra.get("directions") or [])
                    if str(d.get("name") or "").strip()
                ],
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows
