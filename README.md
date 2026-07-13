# Harness

An LLM harness built for me. Voice, chat, memory, tasks, text editing and more in one tool with full control over all inputs and outputs.

## Principles

- **Personal.** This is built for my workflow, not a general audience. It stays opinionated and unfinished.
- **Portable.** The major providers optimize for lock-in, but I want to leave, switch models, and keep my data.
- **Legible.** I want to see how context gets assembled, what prompts the system has, and what tools ran on each message.
- **Exploratory.** I'm building this to understand agentic systems, not just use them.

## Run

```bash
npm install
npm run dev
```

Rust required. On macOS, Xcode Command Line Tools for speech helpers.

```bash
npm run dist:mac
```

Packaging: [BUILD.md](BUILD.md).

## Tech

- Desktop: Tauri (Rust backend, React UI in WKWebView)
- Mobile: native iOS companion ([ios/README.md](ios/README.md)) for chat and capture
- Models: OpenAI API or OpenAI-compatible locals (e.g. Ollama)
- Storage: on disk; optional Cloudflare R2 sync
- Speech: Apple Speech framework on macOS and iOS
- Spacing: 4px type/layout tokens via `src/shared/grid.ts`

## Repo

- [ROADMAP.md](ROADMAP.md): outcomes and execution
- [IDEAS.md](IDEAS.md): scratchpad

