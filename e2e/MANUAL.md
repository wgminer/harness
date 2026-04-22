# Manual checks (not covered by Playwright)

Automated E2E uses `HARNESS_E2E=1` with a dedicated user data dir (see `src/main/e2eBootstrap.ts`) and now covers:

- core chat send and deterministic stream rendering
- chat persistence across relaunch
- conversation delete safety
- settings persistence (`autoSend`, weather ZIP)
- tasks add flow
- stop-mid-stream data-loss guard
- writing surface persistence and save-history round-trip
- ChatGPT import dedupe (fixture-driven)

It still does **not** validate OS-level behavior.

## Global Fn recording (macOS only)

- The Swift helper [`native/HarnessFnMonitor`](../native/HarnessFnMonitor) watches the Fn key and prints JSON lines; the main process state machine lives in [`src/main/globalRecordingSession.ts`](../src/main/globalRecordingSession.ts).
- Grant **Accessibility** to Harness (System Settings → Privacy & Security → Accessibility). Without it, `HarnessFnMonitor` cannot attach a global monitor.
- Confirm: **hold Fn** for push-to-talk; **double-tap Fn** to latch recording on, then **double-tap Fn** again to stop; tray title `{REC}` / `{PROCESSING}` / `{READY}` as appropriate.

## Escape during recording

- While recording via Fn (PTT or latch), `Escape` should cancel (see `registerEscapeCancel` in [`src/main/globalRecordingMain.ts`](../src/main/globalRecordingMain.ts)).

## Real microphone and transcription

- Playwright does not assert audio quality or real Whisper/Parakeet output. Spot-check recording from the in-chat mic button and from the global Fn path.

## Clipboard / OS paste

- The `recording:pasteText` path uses platform paste behavior (e.g. AppleScript on macOS). Verify on your OS if you rely on paste-to-foreground-app behavior.
