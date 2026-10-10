"""Parolsiz kirish: JSHSHIR va pasportni tanish (2026-10-02).

Parol yo'q — raqamning o'zi kalit. Shuning uchun bu yerdagi eng muhim
tekshiruv: tanib bo'lmaydigan yozuv HECH QACHON kimnidir topmasin.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import person_identity as pi


# ------------------------------------------------------------ JSHSHIR

def test_pinfl_is_exactly_fourteen_digits():
    assert pi.is_pinfl("12345678901234")
    assert pi.is_pinfl("  12345678901234  ")
    assert not pi.is_pinfl("1234567890123")      # 13
    assert not pi.is_pinfl("123456789012345")    # 15
    assert not pi.is_pinfl("1234567890123A")
    assert not pi.is_pinfl("")


# ------------------------------------------------------------ pasport

def test_passport_is_series_plus_number():
    assert pi.parse_passport("AD", "1234567") == ("AD", "1234567")


def test_spaces_dashes_and_lowercase_do_not_matter():
    """Pasportni har kim o'zicha yozadi — bu to'siq bo'lmasin."""
    assert pi.parse_passport("ad", " 123-45 67 ") == ("AD", "1234567")
    assert pi.parse_passport(" A D ", "1234567") == ("AD", "1234567")


def test_cyrillic_lookalikes_are_read_as_latin():
    """Manbada АD (kirill А) uchraydi; odam esa lotincha AD ni tanlaydi."""
    assert pi.parse_passport("АD", "1234567") == ("AD", "1234567")
    assert pi.parse_passport("АС", "1234567") == ("AC", "1234567")


def test_series_glued_to_the_number_is_split_correctly():
    """Manbada seriya ustuniga `AD06` kabi yozilgan qatorlar bor."""
    assert pi.parse_passport("AD06", "12345") == ("AD", "0612345")
    assert pi.parse_passport("", "AD1234567") == ("AD", "1234567")


def test_unreadable_passport_is_refused_not_guessed():
    assert pi.parse_passport("", "") is None
    assert pi.parse_passport("AD", "") is None
    assert pi.parse_passport("", "1234567") is None      # seriyasiz
    assert pi.parse_passport("76", "1234567") is None    # seriya harf emas
    assert pi.parse_passport("AD", "123") is None        # juda qisqa
    assert pi.parse_passport("ABCD", "1234567") is None  # 3 harfdan ko'p


def test_every_uzbek_series_is_offered():
    assert "AA" in pi.SERIES_CHOICES
    assert "AB" in pi.SERIES_CHOICES
    assert "AD" in pi.SERIES_CHOICES
    assert "AE" in pi.SERIES_CHOICES
    assert "AF" in pi.SERIES_CHOICES
    assert len(set(pi.SERIES_CHOICES)) == len(pi.SERIES_CHOICES)


# ------------------------------------------------------------ qidiruv

def _db(rows):
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = list(rows)
    return db


def test_one_match_signs_in():
    person = SimpleNamespace(full_name="AZIZOV A.", kind="xodim")
    assert pi.by_pinfl(_db([person]), "12345678901234") is person


def test_two_people_on_one_number_sign_in_nobody():
    """Ma'lumotdagi xato tufayli boshqa odamning hisobiga tushib qolmasin."""
    two = [SimpleNamespace(full_name="A"), SimpleNamespace(full_name="B")]
    assert pi.by_pinfl(_db(two), "12345678901234") is None
    assert pi.by_passport(_db(two), "AD", "1234567") is None


def test_a_malformed_value_never_reaches_the_database():
    db = _db([SimpleNamespace(full_name="A")])
    assert pi.by_pinfl(db, "notapinfl") is None
    assert pi.by_passport(db, "76", "1234567") is None
    db.execute.assert_not_called()
