# Harness Roadmap

Living document with two layers:

1. **Outcomes** — what the project is *for* (steer ideas and compare work here first).
2. **Execution** — what shipped (**Completed**), what’s active (**v0.8 Consolidation**), and what’s **Frozen** until consolidation lands.

**Strategy for this phase:** rebuild in place — cull unused/unfinished features, harden what remains, fix the dev/release process, and clear paper cuts. No greenfield rewrite. No new product features until v0.8 ships.

When considering work, ask: *does this serve consolidation first, or does it belong in the Frozen backlog?*

---

## Project outcomes

Five concrete outcomes. Each has a **success picture** (how you know it’s working) and **signals** (things we can point at in the product today).

### O1 — Showcase-grade layout and UI

Harness should feel like a deliberate product: typography, spacing, motion, and hierarchy hold up under real use—not a dev tool skin on a chat box.

| | |
|---|---|
| **Success picture** | Someone opening the app notices craft: readable density, coherent fixed dark theme, surfaces that scale with the window, chat/notes/settings that feel designed—not bolted on. |
| **Signals today** | Fixed dark theme; **4px spacing tokens** (`src/shared/grid.ts`); type/icon/line-height tokens; `--accent-readable`; object-library sidebar (chats, notes, images); dedicated Notes/System shells; session restore; sidebar sort modes + peek fade; chat single-message layout; tray branding. |
| **Gaps** | Deeper viewport breakpoints; sidebar focus traps; empty/loading/error polish; CSS consolidation (~4.9k lines for a fixed theme). |
| **Anti-goals** | Feature sprawl that ignores layout debt; one-off screens that don’t share tokens; “good enough” spacing in primary flows. |

### O2 — Replace paid AI subscriptions

One personal harness should absorb daily workflows currently spread across chat apps, note tools, task lists, and light automation—so subscriptions shrink because Harness is *good enough* and *yours*.

| | |
|---|---|
| **Success picture** | You reach for Harness first for chat, memory, notes, tasks, and imports; fewer standalone AI SaaS tabs; data lives locally with clear sync/backup. |
| **Signals today** | Chat + tools + memory; tasks; Notes + `proposeEdit`; sticky notes; image library; ChatGPT + Claude import; **Cloudflare R2 sync** with per-file conflict review; conversation search; provider picker (OpenAI / Ollama); dictation sessions. |
| **Gaps** | Sync onboarding tax (R2 credentials); more chat providers (Claude/Gemini APIs); backlog/inbox primitive; richer notes; semantic memory; agent mode with guardrails — **feature gaps are Frozen until v0.8**. |
| **Anti-goals** | Thin wrappers that still require the original app; black-box memory; importing without a path to *use* data inside Harness. |

### O3 — Mobile companion

A small mobile surface for capture and Q&A—not desktop parity.

| | |
|---|---|
| **Success picture** | Capture ideas on the go (voice/text); ask Harness a question; sync cleanly with desktop via R2. |
| **Signals today** | **Harness Mobile (iOS)** — SwiftUI chat, OpenAI streaming, dictation, **R2 remote backup**; conflict sheet; Keychain API keys; system/HIG styling. Desktop sync/conflict UI for thorough merges. |
| **Gaps** | Capture-first inbox; R2 setup parity with desktop; Android; parity only where it reduces friction. |
| **Anti-goals** | Rebuilding desktop recording/transcription on phone; feature parity that doubles maintenance. |

### O4 — Learning lab for building AI tools

Harness is where you practice the full stack: providers, tools, streaming, persistence, evals, and UX around models—not just calling an API.

| | |
|---|---|
| **Success picture** | Each meaningful change teaches something reusable: a new tool, IPC boundary, test pattern, or provider adapter you could lift into another project — without triplicating contracts by hand. |
| **Signals today** | Provider registry; assistant tools; `*In(dir)` test harnesses; import parsers; typed `window.harness`; unit tests; iOS sync codec tests; CI on PRs (lint, tsc, Vitest, Rust, iOS). |
| **Gaps** | Cross-language drift checks (shared contracts + parity tests); plugin/tool registry; documented patterns for adding tools/providers. |
| **Anti-goals** | Opaque magic (no tests, no boundaries); one giant file per feature; hand-copied contracts guarded only by comments. |

