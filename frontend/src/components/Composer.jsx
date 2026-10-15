import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import ModelPicker from "./ModelPicker.jsx";

const Composer = forwardRef(function Composer(
  { busy, onSend, onStop, models, model, onModelChange, footnote }, ref) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  useLayoutEffect(() => {
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [text]);

  const submit = () => {
    if (busy) { onStop(); return; }
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="composer">
      <div className="composer-card" onClick={e => { if (e.target === e.currentTarget) inputRef.current?.focus(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder="Ask anything, or say “remind me to…”"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy) submit();
            }
          }}
          aria-label="Message"
          autoFocus
        />
        <div className="composer-row">
          <ModelPicker models={models} value={model} onChange={onModelChange} />
          <span className="composer-keys">Shift + Enter for a new line</span>
          <button
            type="button"
            className={"send" + (busy ? " stop" : "")}
            onClick={submit}
            disabled={!busy && !text.trim()}
            aria-label={busy ? "Stop" : "Send"}
            title={busy ? "Stop" : "Send"}
          >
            {busy ? <Square size={13} fill="currentColor" /> : <ArrowUp size={18} strokeWidth={2.4} />}
          </button>
        </div>
      </div>
      {footnote && <div className="hint">{footnote}</div>}
    </div>
  );
});

export default Composer;
