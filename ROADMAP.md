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
| **Gaps** | Memory is stale and unselected (see **Sleep memory** project). More providers, inbox — **Frozen**. |

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
- [ ] **Coding agent v2 (daily driver)** — Make Harness good enough to replace Claude Code for daily coding. Keep the agent Pi-minimal (read / edit / write / bash, short prompt, loop runs until the model stops calling tools) so most gains come from better models. Slices, in order: (0) send tool calls from earlier turns back to the model and replace the silent 10-round cap; (1) a turn timeline with live tool status and output; (2) steering mid-turn (Enter steers, ⌥Enter queues); (3) web search v2 + `web_fetch`; (4) undo via a shadow-git snapshot per turn; (5) iOS shows coding turns the same way (shared `toolDisplay.json`, synced display items) and can queue "run on desktop" jobs, with no coding agent on the phone; (6) composer attachments: `@` file mentions, images, folder drops; (7) four tools + AGENTS.md + a permissions contract with "always allow" + workspace folders (read-only or read-write, outside reads ask); (8) loop guard; (9) compaction. Serves O3 as well. Audit and design: [docs/research/coding-agent-audit.html](docs/research/coding-agent-audit.html). Serves O2/O4. Promoted from Frozen "Agent mode with human-in-the-loop".
  - **Concurrent turns (prerequisite for long coding turns).** Today one turn runs app-wide: `ChatController` holds a single cancel token / active stream / note stream, `chat:stop` takes no conversation id, and turn state lives in `ChatView` (the sidebar only knows about the open conversation). Slices: (a) key backend turn state by conversation id, with `chat:stop(conversationId)` and `chat:getActiveTurns`; (b) a renderer turn registry hook above `ChatView` fed by the stream events (already tagged with `conversationId`), so switching away never cancels and switching back rehydrates; (c) sidebar row state from that registry: pulsing dot while running, a distinct "needs you" state when parked on a gated-tool approval, and an unread mark when a background turn finishes; (d) attention outside the sidebar (tray / dock badge) for approvals in conversations that are not open.
- [ ] **Sleep memory** — Memory that builds itself: once per day, distill that day's dictations and chats into day digests, people/project cards, and open threads, then inject only what matches the current turn. Replaces the save-a-fact tool model, which prod use shows is not working. Slices and design: [Project: Sleep memory](#project-sleep-memory). Serves O2/O3/O4. Promoted from Frozen "Semantic memory".
- [ ] **Menu bar tray icon** — replace the plain white squircle (`resources/icon-tray*.png` + recording/processing variants) with a clearer Harness mark (template-friendly at 18/36px).
- [ ] **CSS consolidation** for the fixed dark theme (fewer one-off surfaces).
- [ ] **Empty / loading / error** polish on primary desktop + iOS surfaces.
- [x] **Desktop dictation transcription screen** — polish recording overlay / “Transcribing…” UI in dictation mode.
- [ ] **iOS long-message** overflow / tap-to-expand.
- [ ] **More shared contracts** under `resources/contracts/` (prompts, model names, sync scopes) + parity tests. (`chatModes.json` landed.)
- [ ] **God-file splits** — keep chipping `SettingsView.tsx` and `sync.rs`.
- [ ] **Cross-machine bootstrap** notes in BUILD.md (no secrets in repo).

---

## Project: Sleep memory

Memory should be a by-product of using Harness, not something the model has to remember to do. Once per day the desktop app "sleeps": it reads the day's dictations and chats and consolidates them into a small, dated, legible store. At chat time it "wakes" with only the parts that match the turn.

**Goal: Harness is the only assistant.** Memory is one of the things that keeps conversations in Claude today, so it is a switching requirement, not a nice-to-have. The store is built for Harness chat and dictation. Imported Claude history is a one-time backfill and a shrinking source, not something to keep serving; exporting memory to other assistants is a non-goal.

### What prod use showed (installed app, 2026-06 to 2026-10)

Usage:

- **Dictation is the product, chat happens elsewhere.** Since June: 1,778 dictations, 512 imported Claude conversations, and roughly 200 to 275 native Harness chats. Median 17 sessions per active day (max 118).
- **Harness is the mouth, Claude the brain.** At least 230 of 1,719 usable dictations (13%) show up near-verbatim as a Claude message, typically within a minute. The rest went to destinations Harness cannot see.
- **Claude conversations are short but reply-heavy.** Median 2 user turns; about 370 characters from the user against 2,000 from the model (top tenth near 10,000).
- **Claude carries the personal topics.** Health, money, and family appear there far more than in dictations.
- **Most dictations never reach a model.** 1,665 of 1,778 have no assistant reply. They are voice-to-text taken elsewhere (messages, briefs, prompts for coding agents).
- **Sessions are single-shot.** Median conversation is one message; 84 of 3,662 exceed 20 messages. Median dictation is about 240 characters.
- **Content is mostly work,** with app development and home topics behind. The same people and projects recur for weeks.

Memory today:

- **Nothing written since May.** `memory_set` ran 19 times in two conversations. The last distill was 2026-05-24 (nightly compile was culled in v0.8).
- **No selection.** All 127 keys (about 15k characters) are injected on every turn, sorted by key.
- **Noisy store.** 18 keys hold a "[removed by user request]" tombstone instead of being deleted; style rules are stored three and four times under different keys; dated one-off events never expire.
- **Poor coverage.** Several of the most-mentioned people in dictations (20 to 40 conversations each) have no entry.
- **Recall was tried and failed.** 22 of 23 recorded `memory_search_conversations` calls in July returned nothing, mostly long keyword-soup queries. The two August calls returned hits; the model has rarely searched since.
- **Recall is wanted.** About 75 user messages since June lean on prior context ("we talked", "last week", "what did I say about the brief").

Conclusions: Harness chat has to earn the conversations that go to Claude today, and remembered context is part of that; a tool the model must choose to call does not get called; the corpus worth learning from is the user's own dictated words, which the model never sees today; and what is missing is work context (who, what project, what is open), not more profile facts.

### Principles

1. **Passive.** No memory depends on the model deciding to save it.
2. **Derived and rebuildable.** Conversations stay the source of truth. Every memory entry cites the conversation ids it came from and can be regenerated.
3. **Legible.** Plain files, visible and editable in Settings. No embeddings or vector store in v1.
4. **Dated.** Every entry has `lastSeen`; things decay unless re-mentioned.
5. **Bounded.** The injected memory has a fixed budget (target under 1.5k tokens, down from roughly 3.7k).
6. **Desktop writes, iOS reads.** One writer keeps sync merges trivial.

### Store

Under `app-state/memory/`:

| File | Holds | Written by |
|------|-------|------------|
| `standing.md` | Standing instructions (voice, formatting, "do only what is asked"). Always injected. | User only |
| `user_memory.json` (existing) | Explicit profile facts: Settings edits and `memory_set`. | User, model |
| `days/YYYY-MM-DD.json` | Day digest: summary, topics, decisions, open threads, each with source conversation ids. | Sleep |
| `entities.json` | Cards for people, projects, topics: `id`, `kind`, `name`, `aliases`, `summary`, `firstSeen`, `lastSeen`, `mentionCount`, `sources`. | Sleep, user edits |
| `threads.json` | Open threads and decisions: `text`, `entityIds`, `openedOn`, `lastSeen`, `status` (open / done / expired). | Sleep, user edits |
| `sleep_state.json` | Last processed local day, per-run counts, token use, last error. Not synced. | Sleep |

### Sleep run (the collector)

**Trigger.** Desktop only. When the app is running and a local day has closed (launch, or idle after 03:00), process every closed day that is new or dirty, oldest first, at most 7 per run. `sleep_state.json` keeps a fingerprint of each day's inputs, so an import that adds backdated conversations marks those days dirty and they are digested again. Settings has **Run now** and shows the last run. No API key or offline: skip and retry next trigger. A lock in `sleep_state.json` prevents overlapping runs.

**Stages for day D:**

1. **Collect** (no model). Every conversation with activity on D: dictation transcripts and chat turns, cleaned with the existing `clean_dialogue_body`. Imported conversations count on the day they happened. Skip conversations flagged "exclude from memory", tool output, and assistant text in coding-scope conversations. A dictation whose text reappears as the opening of another conversation within a few minutes is linked to it and counted once. Each item keeps its id, time, and kind. Cap per conversation; if the day exceeds the input budget, digest in chunks and merge.
2. **Digest** (one model call, JSON). The user's words are read in full; model replies contribute only conclusions and decisions, so cards do not become summaries of model prose. Produce the day digest: a short summary, topics with a gist, people and projects mentioned with what was said, decisions, open threads, and any preference signals ("stop doing X"). Write `days/D.json`.
3. **Consolidate** (one model call, JSON operations). Input: the day digest plus the existing cards for names it mentions, matched by alias. Output is a list of operations: upsert a card, add an alias, open or close a thread, propose a standing-instruction change. Rust applies them deterministically, stamps `lastSeen` and sources, and rejects anything without a source id.
4. **Decay** (no model). Cards not seen for 60 days are archived (searchable, never injected). Open threads expire after 30 days without a mention. Windows live in the contract.
5. **Record.** Update `sleep_state.json`; a failed stage leaves the day unprocessed.