### O5 — Low-friction development

Building, shipping, and switching machines should not be a second project.

| | |
|---|---|
| **Success picture** | One-command release that never hangs on a password prompt; obvious which binary/data dir you are in (dev vs installed); bootstrap a second Mac without re-deriving tribal knowledge; sync credentials have a low-pain path. |
| **Signals today** | `HARNESS_DEV` / **Harness Dev** separate Application Support dir; dist runner with timed steps; Tauri updater + GitHub `latest.json`; BUILD.md signing docs. |
| **Gaps** | Non-interactive signing (env/keychain); single-source version bump; cross-machine bootstrap script/docs; **one sync QR** desktop→iOS pairing; clearer dev-vs-prod affordances in UI. |
| **Anti-goals** | Manual version edits across three manifests; hanging `dist` on interactive prompts; undocumented credential/signing setup. |

---

## Outcome scorecard (snapshot)

Quick read on **July 2026**—refresh when major work lands.

| Outcome | Posture | Notes |
|---------|---------|--------|
| **O1** UI craft | **Building** | Object library + fixed dark theme landed; CSS/god-view debt and empty-state polish remain. |
| **O2** Subscription cannibal | **Hardening** | Core loops work; cull unfinished surface (plans, weather, memory compile); sync onboarding still painful. |
| **O3** Mobile | **Building** | iOS companion ships with chat + dictation + R2; setup and capture gaps remain. |
| **O4** Learning lab | **Hardening** | CI exists; dedup/drift-proofing is the next durable pattern. |
| **O5** Dev friction | **Started** | Dev data dir split exists; release/signing and cross-machine setup are recurring tax. |

---

## How to test an idea

Before building (or when reviewing a PR), score the idea 0–2 per outcome (*0 = no impact, 1 = indirect, 2 = direct*). During v0.8, prefer work that scores high on **O4/O5** or consolidates O1–O3 without adding net surface. If every outcome is 0, deprioritize unless it’s pure hygiene.

| Question | Outcome |
|----------|---------|
| Does it make a primary screen noticeably better to use? | O1 |
| Does it replace a workflow you still pay for or open another app for? | O2 |
| Does it only matter on phone? (If yes, is O3 actually unlocked?) | O3 |
| Will you learn something durable about AI product engineering? | O4 |
| Does it make build / ship / multi-machine work less painful? | O5 |

**Outcome tags in execution sections:** items marked `[O1]` … `[O5]` map to the list above (multiple tags allowed).

---

## Completed

### 2026-07 — image library, sidebar IA, releases `[O1][O2]`

- **Generated images as library objects** `[O1][O2]` — First-class peers to chats/notes; New → New image; canvas + right controls panel; `images` Rust module + `app-state/images/`.
- **Sidebar object-library IA** `[O1]` — Unified library list (chats, dictations, notes, images); meta row Tasks · System; Editor-as-tab removed.
- **Release line** — Desktop through **v0.7.10**; **v0.8.0** is the consolidation cut (see package / tauri / Cargo manifests).

### 2026-06 — v0.7.0 — R2 sync, credentials, iOS polish, CI `[O1][O2][O3][O4]`

- **Cloudflare R2 remote backup** `[O2][O3]` — R2 is the **only** sync transport; `RemoteBackupStore` on desktop and iOS; same `bundle.json.gz` + `manifest.json` format; active polling on focus + ~30s interval; iCloud/folder backup removed.
- **Credential hygiene** `[O2][O4]` — OpenAI/Tavily/R2 secrets in OS credential stores; secrets redacted from sync bundle; per-device keys (encrypted cross-device key sync in Frozen backlog).
- **iOS composer fixes** `[O3]` — Draft persistence, live streaming auto-scroll, composer focus/inset fixes, setup-alert Settings action.
- **Mobile system styling** `[O1][O3]` — Custom theming removed on iOS; standard system colors + SF fonts.
- **CI on PRs** `[O4]` — `.github/workflows/ci.yml`: lint, `tsc`, Vitest; Rust and iOS jobs (grid-audit later removed).
- **Version** — Desktop package `0.7.0`; iOS `MARKETING_VERSION` `0.7.0`.

