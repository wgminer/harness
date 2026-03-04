# Harness

A local ChatGPT-style Electron app with swappable models, memory, personalization, and a customization engine the assistant can modify (theme, layout). Dark mode, monospace, command-line style UI by default.

## Features

- **Chat**: OpenAI API (streaming, tool use). Add API key in Settings.
- **Memory**: Per-conversation history and long-term user memory (Settings → User memory). Injected into the system prompt.
- **File tools**: The assistant can list directories, read/write/delete files, create directories (paths restricted to userData, home, desktop).
- **Self-improvement**: Ask the assistant to change theme or layout (e.g. “sidebar on the right”, “use a dark theme”); it calls `update_theme` / `set_layout` tools; changes are stored in userData and applied in the UI.
- **Settings**: OpenAI API key, model, user memory key/value. Pluggable for future providers.

## Run

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
# Then run: npx electron .
```

## Project structure

- `src/main/` — Electron main process (settings, memory, chat, customization, file tools).
- `src/preload/` — Preload script exposing `window.electron` API.
- `src/renderer/` — React UI (chat, settings, base styles).
- `src/shared/` — Shared types.

Data is stored under the app userData directory (no backend).
