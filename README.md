# Mini-Agent

A lightweight, local agent framework — reduced to the essentials so smaller models can work reliably. With session management, web search, file upload, and mobile UI.

---

## What is it?

Mini-Agent connects a local LLM (via llama.cpp) with Python tools through a clean TypeScript architecture. The agent decides when to use a tool and when to answer directly.

**Philosophy:**
- As little complexity as necessary.
- Clear separation: TypeScript orchestrates, Python executes.
- Prompting that doesn't overwhelm small models.
- **No context compression** — history is passed through 1:1.

---

## Architecture

```
mini_agent/
├── src/                    # TypeScript "engine room"
│   ├── server.ts           # Express + SSE API + Multipart Upload
│   ├── agent.ts            # ReAct-Loop (max. 5 steps)
│   ├── llm.ts              # OpenAI-compatible client (multimodal)
│   ├── tools.ts            # Tool registry + Python bridge
│   ├── session-store.ts    # Session persistence (JSON)
│   └── config.ts           # Load soul.md + user.md + current date
├── tools/                  # Python tools
│   ├── read.py             # Read file
│   ├── write.py            # Write file
│   ├── list_dir.py         # List directory
│   ├── web_search.py       # Web search via SearXNG
│   └── web_fetch.py        # Load web pages as text
├── web/                    # Frontend
│   ├── index.html
│   ├── style.css           # Darkmode + Mobile
│   └── app.js              # SSE client + file upload
├── config/
│   ├── soul.md             # Agent personality
│   └── user.md             # User preferences
├── sessions/               # Saved chat sessions (JSON)
└── package.json
```

---

## Features

### Core
- **Local LLM chat** via OpenAI-compatible API (llama.cpp)
- **Tool calling** with ReAct-Loop (tool call → result → answer)
- **SSE streaming** — all intermediate steps live in the browser
- **Multimodal messages** — text + images in one message
- **Markdown rendering** — code blocks, tables, lists, links

### Session Management
- **Session persistence** — each session as JSON under `sessions/`
- **No compression** — 1:1 history pass-through
- **Sidebar** — list sessions, switch, start new ones
- **Current date** — freshly loaded with each new session

### Tools
| Tool | Description |
|------|-------------|
| `read_file` | Read a file |
| `write_file` | Write a file |
| `list_dir` | List directory contents |
| `web_search` | Internet search via SearXNG |
| `web_fetch` | Load web page as text |
| `exec_command` | Run shell commands (with safety blacklist) |

### Web Interface
- **Dark design** — Desktop + Mobile
- **File upload** — images and text files
- **Image preview** — shown before sending
- **Session sidebar** — always visible on desktop, overlay on mobile
- **Session deletion** — delete sessions from the sidebar

---

## Setup & Start

### Requirements
- Node.js 20+ and npm
- Python 3.x
- A running llama.cpp server with a compatible model
- Optional: SearXNG for web search

### Installation

```bash
git clone <repo-url>
cd mini-agent
npm install
```

### Configuration

Create the config files:

```bash
mkdir -p config
echo "You are a helpful assistant." > config/soul.md
echo "The user prefers clear and concise answers." > config/user.md
```

### Start

**1. Start llama.cpp server:**
```bash
./llama-server -m <your-model>.gguf --port 8091
```

**2. Start Mini-Agent:**
```bash
npm run dev    # With watch mode (recommended)
# or
npm start      # One-time
```

**3. Open in browser:**
```
http://localhost:3000
```

---

## Current State — v1.0 (Feature Complete)

The core is intentionally **stable and complete**. No new major features are planned — only bugfixes, security updates, and compatibility patches.

- [x] Local LLM chat via OpenAI-compatible API
- [x] Tool calling with `read_file`, `write_file`, `list_dir`, `exec_command`
- [x] Web search via SearXNG (`web_search`) + web fetch (`web_fetch`)
- [x] ReAct-Loop (tool call → result → answer)
- [x] SSE streaming to the web interface (token-by-token)
- [x] Collapsible reasoning display (▶/▼)
- [x] Token usage display (prompt / completion / total)
- [x] `soul.md` and `user.md` as configurable system prompts
- [x] Session persistence — each session saved as JSON
- [x] Session management — sidebar with switch, new, delete
- [x] File upload — images and text files (click, drag & drop, clipboard paste)
- [x] Mobile UI — responsive design with hamburger menu
- [x] Markdown rendering with syntax highlighting + copy buttons
- [x] Stop button during generation
- [x] Robust error handling

