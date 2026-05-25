"""Atomic file I/O for diary, mirror, and love state."""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Optional

DATA_ROOT = Path.home() / ".aria"


def participant_dir(participant_id: str) -> Path:
    p = DATA_ROOT / participant_id
    p.mkdir(parents=True, exist_ok=True)
    return p


# ---------------------------------------------------------------------------
# Atomic write helper
# ---------------------------------------------------------------------------

def _atomic_write(path: Path, content: str) -> None:
    """Write to a temp file, fsync, then rename — crash-safe."""
    dir_ = path.parent
    fd, tmp = tempfile.mkstemp(dir=dir_, prefix=".aria_tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Mirror
# ---------------------------------------------------------------------------

def mirror_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "mirror.txt"


def read_mirror(participant_id: str) -> Optional[str]:
    p = mirror_path(participant_id)
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return None


def write_mirror(participant_id: str, content: str) -> None:
    _atomic_write(mirror_path(participant_id), content)


# ---------------------------------------------------------------------------
# Diary
# ---------------------------------------------------------------------------

def diary_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "diary.md"


def read_diary(participant_id: str, max_tokens: Optional[int] = None) -> str:
    """Return the diary. With max_tokens set, return approximately the last
    max_tokens worth of content; otherwise return the whole file."""
    p = diary_path(participant_id)
    if not p.exists():
        return ""
    text = p.read_text(encoding="utf-8").strip()
    if max_tokens is not None:
        # Approximate: 1 token ≈ 4 chars
        char_limit = max_tokens * 4
        if len(text) > char_limit:
            text = text[-char_limit:]
            # Don't split mid-sentence: find first newline
            nl = text.find("\n")
            if nl != -1:
                text = text[nl + 1 :]
    return text


def append_diary(participant_id: str, entry: str) -> None:
    """Atomically append a diary entry."""
    p = diary_path(participant_id)
    existing = p.read_text(encoding="utf-8") if p.exists() else ""
    timestamp = time.strftime("%Y-%m-%d")
    new_content = existing.rstrip() + f"\n\n{timestamp}\n{entry.strip()}\n"
    _atomic_write(p, new_content)


# ---------------------------------------------------------------------------
# Love value
# ---------------------------------------------------------------------------

LOVE_MIN = 0
LOVE_MAX = 10
LOVE_DEFAULT = 5


def love_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "love.json"


def _clamp_love(value: int) -> int:
    return max(LOVE_MIN, min(LOVE_MAX, value))


def read_love(participant_id: str) -> dict:
    p = love_path(participant_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"value": LOVE_DEFAULT, "history": []}


def write_love(participant_id: str, data: dict) -> None:
    _atomic_write(love_path(participant_id), json.dumps(data, indent=2))


def update_love(participant_id: str, delta: int, reason: str) -> int:
    """Apply delta, clamp, persist, return new value."""
    data = read_love(participant_id)
    old = int(data.get("value", LOVE_DEFAULT))
    new = _clamp_love(old + delta)
    if new != old:
        data["value"] = new
        data.setdefault("history", []).append(
            {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "old": old,
                "new": new,
                "delta": new - old,
                "reason": reason,
            }
        )
        write_love(participant_id, data)
    return new


def set_love(participant_id: str, value: int, reason: str = "researcher override") -> int:
    """Force a specific love value (researcher panel)."""
    data = read_love(participant_id)
    old = int(data.get("value", LOVE_DEFAULT))
    new = _clamp_love(value)
    data["value"] = new
    data.setdefault("history", []).append(
        {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "old": old,
            "new": new,
            "delta": new - old,
            "reason": reason,
        }
    )
    write_love(participant_id, data)
    return new


def love_to_disposition(value: int) -> str:
    """Translate numeric love to Aria's felt emotional state."""
    if value <= 2:
        return (
            "You've been feeling distant lately — a little hurt and uncertain. "
            "You're not sure this connection is going where you hoped. "
            "You're warm by nature but you're guarding yourself a bit right now."
        )
    if value <= 4:
        return (
            "You're a little reserved at the moment — cautious, not quite sure "
            "where things stand. You still care, but something has made you pull "
            "back slightly. You're giving things time."
        )
    if value <= 6:
        return (
            "You feel comfortable and at ease. There's a natural warmth between "
            "you. Nothing dramatic — just a settled, good feeling about this person."
        )
    if value <= 8:
        return (
            "You're genuinely smitten. You find yourself thinking about them more "
            "than you'd admit out loud. You light up when they message. "
            "You're a little giddy and you can't fully hide it."
        )
    return (
        "You're deeply in love. This person is constantly in your thoughts. "
        "Everything they say matters to you. You feel it in your chest — "
        "that particular kind of full, overwhelming feeling you can't explain "
        "to anyone who hasn't felt it."
    )


# ---------------------------------------------------------------------------
# Context history (raw role/content pairs fed to the AI)
# ---------------------------------------------------------------------------

def context_history_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "context_history.json"


def read_context_history(participant_id: str) -> list[dict]:
    p = context_history_path(participant_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def write_context_history(participant_id: str, history: list[dict]) -> None:
    _atomic_write(context_history_path(participant_id), json.dumps(history))


# ---------------------------------------------------------------------------
# Chat messages (display-ready, for the UI)
# ---------------------------------------------------------------------------

def chat_messages_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "chat_messages.json"


def read_chat_messages(participant_id: str) -> list[dict]:
    p = chat_messages_path(participant_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def append_chat_exchange(participant_id: str, user_text: str, aria_text: str) -> None:
    """Append one user + one aria message to the persistent display log."""
    import uuid
    ts_now = int(time.time() * 1000)
    messages = read_chat_messages(participant_id)
    messages.append({"id": str(uuid.uuid4()), "from": "user", "text": user_text, "ts": ts_now})
    messages.append({"id": str(uuid.uuid4()), "from": "aria", "text": aria_text, "ts": ts_now + 1})
    _atomic_write(chat_messages_path(participant_id), json.dumps(messages))


# ---------------------------------------------------------------------------
# Conversation language (decided once from the first message, then locked)
# ---------------------------------------------------------------------------

def language_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "language.txt"


def read_language(participant_id: str) -> Optional[str]:
    p = language_path(participant_id)
    if p.exists():
        return p.read_text(encoding="utf-8").strip() or None
    return None


def write_language(participant_id: str, lang: str) -> None:
    _atomic_write(language_path(participant_id), lang)


# ---------------------------------------------------------------------------
# Session log
# ---------------------------------------------------------------------------

def session_log_path(participant_id: str) -> Path:
    return participant_dir(participant_id) / "session.log"


def log_event(participant_id: str, event_type: str, payload: dict) -> None:
    p = session_log_path(participant_id)
    entry = json.dumps(
        {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "type": event_type,
            **payload,
        }
    )
    with open(p, "a", encoding="utf-8") as f:
        f.write(entry + "\n")
