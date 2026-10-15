import { useEffect, useState } from "react";
import { AlarmClock, Bell, BellOff, ChevronDown, Check, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { dueLabel, fromLocalInput, notificationsSupported, toLocalInput } from "../useReminders.js";

const COLLAPSE_KEY = "localchat-reminders-collapsed";

function ReminderForm({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial?.text ?? "");
  const [when, setWhen] = useState(toLocalInput(initial?.due_at));
  const submit = e => {
    e.preventDefault();
    const value = text.trim();
    if (value) onSave(value, fromLocalInput(when));
  };
  return (
    <form className="rem-form" onSubmit={submit} onKeyDown={e => e.key === "Escape" && onCancel()}>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} maxLength={200}
        placeholder="Remind me to…" aria-label="Reminder" />
      <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="When (optional)" />
      <div className="rem-form-actions">
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
        <button className="btn small" disabled={!text.trim()}>{initial ? "Save" : "Add"}</button>
      </div>
    </form>
  );
}

function ReminderRow({ r, onToggle, onEdit, onDelete, onOpenChat }) {
  const overdue = !r.done && r.due_at && r.due_at * 1000 < Date.now();
  return (
    <li className={"rem" + (r.done ? " done" : "") + (overdue ? " overdue" : "")}>
      <button type="button" className="rem-check" onClick={() => onToggle(r)}
        aria-label={r.done ? "Mark as not done" : "Mark as done"} title={r.done ? "Mark as not done" : "Mark as done"}>
        {r.done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="rem-main">
        <span className="rem-text">{r.text}</span>
        {r.due_at && <span className="rem-due">{overdue ? "Overdue · " : ""}{dueLabel(r.due_at)}</span>}
      </div>
      <div className="rem-acts">
        {r.source_conversation_id && (
          <button type="button" onClick={() => onOpenChat(r.source_conversation_id)} title="Open the chat it came from"
            aria-label="Open source chat"><MessageSquare size={13} /></button>
        )}
        <button type="button" onClick={() => onEdit(r)} title="Edit" aria-label="Edit reminder"><Pencil size={13} /></button>
        <button type="button" className="del" onClick={() => onDelete(r)} title="Delete" aria-label="Delete reminder">
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

export default function RemindersPanel({ reminders, permission, onRequestPermission, onAdd, onUpdate, onDelete, onOpenChat }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  const open = reminders.filter(r => !r.done);
  const done = reminders.filter(r => r.done);
  const overdue = open.filter(r => r.due_at && r.due_at * 1000 < Date.now()).length;

  const save = async (text, due_at) => {
    if (editing) await onUpdate(editing.id, { text, due_at });
    else await onAdd(text, due_at);
    setAdding(false);
    setEditing(null);
  };

  return (
    <section className={"reminders" + (collapsed ? " collapsed" : "")}>
      <div className="rem-head">
        <button type="button" className="rem-toggle" onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>
          <AlarmClock size={16} />
          <span>Reminders</span>
          {open.length > 0 && <span className={"badge" + (overdue ? " alert" : "")}>{open.length}</span>}
          <ChevronDown size={15} className="chev" />
        </button>
        {notificationsSupported && permission === "default" && (
          <button type="button" className="icon-btn sm" onClick={onRequestPermission}
            title="Turn on desktop notifications" aria-label="Turn on desktop notifications"><Bell size={15} /></button>
        )}
        {permission === "denied" && notificationsSupported && (
          <span className="icon-btn sm muted" title="Desktop notifications are blocked in your browser settings. You'll still get in-app alerts.">
            <BellOff size={15} />
          </span>
        )}
        <button type="button" className="icon-btn sm" title="Add reminder" aria-label="Add reminder"
          onClick={() => { setCollapsed(false); setEditing(null); setAdding(true); }}><Plus size={16} /></button>
      </div>

      {!collapsed && (
        <div className="rem-body">
          {(adding || editing) && (
            <ReminderForm key={editing?.id ?? "new"} initial={editing} onSave={save}
              onCancel={() => { setAdding(false); setEditing(null); }} />
          )}
          {!open.length && !adding && (
            <p className="rem-empty">No reminders. Say “remind me to…” in a chat, or press +.</p>
          )}
          <ul className="rem-list">
            {open.map(r => (
              <ReminderRow key={r.id} r={r} onOpenChat={onOpenChat}
                onToggle={x => onUpdate(x.id, { done: true })}
                onEdit={x => { setAdding(false); setEditing(x); }}
                onDelete={x => onDelete(x.id)} />
            ))}
          </ul>
          {done.length > 0 && (
            <>
              <button type="button" className="link rem-done-toggle" onClick={() => setShowDone(s => !s)}>
                {showDone ? "Hide" : "Show"} completed ({done.length})
              </button>
              {showDone && (
                <ul className="rem-list">
                  {done.map(r => (
                    <ReminderRow key={r.id} r={r} onOpenChat={onOpenChat}
                      onToggle={x => onUpdate(x.id, { done: false })}
                      onEdit={x => { setAdding(false); setEditing(x); }}
                      onDelete={x => onDelete(x.id)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
