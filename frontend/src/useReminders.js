import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

const CHECK_EVERY_MS = 10_000;
const RELOAD_EVERY_MS = 60_000;

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => ctx.close();
  } catch { /* sound is optional */ }
}

export const notificationsSupported = typeof Notification !== "undefined";

/**
 * Reminder list plus the "it's due" alerts. Alerts fire while this page is open:
 * an in-app card, a short sound, and a desktop notification when permitted.
 */
export function useReminders() {
  const [reminders, setReminders] = useState([]);
  const [alerts, setAlerts] = useState([]);           // reminders that just came due
  const [permission, setPermission] = useState(notificationsSupported ? Notification.permission : "denied");
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;

  const load = useCallback(async () => {
    try { setReminders(await api.reminders()); } catch { /* keep the old list */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, RELOAD_EVERY_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const check = () => {
      const now = Date.now() / 1000;
      const due = remindersRef.current.filter(r => !r.done && !r.notified && r.due_at && r.due_at <= now);
      if (!due.length) return;
      const ids = new Set(due.map(r => r.id));
      setReminders(list => list.map(r => (ids.has(r.id) ? { ...r, notified: true } : r)));
      setAlerts(a => [...a.filter(x => !ids.has(x.id)), ...due]);
      beep();
      for (const r of due) {
        api.updateReminder(r.id, { notified: true }).catch(() => {});
        if (notificationsSupported && Notification.permission === "granted") {
          try { new Notification("Reminder", { body: r.text, tag: "reminder-" + r.id }); } catch { /* ignore */ }
        }
      }
    };
    check();
    const t = setInterval(check, CHECK_EVERY_MS);
    return () => clearInterval(t);
  }, [reminders]);

  const requestPermission = useCallback(async () => {
    if (!notificationsSupported) return;
    try { setPermission(await Notification.requestPermission()); } catch { /* ignore */ }
  }, []);

  const dismissAlert = useCallback(id => setAlerts(a => a.filter(x => x.id !== id)), []);

  const add = useCallback(async (text, due_at) => {
    await api.addReminder(text, due_at);
    if (permission === "default") requestPermission();
    load();
  }, [load, permission, requestPermission]);

  const update = useCallback(async (id, fields) => {
    await api.updateReminder(id, fields);
    load();
  }, [load]);

  const remove = useCallback(async id => {
    await api.deleteReminder(id);
    setAlerts(a => a.filter(x => x.id !== id));
    load();
  }, [load]);

  const snooze = useCallback(async (id, minutes = 10) => {
    dismissAlert(id);
    await update(id, { due_at: Date.now() / 1000 + minutes * 60 });
  }, [dismissAlert, update]);

  const complete = useCallback(async id => {
    dismissAlert(id);
    await update(id, { done: true });
  }, [dismissAlert, update]);

  return { reminders, alerts, permission, requestPermission, load, add, update, remove, snooze, complete, dismissAlert };
}

/* ---------- date helpers shared by the reminder components ---------- */

const DAY = 86_400_000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function dueLabel(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days === -1) return `Yesterday, ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: "short" })}, ${time}`;
  const opts = { day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${d.toLocaleDateString([], opts)}, ${time}`;
}

export function toLocalInput(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  return value ? new Date(value).getTime() / 1000 : null;
}
