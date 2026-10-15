import { useState } from "react";
import { ListChecks, ListPlus, MessageSquare, PanelLeftClose, Pencil, Search, Settings2, SquarePen, Trash2, User } from "lucide-react";
import ChecklistSidebar from "./ChecklistSidebar.jsx";
import Logo from "./Logo.jsx";
import RemindersPanel from "./RemindersPanel.jsx";

const DAY = 86_400_000;

function groupOf(ts) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = ts * 1000;
  if (t >= today) return "Today";
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 7 * DAY) return "Previous 7 days";
  if (t >= today - 30 * DAY) return "Previous 30 days";
  return "Older";
}

function ChatItem({ conv, active, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conv.title);

  const finish = save => {
    if (!editing) return;
    setEditing(false);
    const title = draft.trim();
    if (save && title && title !== conv.title) onRename(conv, title);
  };

  if (editing) {
    return (
      <div className="chat-item active">
        <input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => e.target.select()}
          onKeyDown={e => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
          }}
          onBlur={() => finish(true)}
          aria-label="Chat title"
        />
      </div>
    );
  }

  return (
    <div className={"chat-item" + (active ? " active" : "")}>
      <button type="button" className="open" title={conv.title} onClick={() => onOpen(conv.id)}>
        {conv.title}
      </button>
      <button type="button" className="act" title="Rename" aria-label="Rename chat"
        onClick={() => { setDraft(conv.title); setEditing(true); }}>
        <Pencil size={14} />
      </button>
      <button type="button" className="act del" title="Delete" aria-label="Delete chat" onClick={() => onDelete(conv)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function Sidebar({
  open, conversations, activeId, search, onSearch, onNew, onOpen, onRename, onDelete,
  memoryLabel, onPersonalize, reminders, userName, onCollapse, tab, onTab, lists,
}) {
  const chatsOn = tab === "chats";
  const onTabKey = e => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "chats" : e.key === "End" ? "lists" : chatsOn ? "lists" : "chats";
    onTab(next);
    e.currentTarget.querySelector(`[data-tab="${next}"]`)?.focus();
  };
  const groups = [];
  for (const c of conversations) {
    const g = groupOf(c.updated_at);
    if (!groups.length || groups.at(-1).label !== g) groups.push({ label: g, items: [] });
    groups.at(-1).items.push(c);
  }

  return (
    <aside className={"sidebar" + (open ? " open" : "")} onClick={e => e.stopPropagation()}>
      <div className="brand">
        <Logo size={22} className="brand-mark" />
        <span className="brand-name">Local Chat</span>
        <button type="button" className="icon-btn collapse-btn" onClick={onCollapse}
          title="Hide sidebar" aria-label="Hide sidebar"><PanelLeftClose size={18} /></button>
      </div>

      <div className="side-tabs" role="tablist" aria-label="Sidebar sections" onKeyDown={onTabKey}>
        <button type="button" role="tab" data-tab="chats" id="tab-chats" aria-selected={chatsOn}
          aria-controls="panel-chats" tabIndex={chatsOn ? 0 : -1} onClick={() => onTab("chats")}>
          <MessageSquare size={15} /> Chats
        </button>
        <button type="button" role="tab" data-tab="lists" id="tab-lists" aria-selected={!chatsOn}
          aria-controls="panel-lists" tabIndex={chatsOn ? -1 : 0} onClick={() => onTab("lists")}>
          <ListChecks size={15} /> Checklists
          {lists.checklists.length > 0 && <span className="tab-count">{lists.checklists.length}</span>}
        </button>
      </div>

      {chatsOn ? (
        <button type="button" className="new-btn" onClick={onNew}>
          <SquarePen size={17} /> <span>New chat</span> <kbd>Ctrl ⇧ O</kbd>
        </button>
      ) : (
        <button type="button" className="new-btn" onClick={lists.onStartCreate}>
          <ListPlus size={17} /> <span>New checklist</span>
        </button>
      )}

      <div className="side-scroll">
        <RemindersPanel {...reminders} onOpenChat={onOpen} />

        {!chatsOn && (
          <div id="panel-lists" role="tabpanel" aria-labelledby="tab-lists">
            <ChecklistSidebar {...lists} />
          </div>
        )}

        {chatsOn && <div id="panel-chats" role="tabpanel" aria-labelledby="tab-chats" className="tab-panel">
        <label className="search">
          <Search size={15} />
          <input type="search" placeholder="Search chats" value={search} onChange={e => onSearch(e.target.value)} />
        </label>

        <nav className="chat-list" aria-label="Chats">
          {!conversations.length && (
            <div className="list-empty">{search.trim() ? "No chats match." : "Your chats will appear here."}</div>
          )}
          {groups.map(g => (
            <div key={g.label} className="group">
              <div className="group-label">{g.label}</div>
              {g.items.map(c => (
                <ChatItem key={c.id} conv={c} active={c.id === activeId}
                  onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
              ))}
            </div>
          ))}
        </nav>
        </div>}
      </div>

      <button type="button" className="side-foot" onClick={onPersonalize}>
        <span className="user-avatar">{userName ? userName[0].toUpperCase() : <User size={16} />}</span>
        <span className="side-foot-text">
          <b>{userName || "You"}</b>
          <small>{memoryLabel}</small>
        </span>
        <Settings2 size={17} className="side-foot-icon" />
      </button>
    </aside>
  );
}
