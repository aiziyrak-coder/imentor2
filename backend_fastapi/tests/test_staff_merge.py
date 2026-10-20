"""O'qituvchi hisoblarini birlashtirish (2026-10-20).

Bir odam ikki hisob bilan qolgan: HEMIS Xodim ID hisobi (`3442000101`) va o'zi ochgan telefon hisobi
(`998900000101`). Birinchi blok — bazasiz sinovlar. Ikkinchi blok haqiqiy Postgres'da ishlaydi:
`MERGE_TEST_DB=postgresql+psycopg://user:pass@host:port/db` berilmasa o'tkazib yuboriladi.
"""

from __future__ import annotations

import datetime as dt
import os
from types import SimpleNamespace

import pytest

from app.core.db import Base
from app.services import staff_merge as sm

# ------------------------------------------------------------------ bazasiz


def user(first: str, last: str):
    return SimpleNamespace(first_name=first, last_name=last)


def test_same_person_with_honorific_suffix_is_a_candidate():
    assert sm.name_similarity(user("Zilolaxon", "Karimova"), user("Zilola", "Karimova")) >= sm.NAME_SIMILARITY


def test_spelling_variants_and_swapped_order_are_candidates():
    assert sm.name_similarity(user("Zilola", "Raximova"), user("Zilola", "Rahimova")) >= sm.NAME_SIMILARITY
    assert sm.name_similarity(user("Zilola", "Karimova"), user("Karimova", "Zilola")) >= sm.NAME_SIMILARITY
    assert sm.name_similarity(user("Nodira", "Qodirova"), user("Nodira", "Kodirova")) >= sm.NAME_SIMILARITY


@pytest.mark.parametrize(
    "a,b",
    [
        (("Gulnora", "Qodirova"), ("Gulbahor", "Qodirova")),  # bir oilaning turli a'zolari
        (("Dilorom", "Sodiqova"), ("Dildora", "Sodiqova")),
        (("Bobur", "Kadirov"), ("Madina", "Kadirova")),
        (("Sardor", "Kadirov"), ("Bobur", "Kadirov")),
    ],
)
def test_different_people_are_not_candidates(a, b):
    assert sm.name_similarity(user(*a), user(*b)) < sm.NAME_SIMILARITY


def test_every_owner_column_is_covered_by_the_merge():
    """Yangi jadvalga `owner_key` qo'shilsa va u birlashtirishga kiritilmasa — odam birlashgach
    shu jadvaldagi ma'lumoti eski (nofaol) hisobda qolib ketadi. Shuni oldindan ushlaymiz."""
    import app.models  # noqa: F401

    covered = set(sm.PLAIN_COLUMNS) | set(sm.SPECIAL_COLUMNS) | set(sm.IGNORED_COLUMNS)
    missing = [
        (table.name, col.name)
        for table in Base.metadata.tables.values()
        for col in table.columns
        if col.name in sm.OWNER_COLUMN_NAMES and (table.name, col.name) not in covered and table.name != "auth_user"
    ]
    assert not missing, f"birlashtirishda hisobga olinmagan ustunlar: {missing}"


# ------------------------------------------------------------------ Postgres


@pytest.fixture
def db():
    url = os.environ.get("MERGE_TEST_DB")
    if not url:
        pytest.skip("MERGE_TEST_DB berilmagan")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    import app.models  # noqa: F401

    engine = create_engine(url, future=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    Base.metadata.drop_all(engine)
    engine.dispose()


NOW = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)


def make_teacher(db, login, first, last, dept="Kommunal va mehnat gigiyenasi", *, logged_in=True, role="hodim"):
    from app.models.staff_location import StaffProfile
    from app.services import auth_service

    u = auth_service.create_user(db, login, "parol123", first, last)
    auth_service.set_user_role_group(db, u, role)
    if logged_in:
        u.last_login = dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc)
    db.add(
        StaffProfile(owner_key=login, department=dept, job_title="", updated_at=dt.datetime.now(dt.timezone.utc))
    )
    db.flush()
    return u


def add_syllabus(db, name):
    from app.models.content import CourseSyllabus

    s = CourseSyllabus(subject_name=name, subject_code=name, file_name=f"{name}.xlsx", topics=[], variants=[],
        created_at=dt.datetime.now(dt.timezone.utc), updated_at=dt.datetime.now(dt.timezone.utc),
    )
    db.add(s)
    db.flush()
    return s


