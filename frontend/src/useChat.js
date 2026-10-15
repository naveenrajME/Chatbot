import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamChat } from "./api.js";

let nextLocalId = 1;
const withLocalId = m => ({ ...m, localId: nextLocalId++ });

function setHash(id) {
  window.history.replaceState(null, "", id ? "#" + id : window.location.pathname);
}

/**
 * Owns the open chat and the reply being streamed.
 * `chat` is null for an unsaved new chat, otherwise {key, id, title, messages}.
 * `key` stays fixed for the life of the chat object, even before the server assigns an id.
 */
export function useChat({ onConversationsChanged, onMemoryChanged, onRemindersChanged, toast }) {
  const [chat, setChat] = useState(null);
  const [busy, setBusy] = useState(false);
  const ctrlRef = useRef(null);
  const shownKeyRef = useRef(null);

  useEffect(() => { shownKeyRef.current = chat?.key ?? null; }, [chat?.key]);

  const updateChat = useCallback((key, fn) => setChat(c => (c && c.key === key ? fn(c) : c)), []);
  const updateMessage = useCallback((key, localId, fn) =>
    updateChat(key, c => ({ ...c, messages: c.messages.map(m => (m.localId === localId ? fn(m) : m)) })), [updateChat]);

  const stop = useCallback(() => ctrlRef.current?.abort(), []);

  const open = useCallback(async id => {
    stop();
    try {
      const conv = await api.conversation(id);
      setChat({ ...conv, key: conv.id, messages: conv.messages.map(withLocalId) });
      setHash(conv.id);
    } catch {
      setChat(null);
      setHash(null);
      toast("That chat no longer exists.");
    }
  }, [stop, toast]);

  const newChat = useCallback(() => {
    stop();
    setChat(null);
    setHash(null);
  }, [stop]);

  const send = useCallback(async ({ text = "", model, regenerate = false }) => {
    if (ctrlRef.current) return;
    const base = chat ?? { key: "new-" + nextLocalId++, id: null, title: "New chat", messages: [] };
    const key = base.key;

    let messages = [...base.messages];
    if (regenerate) {
      while (messages.length && messages.at(-1).role === "assistant") messages.pop();
    } else {
      messages.push(withLocalId({ role: "user", content: text }));
    }
    const reply = withLocalId({ role: "assistant", content: "", streaming: true });
    setChat({ ...base, messages: [...messages, reply] });

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setBusy(true);

    // Tokens arrive faster than React needs to repaint; batch them.
    let pending = "", received = "", finished = false;
    const flush = () => {
      if (!pending) return;
      const chunk = pending; pending = "";
      updateMessage(key, reply.localId, m => ({ ...m, content: m.content + chunk }));
    };
    const timer = setInterval(flush, 40);
    const finish = (patch = {}) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      flush();
      updateMessage(key, reply.localId, m => ({
        ...m, ...patch, streaming: false, content: m.content || "_(no response)_",
      }));
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; setBusy(false); }
    };
    const appendError = msg => { pending += (received ? "\n\n" : "") + "⚠️ " + msg; };

    try {
      await streamChat(
        { model, conversation_id: base.id, message: regenerate ? null : text, regenerate },
        {
          signal: ctrl.signal,
          onEvent: ev => {
            switch (ev.type) {
              case "conversation":
                if (!base.id) {
                  updateChat(key, c => ({ ...c, id: ev.id, title: ev.title }));
                  if (shownKeyRef.current === key) setHash(ev.id);
                  onConversationsChanged();
                }
                break;
              case "status":
                updateMessage(key, reply.localId, m => ({ ...m, status: ev.text }));
                break;
              case "reminders": {
                const note = { added: ev.added, completed: ev.completed, deleted: ev.deleted };
                updateMessage(key, reply.localId, m => ({ ...m, status: null, reminder_note: note }));
                onRemindersChanged();
                toast(ev.added.length ? `Reminder set: ${ev.added[0].text}${ev.added.length > 1 ? ` (+${ev.added.length - 1} more)` : ""}`
                  : "Reminders updated");
                break;
              }
              case "token":
                pending += ev.content; received += ev.content;
                break;
              case "done":
                finish({ id: ev.message_id, meta: ev.meta });
                break;
              case "error":
                appendError(ev.message); finish();
                break;
              case "title":
                updateChat(key, c => ({ ...c, title: ev.title }));
                onConversationsChanged();
                break;
              case "memory":
                updateMessage(key, reply.localId, m => ({ ...m, memory_note: { added: ev.added, removed: ev.removed } }));
                onMemoryChanged();
                toast(ev.added.length ? "Memory updated" : "Memory removed");
                break;
            }
          },
        }
      );
    } catch (e) {
      if (e.name === "AbortError") finish({ meta: "Stopped" });
      else if (!finished) {
        appendError(e instanceof TypeError ? "Can't reach the Local Chat server. Is it still running?" : e.message);
        finish();
      }
    } finally {
      finish();
      onConversationsChanged();
    }
  }, [chat, updateChat, updateMessage, onConversationsChanged, onMemoryChanged, onRemindersChanged, toast]);

  const rename = useCallback((id, title) =>
    setChat(c => (c && c.id === id ? { ...c, title } : c)), []);

  return { chat, busy, send, stop, open, newChat, rename };
}
