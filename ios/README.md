# Harness Mobile (iOS)

Native SwiftUI chat companion for Harness desktop. It syncs through the **same Cloudflare R2 bucket** as the Mac app and calls **OpenAI** with your API key. Chat supports **task tools** (create, update, list, delete, clear completed) with confirmation for destructive actions, **chat history search** (`memory_search_conversations`) so the agent can recall prior conversations, plus a dedicated **Tasks** view synced with desktop.

**Voice dictation** is back: tap the red mic on the home screen to record. **Import Voice Memo** lives in Settings for pulling in recordings from Apple's Voice Memos app (via Files).

## Prerequisites

1. **Desktop Harness** configured with Cloudflare R2 (Settings → Data).
2. At least one successful **Sync now** on the Mac so `bundle.json.gz` and `manifest.json` exist in the bucket.
3. An **OpenAI API key** (same as desktop Settings, or enter it only on the phone).

## Open the project

```bash
cd ios
open HarnessMobile.xcodeproj
```

Regenerate the Xcode project after editing `project.yml`:

```bash
xcodegen generate
```

### Code signing (contributors)

The repo does not commit an Apple Developer **Team ID**. Before building on a device:

1. Open **HarnessMobile** in Xcode → select the project → **Signing & Capabilities**.
2. Choose your **Team** for the `HarnessMobile`, `HarnessMobileRecordingLiveActivity`, and test targets (or set **DEVELOPMENT_TEAM** in `project.yml` and run `xcodegen generate`).
3. Bundle IDs are `com.harness.mobile` (app) and `com.harness.mobile.recording-live-activity` (widget); change them if they conflict with your account.

Simulator builds often work without a paid team; device builds require your own Apple Developer membership.

## First-run setup on iPhone

1. Build and run on a device (iOS 17+). Camera QR scanning needs a real device; paste-code works on simulator.
2. On the Mac: Settings → Data → **Show sync QR** (R2 must already be working and sync’d at least once).
3. On the phone: Settings → **Set up sync** → scan that QR (or paste the sync code).
4. Phone saves credentials, tests the connection, and pulls the backup. Chats appear without filling OpenAI or R2 forms.

**Manual fallback:** Settings → Cloudflare R2 (same fields as desktop) → **Test connection** → **Sync now**, then enter or import an OpenAI API key.

## Voice dictation

| Action | How |
|--------|-----|
| Record in-app | Home → red **mic** → speak → checkmark |
| Import Voice Memo | Settings → Voice recordings → **Import Voice Memo** |
| Review transcript | Opens a dictation chat with **Continue** / **Polish** (same as desktop) |
| Manage recordings | Settings → Voice recordings (play, retranscribe; stored locally, not synced) |

**Transcription order:** (1) Apple's embedded Voice Memos transcript (`tsrp` atom in the `.m4a`), (2) on-device `SFSpeechRecognizer`, (3) OpenAI Whisper if an API key is set.

To import a memo recorded in Voice Memos: open the memo → **Share** → **Save to Files** (or pick it from iCloud Drive in Files), then import in Harness.

## Daily workflow (desktop ↔ phone)

| Step | Where |
|------|--------|
| Chat on phone | Harness Mobile |
| App backgrounds or you tap Sync | Phone pushes `bundle.json.gz` + `manifest.json` to R2 |
| **Sync now** | Desktop Harness → Settings → Data |

If both Mac and phone edited since the last sync, the app **auto-merges** both sides (combining conversations, messages, tasks, notes, and settings) and pushes the result. Mergeable JSON stores are unioned; binary files that cannot be merged keep this device's copy.

## Run tests

```bash
cd ios
# Use any available iPhone simulator (OS versions vary by Xcode).
DESTINATION=$(xcrun simctl list devices available \
  | awk -F '[()]' '/iPhone / { gsub(/^ +| +$/, "", $1); print "platform=iOS Simulator,id="$2; exit }')
xcodebuild -scheme HarnessMobile -destination "$DESTINATION" test
```

Unit tests assert the sync **revision hash** matches desktop (`syncBundle.test.ts` fixture).

## Layout

| Path | Role |
|------|------|
| `HarnessMobile/Sync/` | `bundle.json.gz` codec, manifest, R2 remote backup |
| `HarnessMobile/Data/` | `conversations.json`, `messages_*.json`, `tasks.json` (desktop format) |
| `HarnessMobile/Chat/` | OpenAI streaming, task tools, chat history search, memory selection, Keychain |
| `HarnessMobile/Dictation/` | Audio capture, transcription, Voice Memos import, local recordings |
| `HarnessMobile/UI/` | SwiftUI list, thread, tasks, settings |

## Model

Chat uses `gpt-5.4`—keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).

## Security notes

- API keys are stored in the **iOS Keychain** when entered on device.
- R2 secret access keys are stored in Keychain; other R2 fields live in UserDefaults.
- Settings secrets are redacted from sync bundles before upload.
