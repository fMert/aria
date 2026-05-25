"""Tests for observer NONE-handling and love-response parsing."""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from observer import ObserverModel


obs = ObserverModel()


# ---------------------------------------------------------------------------
# Love response parsing
# ---------------------------------------------------------------------------

def test_parse_love_zero():
    delta, reason = obs._parse_love_response('{"delta": 0, "reason": "nothing significant"}')
    assert delta == 0


def test_parse_love_positive():
    delta, reason = obs._parse_love_response('{"delta": 1, "reason": "they were kind"}')
    assert delta == 1
    assert "kind" in reason


def test_parse_love_negative():
    delta, reason = obs._parse_love_response('{"delta": -1, "reason": "rude"}')
    assert delta == -1


def test_parse_love_clamps_large_positive():
    delta, _ = obs._parse_love_response('{"delta": 5, "reason": "extreme"}')
    assert delta == 2


def test_parse_love_clamps_large_negative():
    delta, _ = obs._parse_love_response('{"delta": -5, "reason": "extreme"}')
    assert delta == -2


def test_parse_love_malformed_returns_zero():
    delta, reason = obs._parse_love_response("not json at all")
    assert delta == 0
    assert reason == ""


def test_parse_love_with_code_fence():
    raw = "```json\n{\"delta\": 1, \"reason\": \"sweet\"}\n```"
    delta, reason = obs._parse_love_response(raw)
    assert delta == 1


def test_parse_love_empty_string():
    delta, reason = obs._parse_love_response("")
    assert delta == 0


def test_parse_love_single_quotes_fallback():
    # gemma may emit non-strict JSON with single quotes — regex fallback handles it
    delta, reason = obs._parse_love_response("{'delta': 1, 'reason': 'they were sweet'}")
    assert delta == 1
    assert "sweet" in reason


def test_parse_love_echoed_label_fallback():
    delta, _ = obs._parse_love_response('Output: {"delta": -1, "reason": "rude"}')
    assert delta == -1


# ---------------------------------------------------------------------------
# NONE handling in diary is tested via integration; here we test the pattern
# ---------------------------------------------------------------------------

def test_none_string_detection():
    result = "NONE"
    assert result.strip().upper() == "NONE"


def test_non_none_diary_entry():
    result = "She told me her mom is sick. I felt my chest tighten a little."
    assert result.strip().upper() != "NONE"


# ---------------------------------------------------------------------------
# Diary output cleaning — robust NONE handling
# ---------------------------------------------------------------------------

def test_clean_diary_none_plain():
    assert obs._clean_diary_output("NONE") is None


def test_clean_diary_none_with_period():
    assert obs._clean_diary_output("NONE.") is None


def test_clean_diary_none_lowercase():
    assert obs._clean_diary_output("none") is None


def test_clean_diary_none_with_trailing_explanation():
    # A small model often can't resist explaining itself — still means NONE
    assert obs._clean_diary_output("NONE - nothing significant here") is None


def test_clean_diary_none_empty():
    assert obs._clean_diary_output("") is None
    assert obs._clean_diary_output("   ") is None


def test_clean_diary_real_entry():
    entry = obs._clean_diary_output("He told me about his dad. I hope he's okay.")
    assert entry is not None and "dad" in entry


def test_clean_diary_strips_wrapping_quotes():
    assert obs._clean_diary_output('"I think I like this one."') == "I think I like this one."


def test_clean_diary_strips_echoed_label():
    entry = obs._clean_diary_output("Output: I think I like this one.")
    assert entry == "I think I like this one."


# ---------------------------------------------------------------------------
# Prompt template integrity — observer.py uses str.replace(), so templates
# must NOT contain doubled braces (those would reach the model verbatim).
# ---------------------------------------------------------------------------

def test_love_template_has_no_doubled_braces():
    from pathlib import Path
    tpl = (Path(__file__).parent.parent / "prompts" / "observer_love.txt").read_text()
    assert "{{" not in tpl and "}}" not in tpl


def test_observer_templates_keep_required_placeholders():
    from pathlib import Path
    base = Path(__file__).parent.parent / "prompts"
    diary = (base / "observer_diary.txt").read_text()
    love = (base / "observer_love.txt").read_text()
    summary = (base / "observer_summary.txt").read_text()
    for ph in ("{participant_message}", "{inner_thoughts}", "{aria_reply}"):
        assert ph in diary
        assert ph in love
    assert "{current_love}" in love
    assert "{conversation}" in summary
