# Plan: v0.8 Consolidation (rebuild in place)

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prefer small commits per cull/feature group unless the user asks otherwise.
>
> **Status:** ACTIVE — execution queue for [ROADMAP.md](../ROADMAP.md) § v0.8.
>
> **Created:** 2026-07-14  
> **Strategy:** No greenfield rewrite. Cull unused surface → fix dev/release friction → harden (dedup) → clear paper cuts. New product features stay in the **Frozen backlog** until this lands.
>
> **Related:** Dedup mechanics live in [2026-07-12-deduplication-drift-proofing.md](./2026-07-12-deduplication-drift-proofing.md) (workstream B). Shipped/superseded plans are under [archive/](./archive/).

---

## Sequencing

1. [x] Finish in-flight polish needed for the current release line (sidebar CSS unification WIP; ship/commit as appropriate).
2. **A — Cull** (do first; shrinks contracts and Settings).
3. **C — Dev process** (stops recurring ship friction).
4. **B — Hardening** (execute the dedup plan on the post-cull surface).
5. **D — Paper cuts** (ongoing; can interleave with A–C when cheap).

Do **not** start Frozen-backlog features (new providers, agent mode, semantic memory, backlog inbox, etc.) until A–C are substantially done.

---

## Workstream A — Cull

### A1 — Plans objects

**Why:** Data + IPC existed; UI never shipped (`void plans` in App). Sync still knows `plans.json`.

**Delete / unwind**

- [x] Remove Rust module [`src-tauri/src/plans.rs`](../src-tauri/src/plans.rs); drop `mod plans` and `plans_*` handlers from [`lib.rs`](../src-tauri/src/lib.rs) / [`commands.rs`](../src-tauri/src/commands.rs).
- [x] Remove `PLANS_FILE` and any plans helpers from [`memory.rs`](../src-tauri/src/memory.rs); stop migrating/`plans.json` as a first-class file in [`paths.rs`](../src-tauri/src/paths.rs) (tolerant ignore OK).
- [x] Remove `plans.*` from [`desktopAPI.ts`](../src/shared/desktopAPI.ts) + [`desktopAdapter.ts`](../src/renderer/desktopAdapter.ts); strip load/state/`void plans` from [`App.tsx`](../src/renderer/App.tsx).
- [x] Remove `Plan` type (and related) from [`types.ts`](../src/shared/types.ts) if unused afterward.
- [x] Sync merge known-paths / labels: stop *writing* or requiring `app-state/plans.json`, but **tolerate reading** old bundles that still include it (ignore or drop on merge without failing):
  - [`src/shared/syncMerge.ts`](../src/shared/syncMerge.ts)
  - [`src-tauri/src/sync_merge.rs`](../src-tauri/src/sync_merge.rs)
  - [`ios/HarnessMobile/Sync/SyncMerge.swift`](../ios/HarnessMobile/Sync/SyncMerge.swift)
- [x] Update [`dataStorageLayout.ts`](../src/shared/dataStorageLayout.ts) diagram (drop `plans.json`).
- [x] Grep for leftover `plans.` / `plans_` / `Plan` product references (leave prose “future plans” alone).
- [x] Tests: update any merge/ipc golden tests that list plans.

### A2 — Weather tool

**Why:** Low-use Open-Meteo tool + Settings default ZIP.

- [x] Remove `get_weather` tool definition from [`openai.rs`](../src-tauri/src/openai.rs).
- [x] Remove `get_weather` / Open-Meteo client from [`assistant_tools.rs`](../src-tauri/src/assistant_tools.rs).
- [x] Remove `weather.defaultZip` from settings defaults + normalize/save in [`settings.rs`](../src-tauri/src/settings.rs) and [`types.ts`](../src/shared/types.ts).
- [x] Remove weather ZIP UI + save wiring from [`SettingsView.tsx`](../src/renderer/SettingsView.tsx); drop `"weather"` from [`settingsNavConfig.ts`](../src/renderer/settings/settingsNavConfig.ts).
- [x] Strip `get_weather` prose from all three system-prompt defaults:
  - [`src/shared/systemPromptDefaults.ts`](../src/shared/systemPromptDefaults.ts)
  - [`src-tauri/src/system_prompt.rs`](../src-tauri/src/system_prompt.rs)
  - [`ios/HarnessMobile/Chat/SystemPromptSettings.swift`](../ios/HarnessMobile/Chat/SystemPromptSettings.swift)
