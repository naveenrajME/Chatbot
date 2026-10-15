import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Menu, Moon, PanelLeftOpen, SquarePen, Sun } from "lucide-react";
import { api } from "./api.js";
import { useChat } from "./useChat.js";
import { useReminders } from "./useReminders.js";
import { useTheme } from "./useTheme.js";
import { ChecklistContext, useChecklists } from "./useChecklists.js";
import ChecklistView from "./components/ChecklistView.jsx";
import ReminderAlerts from "./components/ReminderAlerts.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ChatView from "./components/ChatView.jsx";
import { Hero, Suggestions } from "./components/Home.jsx";
import Composer from "./components/Composer.jsx";
import SettingsDialog from "./components/SettingsDialog.jsx";

/** Small status message; pass an action ({ label, onClick }) to add a button. */
function useToast() {
  const [toast, setToast] = useState({ text: "", action: null });
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);
  const show = useCallback((text, action = null) => {
    setToast({ text, action });
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), action ? 5000 : 2600);
  }, []);
  const node = (
    <div className={"toast" + (visible ? " show" : "")} role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.action && (
        <button type="button" onClick={() => { setVisible(false); toast.action.onClick(); }}>{toast.action.label}</button>
      )}
    </div>
  );
  return [show, node];
}

export default function App() {
  const [toast, toastNode] = useToast();
  const [conversations, setConversations] = useState([]);
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState({});
  const [memories, setMemories] = useState([]);
  const [models, setModels] = useState({ ok: null, list: [], items: [], error: "" });
  const [model, setModel] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("localchat-sidebar-collapsed") === "1"; } catch { return false; }
  });
  const [sideTab, setSideTab] = useState("chats");
  const [checklistId, setChecklistId] = useState(null);     // non-null = a checklist fills the main area
  const [creatingChecklist, setCreatingChecklist] = useState(false);
  const composerRef = useRef(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const loadConversations = useCallback(async () => {
    try { setConversations(await api.conversations(searchRef.current.trim())); }
    catch { setConversations([]); }
  }, []);

  const loadMemories = useCallback(async () => {
    try { setMemories(await api.memories()); } catch { setMemories([]); }
  }, []);

  const rem = useReminders();
  const lists = useChecklists(toast);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const theme = useTheme();

  const { chat, busy, send, stop, open, newChat, rename } = useChat({
    onConversationsChanged: loadConversations,
    onMemoryChanged: loadMemories,
    onRemindersChanged: rem.load,
    toast,
  });

  // Initial load.
  useEffect(() => {
    (async () => {
      const s = await api.settings().catch(() => ({}));
      setSettings(s);
      const m = await api.models().catch(() => ({ ok: false, models: [], error: "Server not reachable" }));
      setModels({ ok: m.ok, list: m.models, items: m.items || [], error: m.error || "" });
      setModel(s.default_model && m.models.includes(s.default_model) ? s.default_model : (m.models[0] ?? ""));
      loadMemories();
      loadConversations();
      const id = window.location.hash.slice(1);
      if (id.startsWith("cl-")) openChecklist(id.slice(3));
      else if (id) open(id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced chat search.
  useEffect(() => {
    const t = setTimeout(loadConversations, 200);
    return () => clearTimeout(t);
  }, [search, loadConversations]);

  // Ctrl+Shift+O starts a new chat, like ChatGPT.
  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Close the mobile sidebar when clicking outside it.
  useEffect(() => {
    if (!sidebarOpen) return;
    const close = () => setSidebarOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [sidebarOpen]);

  const activeChecklist = checklistId ? lists.checklists.find(c => c.id === checklistId) ?? null : null;
  const showChecklist = checklistId !== null;

  useEffect(() => {
    const t = showChecklist ? activeChecklist?.name : chat?.title;
    document.title = t ? `${t} · Local Chat` : "Local Chat";
  }, [showChecklist, activeChecklist?.name, chat?.title]);

  /* ---- checklists ---- */
  function openChecklist(id) {
    setChecklistId(id);
    setSideTab("lists");
    setSidebarOpen(false);
    window.history.replaceState(null, "", "#cl-" + id);
  }
  const startCreateChecklist = () => { setSideTab("lists"); setCreatingChecklist(true); };
  const createChecklist = async name => {
    setCreatingChecklist(false);
    const c = await lists.create(name);
    if (c) openChecklist(c.id);
  };
  const deleteChecklist = async c => {
    const n = c.items.length;
    if (!confirm(`Delete the checklist "${c.name}"${n ? ` and its ${n} item${n === 1 ? "" : "s"}` : ""}?`)) return;
    await lists.remove(c.id);
    if (checklistId === c.id) window.history.replaceState(null, "", window.location.pathname);
  };
  const leaveChecklist = () => {
    setChecklistId(null);
    window.history.replaceState(null, "", chat?.id ? "#" + chat.id : window.location.pathname);
  };
  const openChat = id => {
    setSidebarOpen(false);
    if (showChecklist && chat?.id === id) { leaveChecklist(); return; }   // keep a running reply going
    setChecklistId(null);
    open(id);
  };

  // Shared with "Add to checklist" under replies: stable functions, fresh list.
  const checklistCtx = useMemo(() => ({
    checklists: lists.checklists,
    addItems: (id, texts) => listsRef.current.addItems(id, texts),
    create: (name, texts) => listsRef.current.create(name, texts),
    notify: (text, id) => toast(text, { label: "Open", onClick: () => openChecklist(id) }),
  }), [lists.checklists, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNewChat = () => {
    setChecklistId(null);
    newChat();
    setSidebarOpen(false);
    composerRef.current?.focus();
  };

  const sendMessage = text => {
    if (!model) { toast("No model available. Start Ollama and pull a model, then reload."); return; }
    send({ text, model });
  };

  const regenerate = useCallback(() => {
    if (model) send({ model, regenerate: true });
  }, [send, model]);

  const changeModel = value => {
    setModel(value);
    api.updateSettings({ default_model: value }).catch(() => {});
  };

  const changeSettings = async values => {
    try { setSettings(await api.updateSettings(values)); }
    catch (e) { toast("Couldn't save: " + e.message); }
  };

  const renameConversation = async (conv, title) => {
    try {
      await api.renameConversation(conv.id, title);
      rename(conv.id, title);
    } catch (e) { toast("Couldn't rename: " + e.message); }
    loadConversations();
  };

  const deleteConversation = async conv => {
    if (!confirm(`Delete "${conv.title}"?`)) return;
    try { await api.deleteConversation(conv.id); }
    catch (e) { toast("Couldn't delete: " + e.message); return; }
    if (chat?.id === conv.id) newChat();
    loadConversations();
  };

  const toggleCollapsed = value => {
    setCollapsed(value);
    try { localStorage.setItem("localchat-sidebar-collapsed", value ? "1" : "0"); } catch { /* ignore */ }
  };

  // First name from a memory like "User's name is Priya", used for the greeting and avatar.
  const userName = (() => {
    for (const m of memories) {
      const hit = m.content.match(/\bname is ([A-Za-z][\w'-]*)/i);
      if (hit) return hit[1][0].toUpperCase() + hit[1].slice(1);
    }
    return "";
  })();

  const memoryOn = settings.memory_enabled !== false;
  const memoryLabel = memoryOn
    ? `${memories.length} saved memor${memories.length === 1 ? "y" : "ies"}`
    : "Memory off";

  const isEmpty = !showChecklist && (!chat || !chat.messages.length);
  const themeLabel = theme.effective === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <ChecklistContext.Provider value={checklistCtx}>
    <div className={"app" + (collapsed ? " side-collapsed" : "")}>
      <Sidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={chat?.id}
        search={search}
        onSearch={setSearch}
        onNew={startNewChat}
        onOpen={openChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
        memoryLabel={memoryLabel}
        userName={userName}
        onCollapse={() => toggleCollapsed(true)}
        onPersonalize={() => { setSidebarOpen(false); setSettingsOpen(true); }}
        tab={sideTab}
        onTab={setSideTab}
        lists={{
          checklists: lists.checklists,
          activeId: checklistId,
          creating: creatingChecklist,
          onStartCreate: startCreateChecklist,
          onCreate: createChecklist,
          onCancelCreate: () => setCreatingChecklist(false),
          onOpen: openChecklist,
          onRename: (id, name) => lists.rename(id, name),
          onDelete: deleteChecklist,
        }}
        reminders={{
          reminders: rem.reminders,
          permission: rem.permission,
          onRequestPermission: rem.requestPermission,
          onAdd: (text, due) => rem.add(text, due).catch(e => toast("Couldn't add: " + e.message)),
          onUpdate: (id, fields) => rem.update(id, fields).catch(e => toast("Couldn't save: " + e.message)),
          onDelete: id => rem.remove(id).catch(e => toast("Couldn't delete: " + e.message)),
        }}
      />

      <main className={"sheet" + (isEmpty ? " empty" : "")}>
        <header className="topbar">
          <button type="button" className="icon-btn menu" aria-label="Show chats"
            onClick={e => { e.stopPropagation(); setSidebarOpen(o => !o); }}>
            <Menu size={19} />
          </button>
          {collapsed && (
            <div className="topbar-group desktop-only">
              <button type="button" className="icon-btn" onClick={() => toggleCollapsed(false)}
                title="Show sidebar" aria-label="Show sidebar"><PanelLeftOpen size={18} /></button>
              <button type="button" className="icon-btn" onClick={startNewChat}
                title="New chat" aria-label="New chat"><SquarePen size={17} /></button>
            </div>
          )}
          <div className="title">{showChecklist ? (activeChecklist?.name ?? "Checklists") : isEmpty ? "" : chat.title}</div>
          <button type="button" className="icon-btn" onClick={theme.toggle} title={themeLabel} aria-label={themeLabel}>
            {theme.effective === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {showChecklist
          ? <ChecklistView checklist={activeChecklist} actions={lists} onNew={startCreateChecklist} />
          : isEmpty
            ? <Hero userName={userName} memoryCount={memories.length} memoryEnabled={memoryOn} />
            : <ChatView chat={chat} busy={busy} onRegenerate={regenerate} />}

        {!showChecklist && <Composer
          ref={composerRef}
          busy={busy}
          onSend={sendMessage}
          onStop={stop}
          models={models}
          model={model}
          onModelChange={changeModel}
          footnote={isEmpty ? null : "Runs locally with Ollama. Answers can be wrong — check important facts."}
        />}

        {isEmpty && <Suggestions onPick={sendMessage} />}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={changeSettings}
        memories={memories}
        onMemoriesChanged={loadMemories}
        toast={toast}
        theme={theme.theme}
        onThemeChange={theme.setTheme}
      />
      <ReminderAlerts alerts={rem.alerts} onComplete={rem.complete} onSnooze={rem.snooze} onDismiss={rem.dismissAlert} />
      {toastNode}
    </div>
    </ChecklistContext.Provider>
  );
}
