"""Local Chat: a ChatGPT-style app with long-term memory, backed by Ollama.

Run with:  python -m uvicorn app.main:app --port 8765
"""
from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, memory, ollama, reminders

log = logging.getLogger("localchat")
DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"   # built React app
MAX_HISTORY_CHARS = int(os.environ.get("MAX_HISTORY_CHARS", "16000"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    yield
    await ollama.close()


app = FastAPI(title="Local Chat", lifespan=lifespan)
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def index():
    page = DIST / "index.html"
    if not page.exists():
        return HTMLResponse("<p>The frontend isn't built yet. Run <code>npm install</code> and "
                            "<code>npm run build</code> in the <code>frontend</code> folder, "
                            "or start the app with <code>run.bat</code>.</p>", status_code=503)
    return FileResponse(page)


# ------------------------------------------------------------------ models

@app.get("/api/models")
async def models():
    try:
        items = await ollama.list_models()
        return {"ok": True, "models": [m["name"] for m in items], "items": items}
    except ollama.OllamaError as e:
        return {"ok": False, "models": [], "error": str(e)}


# ----------------------------------------------------------- conversations

class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


@app.get("/api/conversations")
def list_conversations(q: str = ""):
    return db.list_conversations(q)


@app.get("/api/conversations/{cid}")
def get_conversation(cid: str):
    conv = db.get_conversation(cid)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return {**conv, "messages": db.get_messages(cid)}


@app.patch("/api/conversations/{cid}")
def rename_conversation(cid: str, body: RenameIn):
    if not db.get_conversation(cid):
        raise HTTPException(404, "Conversation not found")
    db.rename_conversation(cid, body.title.strip())
    return {"ok": True}


@app.delete("/api/conversations/{cid}")
def delete_conversation(cid: str):
    db.delete_conversation(cid)
    return {"ok": True}


# -------------------------------------------------------------------- chat

class ChatIn(BaseModel):
    model: str
    conversation_id: str | None = None
    message: str | None = None
    regenerate: bool = False


def _event(**data) -> str:
    return json.dumps(data, ensure_ascii=False) + "\n"


def _trim_history(messages: list[dict]) -> list[dict]:
    """Keep the most recent messages that fit in the context budget."""
    kept, total = [], 0
    for m in reversed(messages):
        total += len(m["content"])
        if kept and total > MAX_HISTORY_CHARS:
            break
        kept.append({"role": m["role"], "content": m["content"]})
    return kept[::-1]


def _fallback_title(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 42 else text[:42] + "…"


@app.post("/api/chat")
async def chat(body: ChatIn):
    conv = db.get_conversation(body.conversation_id) if body.conversation_id else None
    if body.conversation_id and not conv:
        raise HTTPException(404, "Conversation not found")

    if body.regenerate:
        if not conv:
            raise HTTPException(400, "Nothing to regenerate")
        user_text = db.prepare_regenerate(conv["id"])
        if user_text is None:
            raise HTTPException(400, "Nothing to regenerate")
        is_new = False
    else:
        user_text = (body.message or "").strip()
        if not user_text:
            raise HTTPException(400, "Message is empty")
        if conv is None:
            conv = db.create_conversation(_fallback_title(user_text), body.model)
            is_new = True
        else:
            is_new = not db.get_messages(conv["id"])
        db.add_message(conv["id"], "user", user_text)

    return StreamingResponse(_chat_events(conv, user_text, body.model, is_new, analyze=not body.regenerate),
                             media_type="application/x-ndjson")


async def _chat_events(conv: dict, user_text: str, model: str, is_new: bool, analyze: bool = True):
    """Stream one reply. `analyze` is False on regenerate: the message was already checked
    for reminders and memories the first time."""
    cid = conv["id"]
    settings = db.get_settings()
    memories = db.list_memories() if settings["memory_enabled"] else []
    recalled = db.search_history(user_text, cid) if settings["history_recall"] else []

    yield _event(type="conversation", id=cid, title=conv["title"],
                 memories_used=len(memories), chats_recalled=len(recalled))

    # Reminders are handled before the reply so the model can confirm what was saved.
    extra_sections, reminder_note = [], None
    if reminders.mentions_reminders(user_text):
        if analyze:
            yield _event(type="status", text="Checking reminders…")
            try:
                reminder_note = await reminders.process(model, user_text, cid)
            except Exception:
                log.exception("reminder extraction failed")
            if reminder_note:
                yield _event(type="reminders", **reminder_note)
        extra_sections.append(reminders.prompt_section(reminder_note, analyzed=analyze))

    system = memory.build_system_prompt(settings["custom_instructions"], memories, recalled, extra_sections)
    messages = [{"role": "system", "content": system}] + _trim_history(db.get_messages(cid))

    def save_reply(content: str, meta: str | None) -> int:
        mid = db.add_message(cid, "assistant", content, meta)
        if reminder_note:
            db.set_reminder_note(mid, reminder_note)
        return mid

    reply, meta, saved = "", None, False
    try:
        async for chunk in ollama.stream_chat(model, messages):
            piece = chunk.get("message", {}).get("content", "")
            if piece:
                reply += piece
                yield _event(type="token", content=piece)
            if chunk.get("done") and chunk.get("eval_count") and chunk.get("eval_duration"):
                meta = f"{model} · {chunk['eval_count'] / (chunk['eval_duration'] / 1e9):.1f} tokens/sec"
        message_id = save_reply(reply or "_(no response)_", meta)
        saved = True
        yield _event(type="done", message_id=message_id, meta=meta)
    except ollama.OllamaError as e:
        save_reply(reply + ("\n\n" if reply else "") + f"⚠️ {e}", None)
        saved = True
        yield _event(type="error", message=str(e))
        return
    finally:
        # Reached without saving when the user pressed Stop (the client disconnected).
        if not saved and reply:
            save_reply(reply, "Stopped")

    # The reply is complete; these extra steps run while the stream stays open.
    if is_new:
        try:
            title = await memory.make_title(model, user_text)
            if title:
                db.rename_conversation(cid, title)
                yield _event(type="title", title=title)
        except Exception:
            log.exception("title generation failed")

    if analyze and settings["memory_enabled"] and settings["auto_memory"]:
        try:
            note = await memory.update_memories(model, user_text, cid)
        except Exception:
            log.exception("memory update failed")
            note = None
        if note:
            db.set_memory_note(message_id, note)
            yield _event(type="memory", **note)


# ---------------------------------------------------------------- memories

class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=500)


@app.get("/api/memories")
def list_memories():
    return db.list_memories()


@app.post("/api/memories")
def add_memory(body: MemoryIn):
    return db.add_memory(body.content.strip())


@app.patch("/api/memories/{mid}")
def update_memory(mid: int, body: MemoryIn):
    if not db.update_memory(mid, body.content.strip()):
        raise HTTPException(404, "Memory not found")
    return {"ok": True}


@app.delete("/api/memories/{mid}")
def delete_memory(mid: int):
    db.delete_memory(mid)
    return {"ok": True}


@app.delete("/api/memories")
def clear_memories():
    db.clear_memories()
    return {"ok": True}


# --------------------------------------------------------------- reminders

class ReminderIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    due_at: float | None = None


class ReminderPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=200)
    due_at: float | None = None
    done: bool | None = None
    notified: bool | None = None


@app.get("/api/reminders")
def list_reminders():
    return db.list_reminders()


@app.post("/api/reminders")
def add_reminder(body: ReminderIn):
    return db.add_reminder(body.text.strip(), body.due_at)


@app.patch("/api/reminders/{rid}")
def update_reminder(rid: int, body: ReminderPatch):
    if not db.get_reminder(rid):
        raise HTTPException(404, "Reminder not found")
    fields = body.model_dump(exclude_unset=True)
    return db.update_reminder(rid, **fields)


@app.delete("/api/reminders/{rid}")
def delete_reminder(rid: int):
    db.delete_reminder(rid)
    return {"ok": True}


# -------------------------------------------------------------- checklists

class ChecklistIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    items: list[str] = Field(default_factory=list, max_length=200)


class ChecklistRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ItemsIn(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=200)


class ItemPatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    done: bool | None = None


class OrderIn(BaseModel):
    ids: list[str]


def _clean(texts: list[str]) -> list[str]:
    return [t.strip()[:500] for t in texts if t.strip()]


def _found(checklist: dict | None) -> dict:
    if checklist is None:
        raise HTTPException(404, "Checklist not found")
    return checklist


@app.get("/api/checklists")
def list_checklists():
    return db.list_checklists()


@app.post("/api/checklists")
def create_checklist(body: ChecklistIn):
    return db.create_checklist(body.name.strip(), _clean(body.items))


@app.patch("/api/checklists/{cid}")
def rename_checklist(cid: str, body: ChecklistRename):
    return _found(db.rename_checklist(cid, body.name.strip()))


@app.delete("/api/checklists/{cid}")
def delete_checklist(cid: str):
    db.delete_checklist(cid)
    return {"ok": True}


@app.post("/api/checklists/{cid}/items")
def add_checklist_items(cid: str, body: ItemsIn):
    texts = _clean(body.texts)
    if not texts:
        raise HTTPException(400, "Nothing to add")
    return _found(db.add_checklist_items(cid, texts))


@app.patch("/api/checklists/{cid}/items/{iid}")
def update_checklist_item(cid: str, iid: str, body: ItemPatch):
    text = body.text.strip() if body.text is not None else None
    return _found(db.update_checklist_item(cid, iid, text=text or None, done=body.done))


@app.delete("/api/checklists/{cid}/items/{iid}")
def delete_checklist_item(cid: str, iid: str):
    return _found(db.delete_checklist_item(cid, iid))


@app.put("/api/checklists/{cid}/order")
def reorder_checklist(cid: str, body: OrderIn):
    return _found(db.reorder_checklist(cid, body.ids))


@app.post("/api/checklists/{cid}/clear-completed")
def clear_completed(cid: str):
    return _found(db.clear_completed(cid))


@app.post("/api/checklists/{cid}/uncheck-all")
def uncheck_all(cid: str):
    return _found(db.uncheck_all(cid))


# ---------------------------------------------------------------- settings

class SettingsIn(BaseModel):
    custom_instructions: str | None = Field(default=None, max_length=4000)
    memory_enabled: bool | None = None
    auto_memory: bool | None = None
    history_recall: bool | None = None
    default_model: str | None = None


@app.get("/api/settings")
def get_settings():
    return db.get_settings()


@app.put("/api/settings")
def update_settings(body: SettingsIn):
    return db.update_settings(body.model_dump(exclude_none=True))
