import { useState } from "react";
import { Check, Copy } from "lucide-react";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

export default function CopyButton({ getText, label = "Copy", className = "" }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    await copyText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}