def test_candidates_need_same_role_dept_and_similar_name(db):
    make_teacher(db, "3442000101", "Zilolaxon", "Karimova")
    make_teacher(db, "998900000101", "Zilola", "Karimova")
    make_teacher(db, "998900000001", "Zilola", "Karimova", dept="Fiziologiya")  # boshqa kafedra
    make_teacher(db, "998900000002", "Zilola", "Karimova", role="student")  # o'qituvchi emas
    make_teacher(db, "998900000003", "Nigora", "Karimova")  # boshqa odam
    db.commit()

    groups = sm.find_groups(db)
    assert len(groups) == 1
    assert {a.username for a in groups[0].accounts} == {"3442000101", "998900000101"}


def test_merge_moves_everything_and_deactivates_duplicate(db):
    from sqlalchemy import select

    from app.models.content import StaffCourseSelection
    from app.models.face_template import FaceTemplate
    from app.models.prepared_content import PreparedContent
    from app.models.staff_merge_log import StaffMergeLog
    from app.models.staff_pinfl import StaffPinfl
    from app.models.user import User

    a = make_teacher(db, "3442000101", "Zilolaxon", "Karimova", logged_in=False)
    b = make_teacher(db, "998900000101", "Zilola", "Karimova")
    fan1, fan2 = add_syllabus(db, "Gigiyena"), add_syllabus(db, "Epidemiologiya")
    # Ikkalasida ham "Gigiyena" bor (takror), faqat ikkinchisida "Epidemiologiya".
    db.add_all([
        StaffCourseSelection(owner_key=a.username, syllabus_id=fan1.id, variant_label="", selected_at=NOW),
        StaffCourseSelection(owner_key=b.username, syllabus_id=fan1.id, variant_label="", selected_at=NOW),
        StaffCourseSelection(owner_key=b.username, syllabus_id=fan2.id, variant_label="", selected_at=NOW),
        PreparedContent(
            owner_key=b.username, kind="lecture", topic="T", topic_norm="t", payload={},
            created_at=dt.datetime.now(dt.timezone.utc),
        ),
        FaceTemplate(source_person_id="p1", embedding="[]", owner_key=b.username),
        StaffPinfl(pinfl="30000000000099", full_name="Karimova Zilolaxon", owner_key=a.username, link_source="face"),
    ])
    db.commit()

    group = sm.find_groups(db)[0]
    assert group.primary == "3442000101"  # JSHSHIR shu hisobga bog'langan
    assert group.suggest_copy_password  # asosiysi hali kirilmagan, ikkinchisini odam ishlatgan

    old_hash = b.password
    result = sm.merge(db, "3442000101", ["998900000101"], actor="admin", copy_password=True)
    db.commit()

    assert result[0]["moved"]["core_staffcourseselection.owner_key"] == 1
    assert result[0]["skipped_duplicates"] == 1
    mine = db.execute(select(StaffCourseSelection).where(StaffCourseSelection.owner_key == "3442000101")).scalars().all()
    assert {m.syllabus_id for m in mine} == {fan1.id, fan2.id}
    assert not db.execute(select(StaffCourseSelection).where(StaffCourseSelection.owner_key == "998900000101")).first()
    assert db.execute(select(PreparedContent).where(PreparedContent.owner_key == "3442000101")).first()
    assert db.execute(select(FaceTemplate.owner_key)).scalar_one() == "3442000101"
    # profil bitta qoldi, JSHSHIR joyida
    from app.models.staff_location import StaffProfile

    assert db.execute(select(StaffProfile.owner_key)).scalars().all().count("998900000101") == 0
    assert db.get(StaffPinfl, "30000000000099").owner_key == "3442000101"

    users = {u.username: u for u in db.execute(select(User)).scalars()}
    assert users["998900000101"].is_active is False
    assert users["3442000101"].is_active is True
    assert users["3442000101"].password == old_hash  # odam o'z paroli bilan kira oladi
    log = db.execute(select(StaffMergeLog)).scalar_one()
    assert (log.primary_key, log.merged_key, log.pinfl) == ("3442000101", "998900000101", "30000000000099")
    # birlashgandan keyin nomzod qolmadi
    assert sm.find_groups(db) == []


