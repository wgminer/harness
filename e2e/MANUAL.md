# Manual checks (not covered by Playwright)

Automated E2E uses `HARNESS_E2E=1` with a dedicated user data dir (see `src/main/e2eBootstrap.ts`) and now covers:

- core chat send and deterministic stream rendering
- chat persistence across relaunch
- conversation delete safety
- settings persistence (`autoSend`, weather ZIP)
- tasks add flow
- stop-mid-stream data-loss guard
- notes persistence and save round-trip
- ChatGPT import dedupe (fixture-driven)

It still does **not** validate OS-level behavior.

## Visual grid regression (8px overlay)

Playwright captures full-window screenshots with the **8px design grid overlay** enabled
(`HARNESS_E2E_GRID_OVERLAY=8`, seeded in `layout.json` via `e2eBootstrap`).

```bash
npm run test:e2e:visual          # compare against committed baselines
npm run test:e2e:visual:update   # refresh baselines after intentional UI changes
npx playwright show-report       # inspect pixel diffs
```

Baselines live in `e2e/visual-grid.spec.ts-snapshots/`. They are **OS-specific** (font
rendering); update them on the machine you use for visual review (typically macOS).

Screens covered: new-chat compose, chat thread, tasks, settings appearance.

## Global Fn recording (macOS only)

- The Swift helper [`native/HarnessFnMonitor`](../native/HarnessFnMonitor) watches the Fn key and prints JSON lines; the main process state machine lives in [`src/main/globalRecordingSession.ts`](../src/main/globalRecordingSession.ts).
- Grant **Accessibility** to Harness (System Settings → Privacy & Security → Accessibility). Without it, `HarnessFnMonitor` cannot attach a global monitor.
- Confirm: **hold Fn** for push-to-talk; **double-tap Fn** to latch recording on, then **double-tap Fn** again to stop; tray title `{REC}` / `{PROCESSING}` / `{READY}` as appropriate.

## Escape during recording

- While recording via Fn (PTT or latch), `Escape` should cancel (see `registerEscapeCancel` in [`src/main/globalRecordingMain.ts`](../src/main/globalRecordingMain.ts)).

## Real microphone and transcription

- Playwright does not assert audio quality or real Apple Speech output. Spot-check recording from the in-chat mic button and from the global Fn path.

### Speech recognition permission (macOS)

On first dictation, macOS may prompt for **Speech Recognition** access. If transcription fails, check System Settings → Privacy & Security → Speech Recognition and ensure Harness is allowed. On macOS versions before 26, also confirm the dictation language is downloaded under Keyboard → Dictation.

## Clipboard / OS paste

- The `recording:pasteText` path uses platform paste behavior (e.g. AppleScript on macOS). Verify on your OS if you rely on paste-to-foreground-app behavior.
