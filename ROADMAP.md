# Harness Roadmap

Living document with two layers:

1. **Outcomes** — what the project is *for* (steer ideas and compare work here first).
2. **Execution** — what shipped (**Completed**), what’s active (**v0.6**), and what’s queued (**Post v0.6**).

When considering a feature, ask: *which outcome does it serve, and does anything already on the execution track do it better?*

---

## Project outcomes

Four concrete outcomes. Each has a **success picture** (how you know it’s working) and **signals** (things we can point at in the product today).

### O1 — Showcase-grade layout and UI

Harness should feel like a deliberate product: typography, spacing, motion, and hierarchy hold up under real use—not a dev tool skin on a chat box.

| | |
|---|---|
| **Success picture** | Someone opening the app notices craft: readable density, coherent theme, surfaces that scale with the window, chat/notes/settings that feel designed—not bolted on. |
| **Signals today** | **4px layout grid** + `grid:audit`; theme type scale (font + icon + line-height tokens); Theme studio; `--accent-readable`; dedicated Notes/Config shells; session restore; sidebar sort modes + peek fade; chat single-message layout; motion audit doc; tray branding. |
| **Gaps** | Deeper viewport breakpoints; sidebar focus traps; empty/loading/error polish; run `grid:audit` in CI. |
| **Anti-goals** | Feature sprawl that ignores layout debt; one-off screens that don’t share tokens; “good enough” spacing in primary flows. |

### O2 — Replace paid AI subscriptions

One personal harness should absorb daily workflows currently spread across chat apps, note tools, task lists, and light automation—so subscriptions shrink because Harness is *good enough* and *yours*.

| | |
|---|---|
| **Success picture** | You reach for Harness first for chat, memory, notes, tasks, and imports; fewer standalone AI SaaS tabs; data lives locally with clear sync/backup. |
| **Signals today** | Chat + tools + memory; tasks & plans; Notes + `proposeEdit`; ChatGPT + Claude import; nightly memory compile; folder backup sync with **per-file conflict review**; conversation search; weather tool; provider picker (OpenAI / Ollama); dictation sessions. |
| **Gaps** | More chat providers (Claude/Gemini APIs); backlog/inbox primitive; richer notes (metadata, search, guided actions); semantic memory; agent mode with guardrails. |
| **Anti-goals** | Thin wrappers that still require the original app; black-box memory; importing without a path to *use* data inside Harness. |

### O3 — Mobile companion (later)

A small mobile surface for capture and Q&A—not desktop parity.

| | |
|---|---|
| **Success picture** | Capture ideas on the go (voice/text → inbox); ask Harness a question; optional Telegram-style bridge before a full app. |
| **Signals today** | **Harness Mobile (iOS)** — SwiftUI chat, OpenAI streaming, same `bundle.json.gz` / `manifest.json` backup folder as desktop; conflict sheet on phone; Keychain API key. Desktop sync/conflict UI for thorough merges. |
| **Gaps** | Capture-first inbox on mobile; voice capture; Android; parity only where it reduces friction. |
| **Anti-goals** | Rebuilding desktop recording/transcription on phone v1; feature parity that doubles maintenance. |

### O4 — Learning lab for building AI tools

Harness is where you practice the full stack: providers, tools, streaming, persistence, evals, and UX around models—not just calling an API.

| | |
|---|---|
| **Success picture** | Each meaningful feature teaches something reusable: a new tool, IPC boundary, test pattern, or provider adapter you could lift into another project. |
| **Signals today** | Provider registry; assistant tools; `*In(dir)` test harnesses; memory compile pipeline; import parsers; typed `window.electron`; unit + e2e coverage; iOS sync codec tests; `docs/4PX_GRID.md` + motion audit. |
| **Gaps** | CI on PRs (lint, tsc, Playwright, `grid:audit`); plugin/tool registry; documented patterns for adding tools/providers. |
| **Anti-goals** | Opaque magic (no tests, no boundaries); one giant file per feature; skipping the “why” in favor of copy-paste. |

---