def test_different_jshshir_blocks_the_merge(db):
    from app.models.staff_pinfl import StaffPinfl

    a = make_teacher(db, "3442000001", "Dilnoza", "Sodiqova")
    b = make_teacher(db, "998901112233", "Dilnoza", "Sodiqova")
    db.add_all([
        StaffPinfl(pinfl="30000000000001", owner_key=a.username, link_source="face"),
        StaffPinfl(pinfl="30000000000002", owner_key=b.username, link_source="face"),
    ])
    db.commit()
    group = sm.find_groups(db)[0]
    assert group.blocked
    with pytest.raises(sm.MergeError):
        sm.merge(db, a.username, [b.username], actor="admin")


def test_only_teachers_and_no_self_merge(db):
    a = make_teacher(db, "3442000001", "Dilnoza", "Sodiqova")
    s = make_teacher(db, "998900000009", "Dilnoza", "Sodiqova", role="student")
    db.commit()
    with pytest.raises(sm.MergeError):
        sm.merge(db, a.username, [s.username], actor="admin")
    with pytest.raises(sm.MergeError):
        sm.merge(db, a.username, [a.username], actor="admin")


def test_one_account_cannot_hold_two_jshshir(db):
    from sqlalchemy.exc import IntegrityError

    from app.models.staff_pinfl import StaffPinfl

    make_teacher(db, "3442000001", "Dilnoza", "Sodiqova")
    db.add(StaffPinfl(pinfl="30000000000001", owner_key="3442000001"))
    db.commit()
    db.add(StaffPinfl(pinfl="30000000000002", owner_key="3442000001"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # bog'lanmaganlar ko'p bo'lishi mumkin
    db.add_all([StaffPinfl(pinfl="30000000000003"), StaffPinfl(pinfl="30000000000004")])
    db.commit()


def test_face_login_writes_the_jshshir_link(db):
    from app.models.face_template import FaceTemplate
    from app.models.person_identity import PersonIdentity
    from app.models.staff_pinfl import StaffPinfl
    from app.services import staff_pinfl

    make_teacher(db, "3442000101", "Zilolaxon", "Karimova")
    make_teacher(db, "3442000002", "Boshqa", "Odam")
    db.add(PersonIdentity(source_id="p1", kind="xodim", pinfl="30000000000099", full_name="Karimova Zilolaxon"))
    db.add(FaceTemplate(source_person_id="p1", embedding="[]", owner_key="3442000101"))
    db.commit()

    assert staff_pinfl.link_from_face(db, "3442000101", "p1") == "30000000000099"
    db.commit()
    assert db.get(StaffPinfl, "30000000000099").owner_key == "3442000101"
    assert staff_pinfl.pinfl_for(db, "3442000101") == "30000000000099"
    # bog'langan JSHSHIR boshqa hisobga o'tmaydi
    assert staff_pinfl.link_from_face(db, "3442000002", "p1") == ""
    assert db.get(StaffPinfl, "30000000000099").owner_key == "3442000101"


def test_hourly_sync_can_move_an_account_between_jshshirs(db):
    """Unikal cheklov bor: hisob eski JSHSHIRdan yangisiga o'tganda saqlash buzilmasligi kerak."""
    from app.models.staff_pinfl import StaffPinfl
    from app.services import staff_pinfl

    make_teacher(db, "3442000010", "Ali", "Valiyev")
    db.add(StaffPinfl(pinfl="30000000000001", full_name="Soliyev Karim Ahmadovich", owner_key="3442000010", link_source="name"))
    db.commit()
    rows = [
        {"id": "a", "full_name": "Soliyev Karim Ahmadovich", "position": "", "pinfl": "30000000000001"},
        {"id": "b", "full_name": "Valiyev Ali Karimovich", "position": "", "pinfl": "30000000000002"},
    ]
    result = staff_pinfl.sync_pinfl(db, rows)
    assert db.get(StaffPinfl, "30000000000002").owner_key == "3442000010"
    assert db.get(StaffPinfl, "30000000000001").owner_key == ""
    assert result.changed_links[0][1:] == ("3442000010", "") or any(c[2] == "3442000010" for c in result.changed_links)
