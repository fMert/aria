"""Unit tests for inner-thoughts parsing and retry logic."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from aria import (
    parse_response,
    _call_with_retry,
    _format_history_for_summary,
    make_client,
)
from openai import RateLimitError, APIConnectionError


# ---------------------------------------------------------------------------
# parse_response
# ---------------------------------------------------------------------------

VALID = """<inner_thoughts>
She seems nervous. I wonder what's going on with her.
</inner_thoughts>
<reply>
hey! what's up?
</reply>"""

def test_parse_valid():
    inner, reply = parse_response(VALID)
    assert "nervous" in inner
    assert "hey" in reply


def test_parse_strips_whitespace():
    raw = "<inner_thoughts>  hello  </inner_thoughts><reply>  world  </reply>"
    inner, reply = parse_response(raw)
    assert inner == "hello"
    assert reply == "world"


def test_parse_missing_inner_raises():
    with pytest.raises(ValueError):
        parse_response("<reply>hi</reply>")


def test_parse_missing_reply_raises():
    with pytest.raises(ValueError):
        parse_response("<inner_thoughts>thinking</inner_thoughts>")


def test_parse_empty_raises():
    with pytest.raises(ValueError):
        parse_response("")


def test_parse_case_insensitive():
    raw = "<INNER_THOUGHTS>thought</INNER_THOUGHTS><REPLY>reply</REPLY>"
    inner, reply = parse_response(raw)
    assert inner == "thought"
    assert reply == "reply"


def test_parse_extra_text_around_tags():
    raw = "Some preamble\n<inner_thoughts>ok</inner_thoughts>\n<reply>hi</reply>\ntrailing"
    inner, reply = parse_response(raw)
    assert inner == "ok"
    assert reply == "hi"


# ---------------------------------------------------------------------------
# Retry logic
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_retry_succeeds_on_first():
    client = AsyncMock()
    mock_resp = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=mock_resp)

    result = await _call_with_retry(client, model="gpt-4o", messages=[])
    assert result is mock_resp
    assert client.chat.completions.create.call_count == 1


@pytest.mark.asyncio
async def test_retry_retries_on_connection_error():
    client = AsyncMock()
    call = client.chat.completions.create
    mock_resp = MagicMock()

    call.side_effect = [
        APIConnectionError(request=MagicMock()),
        APIConnectionError(request=MagicMock()),
        mock_resp,
    ]

    with patch("aria.time.sleep"):
        result = await _call_with_retry(client, model="gpt-4o", messages=[])
    assert result is mock_resp


@pytest.mark.asyncio
async def test_retry_exhausted_raises():
    client = AsyncMock()
    client.chat.completions.create.side_effect = APIConnectionError(request=MagicMock())

    with patch("aria.time.sleep"), pytest.raises(Exception):
        await _call_with_retry(client, model="gpt-4o", messages=[])


# ---------------------------------------------------------------------------
# Summary formatting — inner thoughts must never leak into the summarizer input
# ---------------------------------------------------------------------------

def test_format_history_strips_inner_thoughts():
    history = [
        {"role": "user", "content": "hi there"},
        {
            "role": "assistant",
            "content": "<inner_thoughts>secret feelings</inner_thoughts><reply>hey you</reply>",
        },
    ]
    out = _format_history_for_summary(history)
    assert "Participant: hi there" in out
    assert "Aria: hey you" in out
    assert "secret feelings" not in out
    assert "inner_thoughts" not in out


def test_format_history_handles_malformed_assistant():
    history = [{"role": "assistant", "content": "no tags at all"}]
    out = _format_history_for_summary(history)
    assert "Aria: no tags at all" in out


# ---------------------------------------------------------------------------
# Provider client factory — OpenAI vs Gemini (OpenAI-compatible endpoint)
# ---------------------------------------------------------------------------

def test_make_client_openai_default():
    c = make_client("openai", "test-key")
    assert "api.openai.com" in str(c.base_url)


def test_make_client_gemini_uses_compat_endpoint():
    c = make_client("gemini", "test-key")
    assert "generativelanguage.googleapis.com" in str(c.base_url)


def test_make_client_unknown_provider_falls_back_to_openai():
    c = make_client("something-else", "test-key")
    assert "api.openai.com" in str(c.base_url)
