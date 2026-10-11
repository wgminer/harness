# Harness Mobile — device QA

Short manual checklist after iOS stability changes. Run on a physical device when touching audio or sync.

## Navigation

- [ ] Home is an empty dark screen with a circle in the center; the menu button at the bottom (or a swipe up) opens the list at half height with a haptic, swipe down returns
- [ ] Opening a thread grows the list sheet to full height
- [ ] While recording, discard (X) and stop sit on one row at the bottom
- [ ] List → conversation opens without a multi-second hitch
- [ ] Back (edge swipe) returns to the list smoothly
- [ ] **New Chat** (toolbar pencil) presents a sheet (not a stack push); keyboard appears promptly
- [ ] Sending from New Chat dismisses the sheet and opens the thread once

## Dictation

- [ ] Mic opens quickly when permission already granted (no long “Starting…”)
- [ ] Cold launch with mic permission granted opens straight into recording; with **Record when the app opens** off it lands on the list
- [ ] Cold launch before mic permission or setup is done does not auto-record
- [ ] Tapping the circle on home starts recording with no sheet; a tap anywhere else does nothing; the circle becomes a ring that moves with your voice
- [ ] Assistant replies render in VT323 (the desktop reply face); bold shows as an underline
- [ ] Stop → Transcribing… → "Saved" → empty home; the capture is at the top of the list (no chat thread)
- [ ] Lock screen **Record** widget (mic) opens the app recording, from cold launch and from background, including when the list sheet was open
- [ ] Start dictation in a thread, go back to the list — transcript still lands in that thread
- [ ] Cancel mid-record leaves no zombie mic / Live Activity
- [ ] Lock during record → unlock → recording still usable or clear failed-take with shareable file
- [ ] Incoming interruption (Siri / call) → clear failure or clean resume

## Sync / lifecycle

- [ ] Pull Control Center and dismiss — UI should not hitch on a full sync
- [ ] Cold launch with R2 configured — sync runs after the list appears (toolbar spinner)
- [ ] Background the app, wait, return — sync runs again; list stays responsive
- [ ] Pull-to-refresh still syncs
- [ ] Conversations pulled from desktop show an accent dot / fading halo until opened