**Guardrails.**

- Sleep never edits `standing.md` or `user_memory.json`. Proposed changes queue for review in Settings.
- User edits win: a card or thread the user edited is marked pinned, and sleep may append sources but not rewrite it.
- Deleting an entry removes it and records its id in a small "forgotten" list so sleep does not recreate it.
- **Sensitive topics.** Health, finances, and family details are not carded by default; the digest tags them and consolidation drops them unless the user opts a topic in. (Most of the 18 tombstones in the current store are exactly these.)
- Prompts, budgets, schema version, and decay windows live in `resources/contracts/sleepMemory.json`.

### Wake (per turn)

- **Always:** `standing.md` plus capped profile facts.
- **Selected:** cards whose name or alias appears in the current message or conversation title (cap 6, most recent first), threads linked to those cards, and yesterday's and today's summaries. This takes over most of what `[RECENT_CONVERSATIONS]` does now.
- **Recall:** `memory_search_conversations` searches day digests and cards first, then raw conversations, and cites the source conversations.
- **Dictation:** reply-strip actions (Proofread, Distill, ...) get the same selected context, and card names become a spelling vocabulary for transcript cleanup.
- **Context preview** shows which entries were selected and why.

Selection is string matching on names and aliases in v1. Add embeddings only if matching demonstrably misses.

### Privacy and cost

Sleep sends dictations to a model that today never leave the machine. So: off until enabled in Settings, with a plain statement of what is sent; per-conversation "exclude from memory"; Ollama as a local option. A typical day is roughly 5k to 10k characters of input across two calls; the heaviest recorded day is well within one chunked run.

### Slices

0. **Hygiene.** Remove unused surface so the new store starts clean. Done: `memory_list` tool removed (2 calls ever, and redundant while everything is injected); duplicated user-memory storage functions collapsed. Remaining: prune the live store (tombstones, duplicates, expired events) and delete the orphaned `memory_compile_state.json`.
1. **Standing vs facts.** `standing.md` seeded from the current style keys; `user_memory.json` keeps facts only; memory block gets a budget. No model work.
2. **Day digest.** Collect and Digest stages, `days/`, `sleep_state.json`, Settings toggle with **Run now**.
3. **Consolidation.** `entities.json`, `threads.json`, operations and deterministic apply, decay, review queue.
4. **Wake selection.** Replace inject-everything with standing + selected cards and threads; context preview shows selection.
5. **Recall and backfill.** Search over digests and cards; explicit one-time backfill of native and imported Claude history, newest first.
6. **iOS and dictation.** iOS reads the synced store with a parity fixture for selection; cleanup vocabulary from card names.

### Open questions

- Which model runs sleep, and is it a separate setting from the chat model?
- Does `memory_set` stay as the explicit "remember this" path, or do explicit saves become notes to sleep?
- How far back does the backfill go? Claude history reaches 2024; decay will archive most of what is older than a few months anyway.
- Beyond memory, what else keeps conversations in Claude (long replies, projects, model quality)? Worth a separate look at the imported conversations.
- Should day digests be visible as library objects, or only in Settings?

### Success

- Injected memory stays under budget and contains no entry older than its decay window.
- The ten most-mentioned people and projects of the last 30 days each have a card.
- Recall questions get an answer with a source link, without the user naming the conversation.
- The user edits or deletes entries rarely.
- New Claude conversations per month trend to zero.

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
| ~~Agent mode with human-in-the-loop~~ — promoted to Active now as **Coding agent v2** | O2, O4 |
| Cardinal directions UI — Experiment with anchoring surfaces and controls to N/E/S/W layout polarity (not only centered chat); design exploration | O1 |
| ~~Semantic memory~~ — promoted to Active now as **Sleep memory** | O2, O4 |
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

*Last updated: 2026-10-09*
