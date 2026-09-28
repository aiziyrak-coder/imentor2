"""HEMIS dars jadvali → monitor bandligi (2026-09-25)."""

import datetime as dt
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import hemis_schedule as hs
from app.services import monitor_schedule_service as ms

MONITORS = [
    {"monitor_id": "MON-001", "department": "Kommunal va mehnat gigiyenasi kafedrasi",
     "room_full": "Oq uy 2 qavat 204-xona", "department_keys": []},
    {"monitor_id": "MON-059", "department": "Tibbiy va biologik kimyo kafedrasi",
     "room_full": "Asosiy (1-bino) 3-Qavat 308-xona", "department_keys": []},
]

AUDITORIUMS = [
    # HEMIS'da bitta fizik xona ikki yozuvda turadi — ikkalasi ham shu monitorga.
    {"code": 939, "name": "204", "building": {"name": "Oq uy binosi"}},
    {"code": 467, "name": "204 (Oq uy)", "building": {"name": "Oq uy binosi"}},
    {"code": 800, "name": "308", "building": {"name": "1-Oʻquv bino"}},
    # Boshqa binodagi bir xil raqam — aralashib ketmasligi kerak.
    {"code": 801, "name": "204", "building": {"name": "Farg'ona viloyat teri-tanosil dispanseri"}},
]


def lesson(**kw):
    base = {
        "id": 1, "auditorium": {"code": 939}, "employee": {"id": 461, "name": "MADOLIMOV A. M."},
        "lessonPair": {"name": "3"}, "trainingType": {"name": "Ma’ruza"},
        "subject": {"name": "Gigiyena"}, "group": {"name": "TPI-823"},
        "lesson_date": int(dt.datetime(2026, 9, 22, 6, 0, tzinfo=dt.timezone.utc).timestamp()),
    }
    return {**base, **kw}


def test_rooms_match_by_building_and_number_including_duplicate_records():
    with patch.object(ms, "monitors", return_value=MONITORS):
        rooms = hs.room_map(AUDITORIUMS)
    assert [m["monitor_id"] for m in rooms[939]] == ["MON-001"]
    assert [m["monitor_id"] for m in rooms[467]] == ["MON-001"]
    assert [m["monitor_id"] for m in rooms[800]] == ["MON-059"]
    # Boshqa binodagi "204" bizning monitorga ulanmaydi.
    assert 801 not in rooms


def test_room_shared_by_two_departments_goes_to_the_lesson_s_own_monitor():
    """3-bino 26-xona inventarda ikki kafedraga yozilgan — dars o'z kafedrasining monitoriga."""
    shared = [
        {"monitor_id": "MON-084", "department": "Fiziologiya kafedrasi",
         "room_full": "Asosiy bino (3-bino) 3-qavat 26 xona", "department_keys": ["fiziologiya kafedrasi"]},
        {"monitor_id": "MON-091", "department": "Patologik fiziologiya va patologik anatomiya kafedrasi",
         "room_full": "Asosiy bino (3-bino) 3-qavat 26 xona",
         "department_keys": ["patologik fiziologiya va patologik anatomiya kafedrasi"]},
    ]
    assert hs.pick_monitor(shared, "Fiziologiya")["monitor_id"] == "MON-084"
    assert hs.pick_monitor(shared, "Patologik fiziologiya va patologik anatomiya")["monitor_id"] == "MON-091"
    # Uchinchi kafedraning darsi bo'lsa — taxmin qilinmaydi.
    assert hs.pick_monitor(shared, "Gistologiya va biologiya") is None
    assert hs.pick_monitor(shared[:1], "Boshqa kafedra")["monitor_id"] == "MON-084"


def _staff_db(rows):
    """(login, ism, familiya, rol) qatorlari — `teacher_map` so'roviga javob."""
    db = MagicMock()
    db.execute.return_value.all.return_value = rows
    return db


def test_teacher_is_linked_by_staff_id_number():
    db = _staff_db([("3432111064", "Aziz", "Azizov", "hodim"), ("998911185759", "Bobur", "Boburov", "hodim")])
    people = [
        {"id": 361, "employee_id_number": "3432111064", "full_name": "AZIZOV AZIZ"},
        {"id": 999, "employee_id_number": "0000000000", "full_name": "NOMALUM ODAM"},  # iMentor'da yo'q
        {"id": 12, "employee_id_number": "", "full_name": ""},
    ]
    assert hs.teacher_map(db, people, used=set()) == {361: "3432111064"}


