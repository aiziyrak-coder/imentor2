"""Keys sifati (2026-10-20): model yo'nalishi va tarjimada fikrlash yorliqlari."""
from app.services import case_i18n
from app.services import openai_client as oai


def test_case_purposes_use_test_models(monkeypatch):
    monkeypatch.delenv("OPENAI_TEST_GENERATE_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TEST_REVIEW_MODEL", raising=False)
    assert oai.model_for("case_generate") == "gpt-5.4-mini"
    assert oai.model_for("case_review") == "gpt-5.4-mini"
    monkeypatch.setenv("OPENAI_TEST_REVIEW_MODEL", "gpt-5.4")
    assert oai.model_for("case_review") == "gpt-5.4"
    # Boshqa vazifalar arzon modelda qoladi.
    assert oai.model_for("online_case_review") == "gpt-4.1-nano"


def test_reasoning_labels_are_protected_and_localized():
    src = "### Differensial tahlil\nFIKR YO'LI: A + B -> C.\nAppenditsit — QO'LLAB: og'riq; RAD: periton simptomlari **yo'q**."
    protected = case_i18n._protect_headings(src)
    assert "QO'LLAB" not in protected and "RAD:" not in protected and "FIKR" not in protected
    assert "§L" in protected
    ru = case_i18n._restore_headings(protected, "ru")
    assert "ХОД РАССУЖДЕНИЯ" in ru and "ЗА:" in ru and "ПРОТИВ:" in ru
    en = case_i18n._restore_headings(protected, "en")
    assert "REASONING" in en and "FOR:" in en and "AGAINST:" in en
    # ruscha manbadan o'zbekchaga
    back = case_i18n._restore_headings(case_i18n._protect_headings("Аппендицит — ЗА: боль; ПРОТИВ: нет"), "uz")
    assert "QO'LLAB:" in back and "RAD:" in back


def test_ordinary_words_are_not_labels():
    text = "Rad etuvchi dalil va for loop: oddiy so'zlar, радиус за рулём"
    assert case_i18n._protect_headings(text) == text


def test_new_case_headings_translate():
    out = case_i18n._restore_headings(case_i18n._protect_headings("### Topshiriq\n1) Savol?"), "ru")
    assert out.startswith("### Задание")
