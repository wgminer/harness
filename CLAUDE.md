# Harness — agent notes

Concise guardrails for AI-assisted work in this repo. Full build/packaging detail lives in [BUILD.md](BUILD.md).

## Single source of truth

**Do not hand-copy cross-language contracts.** When a value is shared across TypeScript, Rust, and/or Swift, add or extend a file under [`resources/contracts/`](resources/contracts/) and wire consumers to read it.

- **Today:** [`resources/contracts/tools.json`](resources/contracts/tools.json) — OpenAI tool schemas (desktop `include_str!`, iOS bundle resource, TS can import the same path).
- **Planned:** prompts, model names, sync scopes, gated tool names, and other shared value contracts.

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

`npm run dev` sets `HARNESS_DEV=1` and merges `src-tauri/tauri.dev.conf.json`, which uses **`~/Library/Application Support/Harness Dev`**, window title / Dock / Accessibility name **Harness Dev**, and bundle id `com.harness.app.dev`. An installed app uses **`~/Library/Application Support/Harness`** (`com.harness.app`). Credentials, sync, and audio are **not** split — only the on-disk profile root and macOS app identity. See [BUILD.md](BUILD.md) (development vs installed Application Support).

## Dist / release confirmation

When reporting a finished desktop dist or release build in chat, always include a markdown `file://` link to the folder that holds the distributable (prefer the DMG dir: `src-tauri/target/release/bundle/dmg/`, else the `.app` parent). Example: `[Open in Finder](file:///…/bundle/dmg)`. The dist runner also prints this link at the end of `npm run dist` / `dist:mac`.

## Border radius

Desktop radius lives in [`src/renderer/base.css`](src/renderer/base.css): `--radius-xs` (2px), `--radius-sm` / `--radius-md` / `--radius-lg` (4px grid), `--radius-pill`. Prefer these over hardcoded px. Leave `0`, `50%`, and rare hairline `1px` literals when they are intentional.

**iOS is out of this scale** — keep platform-native shapes (`Capsule`, `Circle`, continuous rounded rects, liquid-glass bar metrics). Do not port desktop `--radius-*` values to Swift or chase pixel parity with the desktop app.
