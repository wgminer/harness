# Harness — agent notes

Concise guardrails for AI-assisted work in this repo. Full build/packaging detail lives in [BUILD.md](BUILD.md); execution queue in [plans/2026-07-14-consolidation.md](plans/2026-07-14-consolidation.md).

## Single source of truth

**Do not hand-copy cross-language contracts.** When a value is shared across TypeScript, Rust, and/or Swift, add or extend a file under [`resources/contracts/`](resources/contracts/) and wire consumers to read it.

- **Today:** [`resources/contracts/tools.json`](resources/contracts/tools.json) — OpenAI tool schemas (desktop `include_str!`, iOS bundle resource, TS can import the same path).
- **Planned:** prompts, model names, sync scopes, gated tool names, and other value contracts listed in [plans/2026-07-12-deduplication-drift-proofing.md](plans/2026-07-12-deduplication-drift-proofing.md) W1.

If code cannot share a file (logic mirrors), add a **parity test** that reads the real sources and fails on drift — same pattern as `src/shared/versionParity.test.ts` and `src/shared/ipcNames.test.ts`.

## IPC naming (desktop)

Frontend uses `namespace:method` strings in [`src/renderer/desktopAdapter.ts`](src/renderer/desktopAdapter.ts). Wire names are derived by [`src/shared/ipcNames.ts`](src/shared/ipcNames.ts) (`tauriCommandName` → snake_case Rust command id; `tauriEventName` → kebab-case events).

Rust handlers must be listed in `tauri::generate_handler![...]` in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs). **`ipcNames.test.ts` scans `lib.rs` and `desktopAdapter.ts` and fails if they diverge** — do not maintain a duplicate handler list in TS.

## Drift checks

Run before landing cross-surface changes:

```bash
npm test
```

Vitest includes version parity, ipcNames ↔ `generate_handler!` parity, sync-merge fixtures, and other guards under `src/shared/*.test.ts`. CI runs the same `npm test` in the static job.

## Dev vs installed data dirs

`npm run dev` sets `HARNESS_DEV=1`, which uses **`~/Library/Application Support/Harness Dev`** (window title **Harness Dev**). An installed app uses **`~/Library/Application Support/Harness`**. Credentials, sync, and audio are **not** split — only the on-disk profile root. See [BUILD.md](BUILD.md) (development vs installed Application Support).
