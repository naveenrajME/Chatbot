import { useEffect, useRef, useState } from "react";
import { GripVertical, ListChecks, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { doneCount } from "../useChecklists.js";

function Item({ item, onToggle, onEdit, onDelete, onMove, drag }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);

  const finish = save => {
    if (!editing) return;
    setEditing(false);
    const v = draft.trim();
    if (save && v && v !== item.text) onEdit(v);
  };

  const onKeyDown = e => {
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      onMove(e.key === "ArrowUp" ? -1 : 1, e.target);
    }
  };

  return (
    <li
      className={"cl-item" + (item.done ? " done" : "") + (drag.dragging ? " dragging" : "") +
        (drag.over === "before" ? " drop-before" : drag.over === "after" ? " drop-after" : "")}
      data-id={item.id}
      draggable={drag.armed}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
      onKeyDown={onKeyDown}
    >
      <button type="button" className="cl-grip" title="Drag to reorder (or Alt + ↑/↓)" aria-label={`Reorder ${item.text}`}
        onMouseDown={drag.arm} onMouseUp={drag.disarm}>
        <GripVertical size={15} />
      </button>
      <input type="checkbox" className="cl-check" checked={item.done} onChange={e => onToggle(e.target.checked)}
        aria-label={item.text} />
      {editing ? (
        <input
          className="cl-edit"
          autoFocus
          value={draft}
          maxLength={500}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") { e.stopPropagation(); finish(false); }
          }}
          onBlur={() => finish(true)}
          aria-label="Edit item"
        />
      ) : (
        <span className="cl-text" title="Double-click to edit" onDoubleClick={() => { setDraft(item.text); setEditing(true); }}>
          {item.text}
        </span>
      )}
      <button type="button" className="cl-del" title="Delete item" aria-label={`Delete ${item.text}`} onClick={onDelete}>
        <X size={15} />
      </button>
    </li>
  );
}

export default function ChecklistView({ checklist, actions, onNew }) {
  const [text, setText] = useState("");
  const [armed, setArmed] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);           // { id, pos: "before" | "after" }
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const focusAfter = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [checklist?.id]);

  // Restore keyboard focus to the same control after the list re-renders.
  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    listRef.current?.querySelector(`[data-id="${f.id}"] ${f.sel}`)?.focus();
  });

  if (!checklist) {
    return (
      <div className="cl-view">
        <div className="cl-none">
          <ListChecks size={30} className="cl-none-icon" />
          <h2>No checklist open</h2>
          <p>Pick one from the sidebar, or start a new one.</p>
          <button type="button" className="btn" onClick={onNew}><Plus size={16} /> New checklist</button>
        </div>
      </div>
    );
  }

  const { id, items } = checklist;
  const done = doneCount(checklist), total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const add = e => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    actions.addItems(id, [v]);
    setText("");
    inputRef.current?.focus();
  };

  const move = (itemId, delta, target) => {
    const i = items.findIndex(x => x.id === itemId), j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    focusAfter.current = { id: itemId, sel: target.classList.contains("cl-grip") ? ".cl-grip" : ".cl-check" };
    actions.reorder(id, next);
  };

  const dropOn = targetId => {
    if (!dragId || !over || dragId === targetId) return;
    const next = items.filter(x => x.id !== dragId);
    const moved = items.find(x => x.id === dragId);
    let at = next.findIndex(x => x.id === targetId);
    if (over.pos === "after") at += 1;
    next.splice(at, 0, moved);
    actions.reorder(id, next);
  };

  const dragProps = item => ({
    armed: armed === item.id,
    dragging: dragId === item.id,
    over: over?.id === item.id ? over.pos : null,
    arm: () => setArmed(item.id),
    disarm: () => setArmed(null),
    onDragStart: e => {
      setDragId(item.id);
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", item.id); } catch { /* required by some browsers */ }
    },
    onDragEnd: () => { setDragId(null); setOver(null); setArmed(null); },
    onDragOver: e => {
      if (!dragId || dragId === item.id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? "before" : "after";
      if (over?.id !== item.id || over.pos !== pos) setOver({ id: item.id, pos });
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget) && over?.id === item.id) setOver(null); },
    onDrop: e => { e.preventDefault(); dropOn(item.id); setDragId(null); setOver(null); setArmed(null); },
  });

  return (
    <div className="cl-view">
      {/* keyed so switching lists starts fresh instead of animating from the previous list's progress */}
      <div className="cl-col" key={id}>
        <div className="cl-head">
          <h1>{checklist.name}</h1>
          <span className="cl-stat">{done} / {total} done</span>
        </div>
        <div className="cl-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total}
          aria-valuenow={done} aria-valuetext={`${done} of ${total} done`}>
          <span style={{ width: pct + "%" }} />
        </div>

        <form className="cl-add" onSubmit={add}>
          <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} maxLength={500}
            placeholder="Add an item…" aria-label="New item" autoComplete="off" />
          <button className="btn" disabled={!text.trim()}><Plus size={16} /> Add</button>
        </form>

        {total ? (
          <ul className="cl-items" ref={listRef}>
            {items.map(item => (
              <Item
                key={item.id}
                item={item}
                drag={dragProps(item)}
                onToggle={v => { focusAfter.current = { id: item.id, sel: ".cl-check" }; actions.toggle(id, item.id, v); }}
                onEdit={v => actions.editItem(id, item.id, v)}
                onDelete={() => {
                  const i = items.indexOf(item), next = items[i + 1] || items[i - 1];
                  if (next) focusAfter.current = { id: next.id, sel: ".cl-del" };
                  else setTimeout(() => inputRef.current?.focus());
                  actions.deleteItem(id, item.id);
                }}
                onMove={(delta, target) => move(item.id, delta, target)}
              />
            ))}
          </ul>
        ) : (
          <div className="cl-empty">This checklist is empty. Add your first item above.</div>
        )}

        <div className="cl-actions">
          <button type="button" className="btn small ghost" disabled={!done} onClick={() => actions.clearCompleted(id)}>
            <Trash2 size={14} /> Clear completed
          </button>
          <button type="button" className="btn small ghost" disabled={!done} onClick={() => actions.uncheckAll(id)}>
            <RotateCcw size={14} /> Uncheck all
          </button>
          <span className="cl-tip">Double-click an item to edit · drag the handle to reorder</span>
        </div>
      </div>
    </div>
  );
}
