# Harness Roadmap

Living document. **Completed** records what shipped; **v0.5** is the active plan for the next release; **Post v0.5** holds the longer backlog. Rewritten periodically as priorities shift.

---

## Completed

### 2026-04-21 — Test coverage expansion (unit + e2e)

- **Unit coverage upgrade** — Added broad Vitest coverage for persistence and data-loss-sensitive modules (`memory`, `writing`, `plans`, `settings`, `assistantTools` task reducer paths, ChatGPT import parsing, file-tools path safety) plus renderer/shared utility tests.
- **E2E flow coverage upgrade** — Expanded Playwright coverage for core UX and data durability: chat persistence across relaunch, conversation delete safety, settings/task flows, stream abort behavior, writing surface checkpoint persistence, and fixture-driven ChatGPT import dedupe.
- **Testability refactors** — Added `*In(dir)` pure-storage entry points across main-process persistence modules so tests can run against temp dirs without Electron bootstrapping.

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

## v0.5.0 — planned release

Target: iterate on real usage from 0.4.x — clearer shell layout, better scaling, one new external tool, and a concrete direction for mobile and backlog capture — without boiling the ocean.

### Layout, scaling, and shell

- **Viewport-aware UI scaling** — As the window (or embedded web surface) grows, typography and/or layout should scale or breathe so the app does not feel like a fixed-width column floating in empty space. Likely: fluid max-width, stepped or clamp-based font sizing, and/or CSS variables tied to breakpoints — exact approach TBD.
- **Sidebar behavior** — Revisit open/close animation, focus traps, and affordances so the side menu feels predictable and lightweight rather than distracting.
- **Chat page structure** — Rebuild the main chat layout with a clearer hierarchy: scroll regions, sticky composer, and stable heights so long conversations do not fight the viewport. Address current pain around **conversation column height** and streaming-era CSS quirks in one pass.

### Tools

- **Weather** — Add an assistant-callable weather tool backed by a **free or very cheap** HTTP API (candidates: [Open-Meteo](https://open-meteo.com/) — no API key for non-commercial use; or national/municipal free tiers). Keep the tool input/output small and obvious (e.g. location + short forecast summary).

### Mobile direction (companion, not parity)

- **iOS (or cross-platform shell)** — Aim for something **extremely simple**: mobile chat + Q&A against the same mental model as desktop, not feature parity.
- **Audio** — Prefer **voice-to-text** (or OS dictation) feeding normal chat, plus standard LLM calls — not a full duplicate of desktop recording/transcription unless it stays trivial to maintain.
- **Capture-first UX** — Mobile should optimize for "capture now, organize later": one-tap voice/text capture that lands in a backlog inbox without losing ideas.

### Product direction (tool for thought, not just chat)

- **SaaS consolidation** — Harness should progressively absorb daily SaaS workflows (notes, tasks, lightweight planning, assistant chats, and simple automation) into one personal system.
- **Trust-first control surface** — Assume low trust in external LLM providers: explicit provider routing, local-first defaults, and clear controls over what data leaves the device.
- **Backlog as the center** — Treat backlog/inbox as a first-class primitive shared across desktop and mobile; captured ideas become triageable work items before they become tasks or projects.
- **Backburner continuity** — Keep the "Backburner" concept as a capture/backlog mode inside Harness so prior mental models and project naming still map cleanly.

### Themes (carryover from ongoing polish)

- **Accent on dark backgrounds** — Introduce a derived accent token (e.g. softened or mixed toward foreground) for links and chips so saturated user accents remain readable on dark UI.

### Design questions to settle (may drive spikes, not necessarily full builds in 0.5)

These stay **easy to explain in one paragraph** each; implementation can trail.

- **Writing surface tool** — A durable, **markdown-only** document the model and user can write to over time — minimal schema, explicit save semantics, separate from ephemeral chat.
- **Conversation links + memory** — How conversations reference each other; how long-term memory is refreshed (on demand vs scheduled vs nightly scan). Prefer a small number of clear rules over a black box.

### Explicitly not in this roadmap doc

- **Multi-location development and testing workflows** — Worked separately alongside the **Devon LLM** setup; not tracked here.

---

## Post v0.5 — backlog

Pulled forward from earlier planning; order is not commitment.

### Near-term

- **Automated test suite & CI (follow-up)** — Core unit/e2e expansion is now in place; next step is CI hardening (lint, TypeScript checks, and Playwright in PR workflows) so regressions are caught automatically before merge.
- **More providers** — Anthropic (Claude) and Google (Gemini) in the provider registry.
- **Agent / autonomous mode** — Persistent multi-step agent with human-in-the-loop approval before destructive actions.
- **Semantic memory** — Local vector store + similarity retrieval on top of or beside key/value memory.
- **Backlog pipeline** — Unified capture inbox with quick-add, triage states, and promotion into tasks, conversations, or plans.
- **Workflow automation primitives** — Minimal, inspectable automations (rules/triggers/actions) that can run on backlog items without introducing a heavyweight external orchestrator.

### Medium-term

- **Telegram integration** — Harness reachable from mobile without a dedicated app (may overlap with iOS direction; revisit when mobile plan firms up).
- **Backup / sync** — Conversations, memory, settings across machines (local network, iCloud, or file-based).
- **Simple sync backend (non-realtime)** — A lightweight backend or sync protocol that keeps Harness state aligned across devices on a schedule or explicit sync (not live realtime). Include a minimal UI to inspect and resolve conflicts when the same records diverge. Expect automated tests for sync semantics, merge rules, and conflict handling.
- **Richer task management** — Due dates, priority, task-to-conversation links.
- **Model parameter overrides** — Temperature, max tokens, top-p in Settings.
- **Auto-update** — Electron `autoUpdater` for shipped builds.

### Longer-term

- **Plugin / tool registry** — Install or author tool sets without forking core.
- **Windows and Linux builds** — CI, signing, installers.
- **Conversation sharing / export** — Markdown/JSON export; optional read-only links.

---

*Last updated: 2026-04-21*