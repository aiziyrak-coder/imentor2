import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import face_login as fl
from app.services import monitor_schedule_service as svc

HEADER = [
    "Hafta boshi sanasi", "Kafedra", "Monitor/xona", "Hafta kuni", "Para", "Boshlanish", "Tugash",
    "O‘qituvchi F.I.Sh", "Telefon/Login", "Fan", "Guruh", "Dars turi", "Tasdiq holati", "Izoh", "Import kalit",
]
DEPT = "Mikrobiologiya, virusologiya va immunologiya kafedrasi"
OTHER = "Kommunal va mehnat gigiyenasi kafedrasi"

MONITORS = [
    {"monitor_id": "MON-010", "department": DEPT, "department_keys": [svc._norm(DEPT)],
     "room_full": "YuKSHQO'B \n(1-qavat) 106-auditoriya", "building": "", "room": "106"},
    {"monitor_id": "MON-011", "department": DEPT, "department_keys": [svc._norm(DEPT)],
     "room_full": "YuKSHQO'B \n(1-qavat) 108- auditoriya", "building": "", "room": "108"},
    {"monitor_id": "MON-020", "department": OTHER, "department_keys": [svc._norm(OTHER)],
     "room_full": "Oq uy 2 qavat 204-xona", "building": "", "room": "204"},
]


def user(username, last, first):
    return SimpleNamespace(username=username, last_name=last, first_name=first)


USERS = [
    user("998888248688", "Xomidova", "Mohichehra"),
    user("3442311132", "Ruzaliyev", "Komiljon"),
    user("998906308266", "Boretskaya", "Alisa"),
    user("998947751303", "O‘lmasova", "Dinora"),
    user("998911521303", "Nazirova", "Xusnijaxon"),
    user("998999938300", "Rasulov", "Ulug‘bek"),
]


def sheet(*rows):
    return [["iMentor haftalik monitor bandligi"], ["izoh"], HEADER, *rows]


def row(room, weekday, para, teacher, phone, group="DI 4125", status="Bo‘sh", dept=DEPT):
    return ["2026-09-21", dept, room, weekday, para, "", "", teacher, phone, "Mikrobiologiya", group, "amaliy", status, "", ""]


def run_import(rows, allowed=None):
    db = MagicMock()
    with patch.object(svc, "monitors", return_value=MONITORS), \
         patch.object(fl, "_face_login_users", return_value=USERS), \
         patch.object(fl, "_account_info", return_value={}):
        result = svc.import_rows(db, rows, source_file="mikro.xlsx", imported_by="rektor", allowed_departments=allowed)
    added = [c.args[0] for c in db.add.call_args_list]
    return result, added, db


def test_filled_rows_count_even_when_status_left_empty():
    result, added, db = run_import(sheet(
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "5-para", "Boretskaya Alisa", "90 630 82 66"),
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "6-para", "", "", status="Bo‘sh"),
    ))
    assert result["imported_rows"] == 1
    assert added[0].teacher_username == "998906308266" and added[0].status == "Band"
    assert added[0].week_start == dt.date(2026, 9, 21)
    db.commit.assert_called_once()


def test_two_teachers_in_one_cell_become_two_entries_with_their_groups():
    _, added, _ = run_import(sheet(
        row("YuKSHQO'B (1-qavat) 108- auditoriya", "Seshanba", "5-para",
            "Nazirova xusnijaxon        Rasulov Ulug'bek", "911521303", group="DI 3025 sur'at        TPI 824"),
    ))
    assert [(a.teacher_name, a.group_name) for a in added] == [
        ("Nazirova xusnijaxon", "DI 3025 sur'at"), ("Rasulov Ulug'bek", "TPI 824"),
    ]
    assert added[0].teacher_username == "998911521303"
    assert added[1].teacher_username == "998999938300"  # telefoni yozilmagan — ism bo'yicha


def test_wrong_phone_does_not_link_to_someone_else():
    # Jadvalda O'lmasova qatoriga Boretskayaning raqami yozilgan.
    _, added, _ = run_import(sheet(
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Chorshanba", "3-para", "o'lmasova Dinora", "90 630 82 66"),
    ))
    assert added[0].teacher_username == "998947751303"


def test_room_spelling_differences_and_unknown_rooms():
    result, added, _ = run_import(sheet(
        row("YuKSHQO'B  (1-qavat)  108 - auditoriya", "Juma", "1-para", "Boretskaya Alisa", ""),
        row("Noma'lum xona", "Juma", "2-para", "Boretskaya Alisa", ""),
    ))
    assert [a.monitor_id for a in added] == ["MON-011"]
    assert result["unmatched_rooms"] == [f"{DEPT} — Noma'lum xona"]


def test_only_departments_present_in_file_are_replaced_and_cancelled_rows_skipped():
    result, added, db = run_import(sheet(
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Payshanba", "2-para", "Boretskaya Alisa", "", status="Bekor qilindi"),
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Payshanba", "3-para", "Boretskaya Alisa", ""),
    ))
    assert len(added) == 1
    assert [d["department"] for d in result["departments"]] == [DEPT]
    db.query.return_value.filter.return_value.delete.assert_called_once()


