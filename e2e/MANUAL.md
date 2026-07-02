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

- Playwright does not assert audio quality or real Whisper/Parakeet output. Spot-check recording from the in-chat mic button and from the global Fn path.

### Parakeet model download (slim release builds)

Packaged apps bundle only the Parakeet CLI + dylib; the ~2.3 GB model downloads on first use.

**Automated (fixture server, no HF):** `npm run test:e2e:parakeet` builds a slim `.app` and runs `e2e/parakeet-download.spec.ts`.

**Manual QA (once per release, full Hugging Face download):**

1. `npm run dist:mac` (slim bundle via `dist-runner`)
2. `npm run verify:parakeet-install`
3. Install from DMG; quit app; `rm -rf ~/Library/Application\ Support/Harness/parakeet-model`
4. Settings → Voice → **Download model**; wait for Ready
5. Dictate (mic or Fn); relaunch — status stays Ready
6. **Remove model** → download again → still works

## Clipboard / OS paste

- The `recording:pasteText` path uses platform paste behavior (e.g. AppleScript on macOS). Verify on your OS if you rely on paste-to-foreground-app behavior.
