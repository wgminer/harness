# Harness — notes for coding agents

Tool-agnostic guardrails for AI-assisted work in this repo (Cursor, Claude Code, Codex, cloud agents, etc.). Build/packaging: [BUILD.md](BUILD.md). Outcomes: [ROADMAP.md](ROADMAP.md). Vocabulary: [docs/glossary.md](docs/glossary.md).

## Start here every session

1. **Read the collision board** — [`.agents/board.md`](.agents/board.md) (local only; copy from [`.agents/board.example.md`](.agents/board.example.md) if missing).
2. **Tag in** before you edit overlapping paths; **tag out** when done or idle. Protocol: [`.agents/README.md`](.agents/README.md).
3. **Also check** open `cursor/*` / cloud PRs (`gh pr list`) before claiming Settings, chat, or contracts — cloud agents won’t see the local board.
4. Leave unrelated WIP alone (other agents’ uncommitted files are not yours to “clean up”).

## How this repo is usually worked

- Prefer **small, shippable slices**.
- **Work on a branch, not in the main checkout.** The main checkout is for merging. Each piece of work gets its own branch or worktree, however small.
- **Commit to your branch when a slice is done**, without being asked. **Push, merge, or open a PR only when asked.** Never leave a session with finished work uncommitted; if you stop mid-slice, commit it as `WIP:` with what is left.
- **Sync with main** at the start of a session on an existing branch.
- **Cross-cutting refactors** (paths, data layout, IPC, shared settings) land first and alone, before features build on them.
- **Two-client changes** (sync format, contracts read by iOS) are not done until both clients handle them; don't merge one side.
- **No release from a dirty tree**: main must be committed and clean before a version bump.
- Local + cloud agents often run **in parallel** — expect Settings / renderer / contracts collisions.
- “Bring in cloud work” means: fetch, merge ready `cursor/*` PRs (or their branches), resolve conflicts keeping **current product UX** over stale cloud UI, then push.
- Cross-language values go in [`resources/contracts/`](resources/contracts/) — never hand-copy.
- Desktop UI iteration often uses `npm run dev:browser` (debug shell, not a product client).
- **Stay inside the slice.** Don't reformat, rename, or tidy code the task doesn't need. Put an unrelated fix you spot in its own slice, or mention it; don't bundle it in.

## Vocabulary

Use product terms from the glossary. Highlights:

- A **surface** is a UI screen / focused area, not a client platform.
- **Chat UI** and **dictation screen** are distinct — don’t conflate voice chrome with the conversation thread.
- Core objects: **conversation**, **message**, **note**, **task**, **memory**, **image**.
- Desktop **chat modes**: Chat / Q&A (not “Agent mode”).

## Single source of truth

**Do not hand-copy cross-language contracts.** Shared values live under [`resources/contracts/`](resources/contracts/); wire TS / Rust / Swift to the same file.

- **Today:** `tools.json`, `codingTools.json`, `systemPrompt.json`, `chatModes.json`, `chatStreamBatch.json`, `conversationSearch.json`, `dictationSuggestedPrompts.json`, `gmailTools.json`, `homeHeaderQuotes.json`, `imageMarkerPrompt.json`, `recentConversations.json`, `selfModifyScopes.json`, `timeOfDayColors.json`, `toolLabels.json`, `transcriptCleanup.json`, `transcriptionEngines.json` (desktop only).
- **iOS:** the checked-in `ios/HarnessMobile.xcodeproj` lists each contract file under `SharedContracts`; register new ones there (CI regenerates via xcodegen, local Xcode does not).
- **Planned:** model names, sync scopes, gated tool names, and other shared value contracts.

If code cannot share a file (logic mirrors), add a **parity test** that reads the real sources and fails on drift — same pattern as `src/shared/versionParity.test.ts` and `src/shared/ipcNames.test.ts`.

## Code layout

- **Renderer (`src/renderer/`)** is grouped by feature: `chat/`, `notes/`, `tasks/`, `images/`, `search/`, `sidebar/`, `recording/`, `setup/`, `settings/`. Shared primitives live in `ui/`, shared hooks in `hooks/`. Each feature keeps its components, CSS, hooks, and tests together. `App.tsx` composes per-feature hooks (`useConversations`, `useNotesLibrary`, `useImageLibrary`, `useSetupState`, ...) — add new state to the owning hook, not to `App`.
- **Rust (`src-tauri/src/`)** groups domains as a parent file plus a folder of children (same as `chat.rs` + `chat/`): `recording`, `memory`, `sync`, `notes`, `chat`, `images`. Tauri command handlers live in `commands/<domain>.rs`; process-wide state is `state.rs`.
- **Keep files small.** Don't grow a component or module past ~800 lines. If a change would push it over, first split it in its own slice: move state into the feature's hook, or pull out a subcomponent or child module. `ChatView.tsx`, `WritingSurfaceView.tsx`, and `ImageCanvasView.tsx` are already over; shrink them when you touch them, don't add to them.

