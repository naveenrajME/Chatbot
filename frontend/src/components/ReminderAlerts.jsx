import { AlarmClock, X } from "lucide-react";
import { dueLabel } from "../useReminders.js";

/** Cards shown when reminders come due, with Done / Snooze. */
export default function ReminderAlerts({ alerts, onComplete, onSnooze, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="rem-alerts" role="alert">
      {alerts.map(r => (
        <div className="rem-alert" key={r.id}>
          <AlarmClock size={20} className="rem-alert-icon" />
          <div className="rem-alert-main">
            <b>{r.text}</b>
            <small>{dueLabel(r.due_at)}</small>
            <div className="rem-alert-actions">
              <button type="button" className="btn small" onClick={() => onComplete(r.id)}>Done</button>
              <button type="button" className="btn small ghost" onClick={() => onSnooze(r.id, 10)}>Snooze 10 min</button>
            </div>
          </div>
          <button type="button" className="icon-btn sm" onClick={() => onDismiss(r.id)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
