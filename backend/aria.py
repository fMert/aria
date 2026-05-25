"""Main model orchestration — Aria's voice via OpenAI."""

from __future__ import annotations

import asyncio
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from openai import AsyncOpenAI, RateLimitError, APIConnectionError, APIStatusError

from files import (
    read_mirror,
    read_diary,
    read_love,
    love_to_disposition,
    log_event,
    participant_dir,
    write_mirror,
    read_chat_messages,
    read_language,
    write_language,
)

PROMPT_DIR = Path(__file__).parent / "prompts"
SYSTEM_TEMPLATE = (PROMPT_DIR / "aria_system.txt").read_text(encoding="utf-8")

# Gemini and Ollama both expose OpenAI-compatible endpoints.
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1"


class AriaGenerationError(RuntimeError):
    """The model failed to produce a usable reply — empty output, or a
    response truncated by the token limit. The turn is not persisted; the
    caller should surface a retryable error instead of a blank message."""


def make_client(provider: str, api_key: str) -> AsyncOpenAI:
    """Build an OpenAI-compatible async client for the chosen provider.

    provider: "openai" | "gemini" | "ollama"
    """
    if provider == "gemini":
        return AsyncOpenAI(api_key=api_key, base_url=GEMINI_BASE_URL)
    if provider == "ollama":
        # Ollama doesn't require a real key — the SDK needs a non-empty string.
        return AsyncOpenAI(api_key="ollama", base_url=OLLAMA_BASE_URL)
    return AsyncOpenAI(api_key=api_key)


def _thinking_off_kwargs(provider: str) -> dict:
    """Per-request kwargs that make Ollama actually usable for this app.

    - `think: False` — reasoning-enabled local models otherwise burn the whole
      token budget thinking and yield an empty visible response.
    - `options.num_ctx: 16384` — Ollama's default context (4096) is way too
      small for Aria's system prompt + growing chat history. Once the prompt
      gets close to the limit, the model's own context starts evicting as it
      generates, it loses coherence and rambles until it hits `max_tokens`;
      the truncation guard then fails the turn and the UI retries forever.
    """
    if provider == "ollama":
        return {"extra_body": {"think": False, "options": {"num_ctx": 16384}}}
    return {}


# ---------------------------------------------------------------------------
# Native Ollama chat call
# ---------------------------------------------------------------------------
# Ollama's OpenAI-compatible endpoint silently ignores both `think` and
# `options.num_ctx`. Through the OpenAI client we therefore cannot disable
# reasoning (the model burns its whole token budget thinking and emits empty
# content) or set a usable context window (default 4096 → prompts overrun and
# the model rambles into garbage). Use Ollama's native /api/chat instead,
# where these settings actually take effect.

async def _ollama_chat_native(
    model: str, messages: list[dict]
) -> tuple[str, str, dict]:
    """Returns (content, finish_reason, usage_partial)."""
    base = OLLAMA_BASE_URL.replace("/v1", "")
    body = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "1h",
        "options": {"num_ctx": 16384, "num_predict": 2048, "temperature": 0.85},
    }
    last_exc: Exception | None = None
    # Try with reasoning disabled first; fall back for small models that
    # reject the `think` parameter (e.g. tinyllama).
    for extras in ({"think": False}, {}):
        try:
            async with httpx.AsyncClient(timeout=600) as c:
                r = await c.post(f"{base}/api/chat", json={**body, **extras})
                r.raise_for_status()
                d = r.json()
            content = (d.get("message") or {}).get("content", "") or ""
            finish = "length" if d.get("done_reason") == "length" else "stop"
            pt = d.get("prompt_eval_count", 0) or 0
            ct = d.get("eval_count", 0) or 0
            return content, finish, {
                "prompt_tokens": pt,
                "completion_tokens": ct,
                "total_tokens": pt + ct,
            }
        except Exception as e:
            last_exc = e
    raise last_exc if last_exc else RuntimeError("ollama /api/chat failed")


# ---------------------------------------------------------------------------
# Inner-thoughts parsing
# ---------------------------------------------------------------------------

# Local models drift on the exact tag names — they may emit <thought>,
# <thinking>, <response>, etc. Accept the common variants so the parser
# recovers the real content instead of leaking raw tags into the chat.
_THINK_NAMES = r"(?:inner[ _]thoughts?|thoughts?|thinking|think)"
_REPLY_NAMES = r"(?:reply|response|message|msg)"

