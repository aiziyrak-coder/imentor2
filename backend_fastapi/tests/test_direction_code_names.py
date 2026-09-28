"""Yo'nalish kodi fan nomining boshidagi to'liq nomdan ham aniqlanadi (2026-09-26)."""

import pytest

from app.services.direction_code import infer_direction_code, normalize_direction_code


@pytest.mark.parametrize("name, code", [
    ("Davolash ishi 2026-2027 (Milliy) 5-semestr Patologik anatomiya", "DI"),
    ("Pediatriya ishi 2026-2027 (Milliy) 1-semestr ODAM ANATOMIYASI", "PI"),
    ("Tibbiy profilaktika ishi 3 kurs (Milliy) 5- semestr", "TPI"),
    ("Farmatsiya 2025-2026 (Milliy) 4-semestr Analitik kimyo", "F"),
    ("Stomatologiya 2024-2025 (Milliy) 3-semestr", "S"),
    ("Normal fiziologiya TPI 4s", "TPI"),      # qisqa kod ustun
    ("Davolash ishi 2026 Pediatriya", "DI"),    # faqat nom boshi hisoblanadi
    ("Ijtimoiy fanlar", ""),
])
def test_direction_from_the_start_of_the_name(name, code):
    assert infer_direction_code(name) == code


def test_full_name_written_as_code_is_normalised():
    assert normalize_direction_code("Stomatologiya yo'nalishi") == "S"
    assert normalize_direction_code("Pediatriya yo‘nalishi") == "PI"
    assert normalize_direction_code("DI") == "DI"
