"""Long-term memory: building the system prompt and extracting new memories."""
from __future__ import annotations

import datetime as dt
import difflib
import json
import logging
import re

from . import db, ollama

log = logging.getLogger("localchat.memory")

MAX_MEMORIES_IN_PROMPT = 60

BASE_PROMPT = (
    "You are a helpful, knowledgeable assistant running locally on the user's computer. "
    "Answer clearly and accurately. Use Markdown for formatting and fenced code blocks for code."
)

EXTRACT_PROMPT = """You are the memory manager for a personal AI assistant. You decide what to remember about the user long-term, across all future conversations.

Save ONLY durable personal facts the user states about themselves:
- identity: name, job or role, company, location, languages
- ongoing projects, tech stack, tools and operating system they use
- stable preferences (for example "prefers short answers")
- goals, or anything the user explicitly asks you to remember

Never save:
- the question or task itself (NOT "User asked how to reverse a string")
- general knowledge, code, or the assistant's answers
- temporary or one-off details
- reminders, tasks, appointments or to-dos (a separate reminders feature handles those)
- anything already in KNOWN MEMORIES, even if phrased differently

Write each memory as one short sentence in third person that starts with "User", for example "User's name is Priya." or "User works as a QA engineer."

If the user asks you to forget something, or states a fact that replaces a known memory, put that memory's id number in "remove" (and add the new fact if there is one).

Reply with JSON only, in this shape: {"add": ["..."], "remove": [ids]}
Most messages contain nothing worth saving. Then reply {"add": [], "remove": []}"""

# Removals are only honoured when the user's message sounds like a correction or a
# "forget" request, so a small model can't silently wipe memories by mistake.
_REMOVAL_HINT = re.compile(
    r"\b(forget|remove|delete|erase|no longer|not anymore|anymore|changed|moved|switched|"
    r"actually|instead|wrong|not true|isn't|is not|don't|do not)\b", re.I)


def build_system_prompt(custom_instructions: str, memories: list[dict], recalled: list[dict],
                        extra_sections: list[str] = ()) -> str:
    parts = [BASE_PROMPT, f"The current local date and time is {dt.datetime.now():%A, %d %B %Y, %I:%M %p}."]

    if memories:
        facts = "\n".join(f"- {m['content']}" for m in memories[-MAX_MEMORIES_IN_PROMPT:])
        parts.append(
            "## What you remember about the user\n"
            "These facts come from earlier conversations. Use them naturally when relevant, "
            "without listing them unless asked. If the user asks what you remember about them, tell them.\n"
            + facts
        )

    if recalled:
        snippets = []
        for r in recalled:
            s = f'- In the chat "{r["title"]}" the user said: "{_clip(r["question"], 300)}"'
            if r.get("answer"):
                s += f'\n  You replied: "{_clip(r["answer"], 400)}"'
            snippets.append(s)
        parts.append(
            "## Possibly related earlier conversations\n"
            "Use these only if they help with the current message; otherwise ignore them.\n"
            + "\n".join(snippets)
        )

    parts.extend(extra_sections)

    if custom_instructions.strip():
        parts.append("## The user's custom instructions\n" + custom_instructions.strip())

    return "\n\n".join(parts)


def _clip(text: str, n: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _is_duplicate(candidate: str, existing: list[str]) -> bool:
    c = candidate.lower().strip(" .")
    return any(difflib.SequenceMatcher(None, c, e.lower().strip(" .")).ratio() > 0.85 for e in existing)


async def update_memories(model: str, user_text: str, conversation_id: str) -> dict | None:
    """Ask the model whether the user's message holds anything worth remembering.

    Returns {"added": [...], "removed": [...]} when memory changed, otherwise None.
    """
    if len(user_text.strip()) < 8:
        return None

    existing = db.list_memories()
    known = "\n".join(f"[{m['id']}] {m['content']}" for m in existing) or "(none)"
    prompt = f'KNOWN MEMORIES:\n{known}\n\nUSER MESSAGE:\n"""\n{user_text[:4000]}\n"""'

    raw = await ollama.complete(
        model,
        [{"role": "system", "content": EXTRACT_PROMPT}, {"role": "user", "content": prompt}],
        json_mode=True,
        options={"temperature": 0},
    )
    try:
        data = json.loads(raw)
    except ValueError:
        log.warning("memory extraction returned non-JSON: %r", raw[:200])
        return None
    if not isinstance(data, dict):
        return None

    removed: list[str] = []
    by_id = {m["id"]: m["content"] for m in existing}
    if _REMOVAL_HINT.search(user_text):
        for mid in data.get("remove") or []:
            try:
                mid = int(mid)
            except (TypeError, ValueError):
                continue
            if mid in by_id and db.delete_memory(mid):
                removed.append(by_id.pop(mid))

    added: list[str] = []
    for item in (data.get("add") or [])[:5]:
        if not isinstance(item, str):
            continue
        item = " ".join(item.split())[:300]
        if not item.lower().startswith("user") or item.endswith("?") or _is_duplicate(item, list(by_id.values()) + added):
            continue
        db.add_memory(item, conversation_id)
        added.append(item)

    return {"added": added, "removed": removed} if added or removed else None


async def make_title(model: str, first_message: str) -> str | None:
    raw = await ollama.complete(
        model,
        [
            {"role": "system", "content": "You write short titles for chat conversations. "
                                          "Reply with only the title: 2 to 6 words, no quotes, no ending punctuation."},
            {"role": "user", "content": f'First message of the conversation:\n"""\n{first_message[:1000]}\n"""\n\nTitle:'},
        ],
        options={"temperature": 0.2, "num_predict": 20},
    )
    lines = [l for l in raw.strip().splitlines() if l.strip()]
    if not lines:
        return None
    title = re.sub(r"^(title\s*:\s*)", "", lines[0].strip(), flags=re.I)
    title = title.strip(" \"'*#`.").strip()
    return title[:60] or None
