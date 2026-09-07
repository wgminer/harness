# Harness Roadmap

Two layers:

1. **Outcomes** — what the project is *for* (steer ideas here first).
2. **Execution** — what shipped, what’s active, what’s frozen.

**Current phase:** v0.10 (desktop **0.10.0**) — scoped coding tools, image region edits, first-run setup. Next: paper cuts and ship hygiene.

When considering work: *does it serve craft, trust, or ship friction — or does it belong in Frozen?*

---

## Project outcomes

### O1 — Showcase-grade layout and UI

Harness should feel deliberate: typography, spacing, motion, and hierarchy under real use — not a chat box in a dark skin.

| | |
|---|---|
| **Success** | Opening the app shows craft: readable density, fixed dark theme, surfaces that scale, chat/notes/settings that feel designed. |
| **Signals** | Fixed dark theme; 4px tokens (`src/shared/grid.ts`); object-library sidebar; Notes/System shells; session restore; tray branding. |
| **Gaps** | Density / CSS consolidation (~4.9k lines); empty/loading/error polish; menu bar tray mark refresh. |

### O2 — Replace paid AI subscriptions

One personal app for chat, memory, notes, tasks, and light automation — data local, sync optional.

| | |
|---|---|
| **Success** | You reach for Harness first; fewer SaaS tabs; clear backup/sync. |
| **Signals** | Chat + tools + memory; tasks; Notes + `proposeEdit`; image library; ChatGPT/Claude import; R2 sync + conflict review; OpenAI/Ollama; dictation; **desktop→iOS sync QR**. |
| **Gaps** | More providers, agent mode, semantic memory, inbox — **Frozen**. |

### O3 — Mobile companion

Capture and Q&A on phone — not desktop parity.

| | |
|---|---|
| **Success** | Voice/text capture on the go; ask a question; sync with desktop via R2. |
| **Signals** | Harness Mobile: SwiftUI chat, streaming, dictation, Voice Memos import, Live Activity, R2 + conflict sheet, **Set up sync** QR, Keychain. See [ios/README.md](ios/README.md). |
| **Gaps** | Capture-first inbox; Android — **Frozen**. |

### O4 — Learning lab for building AI tools

Practice the full stack: providers, tools, streaming, persistence, tests, UX — without hand-copying contracts.

| | |
|---|---|
| **Success** | Each change teaches something reusable: IPC, tool schema, parity test, provider adapter. |
| **Signals** | `resources/contracts/tools.json`; `ipcNames` ↔ Rust handler parity; sync-merge fixtures; typed `window.harness`; CI (lint, tsc, Vitest, Rust, iOS). |
| **Gaps** | More shared contracts (prompts, models, sync scopes); further god-file splits (`SettingsView.tsx`, `sync.rs`). |

### O5 — Low-friction development

Build, ship, and switch machines without a second project.

| | |
|---|---|
| **Success** | One-command release that doesn’t hang; obvious Dev vs installed; bootstrap a second Mac from docs. |
| **Signals** | `HARNESS_DEV` / **Harness Dev** display + **Harness Dev** data dir; dist runner; non-interactive updater signing env; package-driven version bump + `versionParity` test; [BUILD.md](BUILD.md). |
| **Gaps** | Cross-machine bootstrap checklist (signing keys, credentials) — still tribal. |

---

## Scorecard (July 2026)

| Outcome | Posture | Notes |
|---------|---------|--------|
| **O1** UI craft | Building | Home-first shell + library drawer landed; CSS/empty-state debt remains. |
| **O2** Subscriptions | Hardening | Core loops + sync QR shipped; feature expansion frozen. |
| **O3** Mobile | Building | Chat + dictation + R2 + pairing work; capture-inbox frozen. |
| **O4** Learning lab | Hardening | Contracts/parity started; more drift guards + file splits. |
| **O5** Dev friction | Hardening | Dev profile + release plumbing landed; bootstrap docs still thin. |

---

## Active now

Short list only — refresh when something ships.

- [x] **Desktop shell + cognitive modes** — Library drawer (hidden by default, edge/hover + pin); full-screen “You are here” home; Chat / Decide / Write / Refine modes (in-place on the open conversation). Distinct from frozen Agent mode. Mobile stays unopinionated. Serves O1/O2.
- [ ] **Menu bar tray icon** — replace the plain white squircle (`resources/icon-tray*.png` + recording/processing variants) with a clearer Harness mark (template-friendly at 18/36px).
- [ ] **CSS consolidation** for the fixed dark theme (fewer one-off surfaces).
- [ ] **Empty / loading / error** polish on primary desktop + iOS surfaces.
- [x] **Desktop dictation transcription screen** — polish recording overlay / “Transcribing…” UI in dictation mode.
- [ ] **iOS long-message** overflow / tap-to-expand.
- [ ] **More shared contracts** under `resources/contracts/` (prompts, model names, sync scopes) + parity tests. (`chatModes.json` landed.)
- [ ] **God-file splits** — keep chipping `SettingsView.tsx` and `sync.rs`.
- [ ] **Cross-machine bootstrap** notes in BUILD.md (no secrets in repo).

---

## Completed

### 2026-08 — Revert display brand to Harness `[O5]`

