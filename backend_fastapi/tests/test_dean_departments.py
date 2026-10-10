"""Dekanga o'z kafedralari ko'rinishi (2026-10-05).

Davolash ishi dekani hisobotga kirganda bitta ham kafedra chiqmasdi: institut
hujjatidagi yozilish HEMIS'dagi yozilishga mos kelmasdi va nomlar AYNAN
solishtirilardi.
"""

from app.services.dean_access import DEANS, match_departments, norm_department

# HEMIS hisobotda aynan shunday yozadi (serverdan olingan, 2026-10-05).
HEMIS = [
    "Akusherlik va ginekologiya",
    "Anesteziologiya va reanimotologiya, Pediatriya-2",
    "Biotibbiyot muhandisligi, biofizika va axborot texnologiyalari",
    "Dermatovenerologiya va allergologiya",
    "Endokrinologiya, gematologiya kafedrasi",
    "Epidemiyologiya va yuqumli kasalliklar, hamshiralik ishi",
    "Fakultativ  terapiya (UASH)",
    "Fakultet va gospital jarrohlik",
    "Fiziologiya",
    "Gistologiya va biologiya",
    "Gospital terapiya (laboratoriya)",
    "Ichki kasalliklar propedevtikasi",
    "Ijtimoiy fanlar",
    "Kommunal va mehnat gigienasi",
    "Lotin tili, pedagogika va psixologiya",
    "Mikrobiologiya, virusologiya va immunologiya",
    "Nevrologiya va psixiatriya",
    "O'zbek va xorijiy tillar",
    "Ovqatlanish,  bolalar va o'smirlar gigiyenasi",
    "Patologik fiziologiya va patologik anatomiya",
    "Pediatriya",
    "Preventiv tibbiyot asoslari, jamoat salomatligi, jismoniy tarbiya va sport",
    "Stomatologiya va otoloringologiya",
    "Tibbiy va biologik kimyo",
    "Travmatologiya va ortopediya",
    "Umumiy jarrohlik",
    "Urologiya va onkologiya",
    "Xalq tabobati va farmakologiya",
    "Yu. Nishonov nomidagi Normal anatomiya",
]


def test_the_treatment_dean_sees_all_eight_departments():
    """Fakultet sanab bergan sakkizta kafedra — bittasi ham tushib qolmasin."""
    got = match_departments(DEANS["dekan_davolash"].departments, HEMIS)
    assert sorted(got) == sorted([
        "Akusherlik va ginekologiya",
        "Fakultativ  terapiya (UASH)",
        "Fakultet va gospital jarrohlik",
        "Gospital terapiya (laboratoriya)",
        "Ichki kasalliklar propedevtikasi",
        "Travmatologiya va ortopediya",
        "Umumiy jarrohlik",
        "Yu. Nishonov nomidagi Normal anatomiya",
    ])


def test_the_spellings_that_used_to_fail():
    """Har biri alohida — qaysi biri buzilsa, shu nom aytiladi."""
    pairs = [
        ("Umumiy xirurgiya", "Umumiy jarrohlik"),
        ("Terapiya UASH", "Fakultativ  terapiya (UASH)"),
        ("Normal anatomiya", "Yu. Nishonov nomidagi Normal anatomiya"),
        ("Gospital terapiya", "Gospital terapiya (laboratoriya)"),
        ("Fakultativ va gospital jarrohlik", "Fakultet va gospital jarrohlik"),
        ("Travmatologiya", "Travmatologiya va ortopediya"),
        ("Ichki kasallilar propedevtikasi", "Ichki kasalliklar propedevtikasi"),
    ]
    for wanted, actual in pairs:
        assert match_departments([wanted], HEMIS) == [actual], wanted


def test_a_one_word_name_does_not_swallow_a_longer_one():
    """"Fiziologiya" "Patologik fiziologiya"ni tortib olmasin — ular boshqa kafedra."""
    assert match_departments(["Fiziologiya"], HEMIS) == ["Fiziologiya"]


def test_pediatrics_two_is_a_separate_department_and_is_found():
    got = match_departments(["Pediatriya 2"], HEMIS)
    assert got == ["Anesteziologiya va reanimotologiya, Pediatriya-2"]


def test_every_dean_sees_something():
    for login, dean in DEANS.items():
        assert match_departments(dean.departments, HEMIS), login


def test_an_unknown_department_matches_nothing():
    assert match_departments(["Kosmonavtika kafedrasi"], HEMIS) == []


def test_normalisation_ignores_case_apostrophes_and_filler_words():
    assert norm_department("Ichki kasalliklar propedevtikasi kafedrasi") == norm_department(
        "ICHKI KASALLIKLAR PROPEDEVTIKASI"
    )
    assert norm_department("O'zbek va xorijiy tillar") == norm_department(
        "O‘zbek va xorijiy tillar kafedrasi"
    )
