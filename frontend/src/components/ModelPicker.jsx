import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

const MENU_HEIGHT = 340;

function formatSize(bytes) {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** "gemma3:4b" -> { base: "gemma3", tag: "4b" }; the default "latest" tag is hidden. */
function splitName(name) {
  const [base, tag = ""] = name.split(":");
  return { base, tag: tag === "latest" ? "" : tag };
}

function details(m) {
  return [m.parameter_size, m.quantization, formatSize(m.size)].filter(Boolean).join(" · ");
}

export default function ModelPicker({ models, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState("up");
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const items = models.items?.length ? models.items : models.list.map(name => ({ name }));
  const status = models.ok === true ? "ok" : models.ok === false ? "err" : "";
  const statusText = models.ok === true
    ? `Ollama connected · ${items.length} model${items.length === 1 ? "" : "s"}`
    : models.ok === false ? (models.error || "Ollama not reachable") : "Checking Ollama…";
  const current = splitName(value || "");
  const label = !items.length
    ? (models.ok === false ? "Ollama offline" : models.ok === null ? "Loading…" : "No models")
    : current.base;

  const openMenu = () => {
    if (!items.length) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPlacement(window.innerHeight - rect.bottom > MENU_HEIGHT + 24 ? "down" : "up");
    setActive(Math.max(0, items.findIndex(m => m.name === value)));
    setOpen(true);
  };
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };
  const choose = name => {
    onChange(name);
    close();
  };

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) close(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => { if (open) listRef.current?.focus(); }, [open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onListKey = e => {
    const last = items.length - 1;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i >= last ? 0 : i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i <= 0 ? last : i - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(last); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(items[active].name); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") { close(false); }
  };

  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={"model-pill" + (open ? " open" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Model: ${value || label}`}
        title={statusText}
        disabled={!items.length}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={e => { if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !open) { e.preventDefault(); openMenu(); } }}
      >
        <span className={"dot " + status} />
        <span className="model-pill-name">{label}</span>
        {items.length > 0 && current.tag && <span className="model-pill-tag">{current.tag}</span>}
        <ChevronDown size={14} className="pill-chev" />
      </button>

      {open && (
        <div className={"model-menu " + placement}>
          <div className="model-menu-head">Choose a model</div>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Models"
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
          >
            {items.map((m, i) => {
              const { base, tag } = splitName(m.name);
              const selected = m.name === value;
              return (
                <li
                  key={m.name}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  className={"model-option" + (i === active ? " active" : "") + (selected ? " selected" : "")}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m.name)}
                >
                  <span className="model-badge" aria-hidden="true">{base[0]?.toUpperCase()}</span>
                  <span className="model-text">
                    <span className="model-title">
                      {base}
                      {tag && <span className="model-tag">{tag}</span>}
                      {m.parent_model && <span className="model-custom">Custom</span>}
                    </span>
                    <small>
                      {m.parent_model ? `Based on ${m.parent_model}` : m.family}
                      {details(m) && <span className="model-dim"> · {details(m)}</span>}
                    </small>
                  </span>
                  {selected && <Check size={16} className="model-check" />}
                </li>
              );
            })}
          </ul>
          <div className="model-menu-foot"><span className={"dot " + status} /> {statusText}</div>
        </div>
      )}
    </div>
  );
}
