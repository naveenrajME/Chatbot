// Thin wrappers around the FastAPI backend.

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return res.json();
}

async function errorText(res) {
  try {
    const j = await res.json();
    return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
  } catch {
    return `Server error ${res.status}`;
  }
}

export const api = {
  models: () => request("/api/models"),

  conversations: (q = "") => request("/api/conversations" + (q ? "?q=" + encodeURIComponent(q) : "")),
  conversation: id => request(`/api/conversations/${id}`),
  renameConversation: (id, title) => request(`/api/conversations/${id}`, { method: "PATCH", body: { title } }),
  deleteConversation: id => request(`/api/conversations/${id}`, { method: "DELETE" }),

  memories: () => request("/api/memories"),
  addMemory: content => request("/api/memories", { method: "POST", body: { content } }),
  updateMemory: (id, content) => request(`/api/memories/${id}`, { method: "PATCH", body: { content } }),
  deleteMemory: id => request(`/api/memories/${id}`, { method: "DELETE" }),
  clearMemories: () => request("/api/memories", { method: "DELETE" }),

  reminders: () => request("/api/reminders"),
  addReminder: (text, due_at) => request("/api/reminders", { method: "POST", body: { text, due_at } }),
  updateReminder: (id, fields) => request(`/api/reminders/${id}`, { method: "PATCH", body: fields }),
  deleteReminder: id => request(`/api/reminders/${id}`, { method: "DELETE" }),

  checklists: () => request("/api/checklists"),
  createChecklist: (name, items = []) => request("/api/checklists", { method: "POST", body: { name, items } }),
  renameChecklist: (id, name) => request(`/api/checklists/${id}`, { method: "PATCH", body: { name } }),
  deleteChecklist: id => request(`/api/checklists/${id}`, { method: "DELETE" }),
  addChecklistItems: (id, texts) => request(`/api/checklists/${id}/items`, { method: "POST", body: { texts } }),
  updateChecklistItem: (id, itemId, fields) =>
    request(`/api/checklists/${id}/items/${itemId}`, { method: "PATCH", body: fields }),
  deleteChecklistItem: (id, itemId) => request(`/api/checklists/${id}/items/${itemId}`, { method: "DELETE" }),
  reorderChecklist: (id, ids) => request(`/api/checklists/${id}/order`, { method: "PUT", body: { ids } }),
  clearCompleted: id => request(`/api/checklists/${id}/clear-completed`, { method: "POST" }),
  uncheckAll: id => request(`/api/checklists/${id}/uncheck-all`, { method: "POST" }),

  settings: () => request("/api/settings"),
  updateSettings: values => request("/api/settings", { method: "PUT", body: values }),
};

/**
 * POST /api/chat and call onEvent for every NDJSON event the server streams:
 * conversation, token, done, error, title, memory.
 */
export async function streamChat(body, { signal, onEvent }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await errorText(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}
