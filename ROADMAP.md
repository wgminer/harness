# Harness Roadmap

Living document. History tracks what shipped; Upcoming tracks what's next. Rewritten periodically as priorities shift.

---

## Completed

### 2026-03-22 — Tray assets, recorder UX & typed bridge

- **Tray & app icon** — Idle and recording tray PNGs (`resources/icon-tray*.png`, including `@2x`), plus an updated `build/icon.icns` so the Dock and menu bar stay consistent with product branding.
- **Renderer recording stack** — `useRecorder` hook and `recordingUtils` (PCM → WAV, start/stop chimes) keep capture logic out of views; Chat/App wiring uses the shared flow for save, export, transcription, and paste-back.
- **Typed `window.electron`** — `src/shared/electronAPI.ts` defines the preload contract (including recording, chat, memory search, tasks) so renderer code stays aligned with main-process IPC.

### 2026-03-21 — Providers, Recording & Search

- **Multi-provider architecture** — LLM provider abstraction (`LLMProvider` interface), provider registry, and extracted tool definitions. Chat streaming and title generation route through a unified provider interface, making new backends a single-file addition.
- **Ollama / local model support** — Full provider for any OpenAI-compatible local server (Ollama, LM Studio) with streaming chat, tool use, and conversation title generation.
- **Recording & transcription** — In-app audio capture (PCM → WAV), start/stop/cancel chimes, save-to-disk, export dialog, and show-in-folder. Pluggable transcription providers (OpenAI Whisper and local Whisper-compatible servers like whisper.cpp / faster-whisper-server) with a registry to switch between them. Tray icon reflects recording state.
- **Conversation search** — Full-text search across all stored conversations with title and content matching, snippet extraction, and match-range highlighting. Exposed to both the UI and the assistant via `memory_search_conversations`.
- **Settings v2 (provider & transcription)** — Active LLM provider picker (OpenAI vs Ollama), Ollama base URL and model fields, transcription provider picker (OpenAI vs local), local transcription endpoint config, and recording auto-send toggle — all in the Settings UI.

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

- **More providers** — Add Anthropic (Claude) and Google (Gemini) to the provider registry so all major APIs are a Settings toggle away.
- **Agent / autonomous mode** — Persistent, multi-step agent that can run plans (file work, web search, shell commands) across conversations with a human-in-the-loop approval step before destructive actions.
- **Semantic memory** — Upgrade long-term memory from flat key/value to a local vector store with similarity retrieval so the assistant surfaces relevant past context automatically.

### Medium-term

- **Telegram integration** — Connect to Telegram as an interface so Harness is reachable from mobile without a dedicated app.
- **Backup / sync** — Lightweight system to back up or sync conversations, memory, and settings across machines (local network, iCloud, or file-based).
- **Richer task management** — Due dates, priority levels, and task-to-conversation links on top of the existing status tracking.
- **Model parameter overrides** — Per-model temperature, max tokens, and top-p sliders editable in the Settings UI.
- **Auto-update** — Electron `autoUpdater` wired up so shipped builds can pull new versions without a manual reinstall.

### Longer-term

- **Plugin / tool registry** — A first-class way to install or write new tool sets (e.g. calendar, browser control, code execution sandbox) without modifying core source.
- **Windows and Linux builds** — Electron already supports it; needs CI, signing, and installer testing for each platform.
- **Conversation sharing / export** — Export individual conversations to Markdown or JSON; optionally generate a shareable read-only link.

---

*Last updated: 2026-03-22*
