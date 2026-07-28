# iOS Settings — sketch

Editable wireframe + copy. Edit this file until the labels feel right; then we implement.

**Principles**

- One scrolling page. No tabs.
- No footers / helper subtext on the main form.
- No credential editing on the phone. Keys + R2 come from Mac via QR.
- Almost no editing — toggles and sync, then get out of the way.

---

## Wireframe

```text
Settings
════════════════════════════════════

SYNC
────────────────────────────────────
  Scan QR code                        ›
  Sync Now                            ○   ← attention dot when needed
  Synced 2 hours ago                      ← status line only (not a footer)


DICTATION
────────────────────────────────────
  Send after dictation              [ ● ]
  Clean up transcripts              [ ○ ]


RECORDINGS
────────────────────────────────────
  recording-2026-07-24.m4a            ›
  Jul 24, 2026 · 0:42

  recording-2026-07-23.m4a            ›
  Jul 23, 2026 · 1:15

  (empty)
  No recordings yet.
```

Tap a recording row → open / share the audio file (system sheet). No in-settings player. No retranscribe. No import.

---

## Section copy

### Sync

| Element | Draft |
| --- | --- |
| Section header | `Sync` |
| Primary action | `Scan QR code` |
| Secondary action | `Sync Now` / `Syncing…` |
| Status line | Keep existing dynamic summaries (`Synced …`, `Syncing…`, errors, pending). No extra explanation under the section. |

**Paired vs unpaired**

- Unpaired: `Scan QR code` is the first action; `Sync Now` disabled until configured.
- Paired: same label (re-opens the sheet). Paste fallback lives in the sheet.

**Sheet: Scan QR code** (existing `SyncPairingSheet` — tighten intro)

| Element | Draft |
| --- | --- |
| Title | `Scan QR code` |
| Intro | `Scan the QR from Harness on your Mac.` |
| Fallback | `Or paste the sync code.` |
| Field placeholder | `harness-pair:1:…` |
| Apply | `Apply sync code` |

Drop the long “Mac Settings → General → Show Sync QR” path from the intro if the Mac UI label is obvious; restore a short hint only if pairing fails in practice.

---

### Dictation

| Element | Draft |
| --- | --- |
| Section header | `Dictation` |
| Toggle 1 | `Send after dictation` |
| Toggle 2 | `Clean up transcripts` |

**Not on phone**

- Cleanup prompt editor
- Transcript corrections list

Those stay on Mac and sync down. Phone only flips the two switches (writes `recording.autoSend` and `transcription.cleanup.enabled`).

---

### Recordings

| Element | Draft |
| --- | --- |
| Section header | `Recordings` |
| Row title | filename |
| Row subtitle | `MMM d, yyyy · duration` (omit duration if unknown) |
| Empty | `No recordings yet.` |
| Tap | Open / share file |

**Not on phone Settings**

- Import Voice Memo
- Play / Stop
- Retranscribe
- “On device” count row

---

## First-run (SetupNoticeSheet)

QR-first. No “go enter an API key in Settings.”

| Element | Draft |
| --- | --- |
| Title | `Welcome to Here` |
| Body | `Chat needs an OpenAI key from your Mac. Scan the sync QR to pull credentials and back up this phone.` |
| Primary | `Scan QR code` → opens Settings (or pairing sheet directly) |
| Secondary | `Not now` |

If already paired but missing key somehow: same path — re-pair / sync, don’t offer a key field.

---

## Removed from iOS Settings

Checklist so we don’t put these back:

- [x] Segmented tabs (General / Voice / Data)
- [x] OpenAI API key field, Save, Import from synced settings
- [x] All main-form footers / instructional subtext
- [x] Test Connection
- [x] Advanced R2 fields (Account ID, Bucket, Prefix, keys, Save)
- [x] Import Voice Memo
- [x] Play / Stop in Settings
- [x] Retranscribe
- [x] Memory editors
- [x] Cleanup prompt / corrections editors

---

## Still out of scope on iOS

Theme, notes templates, menu bar, Paths, ChatGPT/Claude import, system-prompt preview, Tavily key UI.

---

## Open questions

Resolved for implementation:

1. **Recording tap:** share sheet (`ActivityShareSheet`).
2. **How many recordings listed:** last 20.
3. **SetupNotice primary:** opens pairing sheet directly.
