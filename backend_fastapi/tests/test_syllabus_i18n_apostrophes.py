"""Tarjimada ikkilangan tutuq belgisi (2026-09-26): "Yallig''lanish"."""

from app.services.syllabus_i18n import fix_doubled_apostrophes


def test_doubled_apostrophe_inside_a_word_is_fixed():
    assert fix_doubled_apostrophes("Yallig''lanish, o''zgarishi") == "Yallig'lanish, o'zgarishi"


def test_quotes_and_normal_apostrophes_are_left_alone():
    assert fix_doubled_apostrophes("''Klinik'' holat") == "''Klinik'' holat"
    assert fix_doubled_apostrophes("O'zbek tili") == "O'zbek tili"
    assert fix_doubled_apostrophes("") == ""
