# Here Mobile — device QA

Short manual checklist after iOS stability changes. Run on a physical device when touching audio or sync.

## Navigation

- [ ] Home → conversation opens without a multi-second hitch
- [ ] Back (edge swipe) returns to the list smoothly
- [ ] **New Chat** presents a sheet (not a stack push); keyboard appears promptly
- [ ] Sending from New Chat dismisses the sheet and opens the thread once

## Dictation

- [ ] Mic opens quickly when permission already granted (no long “Starting…”)
- [ ] Stop → Transcribing… → dictation thread
- [ ] Cancel mid-record leaves no zombie mic / Live Activity
- [ ] Lock during record → unlock → recording still usable or clear failed-take with shareable file
- [ ] Incoming interruption (Siri / call) → clear failure or clean resume

## Sync / lifecycle

- [ ] Pull Control Center and dismiss — UI should not hitch on a full sync
- [ ] Background the app, wait, return — sync may run; list stays responsive
- [ ] Pull-to-refresh still syncs
