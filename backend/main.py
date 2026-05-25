"""FastAPI backend — AI orchestration server for Aria."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from aria import aria_chat, ensure_mirror, make_client, OLLAMA_BASE_URL, AriaGenerationError
from files import (
    read_love,
    set_love,
    read_diary,
    append_diary,
    session_log_path,
    log_event,
    participant_dir,
    read_context_history,
    write_context_history,
    read_chat_messages,
    append_chat_exchange,
)
from observer import ObserverModel

# Per-participant conversation histories kept in memory
_histories: dict[str, list[dict]] = {}
_observer: Optional[ObserverModel] = None
_clients: dict[str, AsyncOpenAI] = {}  # keyed by participant_id
_providers: dict[str, str] = {}  # keyed by participant_id — set at /init


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _observer
    model_name = os.environ.get("OBSERVER_MODEL", "aria-gemma")
    _observer = ObserverModel(model_name=model_name)
    ready = await _observer.ensure_ready()
    _observer.start_worker()
    if not ready:
        print("WARNING: Ollama not reachable — observer in degraded mode")
    yield
    if _observer._worker_task:
        _observer._worker_task.cancel()


app = FastAPI(title="Aria Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class InitRequest(BaseModel):
    participant_id: str
    api_key: str
    provider: str = "openai"  # "openai" or "gemini"
    model: str = "gpt-4o"
    observer_model: str = ""  # Ollama model for the background observer; "" keeps current


class ChatRequest(BaseModel):
    participant_id: str
    message: str
    model: str = "gpt-4o"


class ChatResponse(BaseModel):
    reply: str
    usage: dict


class LoveOverrideRequest(BaseModel):
    participant_id: str
    value: int = Field(ge=0, le=10)
    reason: str = "researcher override"


class DiaryAppendRequest(BaseModel):
    participant_id: str
    entry: str


class ValidateKeyRequest(BaseModel):
    api_key: str
    provider: str = "openai"  # "openai" or "gemini"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_client(participant_id: str) -> AsyncOpenAI:
    if participant_id not in _clients:
        raise HTTPException(status_code=400, detail="Participant not initialized")
    return _clients[participant_id]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/validate-key")
async def validate_key(req: ValidateKeyRequest) -> dict:
    """Cheap validation call — just lists models for the chosen provider."""
    try:
        client = make_client(req.provider, req.api_key)
        models = await client.models.list()
        model_ids = [m.id for m in models.data]
        return {"valid": True, "models": model_ids}
    except Exception as e:
        return {"valid": False, "error": str(e)}


@app.post("/init")
async def init_participant(req: InitRequest) -> dict:
    """Set up a participant session: generate mirror if needed, warm history."""
    try:
        client = make_client(req.provider, req.api_key)
        _clients[req.participant_id] = client
        _providers[req.participant_id] = req.provider

        # Switch the background observer to the requested local model, if asked.
        # Lets a low-power device (e.g. a phone) use a small model like tinyllama.
        if _observer and req.observer_model and req.observer_model != _observer.model_name:
            _observer.set_model(req.observer_model)
            log_event(req.participant_id, "observer_model_set", {"model": req.observer_model})

        saved_history = read_context_history(req.participant_id)
        if saved_history:
            _histories[req.participant_id] = saved_history
        else:
            # context_history.json is missing (e.g. sessions before history saving was
            # added).  Reconstruct a plain context from the display messages so the AI
            # isn't starting blind while the user can see the whole prior conversation.
            display = read_chat_messages(req.participant_id)
            rebuilt = [
                {"role": "user" if m["from"] == "user" else "assistant", "content": m["text"]}
                for m in display
            ]
            _histories[req.participant_id] = rebuilt

        mirror = await ensure_mirror(client, req.participant_id, req.model, req.provider)
        love_data = read_love(req.participant_id)
        log_event(
            req.participant_id,
            "session_start",
            {"model": req.model, "provider": req.provider},
        )

        return {
            "status": "ready",
            "mirror_generated": bool(mirror),
            "love_value": love_data.get("value", 5),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    client = _get_client(req.participant_id)
    provider = _providers.get(req.participant_id, "openai")
    history = _histories.setdefault(req.participant_id, [])
    love_data = read_love(req.participant_id)
    current_love = int(love_data.get("value", 5))

    try:
        inner_thoughts, reply, usage = await aria_chat(
            client=client,
            participant_id=req.participant_id,
            history=history,
            user_message=req.message,
            model=req.model,
            provider=provider,
        )
    except AriaGenerationError as e:
        # Truncated or empty generation — nothing was persisted. Surface a
        # retryable error instead of saving a blank message.
        log_event(req.participant_id, "chat_failed", {"reason": str(e)})
        raise HTTPException(
            status_code=502,
            detail="Aria didn't get a message out that time — please try again.",
        )

    # Persist updated history so the next session can resume context.
    write_context_history(req.participant_id, history)
    append_chat_exchange(req.participant_id, req.message, reply)

    # Fire-and-forget observer update
    if _observer:
        _observer.enqueue(
            participant_id=req.participant_id,
            participant_message=req.message,
            inner_thoughts=inner_thoughts,
            aria_reply=reply,
            current_love=current_love,
        )

    return ChatResponse(reply=reply, usage=usage)


# ---------------------------------------------------------------------------
# Researcher endpoints (all require researcher_token header in prod — skipped
# here since the Electron layer handles password gating before calling these)
# ---------------------------------------------------------------------------

@app.get("/researcher/love/{participant_id}")
async def get_love(participant_id: str) -> dict:
    return read_love(participant_id)


@app.post("/researcher/love")
async def override_love(req: LoveOverrideRequest) -> dict:
    new_val = set_love(req.participant_id, req.value, req.reason)
    log_event(req.participant_id, "researcher_love_override", {"value": new_val})
    return {"value": new_val}


@app.get("/researcher/diary/{participant_id}")
async def get_diary(participant_id: str) -> dict:
    return {"diary": read_diary(participant_id)}


@app.post("/researcher/diary")
async def post_diary(req: DiaryAppendRequest) -> dict:
    append_diary(req.participant_id, req.entry)
    return {"status": "appended"}


@app.get("/researcher/log/{participant_id}")
async def get_log(participant_id: str) -> dict:
    p = session_log_path(participant_id)
    if not p.exists():
        return {"log": ""}
    return {"log": p.read_text(encoding="utf-8")}


@app.get("/researcher/export/{participant_id}")
async def export_session(participant_id: str) -> dict:
    love = read_love(participant_id)
    diary = read_diary(participant_id)
    log_p = session_log_path(participant_id)
    log_text = log_p.read_text(encoding="utf-8") if log_p.exists() else ""
    history = _histories.get(participant_id, [])
    return {
        "participant_id": participant_id,
        "love": love,
        "diary": diary,
        "history": history,
        "log": log_text,
    }


@app.get("/chat-history/{participant_id}")
async def get_chat_history(participant_id: str) -> dict:
    return {"messages": read_chat_messages(participant_id)}


@app.get("/ollama/models")
async def get_ollama_models() -> dict:
    ollama_url = OLLAMA_BASE_URL.replace("/v1", "")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"available": True, "models": models}
    except Exception:
        return {"available": False, "models": []}


@app.get("/health")
async def health() -> dict:
    observer_ok = _observer._healthy if _observer else False
    observer_model = _observer.model_name if _observer else None
    return {"status": "ok", "observer_healthy": observer_ok, "observer_model": observer_model}


# ---------------------------------------------------------------------------
# Static UI — serve the built renderer so the app runs in any browser (desktop
# or Android via Termux), not just inside Electron. Mounted LAST so it never
# shadows an API route declared above.
# ---------------------------------------------------------------------------

_UI_DIR = Path(__file__).resolve().parent.parent / "electron" / "renderer" / "dist"
if _UI_DIR.is_dir():
    app.mount("/", StaticFiles(directory=_UI_DIR, html=True), name="ui")
else:
    print(f"WARNING: renderer build not found at {_UI_DIR} — UI will not be served")
