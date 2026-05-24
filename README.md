# Harness

**Harness** is a personal, all-in-one desktop harness for working with LLMs: one app for chat, memory, tasks, file tools, and UI customization—without shipping your data to a third-party chat product. It is an Electron app with a pluggable LLM backend (OpenAI cloud or OpenAI-compatible locals such as Ollama), streaming and tools, and everything else stored on disk.

Use it as your daily driver when you want API flexibility (model choice, keys in Settings) plus a focused, terminal-inspired interface you can reshape (theme, layout, sidebar) and let the assistant adjust via built-in tools. The direction is broader than chat: Harness is a personal "tool for thought" intended to replace a fragmented set of SaaS tools with one trust-first system you control.

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
- **File tools**: The assistant can list, read, write, and delete files and create directories within allowed roots (e.g. app user data, home, desktop—see main process configuration).
- **Self-improvement**: Ask for layout or theme changes; the assistant uses `update_theme` / `set_layout` (and related tools). Preferences live under the app user data directory.
- **Import**: Bring in exported ChatGPT conversation folders when you need to migrate context.
- **Recording & transcription**: Capture audio in-app, save or export WAV, transcribe via OpenAI or a local Whisper-compatible server; the menu bar icon can reflect recording state.
- **Settings**: API key and model (OpenAI), or base URL and model for Ollama; transcription provider and recording options; memory editor.

Data stays on your machine (no Harness backend). For OpenAI models you supply your own API key; local providers use your machine only.

## Run from source

```bash
npm install
npm run dev
```

## Build & distribute

Production build:

```bash
npm run build
npx electron .
```

Packaged installers (macOS, signing/notarization): see [BUILD.md](BUILD.md).

## Project layout


| Path            | Role                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/`    | App and menu bar icons (`icon.png`, `icon-tray*.png`); `build/icon.icns` is generated from `icon.png` for packaged Mac builds (see [BUILD.md](BUILD.md)). |
| `src/main/`     | Electron main process: settings, memory, chat, plans, customization, file tools, import.                                                                  |
| `src/preload/`  | Preload bridge exposing `window.electron`.                                                                                                                |
| `src/renderer/` | React UI (chat, settings, tasks, styles).                                                                                                                 |
| `src/shared/`   | Shared TypeScript types and the typed `ElectronAPI` / `window.electron` contract.                                                                         |
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