"""Observer model — local Gemma via Ollama. Runs in background; never visible to user."""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx

from files import append_diary, update_love, log_event

PROMPT_DIR = Path(__file__).parent / "prompts"
DIARY_TEMPLATE = (PROMPT_DIR / "observer_diary.txt").read_text(encoding="utf-8")
LOVE_TEMPLATE = (PROMPT_DIR / "observer_love.txt").read_text(encoding="utf-8")


class ObserverModel:
    def __init__(self, model_name: str = "gemma4:e4b", ollama_base: str = "http://localhost:11434"):
        self.model_name = model_name
        self.ollama_base = ollama_base
        self._healthy: Optional[bool] = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._worker_task: Optional[asyncio.Task] = None
        self._pending_updates: list[dict] = []

    def set_model(self, model_name: str) -> None:
        """Switch which Ollama model the observer uses for its next calls.
        The worker, queue and health check are model-agnostic, so only the
        name needs to change — no restart required."""
        self.model_name = model_name

    # ------------------------------------------------------------------
    # Health / startup
    # ------------------------------------------------------------------

    async def check_health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{self.ollama_base}/api/tags")
                self._healthy = r.status_code == 200
        except Exception:
            self._healthy = False
        return self._healthy

    def _start_ollama(self) -> None:
        try:
            subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            time.sleep(3)
        except FileNotFoundError:
            pass

    async def ensure_ready(self) -> bool:
        if await self.check_health():
            return True
        self._start_ollama()
        for _ in range(6):
            await asyncio.sleep(2)
            if await self.check_health():
                return True
        self._healthy = False
        return False

    # ------------------------------------------------------------------
    # Raw Ollama call
    # ------------------------------------------------------------------

    async def _generate(self, prompt: str) -> str:
        if not self._healthy:
            return ""
        base = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 256},
        }
        # Reasoning-enabled models (the default aria-gemma is one) return an
        # empty `response` unless thinking is turned off. Try with thinking
        # disabled first, then fall back to a plain request for small models
        # (e.g. tinyllama) that may reject the `think` parameter.
        for payload in ({**base, "think": False}, base):
            try:
                async with httpx.AsyncClient(timeout=120) as c:
                    r = await c.post(f"{self.ollama_base}/api/generate", json=payload)
                    r.raise_for_status()
                    return r.json().get("response", "").strip()
            except Exception:
                continue
        self._healthy = False
        return ""

    # ------------------------------------------------------------------
    # Diary update
    # ------------------------------------------------------------------

    async def _decide_diary(
        self,
        participant_id: str,
        participant_message: str,
        inner_thoughts: str,
        aria_reply: str,
    ) -> None:
        prompt = (
            DIARY_TEMPLATE
            .replace("{participant_message}", participant_message)
            .replace("{inner_thoughts}", inner_thoughts or "(none recorded)")
            .replace("{aria_reply}", aria_reply)
        )
        result = await self._generate(prompt)
        entry = self._clean_diary_output(result)
        if entry:
            append_diary(participant_id, entry)
            log_event(participant_id, "diary_update", {"entry": entry})

    @staticmethod
    def _clean_diary_output(text: str) -> Optional[str]:
        """Return a clean diary entry, or None if the observer declined (NONE)."""
        if not text or not text.strip():
            return None
        cleaned = re.sub(r"^```[a-zA-Z]*", "", text.strip()).strip().strip("`").strip()
        # Drop an echoed label the local model may copy from the few-shot examples
        cleaned = re.sub(
            r"^(output|diary entry|diary|entry|decision)\s*:\s*",
            "",
            cleaned,
            flags=re.IGNORECASE,
        ).strip()
        # Strip a fully-wrapping pair of quotes
        if len(cleaned) >= 2 and cleaned[0] in "\"'" and cleaned[-1] == cleaned[0]:
            cleaned = cleaned[1:-1].strip()
        if not cleaned:
            return None
        # Any response whose first word is NONE means "not diary-worthy"
        first = cleaned.split()[0].strip(".,:;!?-—\"'").upper()
        if first == "NONE":
            return None
        return cleaned

    # ------------------------------------------------------------------
    # Love update
    # ------------------------------------------------------------------

    async def _decide_love(
        self,
        participant_id: str,
        participant_message: str,
        inner_thoughts: str,
        aria_reply: str,
        current_love: int,
    ) -> None:
        prompt = (
            LOVE_TEMPLATE
            .replace("{participant_message}", participant_message)
            .replace("{inner_thoughts}", inner_thoughts or "(none recorded)")
            .replace("{aria_reply}", aria_reply)
            .replace("{current_love}", str(current_love))
        )
        result = await self._generate(prompt)
        delta, reason = self._parse_love_response(result)
        if delta != 0:
            new_val = update_love(participant_id, delta, reason)
            log_event(
                participant_id,
                "love_update",
                {"delta": delta, "new_value": new_val, "reason": reason},
            )

    @staticmethod
    def _parse_love_response(text: str) -> tuple[int, str]:
        if not text or not text.strip():
            return 0, ""
        clean = re.sub(r"```[a-zA-Z]*", "", text).strip().strip("`").strip()
        # Preferred path: strict JSON
        try:
            data = json.loads(clean)
            delta = max(-2, min(2, int(data.get("delta", 0))))
            return delta, str(data.get("reason", ""))
        except Exception:
            pass
        # Fallback: the local model emitted sloppy / non-strict JSON
        # (single quotes, stray text, echoed labels). Regex-extract the fields.
        m = re.search(r'delta["\']?\s*[:=]\s*([+-]?\d+)', clean, re.IGNORECASE)
        if not m:
            return 0, ""
        try:
            delta = max(-2, min(2, int(m.group(1))))
        except ValueError:
            return 0, ""
        r = re.search(
            r'reason["\']?\s*[:=]\s*["\']([^"\']*)["\']', clean, re.IGNORECASE
        )
        return delta, (r.group(1) if r else "")

    # ------------------------------------------------------------------
    # Background worker — queued so observer never blocks the chat
    # ------------------------------------------------------------------

    async def _worker(self) -> None:
        while True:
            item = await self._queue.get()
            try:
                if not self._healthy:
                    self._pending_updates.append(item)
                    self._queue.task_done()
                    continue
                await self._process(item)
                # Drain any pending updates that queued while offline
                while self._pending_updates:
                    pending = self._pending_updates.pop(0)
                    await self._process(pending)
            except Exception as e:
                log_event(item.get("participant_id", "unknown"), "observer_error", {"error": str(e)})
            finally:
                self._queue.task_done()

    async def _process(self, item: dict) -> None:
        pid = item["participant_id"]
        await asyncio.gather(
            self._decide_diary(
                pid,
                item["participant_message"],
                item["inner_thoughts"],
                item["aria_reply"],
            ),
            self._decide_love(
                pid,
                item["participant_message"],
                item["inner_thoughts"],
                item["aria_reply"],
                item["current_love"],
            ),
        )

    def start_worker(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker())

    def enqueue(
        self,
        participant_id: str,
        participant_message: str,
        inner_thoughts: str,
        aria_reply: str,
        current_love: int,
    ) -> None:
        self._queue.put_nowait(
            {
                "participant_id": participant_id,
                "participant_message": participant_message,
                "inner_thoughts": inner_thoughts,
                "aria_reply": aria_reply,
                "current_love": current_love,
            }
        )
