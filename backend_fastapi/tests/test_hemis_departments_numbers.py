"""Raqami farq qiladigan kafedralar birlashtirilmaydi (2026-09-26)."""

from app.services import hemis_departments as h

HEMIS = ["Pediatriya", "Anesteziologiya va reanimotologiya, Pediatriya-2", "Fiziologiya"]
BY = {h.norm(n): {"name": n} for n in HEMIS}


def test_pediatriya_2_is_its_own_department():
    found, how = h.match("Pediatriya 2", BY)
    assert found["name"] == "Anesteziologiya va reanimotologiya, Pediatriya-2" and how == "qo'lda"


def test_a_number_never_matches_by_similarity_alone():
    found, _ = h.match("Fiziologiya 2", BY)
    assert found is None


def test_plain_names_still_match():
    assert h.match("Pediatriya kafedrasi", BY)[0]["name"] == "Pediatriya"
    assert h.match("Pediatriya 1", BY)[0]["name"] == "Pediatriya"
