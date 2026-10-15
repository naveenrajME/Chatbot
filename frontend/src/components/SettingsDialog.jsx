import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Pencil, Sun, Trash2, X } from "lucide-react";
import { api } from "../api.js";

function MemoryItem({ memory, onChanged, toast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  const finish = async save => {
    if (!editing) return;
    setEditing(false);
    const value = draft.trim();
    if (save && value && value !== memory.content) {
      try { await api.updateMemory(memory.id, value); } catch (e) { toast("Couldn't save: " + e.message); }
      onChanged();
    }
  };

  const remove = async () => {
    try { await api.deleteMemory(memory.id); } catch (e) { toast("Couldn't delete: " + e.message); }
    onChanged();
  };

  if (editing) {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          maxLength={500}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") { e.preventDefault(); finish(false); }
          }}
          onBlur={() => finish(true)}
          aria-label="Memory"
        />
      </li>
    );
  }
  return (
    <li>
      <span className="text">{memory.content}</span>
      <button type="button" title="Edit" aria-label="Edit memory"
        onClick={() => { setDraft(memory.content); setEditing(true); }}>
        <Pencil size={14} />
      </button>
      <button type="button" className="del" title="Delete" aria-label="Delete memory" onClick={remove}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function Toggle({ checked, disabled, onChange, title, help }) {
  return (
    <label className={"toggle" + (disabled ? " disabled" : "")}>
      <span><b>{title}</b><small>{help}</small></span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

const THEMES = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export default function SettingsDialog({
  open, onClose, settings, onSettingsChange, memories, onMemoriesChanged, toast, theme, onThemeChange,
}) {
  const ref = useRef(null);
  const [instructions, setInstructions] = useState("");
  const [saved, setSaved] = useState(false);
  const [newMemory, setNewMemory] = useState("");

  useEffect(() => {
    const dlg = ref.current;
    if (open && !dlg.open) {
      setInstructions(settings.custom_instructions ?? "");
      setSaved(false);
      dlg.showModal();
      onMemoriesChanged();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveInstructions = async () => {
    await onSettingsChange({ custom_instructions: instructions });
    setSaved(true);
  };

  const addMemory = async e => {
    e.preventDefault();
    const value = newMemory.trim();
    if (!value) return;
    try { await api.addMemory(value); setNewMemory(""); } catch (err) { toast("Couldn't add: " + err.message); }
    onMemoriesChanged();
  };

  const clearAll = async () => {
    if (!memories.length || !confirm("Delete all saved memories? This can't be undone.")) return;
    await api.clearMemories().catch(() => {});
    onMemoriesChanged();
  };

  const memoryOn = settings.memory_enabled !== false;

  return (
    <dialog ref={ref} aria-labelledby="settingsTitle" onClose={onClose}
      onClick={e => { if (e.target === ref.current) onClose(); }}>
      <div className="dlg-head">
        <h2 id="settingsTitle">Settings &amp; personalization</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="dlg-body">
        <section>
          <span className="field-label" id="appearanceLabel">Appearance</span>
          <p className="help">System follows your Windows light or dark setting.</p>
          <div className="seg" role="group" aria-labelledby="appearanceLabel">
            {THEMES.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={theme === value} onClick={() => onThemeChange(value)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <label className="field-label" htmlFor="instructions">Custom instructions</label>
          <p className="help">What should the assistant know about you, and how should it respond? Sent with every chat.</p>
          <textarea
            id="instructions"
            rows={4}
            value={instructions}
            onChange={e => { setInstructions(e.target.value); setSaved(false); }}
            placeholder="e.g. I'm a backend developer. Keep answers short and show code in Python."
          />
          <div className="row-end">
            {saved && <span className="saved">Saved</span>}
            <button type="button" className="btn" onClick={saveInstructions}>Save</button>
          </div>
        </section>

        <section className="toggles">
          <Toggle title="Use memory" help="Include saved memories in every chat."
            checked={memoryOn} onChange={v => onSettingsChange({ memory_enabled: v })} />
          <Toggle title="Save memories automatically" help="After each message, the model picks out lasting facts about you."
            checked={settings.auto_memory !== false} disabled={!memoryOn}
            onChange={v => onSettingsChange({ auto_memory: v })} />
          <Toggle title="Reference past chats" help="Look up related messages from your other chats."
            checked={settings.history_recall !== false} onChange={v => onSettingsChange({ history_recall: v })} />
        </section>

        <section>
          <div className="mem-head">
            <span className="field-label">Saved memories ({memories.length})</span>
            <button type="button" className="link danger" onClick={clearAll}>Clear all</button>
          </div>
          <ul className="mem-list">
            {!memories.length && <li className="none">Nothing saved yet.</li>}
            {[...memories].reverse().map(m => (
              <MemoryItem key={m.id + ":" + m.content} memory={m} onChanged={onMemoriesChanged} toast={toast} />
            ))}
          </ul>
          <form className="mem-add" onSubmit={addMemory}>
            <input value={newMemory} onChange={e => setNewMemory(e.target.value)} maxLength={500}
              placeholder="Add something to remember, e.g. I use Windows 11" aria-label="New memory" />
            <button className="btn">Add</button>
          </form>
        </section>
      </div>
    </dialog>
  );
}
