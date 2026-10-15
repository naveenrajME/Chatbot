import { memo, useMemo } from "react";
import { AlarmClock, Brain, RefreshCw } from "lucide-react";
import { dueLabel } from "../useReminders.js";
import Markdown from "./Markdown.jsx";
import CopyButton from "./CopyButton.jsx";
import Logo from "./Logo.jsx";
import AddToChecklist from "./AddToChecklist.jsx";
import { listLines } from "../useChecklists.js";

function MemoryChip({ note }) {
  const added = note?.added ?? [];
  const removed = note?.removed ?? [];
  if (!added.length && !removed.length) return null;
  return (
    <details className="chip chip-memory">
      <summary><Brain size={13} /> Memory updated</summary>
      <ul>
        {added.map((t, i) => <li key={"a" + i}>{t}</li>)}
        {removed.map((t, i) => <li key={"r" + i} className="removed">{t}</li>)}
      </ul>
    </details>
  );
}

function ReminderChip({ note }) {
  const added = note?.added ?? [], completed = note?.completed ?? [], deleted = note?.deleted ?? [];
  if (!added.length && !completed.length && !deleted.length) return null;
  const label = added.length ? `Reminder${added.length > 1 ? "s" : ""} set` : "Reminders updated";
  return (
    <details className="chip chip-reminder" open>
      <summary><AlarmClock size={13} /> {label}</summary>
      <ul>
        {added.map(a => <li key={"a" + a.id}>{a.text}{a.due_at ? <span className="chip-when"> · {dueLabel(a.due_at)}</span> : null}</li>)}
        {completed.map(c => <li key={"c" + c.id}>✓ {c.text}</li>)}
        {deleted.map(d => <li key={"d" + d.id} className="removed">{d.text}</li>)}
      </ul>
    </details>
  );
}

function Message({ message, isLast, canRegenerate, onRegenerate }) {
  const lines = useMemo(
    () => (message.role !== "assistant" || message.streaming ? [] : listLines(message.content)),
    [message.role, message.streaming, message.content]);
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }
  const thinking = message.streaming && !message.content;
  return (
    <div className={"msg assistant" + (isLast ? " last" : "")}>
      <div className={"avatar" + (message.streaming ? " live" : "")}><Logo size={16} /></div>
      <div className="msg-main">
        {thinking ? (
          <div className="thinking">
            <span className="dots"><i /><i /><i /></span>
            {message.status && <span>{message.status}</span>}
          </div>
        ) : (
          <div className={"body" + (message.streaming ? " cursor" : "")}>
            <Markdown text={message.content} />
          </div>
        )}
        {message.streaming && <div className="chips"><ReminderChip note={message.reminder_note} /></div>}
        {!message.streaming && (
          <>
            <div className="chips">
              <ReminderChip note={message.reminder_note} />
              <MemoryChip note={message.memory_note} />
            </div>
            <div className="msg-foot">
              <CopyButton getText={() => message.content} />
              {canRegenerate && (
                <button type="button" onClick={onRegenerate}>
                  <RefreshCw size={14} /><span>Regenerate</span>
                </button>
              )}
              <AddToChecklist lines={lines} />
              {message.meta && <span className="meta">{message.meta}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(Message);
