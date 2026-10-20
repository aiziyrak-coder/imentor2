from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.routes.prepared_content import _test_awaiting_enrichment
from app.models.prepared_content import KIND_CASE, KIND_TEST, PreparedContent
from app.services import case_i18n
from app.services import openai_client as oai


def test_test_translate_model_default_and_allowlist(monkeypatch):
    monkeypatch.delenv("OPENAI_TEST_TRANSLATE_MODEL", raising=False)
    assert oai.test_translate_model() == "gpt-4.1-mini"
    monkeypatch.setenv("OPENAI_TEST_TRANSLATE_MODEL", "gpt-5.4-mini")
    assert oai.test_translate_model() == "gpt-5.4-mini"
    monkeypatch.setenv("OPENAI_TEST_TRANSLATE_MODEL", "gpt-5.5-pro")
    assert oai.test_translate_model() == "gpt-4.1-mini"


def _translate_with(kind, payload):
    seen = []

    def fake(api_key, model, items, target, **kw):
        seen.append(model)
        return None  # tarjima bo'lmadi — faqat model tanlovi tekshiriladi

    settings = SimpleNamespace(openai_api_key="k", openai_fast_model="gpt-4.1-nano")
    with patch.object(case_i18n, "get_settings", return_value=settings), \
         patch.object(case_i18n, "_translate_strings", side_effect=fake), \
         patch.object(case_i18n, "_translate_question", return_value=None):
        case_i18n.ensure_translations(MagicMock(), PreparedContent(id=1, kind=kind, payload=payload), ("ru",))
    return set(seen)


def test_tests_and_cases_are_translated_with_test_model(monkeypatch):
    monkeypatch.delenv("OPENAI_TEST_TRANSLATE_MODEL", raising=False)
    test_payload = {"primaryLanguage": "uz", "questions": [{"question": "Qaysi biri to'g'ri?", "options": ["a", "b"], "correctOptionIndex": 0}]}
    case_payload = {"primaryLanguage": "uz", "questions": [{"scenario": "Bemor keldi", "answer": "javob"}]}
    assert _translate_with(KIND_TEST, test_payload) == {"gpt-4.1-mini"}
    assert _translate_with(KIND_CASE, case_payload) == {"gpt-4.1-mini"}


def test_first_test_save_waits_for_option_explanations():
    brief = {"questions": [{"question": "q", "options": ["a", "b"]}]}
    enriched = {"questions": [{"question": "q", "options": ["a", "b"], "optionExplanations": ["x", "y"]}]}
    assert _test_awaiting_enrichment(KIND_TEST, brief) is True
    assert _test_awaiting_enrichment(KIND_TEST, enriched) is False
    assert _test_awaiting_enrichment(KIND_CASE, brief) is False
    assert _test_awaiting_enrichment(KIND_TEST, {"questions": []}) is False
