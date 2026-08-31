"""Jonli test xizmatining sof funksiyalari.

Bu yerdagi to'rt funksiya baholash zanjirining o'zagi: talaba nima ko'radi,
qanday ball oladi va qachon "tugallandi" hisoblanadi. Ular DB'ga tegmaydi,
shuning uchun testlar ham hech qanday fixture talab qilmaydi.

Asosiy xavf — o'ylanmagan kiritma: AI qaytargan JSON'da `correctOptionIndex`
string bo'lishi, savol dict emas balki null bo'lishi yoki javoblar ro'yxati
savollardan qisqa bo'lishi mumkin. Shu holatlarda ham 500 emas, mantiqiy
natija chiqishi kerak.
"""

from app.services.live_test_service import (
    build_wrong_answers,
    is_complete_draft,
    score_submission,
    strip_questions_for_student,
)


def q(correct, options=("a", "b", "c", "d"), question="Savol?"):
    return {"question": question, "options": list(options), "correctOptionIndex": correct}


class TestScoreSubmission:
    def test_hammasi_togri(self):
        questions = [q(0), q(2), q(1)]
        assert score_submission(questions, [0, 2, 1]) == (3, 3)

    def test_qisman_togri(self):
        questions = [q(0), q(2), q(1)]
        assert score_submission(questions, [0, 0, 1]) == (2, 3)

    def test_javoblar_savollardan_qisqa(self):
        # Talaba testni yarim tashlab ketgan — qolgan savollar noto'g'ri, lekin
        # umumiy savollar soni o'zgarmaydi (ball 1/3, 1/1 emas).
        assert score_submission([q(0), q(1), q(2)], [0]) == (1, 3)

    def test_javoblar_savollardan_uzun(self):
        # Ortiqcha javoblar shunchaki e'tiborga olinmaydi.
        assert score_submission([q(0)], [0, 1, 2, 3]) == (1, 1)

    def test_string_indeks_ham_qabul_qilinadi(self):
        # AI JSON'i ba'zan raqamni string qilib qaytaradi.
        assert score_submission([{"correctOptionIndex": "2"}], ["2"]) == (1, 1)

    def test_yaroqsiz_qiymat_yiqitmaydi(self):
        assert score_submission([{"correctOptionIndex": None}], [0]) == (0, 1)
        assert score_submission([{"correctOptionIndex": 0}], ["salom"]) == (0, 1)

    def test_savol_dict_emas(self):
        assert score_submission([None, q(1)], [0, 1]) == (1, 2)

    def test_correctoptionindex_yoq(self):
        # Kalit umuman bo'lmasa -1 bo'ladi va hech qanday javob mos kelmaydi.
        assert score_submission([{"question": "?"}], [0]) == (0, 1)

    def test_bosh_kiritma(self):
        assert score_submission([], []) == (0, 0)
        assert score_submission([q(0)], []) == (0, 1)

    def test_royxat_emas(self):
        assert score_submission([q(0)], None) == (0, 1)
        assert score_submission(None, [0]) == (0, 0)


class TestStripQuestionsForStudent:
    def test_togri_javob_talabaga_ketmaydi(self):
        # Eng muhim tekshiruv: `correctOptionIndex` javob API'sida chiqib
        # qolsa, talaba DevTools'dan barcha javobni ko'radi.
        out = strip_questions_for_student([q(2)])
        assert out == [{"question": "Savol?", "options": ["a", "b", "c", "d"]}]
        assert "correctOptionIndex" not in out[0]

    def test_boshqa_maxfiy_maydonlar_ham_tushib_qoladi(self):
        item = q(1)
        item["explanation"] = "To'g'ri javob b, chunki..."
        item["answer"] = "b"
        out = strip_questions_for_student([item])
        assert set(out[0]) == {"question", "options"}

    def test_manbalar_saqlanadi(self):
        item = q(0)
        item["references"] = ["Dermatologiya, 42-bet"]
        assert strip_questions_for_student([item])[0]["references"] == ["Dermatologiya, 42-bet"]

    def test_bosh_manbalar_qoshilmaydi(self):
        item = q(0)
        item["references"] = []
        assert "references" not in strip_questions_for_student([item])[0]

    def test_notogri_turdagi_yozuvlar_tashlanadi(self):
        assert strip_questions_for_student([None, "matn", q(0)]) == [
            {"question": "Savol?", "options": ["a", "b", "c", "d"]}
        ]

    def test_options_royxat_emas(self):
        assert strip_questions_for_student([{"question": "?", "options": "abc"}]) == [
            {"question": "?", "options": []}
        ]


class TestBuildWrongAnswers:
    def test_har_bir_savolga_notogri_variant(self):
        questions = [q(0), q(3)]
        wrong = build_wrong_answers(questions)
        assert wrong == [1, 0]
        # Ta'rif bo'yicha: hech biri to'g'ri bo'lmasin.
        assert score_submission(questions, wrong) == (0, 2)

    def test_variantsiz_savol(self):
        assert build_wrong_answers([{"correctOptionIndex": 0, "options": []}]) == [0]

    def test_dict_emas(self):
        assert build_wrong_answers([None]) == [0]


class TestIsCompleteDraft:
    def test_toliq(self):
        assert is_complete_draft([0, 1, 2], 3) is True

    def test_kam_javob(self):
        assert is_complete_draft([0, 1], 3) is False

    def test_manfiy_javob_tanlanmagan_deb_qaraladi(self):
        assert is_complete_draft([0, -1, 2], 3) is False

    def test_savol_yoq(self):
        assert is_complete_draft([], 0) is False

    def test_royxat_emas(self):
        assert is_complete_draft(None, 3) is False

    def test_butun_son_emas(self):
        assert is_complete_draft(["0", 1, 2], 3) is False
