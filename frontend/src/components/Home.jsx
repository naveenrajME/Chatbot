import { AlarmClock, Brain, Code2, FlaskConical } from "lucide-react";
import Logo from "./Logo.jsx";

const SUGGESTIONS = [
  { Icon: Brain, title: "What do you remember about me?", sub: "See what's in memory" },
  { Icon: Code2, title: "Write a PowerShell script to find large files", sub: "Code" },
  { Icon: FlaskConical, title: "Draft test cases for a login page", sub: "Testing" },
  { Icon: AlarmClock, title: "Remind me to stretch in 30 minutes", sub: "Reminders" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function Hero({ userName, memoryCount, memoryEnabled }) {
  const line = !memoryEnabled
    ? "Memory is off, so each chat starts fresh."
    : memoryCount
      ? `I remember ${memoryCount} thing${memoryCount === 1 ? "" : "s"} about you.`
      : "Tell me about yourself and I'll remember it next time.";
  return (
    <div className="hero">
      <Logo size={34} className="hero-mark" />
      <h1 className="display">{greeting()}{userName ? `, ${userName}` : ""}</h1>
      <p>Private by default — everything runs on this computer. {line}</p>
    </div>
  );
}

export function Suggestions({ onPick }) {
  return (
    <div className="suggest-grid">
      {SUGGESTIONS.map(({ Icon, title, sub }) => (
        <button key={title} type="button" className="suggest-card" onClick={() => onPick(title)}>
          <Icon size={17} className="suggest-icon" />
          <span className="suggest-title">{title}</span>
          <span className="suggest-sub">{sub}</span>
        </button>
      ))}
    </div>
  );
}
