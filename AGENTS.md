# Harness — notes for coding agents

Tool-agnostic guardrails for AI-assisted work in this repo (Cursor, Claude Code, Codex, cloud agents, etc.). Build/packaging: [BUILD.md](BUILD.md). Outcomes: [ROADMAP.md](ROADMAP.md). Vocabulary: [docs/glossary.md](docs/glossary.md).

## Start here every session

1. **Read the collision board** — [`.agents/board.md`](.agents/board.md) (local only; copy from [`.agents/board.example.md`](.agents/board.example.md) if missing).
2. **Tag in** before you edit overlapping paths; **tag out** when done or idle. Protocol: [`.agents/README.md`](.agents/README.md).
3. **Also check** open `cursor/*` / cloud PRs (`gh pr list`) before claiming Settings, chat, or contracts — cloud agents won’t see the local board.
4. Leave unrelated WIP alone (other agents’ uncommitted files are not yours to “clean up”).

## How this repo is usually worked

- Prefer **small, shippable slices**; commit **only when asked**.
- Local + cloud agents often run **in parallel** — expect Settings / renderer / contracts collisions.
- “Bring in cloud work” means: fetch, merge ready `cursor/*` PRs (or their branches), resolve conflicts keeping **current product UX** over stale cloud UI, then push.
- Cross-language values go in [`resources/contracts/`](resources/contracts/) — never hand-copy.
- Desktop UI iteration often uses `npm run dev:browser` (debug shell, not a product client).

## Vocabulary

Use product terms from the glossary. Highlights:

- A **surface** is a UI screen / focused area, not a client platform.
- **Chat UI** and **dictation screen** are distinct — don’t conflate voice chrome with the conversation thread.
- Core objects: **conversation**, **message**, **note**, **task**, **memory**, **image**.
- Desktop **chat modes**: Chat / Decide / Write / Refine (not “Agent mode”).

## Single source of truth

**Do not hand-copy cross-language contracts.** Shared values live under [`resources/contracts/`](resources/contracts/); wire TS / Rust / Swift to the same file.

- **Today:** `tools.json`, `systemPrompt.json`, `chatModes.json`, `chatStreamBatch.json`, `homeHeaderQuotes.json`.
- **Planned:** model names, sync scopes, gated tool names, and other shared value contracts.

If code cannot share a file (logic mirrors), add a **parity test** that reads the real sources and fails on drift — same pattern as `src/shared/versionParity.test.ts` and `src/shared/ipcNames.test.ts`.

## IPC naming (desktop)

Frontend uses `namespace:method` strings in [`src/renderer/desktopAdapter.ts`](src/renderer/desktopAdapter.ts). Wire names come from [`src/shared/ipcNames.ts`](src/shared/ipcNames.ts) (`tauriCommandName` → snake_case; `tauriEventName` → kebab-case).

Rust handlers must appear in `tauri::generate_handler![...]` in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs). **`ipcNames.test.ts` scans `lib.rs` and `desktopAdapter.ts` and fails if they diverge** — do not maintain a duplicate handler list in TS.

## Drift checks

Before landing cross-surface changes:

```bash
npm test
```

Vitest covers version parity, ipcNames ↔ `generate_handler!`, sync-merge fixtures, and other guards under `src/shared/*.test.ts`. CI runs the same `npm test` in the static job.

## Browser debug shell

`npm run dev:browser` (or `npm run dev:web`) serves the React renderer without Tauri. `main.tsx` picks `createBrowserAdapter()` when `__TAURI_INTERNALS__` is missing. Chat/settings/notes/tasks persist in `localStorage` (`harness.web.v1`). Without an API key, chat streams dummy replies; with a key (`VITE_OPENAI_API_KEY` or Data settings), completions use the Vite `/openai` proxy. Tools, dictation, sync, and images are stubbed. **Not a third product client.**

## Dev vs installed data dirs

`npm run dev` sets `HARNESS_DEV=1` and merges `src-tauri/tauri.dev.conf.json`. **Display** name: **Harness Dev**; **data folder:** `~/Library/Application Support/Harness Dev`. Installed: **Harness** → `~/Library/Application Support/Harness`. Bundle IDs: `com.harness.app.dev` / `com.harness.app`. Credentials, sync, and **audio** (`Harness/audio-recordings/`) are **not** split — only the on-disk app-state profile root and macOS app identity. See [BUILD.md](BUILD.md).

## Dist / release confirmation

When reporting a finished desktop dist or release build, include a markdown `file://` link to the distributable folder (prefer `src-tauri/target/release/bundle/dmg/`). Example: `[Open in Finder](file:///…/bundle/dmg)`.

## Border radius

Desktop tokens in [`src/renderer/base.css`](src/renderer/base.css): `--radius-xs` (2px), `--radius-sm` / `--radius-md` / `--radius-lg` (4px grid), `--radius-pill`, plus `--radius-control` / `--radius-control-sm`. Prefer these over hardcoded px. Leave `0`, `50%`, and intentional hairline `1px` alone.

`.btn` radius scales with `--control-size` (`min(lg, size/4)`). Size variants must set `--control-size`.

**iOS is out of this scale** — platform-native shapes only. Do not port desktop `--radius-*` to Swift or chase pixel parity.