def test_phone_login_teacher_is_linked_by_unique_name():
    """2026-09-26: Xoliqov Qahramon telefon raqami bilan ro'yxatdan o'tgan —
    Xodim ID bo'yicha topilmay, hisobotda "hisobi yo'q" chiqardi."""
    db = _staff_db([("998884137755", "Qahramon", "Xoliqov", "hodim")])
    people = [{"id": 161, "employee_id_number": "3442011050", "full_name": "XOLIQOV QAHRAMON NU’MONOVICH"}]
    stats: dict = {}
    assert hs.teacher_map(db, people, stats=stats, used=set()) == {161: "998884137755"}
    assert stats["ism_boyicha_boglandi"] == 1


def test_h_and_x_spellings_are_the_same_name():
    db = _staff_db([("998900000001", "Qahramon", "Holiqov", "hodim")])
    people = [{"id": 161, "employee_id_number": "3442011050", "full_name": "XOLIQOV QAHRAMON"}]
    assert hs.teacher_map(db, people, used=set()) == {161: "998900000001"}


def test_namesakes_are_never_guessed():
    """Ikki tomonda ham yagona bo'lmasa — bog'lanmaydi."""
    two_accounts = _staff_db([("998900000001", "Aziz", "Karimov", "hodim"),
                              ("998900000002", "Aziz", "Karimov", "hodim")])
    people = [{"id": 5, "employee_id_number": "1", "full_name": "KARIMOV AZIZ"}]
    assert hs.teacher_map(two_accounts, people, used=set()) == {}

    one_account = _staff_db([("998900000001", "Aziz", "Karimov", "hodim")])
    two_people = [{"id": 5, "employee_id_number": "1", "full_name": "KARIMOV AZIZ A."},
                  {"id": 6, "employee_id_number": "2", "full_name": "KARIMOV AZIZ B."}]
    assert hs.teacher_map(one_account, two_people, used=set()) == {}


def test_student_or_other_staff_login_is_not_taken():
    # Talaba hisobi va boshqa HEMIS xodimining Xodim ID si bo'lgan hisob ulanmaydi.
    db = _staff_db([("ot_344251100543", "Qahramon", "Xoliqov", "student"),
                    ("3442011099", "Qahramon", "Xoliqov", "hodim")])
    people = [{"id": 161, "employee_id_number": "3442011050", "full_name": "XOLIQOV QAHRAMON"},
              {"id": 170, "employee_id_number": "3442011099", "full_name": "BOSHQA ODAM"}]
    assert hs.teacher_map(db, people, used=set()) == {170: "3442011099"}


def test_lesson_becomes_entry_with_exact_day_and_para():
    with patch.object(ms, "monitors", return_value=MONITORS):
        rooms = hs.room_map(AUDITORIUMS)
    entries, stats = hs.build_entries(
        [lesson()], rooms, {461: "3442112018"},
        start=dt.date(2026, 9, 21), end=dt.date(2026, 9, 27),
    )
    (e,) = entries
    assert (e.monitor_id, e.weekday, e.para) == ("MON-001", "Seshanba", "3-para")
    assert e.lesson_date == dt.date(2026, 9, 22) and e.week_start == dt.date(2026, 9, 21)
    assert e.teacher_username == "3442112018" and e.lesson_type == "Ma'ruza"
    assert e.source_file == "hemis" and e.hemis_id == "1" and e.status == "Band"
    assert stats["yozuv"] == 1 and stats["oqituvchisi_boglanmadi"] == 0


