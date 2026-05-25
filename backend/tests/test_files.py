"""Unit tests for file I/O: atomicity, love clamping, diary, mirror."""

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest

# Allow importing from parent directory
sys.path.insert(0, str(Path(__file__).parent.parent))

import files as f


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(f, "DATA_ROOT", tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# Atomic write
# ---------------------------------------------------------------------------

def test_atomic_write_creates_file(tmp_path):
    target = tmp_path / "test.txt"
    f._atomic_write(target, "hello world")
    assert target.read_text() == "hello world"


def test_atomic_write_no_temp_left(tmp_path):
    target = tmp_path / "out.txt"
    f._atomic_write(target, "content")
    temps = list(tmp_path.glob(".aria_tmp_*"))
    assert len(temps) == 0


def test_atomic_write_overwrites(tmp_path):
    target = tmp_path / "out.txt"
    f._atomic_write(target, "v1")
    f._atomic_write(target, "v2")
    assert target.read_text() == "v2"


# ---------------------------------------------------------------------------
# Love value clamping
# ---------------------------------------------------------------------------

def test_clamp_love_lower():
    assert f._clamp_love(-5) == 0


def test_clamp_love_upper():
    assert f._clamp_love(15) == 10


def test_clamp_love_in_range():
    assert f._clamp_love(7) == 7


def test_update_love_clamps(tmp_data_dir):
    pid = "p1"
    # Start at default 5, apply +999 — must cap at 10
    result = f.update_love(pid, 999, "big delta")
    assert result == 10


def test_update_love_clamps_below(tmp_data_dir):
    pid = "p2"
    result = f.update_love(pid, -999, "huge negative")
    assert result == 0


def test_update_love_records_history(tmp_data_dir):
    pid = "p3"
    f.update_love(pid, 2, "nice moment")
    data = f.read_love(pid)
    assert len(data["history"]) == 1
    assert data["history"][0]["delta"] == 2


def test_set_love_forces_value(tmp_data_dir):
    pid = "p4"
    f.set_love(pid, 9, "researcher")
    assert f.read_love(pid)["value"] == 9


def test_love_starts_at_default(tmp_data_dir):
    pid = "p_new"
    data = f.read_love(pid)
    assert data["value"] == f.LOVE_DEFAULT


# ---------------------------------------------------------------------------
# Mirror
# ---------------------------------------------------------------------------

def test_mirror_roundtrip(tmp_data_dir):
    pid = "m1"
    f.write_mirror(pid, "I have brown eyes")
    assert f.read_mirror(pid) == "I have brown eyes"


def test_mirror_missing_returns_none(tmp_data_dir):
    assert f.read_mirror("nobody") is None


# ---------------------------------------------------------------------------
# Diary
# ---------------------------------------------------------------------------

def test_diary_append_and_read(tmp_data_dir):
    pid = "d1"
    f.append_diary(pid, "Talked to someone interesting today.")
    result = f.read_diary(pid)
    assert "Talked to someone interesting today." in result


def test_diary_multiple_entries_ordered(tmp_data_dir):
    pid = "d2"
    f.append_diary(pid, "First entry.")
    f.append_diary(pid, "Second entry.")
    result = f.read_diary(pid)
    assert result.index("First") < result.index("Second")


def test_diary_token_truncation(tmp_data_dir):
    pid = "d3"
    long_entry = "word " * 10000  # ~10000 words
    f.append_diary(pid, long_entry)
    result = f.read_diary(pid, max_tokens=100)
    # 100 tokens * 4 chars = 400 chars max
    assert len(result) <= 450  # small buffer for newline trim


# ---------------------------------------------------------------------------
# Love disposition
# ---------------------------------------------------------------------------

def test_disposition_low():
    d = f.love_to_disposition(1)
    assert "distant" in d or "hurt" in d


def test_disposition_high():
    d = f.love_to_disposition(10)
    assert "love" in d.lower()


def test_disposition_mid():
    d = f.love_to_disposition(5)
    assert "comfortable" in d or "warmth" in d