- [x] Update secrets/redaction tests that mention `weather.defaultZip` ([`settingsSecrets.test.ts`](../src/shared/settingsSecrets.test.ts)).
- [x] Tolerant-read: old `settings.json` may still contain `weather` — ignore rather than error.

### A3 — Nightly memory compile

**Why:** Unused automatic distill + Settings “Compile now”.

**Important:** shared distill helpers used by import live in [`memory_facts.rs`](../src-tauri/src/memory_facts.rs) (`merge_facts` / `parse_facts_response` / `DistilledFact` / `MemoryCompileLlm`). ChatGPT/Claude import keeps working.

- [x] Extract shared distill helpers used by import into a small module (e.g. `memory_facts.rs`) **or** move them into `memory_import.rs`; keep ChatGPT/Claude import working.
- [x] Delete compile-only surface: `run_memory_compile_if_due` / `run_memory_compile_now` / `get_memory_compile_status`, `memory_compile_state.json`, launch deferred compile hook (wherever scheduled in app setup).
- [x] Drop commands + `mod memory_compile` wiring from `commands.rs` / `lib.rs`.
- [x] Remove `memory.runCompileNow` / `memory.getCompileStatus` from `desktopAPI` / `desktopAdapter`.
- [x] Remove Compile UI/status from `SettingsView.tsx`; clean nav keywords in `settingsNavConfig.ts`.
- [x] Leave manual `user_memory.json` + memory tools (`memory_set_fact`, etc.) intact.

### A4 — Theme studio / stale docs (docs-only)

Code is already fixed dark; no Theme studio UI left to delete.

- [x] Archive stale [docs/UI_TRANSITION_AUDIT.md](../docs/archive/UI_TRANSITION_AUDIT.md) (Electron-era; not current guidance).
- [x] Scrub remaining Theme studio / motion-audit pointers from live docs (README had none; ROADMAP rewritten).
- [x] Confirm ROADMAP completed history marks Theme studio / weather / memory compile as historical or culled (done in 2026-07-14 rewrite).

### A — Verify

- [x] `npm run typecheck` + `npm test`
- [x] `cargo test --lib` (in `src-tauri`)
- [x] Smoke: chat still streams; Settings saves without weather/compile; sync merge of a fixture bundle that includes `plans.json` does not crash
- [x] Grep clean for `get_weather`, `plans_list`, `runCompileNow`, `memory_compile` product references

---

## Workstream C — Dev process

### C1 — Dev vs installed clarity

- [x] Document in [BUILD.md](../BUILD.md): `HARNESS_DEV=1` → Application Support **Harness Dev** vs installed **Harness**; what is shared vs not (credentials, sync, audio).
- [x] Audit current affordances (dev icons via `make-dev-icons`, window/tray naming) and note gaps.
- [x] ~~Optional: script to copy selected prod app-state into the Dev data dir~~ — **declined** for v0.8.
- [x] ~~Optional: stronger in-app banner~~ — **declined**; window title **Harness Dev** is enough.
- [x] Unify icons: removed `make-dev-icons.js` and `icon-*-dev.png` so Dev and installed use the same Dock / tray icons.

### C2 — Release pipeline

