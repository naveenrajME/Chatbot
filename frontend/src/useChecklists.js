import { createContext, useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

/** Lets replies deep in the message list add their bullet points to a checklist. */
export const ChecklistContext = createContext(null);

export const doneCount = c => c.items.filter(i => i.done).length;

/** Bullet and numbered lines from a reply, skipping code blocks and stripping simple markdown. */
export function listLines(src) {
  const out = [];
  src.split("```").forEach((part, i) => {
    if (i % 2) return;
    for (const line of part.split("\n")) {
      const m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*\S)/);
      if (!m) continue;
      const text = m[1]
        .replace(/^\[[ xX]\]\s*/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1$2")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
      if (text) out.push(text.slice(0, 500));
    }
  });
  return out;
}

/**
 * Checklist state backed by the server. Checking, deleting and reordering update the
 * screen first and then save; if saving fails the list is reloaded from the server.
 */
export function useChecklists(toast) {
  const [checklists, setChecklists] = useState([]);

  const load = useCallback(async () => {
    try { setChecklists(await api.checklists()); } catch { /* keep what we have */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const replace = useCallback(updated => {
    setChecklists(list => list.map(c => (c.id === updated.id ? updated : c)));
    return updated;
  }, []);

  const local = useCallback((id, fn) => {
    setChecklists(list => list.map(c => (c.id === id ? fn(c) : c)));
  }, []);

  const save = useCallback(async (promise, failMsg = "Couldn't save") => {
    try { return replace(await promise); }
    catch (e) { toast(`${failMsg}: ${e.message}`); load(); return null; }
  }, [replace, toast, load]);

  const create = useCallback(async (name, items = []) => {
    try {
      const c = await api.createChecklist(name, items);
      setChecklists(list => [c, ...list]);
      return c;
    } catch (e) { toast("Couldn't create checklist: " + e.message); return null; }
  }, [toast]);

  const remove = useCallback(async id => {
    setChecklists(list => list.filter(c => c.id !== id));
    try { await api.deleteChecklist(id); } catch (e) { toast("Couldn't delete: " + e.message); load(); }
  }, [toast, load]);

  return {
    checklists,
    load,
    create,
    remove,
    rename: (id, name) => {
      local(id, c => ({ ...c, name }));
      return save(api.renameChecklist(id, name), "Couldn't rename");
    },
    addItems: (id, texts) => save(api.addChecklistItems(id, texts), "Couldn't add"),
    toggle: (id, itemId, done) => {
      local(id, c => ({ ...c, items: c.items.map(i => (i.id === itemId ? { ...i, done } : i)) }));
      return save(api.updateChecklistItem(id, itemId, { done }));
    },
    editItem: (id, itemId, text) => {
      local(id, c => ({ ...c, items: c.items.map(i => (i.id === itemId ? { ...i, text } : i)) }));
      return save(api.updateChecklistItem(id, itemId, { text }));
    },
    deleteItem: (id, itemId) => {
      local(id, c => ({ ...c, items: c.items.filter(i => i.id !== itemId) }));
      return save(api.deleteChecklistItem(id, itemId), "Couldn't delete");
    },
    reorder: (id, items) => {
      local(id, c => ({ ...c, items }));
      return save(api.reorderChecklist(id, items.map(i => i.id)), "Couldn't reorder");
    },
    clearCompleted: id => {
      local(id, c => ({ ...c, items: c.items.filter(i => !i.done) }));
      return save(api.clearCompleted(id));
    },
    uncheckAll: id => {
      local(id, c => ({ ...c, items: c.items.map(i => ({ ...i, done: false })) }));
      return save(api.uncheckAll(id));
    },
  };
}
