import { useContext, useEffect, useRef, useState } from "react";
import { ListPlus, Plus } from "lucide-react";
import { ChecklistContext, doneCount } from "../useChecklists.js";

const MENU_HEIGHT = 300;

/** "Add to checklist" under a reply: adds the reply's bullet lines to a chosen or new checklist. */
export default function AddToChecklist({ lines }) {
  const ctx = useContext(ChecklistContext);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState("down");
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && !naming) menuRef.current?.querySelector("button")?.focus();
  }, [open, naming]);

  if (!ctx || !lines.length) return null;
  const n = lines.length;

  const openMenu = () => {
    const r = buttonRef.current.getBoundingClientRect();
    setPlacement(window.innerHeight - r.bottom > MENU_HEIGHT ? "down" : "up");
    setNaming(false); setName(""); setOpen(true);
  };
  function close(refocus = true) {
    setOpen(false); setNaming(false);
    if (refocus) buttonRef.current?.focus();
  }

  const addTo = async checklist => {
    close();
    const updated = await ctx.addItems(checklist.id, lines);
    if (updated) ctx.notify(`Added ${n} item${n === 1 ? "" : "s"} to “${checklist.name}”`, checklist.id);
  };
  const createNew = async e => {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return;
    close();
    const created = await ctx.create(nm, lines);
    if (created) ctx.notify(`Created “${created.name}” with ${n} item${n === 1 ? "" : "s"}`, created.id);
  };

  const onMenuKey = e => {
    const buttons = [...menuRef.current.querySelectorAll("button")];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (naming) return;
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <div className="add-cl" ref={wrapRef}>
      <button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}>
        <ListPlus size={14} /><span>Add to checklist</span>
      </button>
      {open && (
        <div className={"cl-menu " + placement} ref={menuRef} role="menu" aria-label="Add to checklist" onKeyDown={onMenuKey}>
          <div className="cl-menu-head">Add {n} item{n === 1 ? "" : "s"} to…</div>
          {!naming && (
            <div className="cl-menu-list">
              {ctx.checklists.map(c => (
                <button key={c.id} type="button" role="menuitem" onClick={() => addTo(c)}>
                  <span className="cl-menu-name">{c.name}</span>
                  <span className="cl-count">{doneCount(c)}/{c.items.length}</span>
                </button>
              ))}
              <button type="button" role="menuitem" className="cl-menu-new" onClick={() => setNaming(true)}>
                <Plus size={15} /> New checklist…
              </button>
            </div>
          )}
          {naming && (
            <form className="cl-menu-form" onSubmit={createNew}>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120}
                placeholder="Checklist name" aria-label="New checklist name" />
              <div className="cl-menu-form-actions">
                <button type="button" className="link" onClick={() => setNaming(false)}>Back</button>
                <button className="btn small" disabled={!name.trim()}>Create</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