def test_dean_cannot_import_other_departments():
    result, added, _ = run_import(sheet(
        row("Oq uy 2 qavat 204-xona", "Dushanba", "1-para", "Boretskaya Alisa", "", dept=OTHER),
    ), allowed=[DEPT])
    assert added == [] and result["forbidden_departments"] == [OTHER]


def test_not_a_template_file():
    with pytest.raises(ValueError):
        run_import([["Ism", "Familiya"], ["a", "b"]])


def test_slot_counts_as_used_only_when_teacher_acted_during_that_para():
    entry = SimpleNamespace(
        monitor_id="MON-010", weekday="Dushanba", para="1-para", teacher_name="Boretskaya Alisa",
        teacher_username="998906308266", subject="Mikro", group_name="DI", lesson_type="amaliy", status="Band",
        department=DEPT, imported_at=dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc), source_file="f.xlsx",
    )
    second = SimpleNamespace(**{**entry.__dict__, "para": "2-para"})
    tz = svc.TASHKENT
    # 2026-09-21 dushanba: 1-para 08:00-09:20 ichida jonli test, 2-parada hech narsa.
    events = {"998906308266": [(dt.datetime(2026, 9, 21, 8, 30, tzinfo=tz), 24)]}
    with patch.object(svc, "monitors", return_value=MONITORS[:1]), \
         patch.object(svc, "_load_schedule", return_value=[entry, second]), \
         patch.object(svc, "_usage_events", return_value=events), \
         patch.object(svc, "inventory", return_value={}):
        report = svc.build_report(MagicMock(), date_from="2026-09-21", date_to="2026-09-21")
    assert report["totals"]["planned_slots"] == 2
    assert report["totals"]["used_slots"] == 1
    teacher = report["teachers"][0]
    assert teacher["planned_slots"] == 2 and teacher["used_slots"] == 1 and teacher["students"] == 24
    assert report["schedule_imported"] is True and report["imports"][0]["rows"] == 2


def test_double_space_inside_one_name_and_russified_o_apostrophe():
    _, added, _ = run_import(sheet(
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Payshanba", "3-para", "Xomidova  Moxichehra", "888248688"),
        row("YuKSHQO'B (1-qavat) 106-auditoriya", "Juma", "1-para", "Ro'zaliyev Komiljon", "933744722"),
    ))
    assert [(a.teacher_name, a.teacher_username) for a in added] == [
        ("Xomidova Moxichehra", "998888248688"),
        ("Ro'zaliyev Komiljon", "3442311132"),
    ]


def test_initials_resolve_only_to_one_person_in_the_same_department():
    users = [
        user("998900000001", "Malikov", "Nemat"),
        user("3442000002", "Malikov", "Ergashali"),
        user("998900000003", "Malikov", "Nodir"),  # boshqa kafedra
        user("3442000004", "Sharapov", "Ilxamberdi"),
    ]
    info = {
        "998900000001": {"department": DEPT},
        "3442000002": {"department": DEPT},
        "998900000003": {"department": OTHER},
        "3442000004": {"department": "Mikrobiologiya, virusologiya va immunologiya"},
    }
    db = MagicMock()
    with patch.object(svc, "monitors", return_value=MONITORS), \
         patch.object(fl, "_face_login_users", return_value=users), \
         patch.object(fl, "_account_info", return_value=info):
        svc.import_rows(db, sheet(
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "1-para", "N.Malikov", ""),
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "2-para", "Sharapov I.K.", ""),
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "3-para", "M,Malikov", ""),
        ))
    added = [c.args[0] for c in db.add.call_args_list]
    assert [a.teacher_username for a in added] == ["998900000001", "3442000004", ""]


def test_extra_rooms_get_fixed_ids_after_sequential_ones():
    inv = {"departments": [
        {"row": 1, "department": "A kafedrasi", "rooms": ["1-xona"], "extra_rooms": [{"monitor_id": "MON-100", "room": "9-xona"}]},
        {"row": 2, "department": "B kafedrasi", "rooms": ["2-xona"]},
    ]}
    with patch.object(svc, "inventory", return_value=inv):
        ids = [(m["monitor_id"], m["room_full"]) for m in svc.monitors()]
    assert ids == [("MON-001", "1-xona"), ("MON-002", "2-xona"), ("MON-100", "9-xona")]


def test_report_for_one_teacher_keeps_only_their_lessons():
    base = dict(
        monitor_id="MON-010", weekday="Dushanba", subject="Mikro", group_name="DI", lesson_type="amaliy",
        status="Band", department=DEPT, imported_at=dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc), source_file="f.xlsx",
    )
    mine = SimpleNamespace(**base, para="1-para", teacher_name="Boretskaya Alisa", teacher_username="998906308266")
    other = SimpleNamespace(**base, para="2-para", teacher_name="Rasulov Ulug'bek", teacher_username="998999938300")
    with patch.object(svc, "monitors", return_value=MONITORS[:1]), \
         patch.object(svc, "_load_schedule", return_value=[mine, other]), \
         patch.object(svc, "_usage_events", return_value={}), \
         patch.object(svc, "inventory", return_value={}):
        report = svc.build_report(MagicMock(), date_from="2026-09-21", date_to="2026-09-21", teacher="998906308266")
    assert [t["teacher_key"] for t in report["teachers"]] == ["998906308266"]
    assert [s["para"] for s in report["slots"] if s["planned"]] == ["1-para"]


