from unittest.mock import MagicMock, patch

import pytest

from app.services import openai_client as oai


def test_quota_exhausted_is_not_retried_and_message_is_clear():
    resp = MagicMock(status_code=429, content=b"x")
    resp.json.return_value = {"error": {"message": "You have no credits remaining. Add credits to continue using the API."}}
    with patch.object(oai.requests, "post", return_value=resp):
        with pytest.raises(oai.OpenAiClientError) as err:
            oai._http_post("k", {}, url="u")
    assert str(err.value) == oai.QUOTA_EXHAUSTED_MESSAGE
    assert not oai._is_rate_limited(str(err.value))
    assert oai._is_rate_limited("HTTP 429: Rate limit reached for requests")
