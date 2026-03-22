# Harness

**Harness** is a personal, all-in-one desktop harness for working with LLMs: one app for chat, memory, tasks, file tools, and UI customization—without shipping your data to a third-party chat product. It is an Electron app with a pluggable LLM backend (OpenAI cloud or OpenAI-compatible locals such as Ollama), streaming and tools, and everything else stored on disk.

Use it as your daily driver when you want API flexibility (model choice, keys in Settings) plus a focused, terminal-inspired interface you can reshape (theme, layout, sidebar) and let the assistant adjust via built-in tools.

## What you get

- **Chat**: Conversations with streaming replies, tool use, full-text search across history, and a sidebar grouped by date.
- **Memory**: Per-conversation context and long-term user memory (key/value in Settings), merged into the system prompt.
- **Tasks & plans**: Track work across conversations (see Tasks in the app).
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

| Path | Role |
|------|------|
| `resources/` | App and menu bar icons (`icon.png`, `icon-tray*.png`); `build/icon.icns` is generated from `icon.png` for packaged Mac builds (see [BUILD.md](BUILD.md)). |
| `src/main/` | Electron main process: settings, memory, chat, plans, customization, file tools, import. |
| `src/preload/` | Preload bridge exposing `window.electron`. |
| `src/renderer/` | React UI (chat, settings, tasks, styles). |
| `src/shared/` | Shared TypeScript types and the typed `ElectronAPI` / `window.electron` contract. |

## Roadmap

Completed milestones and upcoming work are tracked in [ROADMAP.md](ROADMAP.md).