def test_schedule_counts_only_from_its_week_start():
    entry = SimpleNamespace(
        monitor_id="MON-010", weekday="Dushanba", para="1-para", teacher_name="Boretskaya Alisa",
        teacher_username="998906308266", subject="Mikro", group_name="DI", lesson_type="amaliy", status="Band",
        department=DEPT, imported_at=dt.datetime(2026, 9, 17, tzinfo=dt.timezone.utc), source_file="f.xlsx",
        week_start=dt.date(2026, 9, 21),
    )
    with patch.object(svc, "monitors", return_value=MONITORS[:1]), \
         patch.object(svc, "_load_schedule", return_value=[entry]), \
         patch.object(svc, "_usage_events", return_value={}), \
         patch.object(svc, "inventory", return_value={}):
        before = svc.build_report(MagicMock(), date_from="2026-09-07", date_to="2026-09-18")
        after = svc.build_report(MagicMock(), date_from="2026-09-14", date_to="2026-09-25")
    # Jadval 21-sentyabr haftasi uchun — undan oldingi dushanbalarda "ishlatilmadi" bo'lmaydi.
    assert before["totals"]["planned_slots"] == 0
    assert before["monitors"][0]["schedule_from"] == "2026-09-21"
    assert after["totals"]["planned_slots"] == 1


def test_twin_accounts_close_spelling_and_blank_department():
    users = [
        user("3440000002", "Axmadaliyev", "Rustamjon"),
        user("998900000828", "Axmadaliyev", "Rustam"),
        user("3442000036", "Axmadjonova", "Gulhaiyo"),
        user("3442000028", "Nazarova", "Yorqinoy"),
    ]
    info = {u.username: {"department": DEPT, "activity": 0, "last_login": None} for u in users}
    info["998900000828"]["activity"] = 5  # telefon hisobi ishlatilmoqda
    db = MagicMock()
    with patch.object(svc, "monitors", return_value=MONITORS), \
         patch.object(fl, "_face_login_users", return_value=users), \
         patch.object(fl, "_account_info", return_value=info):
        svc.import_rows(db, sheet(
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "1-para", "Axmadaliyev R", ""),
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "2-para", "Ahmadjonova Gulhayo", ""),
            row("YuKSHQO'B (1-qavat) 106-auditoriya", "Dushanba", "3-para", "Y.Nazarova", "", dept=""),
        ))
    added = [c.args[0] for c in db.add.call_args_list]
    assert [a.teacher_username for a in added] == ["998900000828", "3442000036", "3442000028"]


def test_planned_lessons_by_teacher_counts_only_scheduled_weekdays_from_their_week():
    import datetime as dt
    from types import SimpleNamespace
    from unittest.mock import patch
    from app.services import monitor_schedule_service as ms

    def row(user, weekday, week, monitor="MON-001"):
        return SimpleNamespace(teacher_username=user, weekday=weekday, para="5-para", week_start=week,
                               imported_at=None, status="Band", monitor_id=monitor, lesson_date=None)

    rows = [
        row("998900400156", "Payshanba", dt.date(2026, 9, 21)),  # Malikov: payshanba/juma
        row("998900400156", "Juma", dt.date(2026, 9, 21)),
        row("3442112021", "Dushanba", dt.date(2026, 9, 14), monitor="MON-002"),  # Saydullayeva: dushanba
    ]
    with patch.object(ms, "_load_schedule", return_value=rows):
        monday = ms.planned_lessons_by_teacher(None, dt.date(2026, 9, 21), dt.date(2026, 9, 21))
        week = ms.planned_lessons_by_teacher(None, dt.date(2026, 9, 21), dt.date(2026, 9, 25))
    assert monday == {"998900400156": 0, "3442112021": 1}
    assert week == {"998900400156": 2, "3442112021": 1}


def test_room_key_ignores_lesson_type_suffix_and_missing_space():
    """2026-09-24: Fiziologiya kafedrasining 13 qatori xona nomi farqi tufayli import bo'lmagan."""
    from app.services import monitor_schedule_service as ms

    inventory = "Asosiy bino (3-bino) 3-qavat28 xona"
    assert ms._room_key(inventory) == ms._room_key("Asosiy bino (3-bino) 3-qavat 28 xona (ma'ruza)")
    assert ms._room_key(inventory) == ms._room_key("Asosiy bino (3-bino) 3-qavat 28 xona (amaliy)")
    # Boshqa xona baribir boshqa bo'lib qoladi.
    assert ms._room_key(inventory) != ms._room_key("Asosiy bino (3-bino) 3-qavat 29 xona")