- User-visible brand back to **Harness** / **Harness Dev** / **Harness Mobile** (Dock, titles, Welcome, prompts, site/docs, `*.app` paths).
- Identity was already Harness (`com.harness.*`, Application Support, Keychain, sync wire) — no data migration.
- Compose quote unchanged: **“You are here”**.

### 2026-07 — Here display rename (light) `[O1][O5]`

- User-visible brand → **Here** / **Here Dev** / **Here Mobile** (Dock, titles, Welcome, boot wordmark, privacy strings, site/docs).
- Compose quote unchanged: **“You are here”**.
- Left alone on purpose: `com.harness.*`, Application Support `Harness` / `Harness Dev`, Keychain services, `harness-pair:1:`, R2 prefix `harness/`, `window.harness` / `HARNESS_*` env vars, helper binary (`HarnessSpeech`).

### 2026-09 — v0.10 coding tools + image regions `[O1][O2][O4]`

- **Coding tools** — Per-conversation CodingScope (project folder or Harness UI aspects), gated edit/shell/git tools, Plus-menu attach/scope UX.
- **Images** — Region markers drive edits; pending gated-tool approvals survive restart; chat opens local `file://` paths.
- **Shell** — Time-of-day theme, stream wait ticker, Settings Voice/Notes tabs, inline first-run API key with hex-scramble welcome.
- **Version** — Desktop **0.10.0** (iOS marketing version stays on its own line).

### 2026-08 — v0.9 chat modes + contracts `[O1][O2]`

- **Chat modes** — Decide / Write / Refine overlays (`chatModes.json`) with desktop picker.
- **Contracts** — Shared `systemPrompt.json` + coarse `chatStreamBatch.json` flushes; tools contract kept.
- **Shell** — Desktop search, settings/sidebar refresh, library peek; memory distill rename.
- **Version** — Desktop **0.9.0** (iOS marketing version stays on its own line).

### 2026-07 — v0.8 Consolidation `[O2][O4][O5]`

- **Cull** — Removed unfinished Plans objects, weather tool, nightly memory compile; theme studio already gone. Legacy `plans.json` ignored in sync merge.
- **Sync QR pairing** — Desktop **Show Sync QR** + iOS **Set up sync** (`pairingPayload`, `SyncQrModal`, `SyncPairingSheet`).
- **Dev profile** — `HARNESS_DEV` → separate Application Support (`Harness Dev`) + **Harness Dev** window title.
- **Release hygiene** — Non-interactive updater signing password default; single-source version bump; parity tests.
- **Contracts** — `resources/contracts/tools.json` shared across TS/Rust/Swift; `ipcNames` ↔ `generate_handler!` guard.
- **Version** — Desktop **0.8.0** (iOS marketing version stays on its own line).

### 2026-07 — image library, sidebar IA `[O1][O2]`

- Generated images as library objects; unified sidebar (chats, dictations, notes, images); Tasks · System meta row.

### 2026-06 — v0.7 — R2 sync, credentials, CI `[O2][O3][O4]`

- R2-only remote backup; secrets in OS keychain; iOS composer/styling polish; CI on PRs.

### 2026-05 — grid, Mobile, shell polish `[O1][O3]`

- 4px grid; Harness Mobile iOS; session restore; sync conflict review; dictation sessions; Claude import; Notes surface.

### 2026-03 / 04 — foundation `[O2][O4]`

- Streaming chat, tools, memory, tasks, ChatGPT import, providers (OpenAI/Ollama), recording + Apple Speech, conversation search, typed desktop API, signed macOS builds, Vitest coverage.

---

## Frozen (post–consolidation)

Nothing below starts until Active now is calm. Not a commitment sequence.

| Item | Outcomes |
|------|----------|
| Chat providers — Anthropic, Gemini APIs | O2, O4 |
| Agent mode with human-in-the-loop | O2, O4 |
| Decide / Refine as Q&A — Chat stays back-and-forth; Decide and Refine become interview-style (agent asks, user answers mostly via multiple choice — `::::options` or a dedicated control) | O1, O2 |
| Chat mode picker — dropdown — Replace the horizontal mode strip with a compact dropdown, right-aligned in the composer action row beside attach / voice / send (not a centered chip strip) | O1 |
| Cardinal directions UI — Experiment with anchoring surfaces and controls to N/E/S/W layout polarity (not only centered chat); design exploration | O1 |
| Semantic memory | O2, O4 |
| Backlog / inbox pipeline | O2, O3 |
| Capture-first mobile UX | O3 |
| Workflow automation | O2, O4 |
| Real-time sync (push wake) | O2, O3 |
| Encrypted cross-device key sync | O2, O4 |
| Richer LLM-assisted notes | O2, O4 |
| Viewport-aware UI scaling | O1 |
| Richer tasks (dates, priority, links) | O2 |
| Model params in Settings | O4 |
| Telegram (or similar) bridge | O3 |
| Plugin / tool registry | O4 |
| Windows & Linux builds | O2 |
| Conversation export / share | O2 |

### Already shipped (do not re-open)

- CI on PRs · Auto-update · iOS chat companion · R2 backup · Sync QR · Dev vs installed profile · tools.json + ipcNames parity

---

*Last updated: 2026-09-07*
