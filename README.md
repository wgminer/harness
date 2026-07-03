# Harness

**Harness** is a personal, all-in-one desktop harness for working with LLMs: one app for chat, memory, tasks, file tools, and UI customization—without shipping your data to a third-party chat product. It is a **Tauri** desktop app (Rust backend + React UI in WKWebView) with a pluggable LLM backend (OpenAI cloud or OpenAI-compatible locals such as Ollama), streaming and tools, and everything else stored on disk.

Use it as your daily driver when you want API flexibility (model choice, keys in Settings) plus a focused, terminal-inspired interface you can reshape (layout, sidebar) and let the assistant adjust via built-in tools. The direction is broader than chat: Harness is a personal "tool for thought" intended to replace a fragmented set of SaaS tools with one trust-first system you control.

## Product direction

- **Personal super app**: Consolidate chat, backlog, tasks, planning, and lightweight automations in one local-first workspace.
- **Trust-first architecture**: Keep clear control over providers and data flow; default to local where practical and make external calls explicit.
- **Backlog-first capture**: Mobile and desktop both prioritize quick idea capture (especially voice-to-text) into a single inbox so thoughts are not lost.
- **Backburner continuity**: The earlier "Backburner" concept lives on as the capture/backlog layer within Harness.

## What you get

- **Chat**: Conversations with streaming replies, tool use, full-text search across history, and a sidebar grouped by date.
- **Memory**: Per-conversation context and long-term user memory (key/value in Settings), merged into the system prompt.
- **Tasks & plans**: Track work across conversations (see Tasks in the app).
- **Backlog capture**: Quickly capture ideas and route them into a backlog/inbox for later triage into tasks, plans, or conversations.
- **File tools**: The assistant can list, read, write, and delete files and create directories within allowed roots (e.g. app user data, home, desktop—see Rust backend configuration).
- **Self-improvement**: Ask for layout changes; the assistant uses `set_layout` (sidebar position and optional design grid overlay). The app uses a fixed dark theme baked into CSS.
- **Import**: Bring in exported ChatGPT conversation folders when you need to migrate context.
- **Recording & transcription**: Capture audio in-app, save or export WAV, transcribe on-device via Apple's Speech framework on macOS; the menu bar icon can reflect recording state.
- **Settings**: API key and model (OpenAI), or base URL and model for Ollama; transcription provider and recording options; memory editor.

Data stays on your machine (no Harness backend). For OpenAI models you supply your own API key; local providers use your machine only.

## Run from source

```bash
npm install
npm run dev
```

Requires Rust (for `src-tauri/`) and, on macOS, Xcode Command Line Tools for native speech/Fn helpers.

## Build & distribute

```bash
npm run dist:mac
```

Packaged installers (macOS, signing/notarization): see [BUILD.md](BUILD.md).

## Project layout

| Path            | Role                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/`    | App and menu bar icons (`icon.png`, `icon-tray*.png`); `build/icon.icns` is generated from `icon.png` for packaged Mac builds (see [BUILD.md](BUILD.md)). |
| `src-tauri/`    | Tauri shell and Rust backend (settings, memory, chat, sync, recording, native helpers).                                                                  |
| `src/renderer/` | React UI (chat, settings, tasks, styles) and the Tauri `desktopAdapter` bridge.                                                                           |
| `src/shared/`   | Shared TypeScript types and the typed `HarnessAPI` / `window.harness` contract.                                                                           |
| `ios/`          | **Harness Mobile** — native iOS chat app synced via the same backup folder as desktop ([ios/README.md](ios/README.md)).                                  |

## Harness Mobile (iOS)

Chat-only companion: OpenAI streaming, iCloud backup-folder sync (`bundle.json.gz` / `manifest.json`), no tools. See [ios/README.md](ios/README.md) for setup and the desktop ↔ phone sync workflow.

## Layout grid (desktop)

Primary UI spacing and line heights snap to a **4px grid** (theme type scale + shared CSS tokens). Details: [docs/4PX_GRID.md](docs/4PX_GRID.md). Check renderer CSS:

```bash
npm run grid:audit
```

## Roadmap

[ROADMAP.md](ROADMAP.md) defines four **project outcomes** (UI craft, subscription consolidation, mobile later, AI engineering lab) and maps completed work, the active v0.5 line, and backlog to them—use it to steer and score new ideas before building.
