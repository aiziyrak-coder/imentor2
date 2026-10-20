import json
from unittest.mock import MagicMock, patch

import pytest
import requests

from app.api.routes import education_ai as route
from app.services import openai_client as oai


def _sse(*texts, finish="stop"):
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': t}}]})}" for t in texts]
    lines.append(f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': finish}]})}")
    lines.append("data: [DONE]")
    resp = MagicMock(status_code=200)
    resp.iter_lines.return_value = lines
    return resp


def _http_error(status, message="boom"):
    resp = MagicMock(status_code=status, text=message)
    resp.json.return_value = {"error": {"message": message}}
    return resp


def _run(side_effect):
    with patch.object(oai.requests, "post", side_effect=side_effect) as post, patch.object(oai.time, "sleep"):
        text = "".join(oai.stream_openai_chat("k", messages=[{"role": "user", "content": "x"}]))
    return text, post.call_count


def test_stream_retries_network_error_and_5xx_before_first_token():
    text, calls = _run([requests.ConnectionError("reset"), _http_error(503), _sse("Ma'", "ruza")])
    assert text == "Ma'ruza"
    assert calls == 3


def test_stream_gives_up_after_three_attempts():
    with pytest.raises(oai.OpenAiClientError):
        _run([requests.ReadTimeout("t")] * 3)


def test_stream_does_not_retry_bad_request_or_quota():
    with pytest.raises(oai.OpenAiClientError):
        _run([_http_error(400, "bad"), _sse("x")])
    with pytest.raises(oai.OpenAiClientError) as exc:
        _run([_http_error(429, "You exceeded your current quota"), _sse("x")])
    assert str(exc.value) == oai.QUOTA_EXHAUSTED_MESSAGE


def test_stream_does_not_retry_after_text_was_sent():
    broken = _sse("bosh")
    broken.iter_lines.return_value = broken.iter_lines.return_value[:1]  # yakunlanmay uzildi
    with pytest.raises(oai.OpenAiClientError):
        _run([broken, _sse("qayta")])


def test_keepalive_pings_while_waiting_and_reports_errors(monkeypatch):
    import threading

    monkeypatch.setattr(route, "STREAM_KEEPALIVE_SECONDS", 0.05)
    release = threading.Event()

    def slow():
        release.wait(1)
        yield "matn"
        raise oai.OpenAiClientError("AI stream ended before completion. Please retry.")

    events = []
    for kind, value in route._with_keepalive(slow):
        events.append(kind)
        if kind == "ping":
            release.set()
    assert events[0] == "ping"
    assert events[-2:] == ["text", "error"]