- [x] Non-interactive updater / signing: ensure `TAURI_SIGNING_PRIVATE_KEY` (+ password via env) never blocks `npm run dist` on a TTY prompt (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` defaulted to empty in dist/release runners; documented in `.env.example`).
- [x] Single-source version bump: `package.json` drives bump; `--bump` / `npm run release` sync `Cargo.toml` + `tauri.conf.json`. iOS marketing version stays separate. Parity test: `src/shared/versionParity.test.ts`.
- [x] Document / wire one-command release path (dist → GitHub release → `latest.json`) and call out remaining manual steps.
- [x] Dist no longer auto-bumps; release bumps explicitly. Heartbeats already cover long `tauri build` steps.

### C3 — Cross-machine bootstrap

- [x] ~~Checklist / bootstrap script~~ — **deferred** until a second-machine setup is needed.
- [ ] When revisited: store *instructions* in-repo; never commit secrets. Prefer “where to put files” + env var names.

### C4 — App-data sync onboarding

**Chosen direction:** one Mac→phone **sync QR** (R2 stays the data plane). Full execution plan: [2026-07-14-sync-qr-pairing.md](./2026-07-14-sync-qr-pairing.md).

- [x] Decide architecture — R2 + single QR pairing (not CloudKit / BaaS / split OpenAI+R2 UX).
- [x] Implement shared `harness-pair` v1 payload + desktop **Show sync QR** + iOS **Set up sync** (scan → apply → pull). See pairing plan checkboxes.
- [x] Goal: phone is ready without filling OpenAI or R2 forms. *(device camera smoke deferred to return checklist)*

---

## Workstream B — Hardening

Run **after** A. Full checklist remains in the dedup plan; this section is the consolidation wrapper.

- [ ] Re-read [2026-07-12-deduplication-drift-proofing.md](./2026-07-12-deduplication-drift-proofing.md); confirm weather/plans/memory-compile items are struck.
- [ ] Dedup **W1** — shared contract JSON resources (tools, prompts, models, sync constants remaining after cull).
- [ ] Dedup **W2** — parity/drift scanners + golden fixtures; close ipcNames ↔ `generate_handler!` gap.
- [ ] Dedup **W3** — Rust `write_json_pretty` envelope; iOS ChatService dedup; streaming accumulator cleanup.
- [x] Dedup **W4** — tool errors as tool results; tool-loop cap; iOS tool expansion (**no weather**).
- [ ] Dedup **W5** — CLAUDE.md / docs for single-source rules.
- [ ] Break up god-files (incremental PRs OK):
  - [ ] [`SettingsView.tsx`](../src/renderer/SettingsView.tsx) (~1.7k) → section components / hooks
  - [ ] [`chat.rs`](../src-tauri/src/chat.rs) (~1.2k) → turn/tool/stream modules
  - [ ] [`sync.rs`](../src-tauri/src/sync.rs) (~970) → runtime vs push/pull split if natural
  - [ ] Extract [`App.tsx`](../src/renderer/App.tsx) shell state (store or focused hooks)
- [ ] Extend ESLint to cover `src/` (today ignored).
- [ ] Cheap legacy naming cleanup: reduce `legacyIpc*` noise; drop dead `clippings` names where migrations already cover — keep on-disk migrations.

---

## Workstream D — Paper cuts

Running list. Add items when noticed; check off when fixed.

- [ ] Sidebar CSS unification: Tasks / System use shared `.sidebar-item` (current WIP on `Sidebar.tsx` / `sidebar.css`).
- [ ] CSS consolidation pass for fixed dark theme (target meaningful reduction of ~4.9k CSS without visual regession on primary surfaces).
- [ ] iOS long-message tap-to-expand / overflow measurement.
- [ ] Primary empty / loading / error polish (chat, library sidebar, notes, images).
- [ ] Sync Settings copy / empty states that assume credentials already exist.
- [ ] _(add below)_

---

## Out of scope (Frozen)

See ROADMAP **Frozen backlog**. Explicitly not this plan:

- New chat providers, agent mode, semantic memory, backlog inbox, real-time sync, encrypted key sync, Telegram bridge, Windows/Linux, plugin registry.
- Re-introducing Theme studio, weather, plans UI, or nightly memory compile.
- Greenfield rewrite of the desktop or iOS apps.

---

## Success picture

After v0.8:

- Smaller product surface that matches what you actually use.
- Cross-language contracts have a single source of truth (or failing tests).
- `npm run dist` does not hang on signing prompts; versions bump from one source.
- Dev vs installed apps are obvious; a second Mac can follow a bootstrap checklist.
- R2 sync setup for a second device is meaningfully less painful.
- Roadmap Frozen backlog is the only place new feature ambition lives — consolidation stays the default until it ships.

---

## Return checklist (after walk-away C+B)

1. Re-enter credentials in Dev (or restore from local `~/Projects/harness-appdata-archive-2026-07-14`).
2. Smoke: chat streams, Settings saves, ChatGPT/Claude import, sync pull.
3. After B sync-merge serialization fix: re-sync / re-pair devices (one-time full re-pull).
4. Device test: Mac **Show sync QR** → iPhone **Set up sync**.
5. Optionally cut a real release (`npm run release`) — pipeline verified with `--dry-run` when green.
   - **Note (2026-07-14 dry-run):** `tauri build` finished without hanging on updater key password, and produced updater `.sig`. However the `.app` was **adhoc**-signed (`Signature=adhoc`), so `verify:mac-trust` failed. Investigate Tauri macOS Developer ID signing vs `CSC_*` env (may need Tauri-native cert env / identity) before a real release.

---

*Last updated: 2026-07-14*
