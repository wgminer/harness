# Harness Roadmap

**Now:** desktop **0.10.7**. Two big bets are active: a coding agent good enough for daily use, and memory that builds itself. Everything else is chores or Frozen.

When considering work, ask: *does it serve one of the outcomes below, or does it belong in Frozen?*

---

## Outcomes

What the project is for. Steer ideas here first.

| | Outcome | Success looks like | Posture | Gaps |
|---|---|---|---|---|
| **O1** | Showcase-grade UI | Opening the app shows craft: readable density, designed surfaces, motion and hierarchy that hold up under real use. | Building | CSS consolidation; empty/loading/error states; tray mark. |
| **O2** | Replace paid AI subscriptions | You reach for Harness first for chat, memory, notes, and tasks. Data stays local, sync is optional. | Building | Memory is stale and unselected; coding still happens in Claude Code. |
| **O3** | Mobile companion | Voice and text capture on the go, quick Q&A, sync with desktop via R2. Not desktop parity. | Building | Long messages; seeing desktop coding turns. |
| **O4** | Learning lab | Each change teaches something reusable: IPC, tool schemas, parity tests, provider adapters. | Hardening | More shared contracts; god-file splits. |
| **O5** | Low-friction development | One-command release, obvious Dev vs installed, a second Mac bootstrapped from docs. | Hardening | Cross-machine bootstrap is still tribal. |

---

## Big bets

### Coding agent v2 `[O2][O4]`

Make Harness good enough to replace Claude Code for daily coding, with a Pi-minimal agent (read / edit / write / bash) so most gains come from better models. Concurrent turns land first, so long turns don't block the rest of the app. Then the slices, in order: tool-call history and no silent round cap, a turn timeline, steering mid-turn, web search and fetch, per-turn undo, iOS views, attachments, permissions and workspace folders, loop guard, compaction.

Slices and design: [docs/projects/coding-agent-v2.md](docs/projects/coding-agent-v2.md).

### Sleep memory `[O2][O3][O4]`

Once a day, distill the day's dictations and chats into day digests, people and project cards, and open threads, then inject only what matches the current turn. This replaces the save-a-fact model: in prod nothing has been saved since May, and all 127 keys are injected on every turn. Next slices: finish hygiene, then split standing instructions from facts.

Design, prod findings, and slices: [docs/projects/sleep-memory.md](docs/projects/sleep-memory.md).

---

## Chores

Small, independent slices. Pick one up between bets.

- [ ] **Menu bar tray icon**: replace the plain white squircle (`resources/icon-tray*.png` + recording/processing variants) with a clearer Harness mark, template-friendly at 18/36px. `[O1]`
- [ ] **CSS consolidation**: fewer one-off surfaces. `[O1]`
- [ ] **Reading calibration**: an eye-chart picker sets text size, plus reply font and line spacing with a live preview, and a one-switch no-glasses preset. Desktop only; iOS keeps Dynamic Type. Slices: one `--type-scale` drives every font size; a Reading group in Settings; the preset; an optional first-run step. `[O1]`
- [ ] **Empty / loading / error states** on the main desktop and iOS surfaces. `[O1][O3]`
- [ ] **iOS long messages**: overflow and tap-to-expand. `[O3]`
- [ ] **More shared contracts** under `resources/contracts/` (prompts, model names, sync scopes) with parity tests. `[O4]`
- [ ] **God-file splits**: `SettingsView.tsx`, `sync.rs`, and the views over 800 lines listed in [AGENTS.md](AGENTS.md). `[O4]`
- [ ] **Cross-machine bootstrap** notes in [BUILD.md](BUILD.md), with no secrets in the repo. `[O5]`

---

## Frozen

Nothing here starts until the bets and chores are calm. The order means nothing.

| Item | Outcomes |
|------|----------|
| Anthropic and Gemini chat providers | O2, O4 |
| Cardinal directions UI: anchor surfaces and controls to N/E/S/W instead of a centered chat | O1 |
| Backlog / inbox pipeline (a desktop Inbox was tried in 0.10 and dropped) | O2, O3 |
| Workflow automation | O2, O4 |
| Real-time sync (push wake) | O2, O3 |
| Encrypted cross-device key sync | O2, O4 |
| Richer LLM-assisted notes | O2, O4 |
| Viewport-aware UI scaling | O1 |
| Task links (importance and due dates shipped) | O2 |
| Model params in Settings | O4 |
| Telegram (or similar) bridge | O3 |
| Plugin / tool registry | O4 |
| Windows and Linux builds | O2 |
| Conversation export / share | O2 |
| Android | O3 |

**Already done, do not reopen:** CI on PRs, auto-update, iOS chat companion, R2 backup, sync QR, Dev vs installed profile, `tools.json` + `ipcNames` parity.

---

## Shipped

Newest first.

- **2026-10, 0.10.x**: chat on the Responses API; coding turns run through Pi; per-conversation terminal; task importance, due dates, and subtasks; record-first iOS home; Parakeet on-device transcription; profile layout (conversations and notes at the root, the rest in `.harness/`); request timing per dictation; dictated word count; local sync backups capped at 20; download site redesign with scripted demo scenes.
- **2026-09, 0.10.0**: per-conversation coding scope with gated edit/shell/git tools; image region edits; gated-tool approvals survive restart; time-of-day theme; inline first-run API key. Dictation transcription screen polish.
- **2026-08, 0.9**: chat modes (`chatModes.json`); shared `systemPrompt.json` and `chatStreamBatch.json`; desktop search; settings and sidebar refresh. Display brand back to **Harness** after a July rename to **Here** (identity was never changed, so no migration).
- **2026-07, 0.8 consolidation**: culled Plans, the weather tool, and nightly memory compile; sync QR pairing; Dev profile; non-interactive release signing; `tools.json` shared across TS/Rust/Swift. Image library and unified sidebar. Desktop shell with library drawer, "You are here" home, and Chat / Decide / Write / Refine modes.
- **2026-06, 0.7**: R2-only backup, secrets in the OS keychain, CI on PRs, iOS composer polish.
- **2026-05**: 4px grid, Harness Mobile, session restore, sync conflict review, dictation sessions, Claude import, Notes.
- **2026-03 to 04**: foundation. Streaming chat, tools, memory, tasks, ChatGPT import, OpenAI/Ollama, recording + Apple Speech, conversation search, typed desktop API, signed macOS builds, Vitest.

---

*Last updated: 2026-10-24*
