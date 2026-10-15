"""SQLite storage for conversations, messages, memories and settings."""
from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "chat.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    model       TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    meta            TEXT,
    memory_note     TEXT,
    created_at      REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS memories (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    content                TEXT NOT NULL,
    source_conversation_id TEXT,
    created_at             REAL NOT NULL,
    updated_at             REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    text                   TEXT NOT NULL,
    due_at                 REAL,               -- unix time, NULL = no time set
    done                   INTEGER NOT NULL DEFAULT 0,
    notified               INTEGER NOT NULL DEFAULT 0,
    source_conversation_id TEXT,
    created_at             REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS checklists (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS checklist_items (
    id           TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    text         TEXT NOT NULL,
    done         INTEGER NOT NULL DEFAULT 0,
    position     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_items ON checklist_items(checklist_id, position);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Full-text index over messages, used for chat search and "reference past chats".
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, content='messages', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
"""

DEFAULT_SETTINGS = {
    "custom_instructions": "",
    "memory_enabled": True,     # include saved memories in every chat
    "auto_memory": True,        # let the model save new memories automatically
    "history_recall": True,     # pull related snippets from other chats
    "default_model": "",
}


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        # Columns added after the first release.
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(messages)")}
        if "reminder_note" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN reminder_note TEXT")


# ---------------------------------------------------------------- conversations

def list_conversations(query: str = "") -> list[dict]:
    with connect() as conn:
        if not query.strip():
            rows = conn.execute(
                "SELECT id, title, model, updated_at FROM conversations ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]
        fts = _fts_query(query, prefix=True, joiner=" AND ")
        sql = "SELECT id, title, model, updated_at FROM conversations WHERE title LIKE ?"
        params: list = [f"%{query.strip()}%"]
        if fts:
            sql += """ OR id IN (SELECT m.conversation_id FROM messages_fts f
                                 JOIN messages m ON m.id = f.rowid
                                 WHERE messages_fts MATCH ?)"""
            params.append(fts)
        rows = conn.execute(sql + " ORDER BY updated_at DESC", params).fetchall()
        return [dict(r) for r in rows]


def get_conversation(cid: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (cid,)).fetchone()
        return dict(row) if row else None


def create_conversation(title: str, model: str | None) -> dict:
    now = time.time()
    conv = {"id": uuid.uuid4().hex[:12], "title": title, "model": model,
            "created_at": now, "updated_at": now}
    with connect() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (conv["id"], title, model, now, now),
        )
    return conv


def rename_conversation(cid: str, title: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE conversations SET title = ? WHERE id = ?", (title, cid))


def delete_conversation(cid: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (cid,))
        conn.execute("DELETE FROM conversations WHERE id = ?", (cid,))


# --------------------------------------------------------------------- messages

def get_messages(cid: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, role, content, meta, memory_note, reminder_note FROM messages "
            "WHERE conversation_id = ? ORDER BY id",
            (cid,),
        ).fetchall()
    out = []
    for r in rows:
        m = dict(r)
        for key in ("memory_note", "reminder_note"):
            m[key] = json.loads(m[key]) if m[key] else None
        out.append(m)
    return out


def add_message(cid: str, role: str, content: str, meta: str | None = None) -> int:
    now = time.time()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)",
            (cid, role, content, meta, now),
        )
        conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, cid))
        return cur.lastrowid


def set_memory_note(message_id: int, note: dict) -> None:
    with connect() as conn:
        conn.execute("UPDATE messages SET memory_note = ? WHERE id = ?", (json.dumps(note), message_id))


def set_reminder_note(message_id: int, note: dict) -> None:
    with connect() as conn:
        conn.execute("UPDATE messages SET reminder_note = ? WHERE id = ?", (json.dumps(note), message_id))


def prepare_regenerate(cid: str) -> str | None:
    """Drop trailing assistant replies and return the last user message to answer again."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC",
            (cid,),
        ).fetchall()
        for r in rows:
            if r["role"] == "user":
                return r["content"]
            conn.execute("DELETE FROM messages WHERE id = ?", (r["id"],))
    return None


# ------------------------------------------------------------- history recall

_STOPWORDS = set("""
about above after again also another because been before being below between both but
could does doing down during each from further have having here into itself just like
make more most much must need only other over same should some such than that their them
then there these they this those through under until very want were what when where which
while will with would your yours please thanks thank tell explain write give show help
""".split())


def _fts_query(text: str, prefix: bool = False, joiner: str = " OR ") -> str:
    words = re.findall(r"[A-Za-z0-9_]+", text.lower())
    min_len = 2 if prefix else 4
    words = [w for w in dict.fromkeys(words) if len(w) >= min_len and w not in _STOPWORDS][:12]
    return joiner.join(f'"{w}"' + ("*" if prefix else "") for w in words)


def search_history(text: str, exclude_conversation: str, limit: int = 2) -> list[dict]:
    """Find earlier user messages (and the reply to each) from *other* chats that match `text`."""
    fts = _fts_query(text)
    if not fts:
        return []
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT c.title, m.content AS question,
                   (SELECT a.content FROM messages a
                     WHERE a.conversation_id = m.conversation_id AND a.id > m.id AND a.role = 'assistant'
                     ORDER BY a.id LIMIT 1) AS answer
            FROM messages_fts f
            JOIN messages m ON m.id = f.rowid
            JOIN conversations c ON c.id = m.conversation_id
            WHERE messages_fts MATCH ? AND m.role = 'user' AND m.conversation_id != ?
            ORDER BY bm25(messages_fts)
            LIMIT ?
            """,
            (fts, exclude_conversation, limit),
        ).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------------- memories

def list_memories() -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, content, source_conversation_id, created_at, updated_at FROM memories ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


def add_memory(content: str, source_conversation_id: str | None = None) -> dict:
    now = time.time()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO memories (content, source_conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (content, source_conversation_id, now, now),
        )
        return {"id": cur.lastrowid, "content": content, "source_conversation_id": source_conversation_id,
                "created_at": now, "updated_at": now}


def update_memory(mid: int, content: str) -> bool:
    with connect() as conn:
        cur = conn.execute("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
                           (content, time.time(), mid))
        return cur.rowcount > 0


def delete_memory(mid: int) -> bool:
    with connect() as conn:
        return conn.execute("DELETE FROM memories WHERE id = ?", (mid,)).rowcount > 0


def clear_memories() -> None:
    with connect() as conn:
        conn.execute("DELETE FROM memories")


# -------------------------------------------------------------------- reminders

def _reminder(row: sqlite3.Row) -> dict:
    r = dict(row)
    r["done"] = bool(r["done"])
    r["notified"] = bool(r["notified"])
    return r


def list_reminders(open_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM reminders"
    if open_only:
        sql += " WHERE done = 0"
    # Timed reminders first, soonest first; untimed ones after, newest first.
    sql += " ORDER BY done, due_at IS NULL, due_at, created_at DESC"
    with connect() as conn:
        return [_reminder(r) for r in conn.execute(sql)]


def get_reminder(rid: int) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM reminders WHERE id = ?", (rid,)).fetchone()
        return _reminder(row) if row else None


def add_reminder(text: str, due_at: float | None, source_conversation_id: str | None = None) -> dict:
    now = time.time()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO reminders (text, due_at, source_conversation_id, created_at) VALUES (?, ?, ?, ?)",
            (text, due_at, source_conversation_id, now),
        )
    return get_reminder(cur.lastrowid)


_UNSET = object()


def update_reminder(rid: int, *, text=None, due_at=_UNSET, done=None, notified=None) -> dict | None:
    sets, params = [], []
    if text is not None:
        sets.append("text = ?"); params.append(text)
    if due_at is not _UNSET:
        sets.append("due_at = ?"); params.append(due_at)
        sets.append("notified = 0")             # a new time needs a new notification
    if done is not None:
        sets.append("done = ?"); params.append(int(done))
        if not done:
            sets.append("notified = 0")
    if notified is not None:
        sets.append("notified = ?"); params.append(int(notified))
    if sets:
        with connect() as conn:
            conn.execute(f"UPDATE reminders SET {', '.join(sets)} WHERE id = ?", (*params, rid))
    return get_reminder(rid)


def delete_reminder(rid: int) -> bool:
    with connect() as conn:
        return conn.execute("DELETE FROM reminders WHERE id = ?", (rid,)).rowcount > 0


# ------------------------------------------------------------------- checklists
# Shape returned to the frontend: {id, name, created, items: [{id, text, done}]}

def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _checklist(conn: sqlite3.Connection, cid: str) -> dict | None:
    row = conn.execute("SELECT id, name, created FROM checklists WHERE id = ?", (cid,)).fetchone()
    if not row:
        return None
    items = conn.execute(
        "SELECT id, text, done FROM checklist_items WHERE checklist_id = ? ORDER BY position, rowid", (cid,)
    ).fetchall()
    return {**dict(row), "items": [{"id": i["id"], "text": i["text"], "done": bool(i["done"])} for i in items]}


def _append_items(conn: sqlite3.Connection, cid: str, texts: list[str]) -> None:
    start = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM checklist_items WHERE checklist_id = ?",
                         (cid,)).fetchone()[0]
    conn.executemany(
        "INSERT INTO checklist_items (id, checklist_id, text, position) VALUES (?, ?, ?, ?)",
        [(_new_id(), cid, t, start + n) for n, t in enumerate(texts)],
    )


def list_checklists() -> list[dict]:
    with connect() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM checklists ORDER BY created DESC")]
        return [_checklist(conn, cid) for cid in ids]


def create_checklist(name: str, texts: list[str] = ()) -> dict:
    cid = _new_id()
    with connect() as conn:
        conn.execute("INSERT INTO checklists (id, name, created) VALUES (?, ?, ?)", (cid, name, time.time()))
        if texts:
            _append_items(conn, cid, list(texts))
        return _checklist(conn, cid)


def rename_checklist(cid: str, name: str) -> dict | None:
    with connect() as conn:
        conn.execute("UPDATE checklists SET name = ? WHERE id = ?", (name, cid))
        return _checklist(conn, cid)


def delete_checklist(cid: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM checklist_items WHERE checklist_id = ?", (cid,))
        conn.execute("DELETE FROM checklists WHERE id = ?", (cid,))


def add_checklist_items(cid: str, texts: list[str]) -> dict | None:
    with connect() as conn:
        if not conn.execute("SELECT 1 FROM checklists WHERE id = ?", (cid,)).fetchone():
            return None
        _append_items(conn, cid, texts)
        return _checklist(conn, cid)


def update_checklist_item(cid: str, iid: str, *, text: str | None = None, done: bool | None = None) -> dict | None:
    with connect() as conn:
        if text is not None:
            conn.execute("UPDATE checklist_items SET text = ? WHERE id = ? AND checklist_id = ?", (text, iid, cid))
        if done is not None:
            conn.execute("UPDATE checklist_items SET done = ? WHERE id = ? AND checklist_id = ?", (int(done), iid, cid))
        return _checklist(conn, cid)


def delete_checklist_item(cid: str, iid: str) -> dict | None:
    with connect() as conn:
        conn.execute("DELETE FROM checklist_items WHERE id = ? AND checklist_id = ?", (iid, cid))
        return _checklist(conn, cid)


def reorder_checklist(cid: str, ids: list[str]) -> dict | None:
    """Put items in the given order; items not listed keep their relative order after them."""
    with connect() as conn:
        current = [r["id"] for r in conn.execute(
            "SELECT id FROM checklist_items WHERE checklist_id = ? ORDER BY position, rowid", (cid,))]
        known, listed = set(current), set(ids)
        order = [i for i in dict.fromkeys(ids) if i in known] + [i for i in current if i not in listed]
        conn.executemany("UPDATE checklist_items SET position = ? WHERE id = ?", [(n, i) for n, i in enumerate(order)])
        return _checklist(conn, cid)


def clear_completed(cid: str) -> dict | None:
    with connect() as conn:
        conn.execute("DELETE FROM checklist_items WHERE checklist_id = ? AND done = 1", (cid,))
        return _checklist(conn, cid)


def uncheck_all(cid: str) -> dict | None:
    with connect() as conn:
        conn.execute("UPDATE checklist_items SET done = 0 WHERE checklist_id = ?", (cid,))
        return _checklist(conn, cid)


# --------------------------------------------------------------------- settings

def get_settings() -> dict:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out = dict(DEFAULT_SETTINGS)
    for r in rows:
        if r["key"] in out:
            out[r["key"]] = json.loads(r["value"])
    return out


def update_settings(values: dict) -> dict:
    with connect() as conn:
        for key, value in values.items():
            if key in DEFAULT_SETTINGS:
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, json.dumps(value)),
                )
    return get_settings()