## Outcome scorecard (snapshot)

Quick read on **May 2026**—refresh when major work lands.

| Outcome | Posture | Notes |
|---------|---------|--------|
| **O1** UI craft | **Building** | 4px grid + type scale landed; shell/session/motion improved; chat column still has room for breakpoint work. |
| **O2** Subscription cannibal | **Building** | Core harness + imports + sync conflict review; providers and backlog still open. |
| **O3** Mobile | **Started** | iOS chat companion ships; capture/inbox still desktop-first. |
| **O4** Learning lab | **Building** | Good architecture and tests; CI/docs for patterns still thin. |

---

## How to test an idea

Before building (or when reviewing a PR), score the idea 0–2 per outcome (*0 = no impact, 1 = indirect, 2 = direct*). If every outcome is 0, deprioritize unless it’s pure hygiene.

| Question | Outcome |
|----------|---------|
| Does it make a primary screen noticeably better to use? | O1 |
| Does it replace a workflow you still pay for or open another app for? | O2 |
| Does it only matter on phone? (If yes, is O3 actually unlocked?) | O3 |
| Will you learn something durable about AI product engineering? | O4 |

**Outcome tags in execution sections:** items marked `[O1]` … `[O4]` map to the list above (multiple tags allowed).

---

## Completed

### 2026-05-24 — 4px grid, Harness Mobile iOS, v0.6 `[O1][O3][O4]`

- **4px layout grid** `[O1]` — `src/shared/grid.ts` (`snapToGrid`, `space`, `lineHeightForFont`); theme `typeScaleCssVars` emits grid-aligned font, icon, and line-height tokens; renderer CSS normalized; `npm run grid:audit` (`scripts/grid-audit.js`); [docs/4PX_GRID.md](docs/4PX_GRID.md).
- **Layout cleanup** `[O1]` — Removed `compact` / `comfortable` layout density; spacing driven by theme font size + grid. Chat composer dock and tasks composer heights snap to grid.
- **Chat & sidebar UX** `[O1]` — Single-message chat centers in scroll area; sidebar default sort “Recent” with date-bucket and calendar-day modes; progressive fade on peek rows 8–12.
- **Harness Mobile (iOS)** `[O3][O4]` — Native SwiftUI app: conversation list + thread, OpenAI streaming, Keychain, iCloud backup-folder sync (`bundle.json.gz`, manifest), conflict sheet; [ios/README.md](ios/README.md). Xcode project via `project.yml` / XcodeGen.
- **Version** — Desktop package `0.6.0`.

### 2026-05 (shell line) — Session restore, sync review, motion, dictation `[O1][O2][O4]`

- **UI session persistence** — `ui-session.json` restores last view, conversation, and open note across restarts.
- **Sync conflict review** — Per-file local / remote / merged choice when backup folder diverges; explicit pull/push/conflict paths.
- **Shell polish** — Settings renamed to Config; task completion animation; code block highlighting in chat; sidebar/theme CSS refresh; [docs/UI_TRANSITION_AUDIT.md](docs/UI_TRANSITION_AUDIT.md).
- **Dictation sessions** — Conversation `kind` for dictation vs chat; title policy for user-only dictation threads; Fn recording gated to chat view.
- **Release tooling** — `dist` runner with timed steps and patch bump (`8d501a2`).

### 2026-05-17 — Claude import, memory compile, note print, settings & data UX `[O2][O4]`

- **Claude.ai conversation import** — Parse official export archives (`conversations.json` and per-file variants); map `human`/`assistant` and structured content blocks; dedupe by `claudeId`; Settings → Data import flow and `memory:importFromClaudeFolder` IPC (parallel to ChatGPT import).
- **Nightly memory compile** — Once-per-day (plus manual “Compile now”) OpenAI distill of recent user messages into `user_memory.json`; char/conversation budgets; merge rules with case-insensitive key matching; `memory_compile_state.json` for last-run status; deferred run on app launch (skipped in E2E).
- **Note printing** — `buildNotePrintHtml` + hidden-window system print dialog from the Notes toolbar menu.
- **Theme studio refresh** `[O1]` — Color-only presets (night, paper, matcha, ik blue, bloomberg); typography (fonts, stepped font size) separate from palette; `applyThemeColors` / `themeMatchesColorPreset` helpers.
- **Settings & data UX** `[O2]` — ASCII storage-layout diagram on Data tab; “Show app data folder” opens full Electron `userData`; backup-folder picker with iCloud default suggestion; removed “erase all stored data” from UI/API; note template descriptions normalized to first line.

