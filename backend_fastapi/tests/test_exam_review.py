import json
from unittest.mock import patch

from app.services import exam_review
from app.services import openai_client as oai


def _q(text, ci=0):
    return {"text": text, "options": ["a1", "b2", "c3", "d4", "e5"], "correctIndex": ci, "explanation": "x"}


def test_exam_purposes_route_to_their_models(monkeypatch):
    monkeypatch.delenv("OPENAI_EXAM_REVIEW_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TEST_GENERATE_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_TEST_REVIEW_MODEL", raising=False)
    assert oai.model_for("exam_review") == "gpt-5.4"
    assert oai.model_for("exam_generate") == "gpt-5.4-mini"
    assert oai.model_for("test_repair") == "gpt-5.4-mini"
    # Keys 2026-10-20 dan test modellarida; boshqa vazifalar arzon modelda.
    assert oai.model_for("case_generate") == "gpt-5.4-mini"
    assert oai.model_for("handout_infographic") == "gpt-4.1-nano"


def test_exam_review_model_env_is_allowlisted(monkeypatch):
    monkeypatch.setenv("OPENAI_EXAM_REVIEW_MODEL", "gpt-5.4-mini")
    assert oai.model_for("exam_review") == "gpt-5.4-mini"
    monkeypatch.setenv("OPENAI_EXAM_REVIEW_MODEL", "gpt-5.5-pro")
    assert oai.model_for("exam_review") == "gpt-5.4"


def test_review_keeps_ok_applies_fix_and_drops_bad():
    reply = json.dumps(
        {
            "reviews": [
                {"i": 1, "verdict": "ok"},
                {"i": 2, "verdict": "fix", "text": "new", "options": ["p", "q", "r", "s", "t"], "correctIndex": 3, "explanation": "e"},
                {"i": 3, "verdict": "drop"},
                # Buzuq tuzatish (bir xil variantlar) — olib tashlanadi.
                {"i": 4, "verdict": "fix", "text": "z", "options": ["p", "p", "r", "s", "t"], "correctIndex": 0},
            ]
        }
    )
    qs = [_q("one"), _q("two"), _q("three"), _q("four"), _q("five")]
    with patch.object(oai, "generate_openai_chat", return_value=reply) as call:
        out = exam_review.review_exam_questions("k", qs, subject="s", department="d", lang_name="o'zbek")
    assert call.call_args.kwargs["model"] == oai.model_for("exam_review")
    assert call.call_args.kwargs["usage_kind"] == "exam_review"
    assert [q["text"] for q in out] == ["one", "new", "five"]
    assert out[1]["correctIndex"] == 3 and out[1]["options"][3] == "s"


def test_review_failure_returns_questions_unchanged():
    qs = [_q("one"), _q("two")]
    with patch.object(oai, "generate_openai_chat", side_effect=oai.OpenAiClientError("HTTP 500")):
        assert exam_review.review_exam_questions("k", qs, subject="s", department="d", lang_name="o'zbek") == qs
    with patch.object(oai, "generate_openai_chat", return_value="not json"):
        assert exam_review.review_exam_questions("k", qs, subject="s", department="d", lang_name="o'zbek") == qs


def test_presentation_purposes_keep_their_model():
    assert oai.model_for("presentation_generate") == "gpt-4.1-mini"
    assert oai.model_for("presentation_language_repair") == "gpt-4.1-nano"


def test_review_chunks_map_back_to_the_right_questions():
    def reply(api_key, *, messages, **kw):
        # Har bo'lakda 2-savol tashlanadi: 7 savol → bo'laklar 1–5 va 6–7.
        return json.dumps({"reviews": [{"i": 2, "verdict": "drop"}]})

    qs = [_q(f"q{n}") for n in range(1, 8)]
    with patch.object(oai, "generate_openai_chat", side_effect=reply) as call:
        out = exam_review.review_exam_questions("k", qs, subject="s", department="d", lang_name="o'zbek")
    assert call.call_count == 2
    assert [q["text"] for q in out] == ["q1", "q3", "q4", "q5", "q6"]