---

## Known Quirks & Solutions

| Problem | Cause | Solution |
|---------|-------|----------|
| LLM doesn't answer after tool call | Tool calls appended as multiple `assistant` messages | All tool calls of one round as **one** message with `tool_calls: [...]` |
| Answer doesn't appear in web UI | `currentMsg` was local instead of global | Moved variable to global scope |
| Model thinks very verbosely | Model behavior | `reasoning_content` output as separate event |
| Session history lost | No persistence | Each session saved as JSON under `sessions/` |
| Orphaned tool calls after reload | Session not loaded correctly | History restored 1:1 from JSON |
| "Tag A, B, C becomes Tag AC" | Context compression in other frameworks | **No compression** — 1:1 pass-through |
| KV cache lost on hybrid models (Qwen3.5/3.6 MoE, Gemma 4) | llama.cpp invalidates recurrent state checkpoints | Local patch: [ggml-org/llama.cpp#21831](https://github.com/ggml-org/llama.cpp/issues/21831) — keeps cache in memory, no re-processing |

---

## Future Ideas (Low Priority)

These are **not planned for v1.x** — kept here as potential directions if ever needed.

### Chat Memory (Simple RAG)
- Automatically index past chat sessions into a searchable memory
- Allow the model to reference earlier conversations: *"Hey, 2 weeks ago we discussed X..."*
- Keep it simple: no vector DB complexity, just indexed text search

### Project Mode
- Per-project folders (`projects/my-project/`) with:
  - `context.md` — project-specific instructions
  - `data/` — files automatically indexed for the model
  - Dedicated sessions tied to a project

### Other Ideas
- **Session export/import** as Markdown or JSON
- **Git tools** — `git_status`, `git_diff`, `git_commit`

---

## Why mini_agent stays lean

### The Problem: "Tag A, B, C becomes Tag AC"

In full agent frameworks, even 110B MoE models lose track. Example:

> **User:** "this week is still first of May"
> **Agent:** "You probably **celebrated** ... the holiday is **coming soon**"
> **User:** "Wednesday first of May..."
> **Agent:** "4 days off ... the holiday is **getting closer**"

The agent contradicts itself because the **framework confuses the model**.

### The 3 Main Causes

1. **Huge system prompt** (3,000–5,000 tokens in other frameworks) → mini_agent: ~100 tokens
2. **Active context compression** (summaries, deduplication) → mini_agent: **None**
3. **Tool call stubs** (placeholders instead of real results) → mini_agent: **Full results**

### Design Rule

> **"The model is smart enough. The framework shouldn't prevent it from being smart."**

| | Other Frameworks | mini_agent |
|---|---|---|
| **System prompt** | 3,000–5,000 tokens | ~100 tokens |
| **Context management** | Compression, summaries | 1:1 pass-through |
| **Tool results** | Stubs/summaries | Complete |
| **Code complexity** | 11,000+ lines, 12+ modules | ~500 lines, 5 files |
| **Timeline tracking** | Gets lost | Stays exact |

---

## Design Decisions

### Why TypeScript for the core?
- Type safety makes the "engine room" more robust.
- Node.js has excellent `child_process` and HTTP APIs.
- Easy to extend and test.

### Why Python for tools?
- File operations, web requests, and external APIs are often less code in Python.
- Isolated processes — a crashed tool doesn't crash the agent.

### Why SSE instead of WebSocket?
- For unidirectional server→client communication, simpler and more resource-efficient.
- No persistent connection overhead.

### Why `soul.md` + `user.md`?
- Clear separation between agent identity and user preferences.
- Easy to edit without changing code.
- Freshly loaded with each new session (changes active immediately).

---

## Contributing

New tools can be added by **adding a Python file** in `tools/` and **registering it in `tools.ts`** — without touching the core.

---

## License

MIT