## Where new things go

Touch these in order. Where a check catches a missed step, it's named in parentheses.

- **IPC command:** Rust handler in `src-tauri/src/commands/<domain>.rs` → register in `generate_handler!` in `lib.rs` → method on `HarnessAPI` in `src/shared/desktopAPI.ts` → call in `desktopAdapter.ts` (`ipcNames.test.ts`) → stub in `src/renderer/browser/browserAdapter.ts` (`npm run typecheck`).
- **Shared value (TS + Rust + Swift):** JSON file in `resources/contracts/` → load it from each side → register it in `ios/HarnessMobile.xcodeproj` under `SharedContracts` → add it to the **Today** list above.
- **Setting:** field on `Settings` and `DEFAULT_SETTINGS` in `src/shared/types.ts` → matching default in `default_settings()` in `src-tauri/src/settings.rs` → UI in the right tab under `src/renderer/settings/`.
- **Renderer feature:** new folder under `src/renderer/<feature>/` with its own hook, components, CSS, and tests; `App.tsx` only composes the hook.
- **Rust domain:** `src-tauri/src/<domain>.rs` + `<domain>/` for children; commands in `commands/<domain>.rs`.

## IPC naming (desktop)

Frontend uses `namespace:method` strings in [`src/renderer/desktopAdapter.ts`](src/renderer/desktopAdapter.ts). Wire names come from [`src/shared/ipcNames.ts`](src/shared/ipcNames.ts) (`tauriCommandName` → snake_case; `tauriEventName` → kebab-case).

Rust handlers must appear in `tauri::generate_handler![...]` in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs). **`ipcNames.test.ts` scans `lib.rs` and `desktopAdapter.ts` and fails if they diverge** — do not maintain a duplicate handler list in TS.

## Checks before you commit

Run what CI runs, so a green local run means a green CI run:

```bash
npm run lint && npm run typecheck && npm test
```

If you touched `src-tauri/`, also run `cargo test --lib` from `src-tauri/`. If you added a contract file, confirm it's registered in the checked-in Xcode project (CI regenerates the project with xcodegen, but local Xcode builds don't).

Vitest covers version parity, ipcNames ↔ `generate_handler!`, sync-merge fixtures, and other drift guards under `src/shared/*.test.ts`. If a guard fails, fix the drift; don't loosen the guard or silence the lint rule. If the guard itself is wrong, say why in the commit message.

While iterating, run only the tests you're working against, then the full set once before committing:

```bash
npx vitest run src/shared/ipcNames.test.ts
```

In `src-tauri/`, `cargo test --lib <module_or_test_name>` does the same for Rust.

## Browser debug shell

`npm run dev:browser` (or `npm run dev:web`) serves the React renderer without Tauri. `main.tsx` picks `createBrowserAdapter()` when `__TAURI_INTERNALS__` is missing. Chat/settings/notes/tasks persist in `localStorage` (`harness.web.v1`). Without an API key, chat streams dummy replies; with a key (`VITE_OPENAI_API_KEY` or Data settings), completions use the Vite `/openai` proxy. Tools, dictation, sync, and images are stubbed. **Not a third product client.**

## Dev vs installed data dirs

`npm run dev` sets `HARNESS_DEV=1` and merges `src-tauri/tauri.dev.conf.json`. **Display** name: **Harness Dev**; **data folder:** `~/Library/Application Support/Harness Dev`. Installed: **Harness** → `~/Library/Application Support/Harness`. Bundle IDs: `com.harness.app.dev` / `com.harness.app`. Credentials, sync, and **audio** (`Harness/Recordings/`) are **not** split — only the on-disk app-state profile root and macOS app identity. See [BUILD.md](BUILD.md).

## Dist / release confirmation

When reporting a finished desktop dist or release build, include a markdown `file://` link to the distributable folder (prefer `src-tauri/target/release/bundle/dmg/`). Example: `[Open in Finder](file:///…/bundle/dmg)`.

## Border radius

Desktop tokens in [`src/renderer/base.css`](src/renderer/base.css): `--radius-xs` (2px), `--radius-sm` / `--radius-md` / `--radius-lg` (4px grid), `--radius-pill`, plus `--radius-control` / `--radius-control-sm`. Prefer these over hardcoded px. Leave `0`, `50%`, and intentional hairline `1px` alone.

`.btn` radius scales with `--control-size` (`min(lg, size/4)`). Size variants must set `--control-size`.

**iOS is out of this scale** — platform-native shapes only. Do not port desktop `--radius-*` to Swift or chase pixel parity.
