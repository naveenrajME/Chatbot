"""Reminders set from chat: detect requests, save them, and tell the chat model what changed."""
from __future__ import annotations

import datetime as dt
import json
import logging
import re

from . import db, ollama

log = logging.getLogger("localchat.reminders")

# Cheap pre-check so the extra model call only runs when the message is about reminders.
_HINT = re.compile(
    r"\b(remind(er|ers)?|don'?t let me forget|remember to|to-?do|alert me|notify me|ping me)\b", re.I)

_RELATIVE = re.compile(r"\bin\s+(\d+|an?|one|half an?)\s*(min(ute)?s?|h(ou)?rs?|hours?|days?)\b", re.I)

EXTRACT_PROMPT = """You manage the user's reminders. Read the user's message and decide what to change.

- "add": new reminders the user asks for.
  "text" is a short task description without the time words, e.g. "Call mom".
  "due" is the local date and time as "YYYY-MM-DD HH:MM" (24-hour clock), or null if no time or day was given.
  If only a day is given, use 09:00. Morning = 09:00, afternoon = 14:00, evening = 18:00, night = 21:00.
  Work out relative times ("tomorrow", "next Friday", "in 2 hours") from the current time and the calendar below.
- "complete": ids of open reminders the user says are done.
- "delete": ids of open reminders the user wants cancelled or removed.
- To move an existing reminder to a new time, delete the old id and add it again with the new time.
- Questions such as "what are my reminders?" change nothing.

Reply with JSON only:
{"add": [{"text": "...", "due": "YYYY-MM-DD HH:MM" or null}], "complete": [ids], "delete": [ids]}"""


def mentions_reminders(text: str) -> bool:
    return bool(_HINT.search(text))


def format_due(ts: float | None) -> str:
    if ts is None:
        return "no time set"
    d = dt.datetime.fromtimestamp(ts)
    return f"{d:%a %d %b %Y}, {d:%I:%M %p}".replace(" 0", " ")


def _calendar(now: dt.datetime) -> str:
    lines = [f"- today: {now:%A %Y-%m-%d}"]
    for i in range(1, 15):
        d = now + dt.timedelta(days=i)
        label = "tomorrow" if i == 1 else ("next " if i >= 7 else "") + f"{d:%A}"
        lines.append(f"- {label}: {d:%A %Y-%m-%d}")
    return "\n".join(lines)


def _parse_due(value, now: dt.datetime) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip().replace("T", " ")
    try:
        d = dt.datetime.fromisoformat(value)
    except ValueError:
        try:
            d = dt.datetime.combine(dt.date.fromisoformat(value[:10]), dt.time(9, 0))
        except ValueError:
            return None
    # "at 9am" said late at night usually means tomorrow.
    if d < now - dt.timedelta(minutes=1) and now - d < dt.timedelta(days=1):
        d += dt.timedelta(days=1)
    return d.timestamp()


def _relative_due(text: str, now: dt.datetime) -> float | None:
    """Exact time for "in 20 minutes" / "in 2 hours", which small models often get wrong."""
    m = _RELATIVE.search(text)
    if not m:
        return None
    raw, unit = m.group(1).lower(), m.group(2).lower()
    amount = 0.5 if raw.startswith("half") else 1 if raw in ("a", "an", "one") else int(raw)
    if unit.startswith("m"):
        delta = dt.timedelta(minutes=amount)
    elif unit.startswith("h"):
        delta = dt.timedelta(hours=amount)
    else:
        delta = dt.timedelta(days=amount)
    return (now + delta).timestamp()


async def process(model: str, user_text: str, conversation_id: str) -> dict | None:
    """Apply any reminder changes the message asks for.

    Returns {"added": [...], "completed": [...], "deleted": [...]} when something changed, else None.
    """
    now = dt.datetime.now().replace(second=0, microsecond=0)
    open_reminders = db.list_reminders(open_only=True)
    listing = "\n".join(
        f"[{r['id']}] {r['text']} (due {dt.datetime.fromtimestamp(r['due_at']):%Y-%m-%d %H:%M})"
        if r["due_at"] else f"[{r['id']}] {r['text']} (no time)"
        for r in open_reminders
    ) or "(none)"
    prompt = (
        f"Current local date and time: {now:%A, %Y-%m-%d %H:%M}\n\nCalendar:\n{_calendar(now)}\n\n"
        f"OPEN REMINDERS:\n{listing}\n\nUSER MESSAGE:\n\"\"\"\n{user_text[:2000]}\n\"\"\""
    )
    raw = await ollama.complete(
        model,
        [{"role": "system", "content": EXTRACT_PROMPT}, {"role": "user", "content": prompt}],
        json_mode=True,
        options={"temperature": 0},
    )
    try:
        data = json.loads(raw)
    except ValueError:
        log.warning("reminder extraction returned non-JSON: %r", raw[:200])
        return None
    if not isinstance(data, dict):
        return None

    by_id = {r["id"]: r for r in open_reminders}

    def ids(key):
        out = []
        for v in data.get(key) or []:
            try:
                v = int(v)
            except (TypeError, ValueError):
                continue
            if v in by_id and v not in out:
                out.append(v)
        return out

    completed, deleted = [], []
    for rid in ids("complete"):
        db.update_reminder(rid, done=True)
        completed.append({"id": rid, "text": by_id.pop(rid)["text"]})
    for rid in ids("delete"):
        db.delete_reminder(rid)
        deleted.append({"id": rid, "text": by_id.pop(rid)["text"]})

    items = [a for a in (data.get("add") or []) if isinstance(a, dict) and isinstance(a.get("text"), str)]
    relative = _relative_due(user_text, dt.datetime.now()) if len(items) == 1 else None
    added = []
    for item in items[:5]:
        text = " ".join(item["text"].split()).strip(" .")[:200]
        if not text:
            continue
        text = text[0].upper() + text[1:]
        due_at = relative or _parse_due(item.get("due"), now)
        r = db.add_reminder(text, due_at, conversation_id)
        added.append({"id": r["id"], "text": text, "due_at": due_at})

    if not (added or completed or deleted):
        return None
    return {"added": added, "completed": completed, "deleted": deleted}


def prompt_section(note: dict | None, analyzed: bool = True) -> str:
    """System-prompt section telling the chat model about reminders and what just changed."""
    lines = [
        "## Reminders",
        "This app has a Reminders list in its sidebar and notifies the user when a reminder is due. "
        "Reminders are created from the user's messages automatically, so never say you can't set reminders.",
    ]
    if note:
        lines.append("Changes made from the user's latest message (confirm them briefly):")
        lines += [f'- Saved reminder "{a["text"]}" for {format_due(a["due_at"])}.' for a in note["added"]]
        lines += [f'- Marked "{c["text"]}" as done.' for c in note["completed"]]
        lines += [f'- Deleted reminder "{d["text"]}".' for d in note["deleted"]]
    elif analyzed:
        lines.append(
            "No reminder was changed by the latest message. If the user was trying to set or change one "
            "(not just asking about them), "
            "say it wasn't saved and suggest rephrasing with what and when, or using the + button in the Reminders panel.")
    open_reminders = db.list_reminders(open_only=True)
    if open_reminders:
        lines.append("The user's open reminders:")
        lines += [f"- {r['text']}: {format_due(r['due_at'])}" for r in open_reminders[:25]]
    else:
        lines.append("The user has no open reminders.")
    return "\n".join(lines)