def test_lessons_outside_range_or_without_monitor_are_skipped():
    with patch.object(ms, "monitors", return_value=MONITORS):
        rooms = hs.room_map(AUDITORIUMS)
    lessons = [
        lesson(id=2, auditorium={"code": 801}),  # monitorsiz xona
        lesson(id=3, lesson_date=int(dt.datetime(2026, 8, 1, 6, 0, tzinfo=dt.timezone.utc).timestamp())),
        lesson(id=4, lessonPair={"name": ""}),
        lesson(id=5, employee={"id": 777, "name": "NOMA'LUM X. Y."}),  # hisobi yo'q — baribir saqlanadi
    ]
    entries, stats = hs.build_entries(lessons, rooms, {461: "3442112018"},
                                      start=dt.date(2026, 9, 21), end=dt.date(2026, 9, 27))
    assert stats["monitorsiz_xona"] == 1 and stats["sanasi_oraliqdan_tashqari"] == 1
    assert stats["parasi_yoq"] == 1 and stats["oqituvchisi_boglanmadi"] == 1
    assert [e.hemis_id for e in entries] == ["5"] and entries[0].teacher_username == ""


def test_same_lesson_twice_is_stored_once():
    with patch.object(ms, "monitors", return_value=MONITORS):
        rooms = hs.room_map(AUDITORIUMS)
    entries, _ = hs.build_entries([lesson(), lesson()], rooms, {},
                                  start=dt.date(2026, 9, 21), end=dt.date(2026, 9, 27))
    assert len(entries) == 1


# ------------------------------------------------- hisobotda HEMIS Excel'dan ustun


def entry(source, day=None, user="998900400156"):
    return SimpleNamespace(teacher_username=user, weekday="Seshanba", para="3-para",
                           week_start=dt.date(2026, 9, 21), imported_at=None, status="Band",
                           monitor_id="MON-001", lesson_date=day, source_file=source)


def test_hemis_entry_wins_over_excel_in_the_same_slot():
    """Bitta slotda ikkalasi ham bo'lsa, dars ikki marta hisoblanmasin."""
    rows = [entry("Excel.xlsx"), entry("hemis", day=dt.date(2026, 9, 22))]
    with patch.object(ms, "_load_schedule", return_value=rows):
        out = ms.planned_lessons_by_teacher(None, dt.date(2026, 9, 22), dt.date(2026, 9, 22))
    assert out == {"998900400156": 1}


def test_hemis_entry_counts_only_on_its_own_day():
    """Excel har hafta takrorlanadi, HEMIS yozuvi esa faqat o'z kunida."""
    rows = [entry("hemis", day=dt.date(2026, 9, 22))]
    with patch.object(ms, "_load_schedule", return_value=rows):
        same = ms.planned_lessons_by_teacher(None, dt.date(2026, 9, 22), dt.date(2026, 9, 22))
        later = ms.planned_lessons_by_teacher(None, dt.date(2026, 9, 29), dt.date(2026, 9, 29))
    assert same == {"998900400156": 1}
    assert later == {"998900400156": 0}


def test_saturday_is_a_working_day():
    assert "Shanba" in ms.WEEKDAYS
    assert dt.date(2026, 9, 26) in ms._dates(dt.date(2026, 9, 21), dt.date(2026, 9, 27))
    assert dt.date(2026, 9, 27) not in ms._dates(dt.date(2026, 9, 21), dt.date(2026, 9, 27))
    assert "7-para" in ms.PERIOD_TIMES


def test_lessons_go_to_the_account_the_person_actually_uses():
    """Xodim ID hisobi ochilgan, lekin ishlatilmagan; telefon hisobi faol."""
    db = _staff_db([("3442412029", "Aziza", "Karimova", "hodim"), ("998939850428", "Aziza", "Karimova", "hodim")])
    people = [{"id": 7, "employee_id_number": "3442412029", "full_name": "KARIMOVA AZIZA"}]
    stats: dict = {}
    assert hs.teacher_map(db, people, stats=stats, used={"998939850428"}) == {7: "998939850428"}
    assert stats["faol_hisobga_otkazildi"] == 1


def test_used_staff_id_account_is_kept():
    db = _staff_db([("3442412029", "Aziza", "Karimova", "hodim"), ("998939850428", "Aziza", "Karimova", "hodim")])
    people = [{"id": 7, "employee_id_number": "3442412029", "full_name": "KARIMOVA AZIZA"}]
    assert hs.teacher_map(db, people, used={"3442412029", "998939850428"}) == {7: "3442412029"}
