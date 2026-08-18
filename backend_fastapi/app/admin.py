from __future__ import annotations

from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from app.core.config import get_settings
from app.core.db import engine
from app.core.security import verify_password
from app.models.book import SubjectBook
from app.models.clinical_group import ClinicalGroup
from app.models.content import AcademicDepartment, CourseSyllabus, StaffCourseSelection
from app.models.device_pairing import DevicePairingSession
from app.models.live_test import LiveTestSession
from app.models.staff_location import CampusBuilding, StaffScheduleSlot
from app.models.startup import StartupProjectApplication
from app.models.user import User
from app.services.auth_service import get_user_by_username, resolve_user_role_from_db

settings = get_settings()


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        username = str(form.get("username") or "").strip()
        password = str(form.get("password") or "")

        from sqlalchemy.orm import Session

        with Session(engine) as db:
            user = get_user_by_username(db, username)
            if user is None or not verify_password(password, user.password):
                return False
            role = resolve_user_role_from_db(db, user)
            if not (user.is_superuser or role == "admin"):
                return False

        request.session.update({"admin_user": username})
        return True

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        username = request.session.get("admin_user")
        if not username:
            return False
        from sqlalchemy.orm import Session

        with Session(engine) as db:
            user = get_user_by_username(db, str(username))
            if user is None or not user.is_active:
                request.session.clear()
                return False
            role = resolve_user_role_from_db(db, user)
            if not (user.is_superuser or role == "admin"):
                request.session.clear()
                return False
        return True


class UserAdmin(ModelView, model=User):
    name = "Foydalanuvchi"
    name_plural = "Foydalanuvchilar"
    column_list = [User.id, User.username, User.first_name, User.last_name, User.is_superuser, User.is_active]
    can_create = False
    can_delete = False
    form_excluded_columns = [User.password]


class AcademicDepartmentAdmin(ModelView, model=AcademicDepartment):
    name = "Kafedra"
    name_plural = "Kafedralar"
    column_list = [AcademicDepartment.id, AcademicDepartment.name, AcademicDepartment.code, AcademicDepartment.is_active]


class CourseSyllabusAdmin(ModelView, model=CourseSyllabus):
    name = "Fan syllabus"
    name_plural = "Fan syllabus katalogi"
    column_list = [
        CourseSyllabus.id,
        CourseSyllabus.subject_name,
        CourseSyllabus.subject_code,
        CourseSyllabus.department,
        CourseSyllabus.is_active,
    ]
    form_excluded_columns = [CourseSyllabus.topics, CourseSyllabus.variants]
    column_formatters = {CourseSyllabus.department: lambda m, a: m.department.name if m.department else ""}


class StaffCourseSelectionAdmin(ModelView, model=StaffCourseSelection):
    name = "Fan tanlovi"
    name_plural = "O'qituvchi fan tanlovlari"
    column_list = [
        StaffCourseSelection.id,
        StaffCourseSelection.owner_key,
        StaffCourseSelection.syllabus,
        StaffCourseSelection.variant_label,
    ]
    column_formatters = {StaffCourseSelection.syllabus: lambda m, a: m.syllabus.subject_name}


class CampusBuildingAdmin(ModelView, model=CampusBuilding):
    name = "Kampus binosi"
    name_plural = "Kampus binolari"
    column_list = [CampusBuilding.id, CampusBuilding.name, CampusBuilding.radius_m, CampusBuilding.is_active]


class StaffScheduleSlotAdmin(ModelView, model=StaffScheduleSlot):
    name = "Jadval sloti"
    name_plural = "Xodim jadval slotlari"
    column_list = [
        StaffScheduleSlot.id,
        StaffScheduleSlot.owner_key,
        StaffScheduleSlot.weekday,
        StaffScheduleSlot.start_time,
        StaffScheduleSlot.end_time,
        StaffScheduleSlot.building_name,
    ]


class LiveTestSessionAdmin(ModelView, model=LiveTestSession):
    name = "Jonli test"
    name_plural = "Jonli test sessiyalari"
    column_list = [LiveTestSession.id, LiveTestSession.session_key, LiveTestSession.owner_key, LiveTestSession.is_closed]
    can_create = False
    form_excluded_columns = [LiveTestSession.payload]


class StartupApplicationAdmin(ModelView, model=StartupProjectApplication):
    name = "Startap arizasi"
    name_plural = "Startap arizalari"
    column_list = [
        StartupProjectApplication.id,
        StartupProjectApplication.owner_key,
        StartupProjectApplication.title,
        StartupProjectApplication.status,
    ]


class ClinicalGroupAdmin(ModelView, model=ClinicalGroup):
    name = "Klinika guruhi"
    name_plural = "Klinika guruhlari"
    column_list = [
        ClinicalGroup.id,
        ClinicalGroup.name,
        ClinicalGroup.code,
        ClinicalGroup.subscription_plan,
        ClinicalGroup.subscription_status,
        ClinicalGroup.is_active,
    ]


class SubjectBookAdmin(ModelView, model=SubjectBook):
    name = "Fan darsligi"
    name_plural = "Fan darsliklari"
    column_list = [SubjectBook.id, SubjectBook.title, SubjectBook.department_id, SubjectBook.page_count, SubjectBook.is_active]
    can_create = False


class DevicePairingSessionAdmin(ModelView, model=DevicePairingSession):
    name = "Qurilma ulanishi"
    name_plural = "Qurilma ulanishlari"
    column_list = [
        DevicePairingSession.id,
        DevicePairingSession.pairing_token,
        DevicePairingSession.status,
        DevicePairingSession.owner_key,
        DevicePairingSession.expires_at,
    ]
    can_create = False
    can_edit = False


def register_admin(app) -> Admin:
    admin = Admin(
        app,
        engine,
        authentication_backend=AdminAuth(secret_key=settings.django_secret_key),
        title="iMentor Admin (FastAPI)",
    )
    for view in (
        UserAdmin,
        AcademicDepartmentAdmin,
        CourseSyllabusAdmin,
        StaffCourseSelectionAdmin,
        CampusBuildingAdmin,
        StaffScheduleSlotAdmin,
        LiveTestSessionAdmin,
        StartupApplicationAdmin,
        ClinicalGroupAdmin,
        SubjectBookAdmin,
        DevicePairingSessionAdmin,
    ):
        admin.add_view(view)
    return admin
