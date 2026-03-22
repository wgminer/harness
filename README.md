# Harness

**Harness** is a personal, all-in-one desktop harness for working with LLMs: one app for chat, memory, tasks, file tools, and UI customization—without shipping your data to a third-party chat product. It is an Electron app that talks to the OpenAI API (streaming, tools) and keeps everything else local on disk.

Use it as your daily driver when you want API flexibility (model choice, keys in Settings) plus a focused, terminal-inspired interface you can reshape (theme, layout, sidebar) and let the assistant adjust via built-in tools.

## What you get

- **Chat**: Conversations with streaming replies, tool use, and searchable history grouped by date.
- **Memory**: Per-conversation context and long-term user memory (key/value in Settings), merged into the system prompt.
- **Tasks & plans**: Track work across conversations (see Tasks in the app).
- **File tools**: The assistant can list, read, write, and delete files and create directories within allowed roots (e.g. app user data, home, desktop—see main process configuration).
- **Self-improvement**: Ask for layout or theme changes; the assistant uses `update_theme` / `set_layout` (and related tools). Preferences live under the app user data directory.
- **Import**: Bring in exported ChatGPT conversation folders when you need to migrate context.
- **Settings**: API key, model, and memory—structured for additional providers later.

Data stays on your machine (no Harness backend). You supply your own OpenAI API key.

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
| `src/main/` | Electron main process: settings, memory, chat, plans, customization, file tools, import. |
| `src/preload/` | Preload bridge exposing `window.electron`. |
| `src/renderer/` | React UI (chat, settings, tasks, styles). |
| `src/shared/` | Shared TypeScript types. |

## Roadmap

Completed milestones and upcoming work are tracked in [ROADMAP.md](ROADMAP.md).
