# Harness glossary

Shared vocabulary for product and agent conversations. Prefer these terms over near-synonyms when talking about the app.

## Identity

| Term | Meaning |
|---|---|
| **Harness** | The product: a personal, offline-first place around a language model (chat, voice, notes, tasks, memory). |
| **Harness Dev** | Dev build (`npm run dev`): separate Dock name + data dir; credentials, sync, and audio are not split from installed. |
| **Desktop** | Tauri app (Rust + React) — primary client. |
| **Browser / Harness Web** | Debug shell: the desktop React chat UI in a regular browser (`npm run dev:browser`). localStorage only; not a shipped client. |
| **Harness Mobile / iOS** | Native companion: capture + Q&A + sync — not desktop parity. |

## Surfaces

A **surface** is a specific part of the app — typically a UI screen or focused interaction area (e.g. chat UI, dictation screen, notes, settings), not a platform/client.

### Important distinction

| Term | Meaning |
|---|---|
| **Chat UI** | The conversation surface: message thread, composer, chat modes, streaming replies. |
| **Dictation screen** | The voice-capture / transcription overlay (recording, “Transcribing…”, polish of spoken input). Distinct from the chat UI even when dictation lands in a conversation. |

## Core objects

| Term | Meaning |
|---|---|
| **Conversation** | A chat thread: messages over time, optional title, optional chat mode. |
| **Message** | One turn (`user` / `assistant` / `system`) plus optional attachments, tool calls, model, timestamp. |
| **Note** | Markdown document in the notes store; editable in the writing surface; can receive AI edit proposals. |
| **Task** | Item in the tasks list (separate from chat/notes). |
| **Memory** | Named key/value facts the model can pull into context (not the full chat history). |
| **Image** | Image library / attachment object, distinct from notes. |

## Chat & cognition

| Term | Meaning |
|---|---|
| **Chat mode** | Desktop-only stance on an open conversation: **Chat**, **Decide**, **Write**, **Refine**. Same thread; mode changes the system overlay + composer placeholder. Not Agent mode (frozen). |
| **System prompt** | Assembled instructions for a request: shared contract + platform overlay + mode overlay + memory/recent/temporal blocks. |
| **Context / context preview** | What actually goes to the model for a turn (prompt layers, selected memories, messages, tools) — the legible surface of a request. |
| **Tools** | Model-callable functions from the tools contract. Schemas sit beside the prompt, not inside it. |
| **Streaming** | Incremental assistant output (and related UI flush batching). |
| **Provider / model** | Where completions come from (OpenAI API or OpenAI-compatible local, e.g. Ollama). |

## Voice

| Term | Meaning |
|---|---|
| **Dictation** | Speech → text via Apple Speech (local). Often enters through the **dictation screen**, then may continue in the **chat UI**. |
| **Fn dictation / global hotkey** | Background Fn shortcut (needs Accessibility); optional bring-to-front. |
| **Transcript cleanup** | Optional post-pass via OpenAI to polish dictation. |
| **Dictionary** | Deterministic find/replace for repeated mishears. |
| **Recording** | Captured audio; local-only under shared `~/Library/Application Support/Harness/audio-recordings/` (Dev + Dist; not synced). |

## Notes & writing

| Term | Meaning |
|---|---|
| **Writing surface** | Notes editor UI. |
| **Template** | Seed title/body for new notes (Blank + user templates). |
| **proposeEdit** | AI suggests a note edit; user accepts/rejects (not silent overwrite). |

## Sync & data

| Term | Meaning |
|---|---|
| **App data / profile root** | On-disk home (`~/Library/Application Support/Harness` or `…/Harness Dev`). |
| **local-data** | Primary store: `app-state` (conversations, messages, memory, tasks, notes) + settings + sync state. |
| **Sync (R2)** | Optional Cloudflare R2 backup/sync of app-state + settings across devices. |
| **Sync pairing / QR** | Desktop→iOS setup for shared R2 credentials. |
| **Conflict review** | UI when sync pulls diverge from local. |
| **Credentials** | Secrets in OS credential store (not plain settings JSON). |
| **Setup gap / setup notice** | First-run or missing config (API key required; R2 / Accessibility recommended). |

## Principles & engineering

| Term | Meaning |
|---|---|
| **Personal / portable / legible / exploratory** | README principles — opinionated, leave-with-your-data, see context assembly, learning lab. |
| **Offline-first** | Local store is source of truth; sync is optional. |
| **Contract** | Shared JSON under `resources/contracts/` — single source across TS/Rust/Swift. |
| **Parity test** | Test that fails when mirrored clients or contracts drift (IPC names, versions, etc.). |

## Easy to muddy

- **Chat UI ≠ dictation screen** — voice capture/transcription UI vs the conversation thread/composer.
- **Chat mode ≠ Agent mode** — modes are cognitive overlays; Agent is frozen/out of scope.
- **Memory ≠ conversation history** — memories are curated facts; history is the thread.
- **Surface ≠ Desktop/iOS** — a surface is a part of the app UI; Desktop and Mobile are clients.
- **Harness vs Harness Dev** — display name + data folder only; not a separate sync identity.
- **Browser / Harness Web ≠ Desktop** — same React chat UI for local debugging; localStorage, no Tauri, not a shipped client.
