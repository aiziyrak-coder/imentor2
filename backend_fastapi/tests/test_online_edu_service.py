"""Online ta'lim yordamchilari — mavzu qidirish, ruxsat va baholash.

Bu funksiyalar talabaga NIMA ko'rinishini va qanday ball olishini hal
qiladi, shuning uchun ular bazasiz, alohida sinaladi.
"""

import pytest

from app.models.online_edu import OnlineSyllabus
from app.services.online_edu_service import (
    new_room_name,
    score_answers,
    slugify_subject,
    strip_test_for_student,
    topic_by_code,
    topic_title,
    topics_for,
    variant_labels,
)


def syllabus(topics=None, variants=None):
    s = OnlineSyllabus()
    s.topics = topics if topics is not None else []
    s.variants = variants if variants is not None else []
    return s


class TestTopicsFor:
    def test_variantsiz_sillabus(self):
        s = syllabus(topics=[{"code": "1", "title": "Kirish"}])
        assert topics_for(s) == [{"code": "1", "title": "Kirish"}]

    def test_variant_bo_yicha(self):
        s = syllabus(
            topics=[{"code": "1", "title": "Umumiy"}],
            variants=[
                {"label": "davolash", "topics": [{"code": "d1", "title": "Davolash mavzusi"}]},
                {"label": "pediatriya", "topics": [{"code": "p1", "title": "Pediatriya mavzusi"}]},
            ],
        )
        assert topics_for(s, "pediatriya")[0]["code"] == "p1"

    def test_topilmagan_variant_umumiyga_qaytadi(self):
        s = syllabus(
            topics=[{"code": "1", "title": "Umumiy"}],
            variants=[{"label": "davolash", "topics": [{"code": "d1", "title": "X"}]}],
        )
        assert topics_for(s, "yo-q-variant")[0]["code"] == "1"

    def test_yaroqsiz_yozuvlar_tashlanadi(self):
        s = syllabus(topics=[None, "matn", {"code": "1", "title": "Bor"}])
        assert topics_for(s) == [{"code": "1", "title": "Bor"}]

    def test_bo_sh_sillabus(self):
        assert topics_for(syllabus()) == []


class TestTopicLookup:
    def test_kod_bo_yicha_topiladi(self):
        s = syllabus(topics=[{"code": "a3", "title": "Amaliy 3"}])
        assert topic_by_code(s, "", "a3")["title"] == "Amaliy 3"
        assert topic_title(s, "", "a3") == "Amaliy 3"

    def test_bo_sh_joylar_e_tiborga_olinmaydi(self):
        s = syllabus(topics=[{"code": " a3 ", "title": "Amaliy 3"}])
        assert topic_by_code(s, "", "a3") is not None

    def test_topilmasa_none(self):
        s = syllabus(topics=[{"code": "1", "title": "X"}])
        assert topic_by_code(s, "", "999") is None
        assert topic_title(s, "", "999") == ""


class TestVariantLabels:
    def test_yig_iladi_va_takrorlanmaydi(self):
        s = syllabus(variants=[
            {"label": "davolash", "topics": []},
            {"label": "davolash", "topics": []},
            {"label": "pediatriya", "topics": []},
        ])
        assert variant_labels(s) == ["davolash", "pediatriya"]

    def test_bo_sh_nom_tashlanadi(self):
        s = syllabus(variants=[{"label": "  ", "topics": []}, {"label": "bor", "topics": []}])
        assert variant_labels(s) == ["bor"]


class TestRoomName:
    def test_har_safar_boshqacha(self):
        # Xona nomi taxmin qilinadigan bo'lsa, uni bilgan har kim darsga
        # qo'shila oladi — shuning uchun tasodifiylik SHART.
        names = {new_room_name() for _ in range(50)}
        assert len(names) == 50

    def test_url_uchun_xavfsiz(self):
        for _ in range(20):
            name = new_room_name()
            assert name.replace("-", "").isalnum()
            assert 10 <= len(name) <= 40


class TestScoreAnswers:
    def test_hammasi_togri(self):
        qs = [{"correctOptionIndex": 0}, {"correctOptionIndex": 2}]
        assert score_answers(qs, [0, 2]) == (2, 2)

    def test_yarim_tashlab_ketilgan(self):
        qs = [{"correctOptionIndex": 0}] * 10
        assert score_answers(qs, [0, 0]) == (2, 10)

    def test_string_indeks(self):
        assert score_answers([{"correctOptionIndex": "1"}], ["1"]) == (1, 1)

    def test_yaroqsiz_qiymat_yiqitmaydi(self):
        assert score_answers([{"correctOptionIndex": None}], [0]) == (0, 1)
        assert score_answers([{"correctOptionIndex": 0}], ["salom"]) == (0, 1)

    def test_bo_sh(self):
        assert score_answers([], []) == (0, 0)
        assert score_answers(None, [0]) == (0, 0)


class TestStripTestForStudent:
    def test_togri_javob_ketmaydi(self):
        out = strip_test_for_student([
            {"question": "Savol?", "options": ["a", "b"], "correctOptionIndex": 1}
        ])
        assert out == [{"question": "Savol?", "options": ["a", "b"]}]
        assert "correctOptionIndex" not in out[0]

    def test_izoh_va_javob_maydonlari_ham_ketmaydi(self):
        out = strip_test_for_student([
            {
                "question": "S",
                "options": ["a"],
                "correctOptionIndex": 0,
                "explanation": "chunki...",
                "answer": "a",
            }
        ])
        assert set(out[0]) == {"question", "options"}

    def test_yaroqsiz_yozuv(self):
        assert strip_test_for_student([None, "matn"]) == []

    def test_options_royxat_emas(self):
        assert strip_test_for_student([{"question": "S", "options": "abc"}]) == [
            {"question": "S", "options": []}
        ]


class TestSlugify:
    @pytest.mark.parametrize(
        "name,expected",
        [
            ("Ichki kasalliklar", "ichki-kasalliklar"),
            ("Oftalmologiya DI 10-s", "oftalmologiya-di-10-s"),
            ("  bo'sh   joylar  ", "bo-sh-joylar"),
            ("", "fan"),
            ("!!!", "fan"),
        ],
    )
    def test_kod_hosil_qilish(self, name, expected):
        assert slugify_subject(name) == expected

    def test_uzunligi_cheklangan(self):
        assert len(slugify_subject("a" * 200)) <= 56