_INNER_RE = re.compile(
    rf"<\s*{_THINK_NAMES}\s*>(.*?)<\s*/\s*{_THINK_NAMES}\s*>",
    re.DOTALL | re.IGNORECASE,
)
_REPLY_RE = re.compile(
    rf"<\s*{_REPLY_NAMES}\s*>(.*?)<\s*/\s*{_REPLY_NAMES}\s*>",
    re.DOTALL | re.IGNORECASE,
)
# Any leftover XML-style tag — used only to scrub a malformed reply.
_ANY_TAG_RE = re.compile(r"</?[a-zA-Z][\w-]*/?>")


def parse_response(raw: str) -> tuple[str, str]:
    """Return (inner_thoughts, reply). Raises ValueError if format missing."""
    inner_m = _INNER_RE.search(raw)
    reply_m = _REPLY_RE.search(raw)
    if not inner_m or not reply_m:
        raise ValueError(f"Malformed Aria response — missing tags:\n{raw[:300]}")
    return inner_m.group(1).strip(), reply_m.group(1).strip()


# ---------------------------------------------------------------------------
# Retry wrapper
# ---------------------------------------------------------------------------

async def _call_with_retry(client: AsyncOpenAI, **kwargs) -> object:
    delays = [1, 2, 4]
    last_err: Exception | None = None
    for delay in delays:
        try:
            return await client.chat.completions.create(**kwargs)
        except RateLimitError:
            await asyncio.sleep(delay)
            last_err = RateLimitError
        except APIConnectionError as e:
            await asyncio.sleep(delay)
            last_err = e
        except APIStatusError as e:
            if e.status_code >= 500:
                await asyncio.sleep(delay)
                last_err = e
            else:
                with open(Path(__file__).parent / "api_error.log", "w") as f:
                    f.write(f"Status Code: {e.status_code}\nError Response: {e.response.text}")
                raise
    raise last_err or RuntimeError("OpenAI call failed after retries")


# ---------------------------------------------------------------------------
# Mirror generation
# ---------------------------------------------------------------------------

# Neutral fallback used when the model returns no usable mirror text. Persisting
# this keeps a blank mirror from being regenerated — slowly — on every launch.
_DEFAULT_MIRROR = (
    "I look about how I always do — dark hair I keep pushing out of my face, "
    "half-up in a clip that's slowly losing the fight. My eyes are a little "
    "tired. There's usually a smudge of ink or paint somewhere on my hands. I "
    "dress for comfort more than anything: soft sweaters, jeans, the same worn "
    "boots. A small freckle sits just under my left eye, and I've never minded it."
)


