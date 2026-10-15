# Local Chat

A ChatGPT-style chat app for your local Ollama models, with long-term memory across chats.

## Run

Double-click `run.bat`. On first run it sets up a Python environment and builds the React
frontend (needs Node.js), then starts the server and opens http://127.0.0.1:8765.
Ollama must be running.

Manual start:

```
cd frontend && npm install && npm run build && cd ..
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8765
```

### Setting up on another computer

1. Install [Python 3.10+](https://www.python.org/downloads/) (tick "Add to PATH") and [Ollama](https://ollama.com/download).
2. Pull the models and create the QA model:
   ```
   ollama pull gemma3:4b
   ollama pull qwen2.5-coder:3b
   ollama pull qwen2.5-coder:1.5b
   ollama create qa-assistant -f ollama/Modelfile
   ```
3. Clone this repo and double-click `run.bat`. The built frontend is included, so Node.js is
   only needed if you change the React code.

Chats, memories, reminders and checklists live in `data/chat.db`, which is committed to this
repo, so a fresh clone starts with the same data. Commit and push it again to carry over new chats.

### Working on the frontend

Run the backend as above, then in another terminal:

```
cd frontend
npm run dev
```

Open http://localhost:5173. Vite reloads instantly on save and forwards `/api` calls to the
backend on port 8765. Run `npm run build` when done; FastAPI serves `frontend/dist`.

## How memory works

Every request to Ollama is built by the backend with a system prompt containing:

1. **Saved memories** – short facts about you ("User's name is Naveen."). After each reply,
   the model reads your message and decides whether to add new facts or replace outdated ones
   (for example when you say you moved city). A "✓ Memory updated" chip shows what changed.
2. **Related past chats** – a full-text search over your earlier messages in *other* chats; the
   best two matches (and the replies to them) are included.
3. **Custom instructions** – free text you set in *Memory & personalization*.

You can view, edit, add, delete or clear memories, and switch each feature on or off, from the
*Memory & personalization* button at the bottom of the sidebar.

## Reminders

The **Reminders** panel at the top of the sidebar lists your reminders. Add them with **+**, or just
say it in any chat: "remind me to call the bank tomorrow at 11", "remind me in 20 minutes to
drink water", "I paid the bill, mark that done", "cancel the dentist reminder".

When a message mentions reminders, the backend asks the model to turn it into reminder changes
*before* replying (so the reply confirms exactly what was saved) and a chip under the reply shows them.
Due reminders pop up as a card with **Done** / **Snooze 10 min**, play a short sound, and show a
desktop notification if you allow it (bell icon in the panel). Alerts only fire while the app is
open in a browser tab.

## Checklists

The sidebar has two tabs, **Chats** and **Checklists**. On the Checklists tab, **New checklist** asks for a
name inline and opens it. Each list shows its progress (e.g. 3/7); rename it by double-clicking the name or
with the pencil, delete it with the bin.

Inside a checklist: add items (Enter or **Add**), tick them off, double-click to edit, drag the handle
(or Alt + Up/Down) to reorder, and use **Clear completed** / **Uncheck all**. Under any reply that contains
a bulleted or numbered list, **Add to checklist** copies those lines into an existing or new checklist.
Checklists are stored in `data/chat.db` with the chats. A checklist can be linked directly as `/#cl-<id>`.

## Layout

```
app/
  main.py      FastAPI routes, streaming chat endpoint (NDJSON)
  db.py        SQLite storage: chats, messages, memories, settings, full-text index
  memory.py    system prompt builder, memory extraction, chat titles
  reminders.py reminder detection from chat messages
  ollama.py    async Ollama client
frontend/      React + Vite app
  src/App.jsx          layout and app-wide state (chats, models, settings, memories)
  src/useChat.js       open chat, streaming replies, stop and regenerate
  src/useReminders.js  reminder list, due-time alerts, notifications
  src/useChecklists.js checklist state and the bullet-line extractor
  src/api.js           backend calls and the NDJSON stream reader
  src/components/      Sidebar, RemindersPanel, ReminderAlerts, ChatView, Message, Composer, ...
  dist/                production build served by FastAPI
data/chat.db   all your data (created on first run)
```

## Settings (environment variables)

| Variable            | Default                  | Meaning                                  |
|---------------------|--------------------------|------------------------------------------|
| `OLLAMA_URL`        | `http://localhost:11434` | Where Ollama runs                        |
| `NUM_CTX`           | `8192`                   | Context window sent to Ollama (tokens)   |
| `MAX_HISTORY_CHARS` | `16000`                  | How much of the current chat is sent     |

Memory extraction quality depends on the model: `gemma3:4b` works well; very small models
(such as `qwen2.5-coder:1.5b`) sometimes save poor memories, which you can delete in the panel.
