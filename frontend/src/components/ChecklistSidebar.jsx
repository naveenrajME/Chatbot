import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { doneCount } from "../useChecklists.js";

function Row({ checklist, active, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(checklist.name);
  const done = doneCount(checklist), total = checklist.items.length;

  const finish = save => {
    if (!editing) return;
    setEditing(false);
    const name = draft.trim();
    if (save && name && name !== checklist.name) onRename(checklist.id, name);
  };
  const startEdit = () => { setDraft(checklist.name); setEditing(true); };

  if (editing) {
    return (
      <div className="chat-item active">
        <input autoFocus value={draft} maxLength={120} aria-label="Checklist name"
          onChange={e => setDraft(e.target.value)} onFocus={e => e.target.select()}
          onKeyDown={e => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); }}
          onBlur={() => finish(true)} />
      </div>
    );
  }

  return (
    <div className={"chat-item cl-row" + (active ? " active" : "")}>
      <button type="button" className="open" title={`${checklist.name} — double-click to rename`}
        aria-label={`${checklist.name}, ${done} of ${total} done`}
        onClick={() => onOpen(checklist.id)} onDoubleClick={startEdit}>
        <span className="cl-row-name">{checklist.name}</span>
        <span className={"cl-count" + (total && done === total ? " complete" : "")}>{done}/{total}</span>
      </button>
      <button type="button" className="act" title="Rename" aria-label={`Rename ${checklist.name}`} onClick={startEdit}>
        <Pencil size={14} />
      </button>
      <button type="button" className="act del" title="Delete" aria-label={`Delete ${checklist.name}`}
        onClick={() => onDelete(checklist)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** Inline "name your checklist" field shown at the top of the list. */
export function NewChecklistField({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const submit = () => { const n = name.trim(); if (n) onCreate(n); else onCancel(); };
  return (
    <div className="chat-item active cl-new">
      <input autoFocus value={name} maxLength={120} placeholder="Checklist name, then Enter"
        aria-label="New checklist name" onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        onBlur={() => (name.trim() ? submit() : onCancel())} />
    </div>
  );
}

export default function ChecklistSidebar({ checklists, activeId, creating, onCreate, onCancelCreate, onOpen, onRename, onDelete }) {
  return (
    <nav className="chat-list" aria-label="Checklists">
      {creating && <NewChecklistField onCreate={onCreate} onCancel={onCancelCreate} />}
      {!checklists.length && !creating && (
        <div className="list-empty">No checklists yet. Press “New checklist”, or use “Add to checklist” under a reply.</div>
      )}
      {checklists.map(c => (
        <Row key={c.id} checklist={c} active={c.id === activeId}
          onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
      ))}
    </nav>
  );
}
