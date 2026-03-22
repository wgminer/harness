# Harness Roadmap

Living document. History tracks what shipped; Upcoming tracks what's next. Rewritten periodically as priorities shift.

---

## Completed

### 2026-03-21 — Foundation
- Established project identity as a personal, all-in-one LLM harness (desktop app, local data, OpenAI API).
- Electron + React app with streaming chat, tool use, and searchable conversation history grouped by date.
- Per-conversation context and long-term user memory (key/value), merged into the system prompt.
- File tools: the assistant can list, read, write, delete files and create directories within allowed roots.
- Self-improvement tools: `update_theme` / `set_layout` and related tools let the assistant reshape the UI on request; preferences persist to disk.
- Tasks & plans panel for tracking work across conversations.
- ChatGPT conversation import.
- Settings view: API key, model selection, memory editor.
- macOS production builds with code signing and notarization via electron-builder.
- Custom app icon and `productName: Harness` throughout the build pipeline.

---

## Upcoming

### Near-term

- **Recording / transcription** — In-app audio recording with Whisper-based transcription piped into chat input.
- **Conversation search** — Full-text search across all stored conversations, not just date-grouped browsing.
- **Richer task management** — Status tracking (todo / in-progress / done), due dates, and task-to-conversation links.
- **Settings v2** — Per-model parameter overrides (temperature, max tokens, top-p) editable in the UI.
- **Auto-update** — Electron `autoUpdater` wired up so shipped builds can pull new versions without a manual reinstall.

### Medium-term

- **Multi-provider support** — Swap between OpenAI, Anthropic (Claude), and Google (Gemini) from Settings without changing anything else.
- **Local model support** — Connect to Ollama or LM Studio for fully offline operation.
- **Semantic memory** — Upgrade long-term memory from flat key/value to a local vector store with similarity retrieval so the assistant surfaces relevant past context automatically.
- **Agent / autonomous mode** — Let the assistant run multi-step plans (file work, web search, shell commands) with a human-in-the-loop approval step before any destructive action.
- **Notifications** — System notifications for long-running tasks and scheduled reminders the assistant can set.

### Longer-term

- **Plugin / tool registry** — A first-class way to install or write new tool sets (e.g. calendar, browser control, code execution sandbox) without modifying core source.
- **Voice I/O** — Push-to-talk input and TTS playback so the app can be used hands-free.
- **Windows and Linux builds** — Electron already supports it; needs CI, signing, and installer testing for each platform.
- **Conversation sharing / export** — Export individual conversations to Markdown or JSON; optionally generate a shareable read-only link.
- **Mobile companion** — Lightweight iOS/Android read-only view of tasks, memory, and recent conversations synced via a local network or iCloud relay.

---

*Last updated: 2026-03-21*
