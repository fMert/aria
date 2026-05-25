"""50-turn integration test with mocked OpenAI."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

import files as f
from aria import aria_chat, parse_response


def _make_mock_client(reply_text: str):
    """Build a mock AsyncOpenAI that returns a formatted Aria response."""
    client = AsyncMock()
    usage = MagicMock()
    usage.prompt_tokens = 500
    usage.completion_tokens = 80
    usage.total_tokens = 580

    choice = MagicMock()
    choice.message.content = reply_text

    response = MagicMock()
    response.choices = [choice]
    response.usage = usage

    client.chat.completions.create = AsyncMock(return_value=response)
    return client


def _make_aria_response(n: int) -> str:
    return (
        f"<inner_thoughts>Turn {n} — thinking about what they said.</inner_thoughts>"
        f"<reply>turn {n} reply</reply>"
    )


@pytest.mark.asyncio
async def test_50_turn_conversation(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "DATA_ROOT", tmp_path)
    participant_id = "integration_test"

    # Seed mirror and love files
    f.write_mirror(participant_id, "I have green eyes and dark hair.")
    # No need to seed love — defaults to 5

    history: list[dict] = []
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0}

    async def mock_summarize(conversation: str) -> str:
        return "[summary of earlier messages]"

    for turn in range(1, 51):
        reply_text = _make_aria_response(turn)
        client = _make_mock_client(reply_text)

        with patch("aria.time.sleep"):
            inner, reply, usage = await aria_chat(
                client=client,
                participant_id=participant_id,
                history=history,
                user_message=f"User message #{turn}",
                model="gpt-4o",
                observer_summarize_fn=mock_summarize,
            )

        assert f"turn {turn} reply" in reply
        assert f"Turn {turn}" in inner
        total_usage["prompt_tokens"] += usage["prompt_tokens"]
        total_usage["completion_tokens"] += usage["completion_tokens"]

    # History should have been summarized (turns > SUMMARY_THRESHOLD)
    # After summarization, history length should be bounded
    # With KEEP_VERBATIM=10, after 50 turns history contains summary + 10*2 messages
    # Plus additional turns since last summary; exact count varies but should be < 50*2
    assert len(history) < 100, f"History grew too large: {len(history)}"

    # Session log should have 50 message events
    log_path = f.session_log_path(participant_id)
    assert log_path.exists()
    lines = [l for l in log_path.read_text().splitlines() if l.strip()]
    message_events = [l for l in lines if '"type": "message"' in l]
    assert len(message_events) == 50

    # Love file should exist and have valid structure
    love_data = f.read_love(participant_id)
    assert 0 <= love_data["value"] <= 10


@pytest.mark.asyncio
async def test_malformed_response_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "DATA_ROOT", tmp_path)
    participant_id = "malformed_test"
    f.write_mirror(participant_id, "test mirror")

    # Response missing tags — should fall back gracefully
    client = _make_mock_client("Hello there, no tags here.")
    history: list[dict] = []

    inner, reply, usage = await aria_chat(
        client=client,
        participant_id=participant_id,
        history=history,
        user_message="hi",
        model="gpt-4o",
    )

    assert reply == "Hello there, no tags here."
    assert inner == ""


@pytest.mark.asyncio
async def test_love_stays_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "DATA_ROOT", tmp_path)
    pid = "love_bound_test"

    for i in range(20):
        f.update_love(pid, 3, f"attempt {i}")

    data = f.read_love(pid)
    assert data["value"] == 10
