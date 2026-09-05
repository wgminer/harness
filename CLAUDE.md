# Harness — agent notes

Concise guardrails for AI-assisted work in this repo. Full build/packaging detail lives in [BUILD.md](BUILD.md); outcomes in [ROADMAP.md](ROADMAP.md).

## Vocabulary

Use product terms from [`docs/glossary.md`](docs/glossary.md). Highlights:

- A **surface** is a specific part of the app (UI screen / focused area), not a client platform.
- **Chat UI** and **dictation screen** are distinct surfaces — do not conflate voice capture/transcription chrome with the conversation thread.
- Core objects: **conversation**, **message**, **note**, **task**, **memory**, **image**.
- Desktop **chat modes**: Chat / Decide / Write / Refine (not Agent mode).

## Single source of truth

**Do not hand-copy cross-language contracts.** When a value is shared across TypeScript, Rust, and/or Swift, add or extend a file under [`resources/contracts/`](resources/contracts/) and wire consumers to read it.

- **Today:** [`resources/contracts/tools.json`](resources/contracts/tools.json) — OpenAI tool schemas (desktop `include_str!`, iOS bundle resource, TS can import the same path). [`resources/contracts/systemPrompt.json`](resources/contracts/systemPrompt.json) — shared / desktop / iOS system prompt fields (contract-only; not settings-overridable). [`resources/contracts/chatModes.json`](resources/contracts/chatModes.json) — desktop chat mode labels/overlays. [`resources/contracts/chatStreamBatch.json`](resources/contracts/chatStreamBatch.json) — coarse chat/note stream UI flush thresholds. [`resources/contracts/homeHeaderQuotes.json`](resources/contracts/homeHeaderQuotes.json) — compose-screen rotating header one-liners (desktop + iOS).
- **Planned:** model names, sync scopes, gated tool names, and other shared value contracts.

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

## Browser debug shell

`npm run dev:browser` (or `npm run dev:web`) serves the same React renderer without Tauri. `main.tsx` picks `createBrowserAdapter()` when `__TAURI_INTERNALS__` is missing. Chat/settings/notes/tasks persist in `localStorage` (`harness.web.v1`). Completions go through the Vite `/openai` proxy. Tools, dictation, sync, and images are stubbed. Do not treat this as a third product client.

## Dev vs installed data dirs

`npm run dev` sets `HARNESS_DEV=1` and merges `src-tauri/tauri.dev.conf.json`. **Display** name is **Harness Dev** (Dock / window / Accessibility); **data folder** is **`~/Library/Application Support/Harness Dev`**. Installed builds display as **Harness** with data under **`~/Library/Application Support/Harness`**. Bundle IDs remain `com.harness.app.dev` / `com.harness.app`. Credentials, sync, and **audio** (`Harness/audio-recordings/`) are **not** split — only the on-disk app-state profile root and macOS app identity. See [BUILD.md](BUILD.md) (development vs installed Application Support).

## Dist / release confirmation

When reporting a finished desktop dist or release build in chat, always include a markdown `file://` link to the folder that holds the distributable (prefer the DMG dir: `src-tauri/target/release/bundle/dmg/`, else the `.app` parent). Example: `[Open in Finder](file:///…/bundle/dmg)`. The dist runner also prints this link at the end of `npm run dist` / `dist:mac`.

## Border radius

Desktop radius lives in [`src/renderer/base.css`](src/renderer/base.css): `--radius-xs` (2px), `--radius-sm` / `--radius-md` / `--radius-lg` (4px grid), `--radius-pill`, plus `--radius-control` / `--radius-control-sm` (¼ of 36px / 24px control height). Prefer these over hardcoded px. Leave `0`, `50%`, and rare hairline `1px` literals when they are intentional.

`.btn` radius scales with `--control-size` (`min(lg, size/4)`). Size variants and height overrides must set `--control-size` so corners stay soft without going pill-shaped.

**iOS is out of this scale** — keep platform-native shapes (`Capsule`, `Circle`, continuous rounded rects, liquid-glass bar metrics). Do not port desktop `--radius-*` values to Swift or chase pixel parity with the desktop app.