async def ensure_mirror(
    client: AsyncOpenAI,
    participant_id: str,
    model: str = "gpt-4o",
    provider: str = "openai",
) -> str:
    existing = read_mirror(participant_id)
    if existing:
        return existing
    resp = await _call_with_retry(
        client,
        model=model,
        messages=[
            {
                "role": "user",
                "content": (
                    "Write a first-person, present-tense description of what a "
                    "24-year-old woman named Aria sees when she looks in the mirror. "
                    "She is a freelance illustrator. Cover her hair, her eyes, the "
                    "shape of her face, her build, the way she tends to dress, and "
                    "one small distinctive feature (a freckle, a faint scar, the "
                    "particular way she ties her hair). Make it specific and sensory "
                    "— the real, slightly imperfect details a person actually notices "
                    "about themselves, not a flattering portrait. About 180 words. "
                    "Output only the description itself: no title, no preamble, no "
                    "quotation marks, no sign-off."
                ),
            }
        ],
        max_tokens=400,
        temperature=0.9,
        **_thinking_off_kwargs(provider),
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        # A thinking model can spend its whole budget reasoning and return no
        # visible content. Never persist an empty mirror — that forces a slow
        # regeneration on every launch. Fall back to a neutral description.
        log_event(participant_id, "mirror_fallback", {"reason": "empty content"})
        text = _DEFAULT_MIRROR
    write_mirror(participant_id, text)
    return text


# ---------------------------------------------------------------------------
# Conversation language — locked to the chat's first message
# ---------------------------------------------------------------------------

# Letters effectively exclusive to Turkish among Latin-script text.
_TURKISH_CHARS = "ışğ"

_TURKISH_GREETINGS = {
    "merhaba", "merhabalar", "selam", "selamlar", "naber", "günaydın", "gunaydin",
}

_TURKISH_WORDS = {
    "merhaba", "merhabalar", "selam", "selamlar", "naber", "nasılsın", "nasilsin",
    "nasıl", "nasil", "ben", "sen", "biz", "siz", "evet", "hayır", "hayir", "ve",
    "bir", "için", "icin", "değil", "degil", "var", "yok", "iyi", "iyiyim", "kötü",
    "kotu", "teşekkür", "tesekkur", "teşekkürler", "tesekkurler", "günaydın",
    "gunaydin", "bugün", "bugun", "çok", "cok", "ama", "gibi", "şey", "sey",
    "benim", "senin", "seni", "beni", "mısın", "misin", "musun", "değilim",
    "degilim", "nerede", "neden", "niye", "tamam", "peki", "kanka", "abi", "abla",
}

_TR_DIRECTIVE = (
    "You and this person text each other in Turkish. Every message you send "
    "them is in Turkish — your <reply> is always written in Turkish, "
    "naturally, the way you always text. This is simply how the two of you "
    "talk, and you never remark on it."
)
_EN_DIRECTIVE = (
    "You and this person text each other in English. Your <reply> is always "
    "written in English."
)


def detect_language(text: str) -> str:
    """Best-effort detection. Returns 'tr' for Turkish, 'en' otherwise."""
    if not text or not text.strip():
        return "en"
    low = text.lower()
    if any(ch in low for ch in _TURKISH_CHARS):
        return "tr"
    words = re.findall(r"[a-zçğıöşü]+", low)
    if not words:
        return "en"
    if any(w in _TURKISH_GREETINGS for w in words):
        return "tr"
    hits = sum(1 for w in words if w in _TURKISH_WORDS)
    return "tr" if hits / len(words) >= 0.34 else "en"


def conversation_language(participant_id: str, current_user_message: str) -> str:
    """The chat's language, decided once from its first message then locked."""
    saved = read_language(participant_id)
    if saved:
        return saved
    prior = read_chat_messages(participant_id)
    first_user = next(
        (m.get("text", "") for m in prior if m.get("from") == "user"), None
    )
    lang = detect_language(first_user or current_user_message)
    write_language(participant_id, lang)
    log_event(participant_id, "language_detected", {"value": lang})
    return lang


# ---------------------------------------------------------------------------
# Time context — what Aria perceives as "now"
# ---------------------------------------------------------------------------
# Aria lives in Portland. When she registers the current time, she registers
# her own local clock — same as anyone else does in a long-distance text
# exchange. The participant's UI timestamps live in their own local time;
# these two views drifting apart by timezone is the same realism you get from
# real cross-timezone texting.

ARIA_TZ = ZoneInfo("America/Los_Angeles")


def _part_of_day(hour: int) -> str:
    if 5 <= hour < 11:
        return "morning"
    if 11 <= hour < 13:
        return "midday"
    if 13 <= hour < 17:
        return "afternoon"
    if 17 <= hour < 21:
        return "evening"
    if 21 <= hour < 24:
        return "late evening"
    return "the middle of the night"


def _format_now(dt: datetime) -> str:
    weekday = dt.strftime("%A")
    part = _part_of_day(dt.hour)
    month_day = dt.strftime("%B %-d")
    clock = dt.strftime("%-I:%M %p").lower().replace("am", "AM").replace("pm", "PM")
    return f"{weekday} {part}, {month_day}, {dt.year} — around {clock} in Portland"


def _format_gap(now: datetime, last: datetime) -> str:
    seconds = (now - last).total_seconds()
    if seconds < 0:
        return ""
    if seconds < 90:
        return "You two were just texting a moment ago."
    if seconds < 10 * 60:
        return "You were just texting a few minutes ago."
    if seconds < 60 * 60:
        m = int(seconds // 60)
        return f"You last messaged about {m} minutes ago."
    if seconds < 3 * 60 * 60:
        h = max(1, int(round(seconds / 3600)))
        return f"You last messaged about {h} hour{'s' if h != 1 else ''} ago."
    if seconds < 8 * 60 * 60:
        h = int(seconds // 3600)
        return f"It's been about {h} hours since your last exchange."
    days_apart = (now.date() - last.date()).days
    if days_apart == 0:
        return "It's been most of the day since you last messaged."
    if days_apart == 1:
        return "You haven't talked since yesterday."
    if days_apart < 7:
        return f"You haven't talked in {days_apart} days."
    if days_apart < 21:
        weeks = days_apart // 7
        return f"It's been about {weeks} week{'s' if weeks != 1 else ''} since you've talked."
    if days_apart < 60:
        return "It's been about a month since you've talked."
    return "It's been months since you've talked."


def build_now_context(last_message_ts_ms: Optional[int]) -> str:
    now = datetime.now(ARIA_TZ)
    line = "Right now it is " + _format_now(now) + "."
    if last_message_ts_ms is None:
        return line
    last = datetime.fromtimestamp(last_message_ts_ms / 1000.0, tz=ARIA_TZ)
    gap = _format_gap(now, last)
    return f"{line} {gap}".strip() if gap else line


# ---------------------------------------------------------------------------
# Build system prompt
# ---------------------------------------------------------------------------

def build_system_prompt(
    participant_id: str,
    lang: str = "en",
    last_message_ts_ms: Optional[int] = None,
) -> str:
    mirror = read_mirror(participant_id) or "(no mirror description yet)"
    diary = read_diary(participant_id)
    love_data = read_love(participant_id)
    disposition = love_to_disposition(int(love_data.get("value", 5)))

    diary_section = (
        "You flip back through your diary sometimes. These are your most recent entries:\n\n"
        + diary
        if diary
        else "Your diary is empty so far — you haven't written anything in it yet."
    )

    return (
        SYSTEM_TEMPLATE
        .replace("{mirror}", mirror)
        .replace("{diary}", diary_section)
        .replace("{disposition}", disposition)
        .replace("{language_directive}", _TR_DIRECTIVE if lang == "tr" else _EN_DIRECTIVE)
        .replace("{now}", build_now_context(last_message_ts_ms))
    )


# ---------------------------------------------------------------------------
# Main chat call
# ---------------------------------------------------------------------------

async def aria_chat(
    client: AsyncOpenAI,
    participant_id: str,
    history: list[dict],
    user_message: str,
    model: str = "gpt-4o",
    provider: str = "openai",
) -> tuple[str, str, dict]:
    """
    Returns (inner_thoughts, visible_reply, usage_dict).
    history is mutated in-place with the new user + assistant turn — but only
    on success. A failed turn raises AriaGenerationError and leaves history
    untouched, so a blank message is never persisted.
    """
    lang = conversation_language(participant_id, user_message)
    prior_chat = read_chat_messages(participant_id)
    last_ts = prior_chat[-1].get("ts") if prior_chat else None
    system_prompt = build_system_prompt(participant_id, lang, last_ts)

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history)
    messages.append({"role": "user", "content": user_message})

    start = time.monotonic()
    if provider == "ollama":
        raw, finish_reason, usage = await _ollama_chat_native(model, messages)
    else:
        resp = await _call_with_retry(
            client,
            model=model,
            messages=messages,
            max_tokens=2048,
            temperature=0.85,
            **_thinking_off_kwargs(provider),
        )
        choice = resp.choices[0]
        raw = choice.message.content or ""
        finish_reason = getattr(choice, "finish_reason", None)
        u = resp.usage
        usage = {
            "prompt_tokens": (u.prompt_tokens if u else None) or 0,
            "completion_tokens": (u.completion_tokens if u else None) or 0,
            "total_tokens": (u.total_tokens if u else None) or 0,
        }
    elapsed = time.monotonic() - start
    usage["model"] = model
    usage["latency_s"] = round(elapsed, 2)

    # A response cut off at the token limit never produced a complete reply.
    # Fail the turn rather than persist a fragment — or, when the model spent
    # the whole budget before emitting any visible content, a blank message.
    if finish_reason == "length":
        log_event(
            participant_id,
            "generation_failed",
            {"reason": "length", "raw_len": len(raw), "usage": usage},
        )
        raise AriaGenerationError("response truncated at token limit")

    history_content = raw  # what gets stored in context by default
    try:
        inner_thoughts, reply = parse_response(raw)
    except ValueError:
        # Model didn't follow the tag format (common with local models that
        # drift on tag names, e.g. <thought> instead of <inner_thoughts>).
        inner_m = _INNER_RE.search(raw)
        inner_thoughts = inner_m.group(1).strip() if inner_m else ""
        reply_m = _REPLY_RE.search(raw)
        if reply_m:
            reply = reply_m.group(1)
        elif inner_m:
            # No reply tag — the reply is whatever follows the thoughts block.
            reply = raw[inner_m.end():]
        else:
            reply = raw
        # Scrub every stray XML-style tag (e.g. <thought>) so none of the
        # model's formatting leaks into the visible chat.
        reply = _ANY_TAG_RE.sub("", reply).strip()
        # Store the clean reply in history — raw tags would confuse the model.
        history_content = reply
        log_event(participant_id, "parse_error", {"raw": raw[:200]})

    # An empty reply — model returned nothing, or the text was all
    # inner_thoughts — is a failed turn. Don't persist it as a blank message.
    if not reply.strip():
        log_event(
            participant_id,
            "generation_failed",
            {"reason": "empty_reply", "raw": raw[:200], "usage": usage},
        )
        raise AriaGenerationError("model produced no reply")

    # Append to history (success only — a failed turn leaves history clean)
    history.append({"role": "user", "content": user_message})
    history.append({"role": "assistant", "content": history_content})

    log_event(
        participant_id,
        "message",
        {
            "user": user_message,
            "inner_thoughts": inner_thoughts,
            "reply": reply,
            "usage": usage,
        },
    )

    return inner_thoughts, reply, usage