### 2026-05 — Writing surface, theme-linked shell scaling, weather & folder sync `[O1][O2][O4]`

- **Notes / writing surface** — Dedicated Notes view with templates (`{{today}}`), overview, save/delete, show-in-folder, and LLM `notes:proposeEdit` for guided edits (preview before apply).
- **Theme-linked UI scaling** — Surfaces (chat, notes, settings, tasks, sidebar) use `calc(var(--font-size) * …)` and shared icon-size tokens so typography scales with Theme studio base size.
- **Readable accent token** — `--accent-readable` (oklab mix toward foreground) for links and accent text on dark backgrounds; vivid accents unchanged for borders/backgrounds.
- **Weather tool** — `get_weather` assistant tool via [Open-Meteo](https://open-meteo.com/) (US ZIP, °F); default ZIP in Settings.
- **Folder backup sync** — Provider-agnostic backup folder (push/pull bundle + manifest), sync status in Settings, cloud-folder suggestions (e.g. iCloud Drive), conflict-copy detection.

### 2026-04-21 — Test coverage expansion (unit + e2e) `[O4]`

- **Unit coverage upgrade** — Broad Vitest coverage for persistence and data-loss-sensitive modules plus renderer/shared utility tests.
- **E2E flow coverage upgrade** — Playwright: chat persistence, delete safety, settings/tasks, stream abort, notes, ChatGPT import dedupe.
- **Testability refactors** — `*In(dir)` pure-storage entry points for temp-dir tests without Electron boot.

### 2026-03-22 — Tray assets, recorder UX & typed bridge `[O1][O4]`

- **Tray & app icon** — Menu bar + Dock branding.
- **Renderer recording stack** — `useRecorder`, PCM → WAV, chimes; shared save/export/transcribe flow.
- **Typed `window.electron`** — Preload contract in `src/shared/electronAPI.ts`.

### 2026-03-21 — Providers, Recording & Search `[O2][O4]`

- **Multi-provider architecture** — `LLMProvider` registry; streaming + tools + titles through one interface.
- **Ollama / local model support** — OpenAI-compatible local servers.
- **Recording & transcription** — In-app capture; Whisper + local transcription registry; tray recording state.
- **Conversation search** — Full-text search + `memory_search_conversations` tool.
- **Settings v2** — Provider and transcription pickers, recording auto-send.

### 2026-03-21 — Foundation `[O2][O4]`

- Desktop harness: streaming chat, tools, local memory, file tools, theme/layout tools, tasks & plans, ChatGPT import, Settings, signed macOS builds.

---

## v0.6.0 — release line (in progress)

Near-term execution under the outcomes above. **Shipped on this line** is summarized in **Completed (2026-05-24\*)** and the shell line above.

### Layout, scaling, and shell `[O1]` — remaining

- **Viewport-aware UI scaling (deeper pass)** — Fluid max-width, breakpoints, chat layout that uses large windows well.
- **Sidebar behavior** — Focus traps, keyboard nav; motion items from [UI_TRANSITION_AUDIT.md](docs/UI_TRANSITION_AUDIT.md).
- **Grid in CI** — Run `npm run grid:audit` on PRs.

### Tools

- ~~**Weather**~~ — **Done** `[O2]`.

### Mobile direction `[O3]`

- ~~**iOS chat companion**~~ — **Done** (v0.6); see [ios/README.md](ios/README.md).
- **Capture-first UX** — One-tap capture → backlog inbox (depends on backlog primitive `[O2]`).
- **Audio on mobile** — OS dictation into chat; avoid duplicating desktop recording unless trivial.

### Trust & consolidation (cross-cutting) `[O2]`

- **Trust-first control** — Explicit provider routing, local-first defaults, clear data-leave-device boundaries.
- **Backlog as center** — Shared inbox across surfaces; triage into tasks, conversations, plans.
- **Backburner continuity** — Capture/backlog mode naming and mental-model fit.

### LLM-Assisted Notes `[O2][O4]`

- **Phase 1 (MVP+)** — Note metadata, list/search/sort, `note_suggest_outline` / `note_rewrite_section`. *Partial:* `notes:proposeEdit`.
- **Phase 2** — Guided actions (“brainstorm”, “tighten”, …), diff/preview, snapshots. *Partial:* edit proposals.
- **Phase 3** — Co-author side panel, block-level intents, provenance timeline.
- **Conversation links + memory** — Cross-conversation references; memory refresh rules. *Partial:* nightly memory compile + manual run.

### Explicitly not in this doc

- **Multi-location dev workflows** — Tracked with **Devon LLM** setup separately.

---

## Post v0.6 — backlog

Ordered loosely by outcome; not a commitment sequence.

### Near-term

| Item | Outcomes |
|------|----------|
| **CI hardening** (lint, tsc, Playwright, `grid:audit` on PR) | O4 |
| **Chat providers** — Anthropic, Gemini APIs (≠ export import) | O2, O4 |
| **Agent mode** with human-in-the-loop before destructive actions | O2, O4 |
| **Semantic memory** (vectors + retrieval) | O2, O4 |
| **Backlog pipeline** (inbox, triage, promote) | O2, O3 |
| **Workflow automation** (minimal rules/triggers) | O2, O4 |
| **R2 remote backup** — S3-compatible blob backup; backup-only mode first | O2, O3, O4 |

#### R2 remote backup `[O2][O3][O4]`

Replace slow iCloud Drive folder transport with direct HTTPS upload/download of the existing sync artifacts.

- **Provider:** Cloudflare R2 — S3-compatible API, permanent free tier (10 GB), no egress fees; scoped bucket API token (no IAM maze).
- **Artifacts:** reuse `bundle.json.gz` + `manifest.json`; no format change.
- **Mode (v1):** **backup-only** — push local blob on edit / background; pull on app launch when remote is newer. Skip bidirectional merge initially (last-write-wins or newer-timestamp-wins is fine for personal backup). Full merge can come later.
- **Implementation:** new `SyncProvider: "s3Backup"` alongside `"folderBackup"`; thin `RemoteBackupStore` (`readManifest`, `readBundle`, `writeBundle+Manifest`); desktop via `@aws-sdk/client-s3` + R2 endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `region: "auto"`); iOS via URLSession + SigV4 (or AWS SDK for Swift); credentials in Keychain / encrypted settings.
- **Settings:** bucket name, account ID, access key, secret (scoped to one bucket prefix, e.g. `harness/`).
- **Bonus:** enable R2/S3 object versioning for automatic backup history without changing the bundle format.
- **Why:** one HTTPS round-trip per direction, clear upload-complete signal, no `.icloud` placeholders or waiting for filesystem sync daemons. Folder backup (Dropbox/Drive/iCloud) stays as an option for users who prefer it.

### Medium-term

| Item | Outcomes |
|------|----------|
| **Telegram** (or similar) as mobile bridge | O3 |
| **Backup / sync (deeper)** — scheduled sync, bidirectional merge on R2, richer conflict rules | O2, O3 |
| **Richer tasks** — due dates, priority, conversation links | O2 |
| **Model params in Settings** — temperature, max tokens, top-p | O4 |
| **Auto-update** — `autoUpdater` for shipped builds | O2 |

### Longer-term

| Item | Outcomes |
|------|----------|
| **Plugin / tool registry** | O4 |
| **Windows & Linux builds** | O2 |
| **Conversation export / share** | O2 |

---

*Last updated: 2026-06-14*