### 2026-05-24 — 4px grid, Harness Mobile iOS, v0.6 `[O1][O3][O4]`

- **4px layout grid** `[O1]` — `src/shared/grid.ts` (`snapToGrid`, `space`, `lineHeightForFont`); type scale tokens; renderer CSS normalized (grid-audit tooling since removed).
- **Layout cleanup** `[O1]` — Removed `compact` / `comfortable` layout density.
- **Chat & sidebar UX** `[O1]` — Single-message chat centers in scroll area; sidebar date-bucket sort modes; peek fade.
- **Harness Mobile (iOS)** `[O3][O4]` — Native SwiftUI app: conversation list + thread, OpenAI streaming, Keychain; later moved from iCloud folder sync to R2. See [ios/README.md](ios/README.md).
- **Version** — Desktop package `0.6.0`.

### 2026-05 (shell line) — Session restore, sync review, motion, dictation `[O1][O2][O4]`

- **UI session persistence** — `ui-session.json` restores last view, conversation, and open note across restarts.
- **Sync conflict review** — Per-file local / remote / merged choice when backups diverge.
- **Shell polish** — Settings labeled System; task completion animation; code block highlighting; sidebar CSS refresh.
- **Dictation sessions** — Conversation `kind` for dictation vs chat; Fn recording gated to chat view.
- **Release tooling** — `dist` runner with timed steps and patch bump.

### 2026-05-17 — Claude import, memory compile, note print, settings & data UX `[O2][O4]`

- **Claude.ai conversation import** — Parse official export archives; Settings → Data import flow.
- **Nightly memory compile** — Once-per-day (plus manual “Compile now”) distill into `user_memory.json` — **scheduled for removal in v0.8 cull**.
- **Note printing** — System print dialog from the Notes toolbar menu.
- **Theme studio** (historical) — Multi-preset theming; later replaced by fixed dark theme; studio UI removed.
- **Settings & data UX** — Storage-layout diagram; “Show app data folder”; removed “erase all stored data” from UI/API.

### 2026-05 — Writing surface, theme-linked shell scaling, weather & folder sync `[O1][O2][O4]`

- **Notes / writing surface** — Notes view with templates, LLM `notes:proposeEdit`, sticky/pop-out windows.
- **Theme-linked UI scaling** — Shared font/icon tokens.
- **Readable accent token** — `--accent-readable`.
- **Weather tool** — `get_weather` via Open-Meteo — **scheduled for removal in v0.8 cull**.
- **Folder backup sync** — Later replaced by R2-only sync.

### 2026-04-21 — Test coverage expansion (unit + e2e) `[O4]`

- **Unit coverage upgrade** — Broad Vitest coverage for persistence-sensitive modules.
- **E2E** — Playwright flows (historical; current CI focuses on unit + Rust + iOS).
- **Testability refactors** — `*In(dir)` pure-storage entry points.

### 2026-03-22 — Tray assets, recorder UX & typed bridge `[O1][O4]`

- **Tray & app icon** — Menu bar + Dock branding.
- **Renderer recording stack** — Capture → WAV → on-device speech helpers.
- **Typed `window.harness`** — Desktop API contract in `src/shared/desktopAPI.ts`.

### 2026-03-21 — Providers, Recording & Search `[O2][O4]`

- **Multi-provider architecture** — OpenAI + Ollama-compatible locals.
- **Recording & transcription** — In-app + global Fn; Apple Speech helpers.
- **Conversation search** — Full-text + `memory_search_conversations` tool.
- **Settings v2** — Provider and transcription pickers.

### 2026-03-21 — Foundation `[O2][O4]`

- Desktop harness: streaming chat, tools, local memory, tasks & plans, ChatGPT import, Settings, signed macOS builds. (**Plans** objects never shipped a durable UI — **scheduled for removal in v0.8 cull**.)

---

## v0.8 — Consolidation (active)

### Sequencing

1. Finish in-flight polish / release (sidebar CSS unification, v0.7.x ship as needed).
2. **A — Cull** (biggest leverage, smallest risk).
3. **C — Dev process** (stops recurring ship friction).
4. **B — Hardening** (dedup on the smaller surface).
5. **D — Paper cuts** (ongoing, interleaved).

