# PRD v3 — AI Workstation (Web-first + Tauri Desktop)

## 1. Product Positioning

### One-Liner
> **A local folder-centric AI workbench** (GUI version of Codex)

### Core Experience
1. Open app → automatically enter last-used folder (Workspace)
2. Immediately start working with AI to **operate files + generate content**

### Product Essence
| Not This | But This |
|----------|----------|
| ❌ AI chat tool | ❌ AI note-taking software |
| ✅ **AI-driven file system** | |

---

## 2. Target Users

| User Type | Primary / Secondary | Needs |
|-----------|---------------------|-------|
| **General users** | 🟢 Primary | Write content, read materials, organize files |
| **Power users** | 🔵 Secondary | Understand scripts, want automation |

---

## 3. Core Object Model

### 3.1 Workspace
```typescript
interface Workspace {
  id: string
  path: string
  name: string
  lastOpenedAt: Date
}
```
> All operations are bound to a Workspace.

### 3.2 Conversation
```typescript
interface Conversation {
  id: string
  workspaceId: string
  summary: string
  updatedAt: Date
}
```

### 3.3 Message
```typescript
interface Message {
  role: "user" | "assistant"
  content: string
}
```

### 3.4 FileAction (Core)
```typescript
interface FileAction {
  type: "read" | "write" | "rename" | "delete"
  path: string
  timestamp: Date
}
```

### 3.5 Task (Agent Execution)
```typescript
interface Task {
  id: string
  status: "pending" | "running" | "done"
  logs: string[]
}
```

---

## 4. Information Architecture (UI Layout)

```
┌───────────────┬──────────────┬───────────────┐
│  File Area    │  Content     │  AI Assistant │
│  (Explorer)   │  (Preview)   │  (Chat)       │
└───────────────┴──────────────┴───────────────┘
```

### Left Panel — File Explorer
- Folder tree
- File search (by filename)
- Recent files

### Middle Panel — Content Preview
- File preview (md / txt / pdf)
- AI-generated result display

### Right Panel — AI Assistant (Core)
- Chat
- Action buttons (shortcuts)

---

## 5. AI System Design

### Paradigm Shift
| Old | New |
|-----|-----|
| ❌ ChatGPT-style free chat | ✅ **Tool-based Agent** |

### Tool Definitions

#### 📄 File Tools
| Tool | Description |
|------|-------------|
| `list_dir` | List directory contents |
| `read_file` | Read file content |
| `write_file` | Write content to file |
| `search_files` | Search across files |

#### ✍️ Content Tools
| Tool | Description |
|------|-------------|
| `summarize` | Summarize content |
| `rewrite` | Rewrite content |
| `generate_doc` | Generate document |

#### ⚙️ Execution Tools (Reserved)
| Tool | Description |
|------|-------------|
| `run_python` | Execute Python code |

### Call Flow
```
User Input
    ↓
LLM Intent Classification
    ↓
Tool Selection
    ↓
Tool Execution
    ↓
Result Return
    ↓
Response Generation
```

---

## 6. Permission System

### Permission Levels
| Operation | Auto-Execute | Confirmation Required |
|-----------|:------------:|:---------------------:|
| Read file | ✅ Yes | — |
| Search | ✅ Yes | — |
| Write file | ⚠️ | Yes |
| Delete file | ❗ | **Strong confirmation** |
| Execute Python | ❗ | **Strong confirmation** |

### Workspace Restriction
> AI can only access: `/selected-workspace/*`

---

## 7. Memory System

### Long-Term Memory (SQLite)
- Default language
- Output style
- Recent workspaces

### Short-Term Context
- Current file
- Recent files
- Conversation summary

### Session Recovery
> On app launch: automatically load most recent Conversation

---

## 8. Execution Capability (Phase 2)

### Python Execution Flow
```
User Input
    ↓
AI Code Generation
    ↓
Code Preview
    ↓
User Confirmation
    ↓
Execution
    ↓
Generated Files
    ↓
Result Display
```

### Output Display
- New file list
- Download / Open options

---

## 9. Technical Architecture

```
┌─────────────────┐
│  Frontend (React)  │
└────────┬────────┘
         ↓
┌─────────────────┐
│ Tauri Bridge    │
└────────┬────────┘
         ↓
┌─────────────────┐
│ Backend Service │  (Node / Rust)
└────────┬────────┘
         ↓
┌─────────────────┐
│ LLM API + Execution Engine │
└─────────────────┘
```

---

## 10. Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React, Tailwind, shadcn/ui |
| **Desktop** | Tauri |
| **AI** | OpenAI-compatible API or Ollama |
| **Agent Execution** | Open Interpreter |
| **Storage** | SQLite |
| **File System** | Tauri FS API |

---

## 11. MVP Scope

### Must Have
- ✅ Workspace selection
- ✅ File browsing
- ✅ AI chat
- ✅ AI file read/write
- ✅ Conversation memory

### Out of Scope
- ❌ Cloud sync
- ❌ Multi-user
- ❌ Plugin system
- ❌ Vector database

---

## 12. Development Milestones

| Day | Focus |
|-----|-------|
| Day 1–2 | UI framework, Tauri initialization |
| Day 3 | File system |
| Day 4 | AI chat |
| Day 5 | Tool calling |
| Day 6 | File write capability |
| Day 7 | Session recovery |

---

## 13. Design Principles

| # | Principle | Description |
|---|----------|-------------|
| 1️⃣ | **Workspace First** | All operations revolve around the folder |
| 2️⃣ | **Tool First** | No free chat — tool calling only |
| 3️⃣ | **Permission First** | All write operations are controllable |
| 4️⃣ | **Memory Light** | Remember preferences, not everything |
| 5️⃣ | **UI First** | User doesn't need to understand any technology |

---

## Summary

This PRD defines:

| Not This | But This |
|----------|----------|
| ❌ AI tool | ❌ ChatGPT wrapper |
| ✅ **Local AI work operating system** (lightweight version) |

---

*Document Version: v3*
*Last Updated: 2026-04-13*