### Workstream A — Cull `[O2][O4]`

Remove unfinished or unused surface so everything downstream is smaller:

| Cull | Why |
|------|-----|
| **Plans objects** | Data + API existed; UI suppressed (`void plans` in App). No durable product. |
| **Weather tool** | Low-use Open-Meteo tool + default ZIP settings. |
| **Nightly memory compile** | Unused automatic distill + Settings “Compile now”. |
| **Theme studio remnants** | Code already fixed-dark; scrub docs/stale references only. |

Sync note: dropping `plans.json` from scopes must tolerate old bundles that still contain it.

### Workstream B — Hardening `[O1][O4]`

- Shared contracts + parity/drift guards (dedup plan W1–W5), including ipcNames ↔ `generate_handler!` parity.
- Break up god-files: `SettingsView.tsx`, `chat.rs`, `sync.rs`; extract `App.tsx` state.
- ~~Extend ESLint to cover `src/`.~~ Done (recommended TS/React rules; react-hooks@7 strict purity rules relaxed).
- ~~Retire cheap legacy naming (`legacyIpc*` bridge noise, `clippings` constants); keep data migrations.~~ Partial: renamed `tauriCommandName`/`tauriEventName`, removed dead `CLIPPINGS_NOTE_TITLE`; on-disk migrations unchanged.

### Workstream C — Dev process `[O5]`

- **Dev vs installed clarity** — documented `Harness Dev` vs `Harness` data dirs; icons unified; window title remains the Dev indicator.
- **Release pipeline** — non-interactive signing; single-source version bump; one-command release that doesn’t hang.
- **Cross-machine bootstrap** — scripted/docs path for signing keys, `TAURI_SIGNING_PRIVATE_KEY`, credentials, native helpers.
- **Sync onboarding** — one Mac **Show sync QR** / phone **Set up sync** (R2 under the hood; no OpenAI-vs-R2 UX split).

### Workstream D — Paper cuts `[O1][O3]`

Seeds:

- Sidebar CSS unification (Tasks/System → shared `.sidebar-item`).
- CSS consolidation for fixed dark theme.
- iOS message tap-to-expand / overflow.
- Empty / loading / error polish on primary surfaces.

---

## Frozen backlog (post–v0.8)

Nothing below starts until Consolidation ships. Ordered loosely by outcome; not a commitment sequence.

### Product / platform

| Item | Outcomes |
|------|----------|
| **Chat providers** — Anthropic, Gemini APIs (≠ export import) | O2, O4 |
| **Agent mode** with human-in-the-loop before destructive actions | O2, O4 |
| **Semantic memory** (vectors + retrieval) | O2, O4 |
| **Backlog pipeline** (inbox, triage, promote) | O2, O3 |
| **Capture-first mobile UX** — one-tap capture → inbox | O3 |
| **Workflow automation** (minimal rules/triggers) | O2, O4 |
| **Real-time sync** — sub-second push-triggered wake | O2, O3 |
| **Encrypted cross-device key sync** — opt-in sync passphrase for API keys | O2, O4 |
| **LLM-assisted notes** — metadata, guided actions, co-author panel (beyond `proposeEdit`) | O2, O4 |
| **Viewport-aware UI scaling** — deeper breakpoints | O1 |
| **Richer tasks** — due dates, priority, conversation links | O2 |
| **Model params in Settings** — temperature, max tokens, top-p | O4 |
| **Telegram** (or similar) as mobile bridge | O3 |
| **Backup / sync (deeper)** — scheduled sync, richer conflict rules | O2, O3 |
| **Plugin / tool registry** | O4 |
| **Windows & Linux builds** | O2 |
| **Conversation export / share** | O2 |

### Already shipped (do not re-open as backlog)

- ~~CI on PRs~~ — Done (0.7).
- ~~Auto-update for shipped builds~~ — Done (Tauri updater + GitHub releases).
- ~~iOS chat companion~~ — Done (v0.6+).
- ~~R2 remote backup~~ — Done (0.7).

---

*Last updated: 2026-07-14*
