# Harness Mobile (iOS)

Native SwiftUI capture companion for Harness desktop: open it and it starts recording. It syncs through the **same Cloudflare R2 bucket** as the Mac app and calls **OpenAI** with your API key. Chat supports **task tools** (create, update, list, delete, clear completed) with confirmation for destructive actions, **chat history search** (`memory_search_conversations`) so the agent can recall prior conversations, plus a dedicated **Tasks** view synced with desktop.

**Recording comes first:** the app starts recording when it opens (Settings → Dictation → **Record when the app opens**). The home screen is otherwise empty apart from a circle in the center: tapping the circle records (the rest of the screen does nothing), and the circle becomes a ring that vibrates with your voice. A finished take is saved as a dictation; it does not open a chat. Tap the menu button at the bottom (or swipe up) for the half-height list (captures, chats, Tasks, Settings, and **New Chat** as the pencil icon). **Import Voice Memo** lives in Settings for pulling in recordings from Apple's Voice Memos app (via Files).

## Prerequisites

1. **Desktop Harness** configured with Cloudflare R2 (System → Accounts).
2. At least one successful **Sync now** on the Mac so `manifest.json` and a content-addressed `bundle-<hash>.json.gz` exist in the bucket (older builds also wrote a legacy `bundle.json.gz` mirror).
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
2. On the Mac: Settings → General → **Show Sync QR** (R2 must already be working and sync’d at least once).
3. On the phone: Settings → **Set up sync** → scan that QR (or paste the sync code).
4. Phone saves credentials, tests the connection, and pulls the backup. Chats appear without filling OpenAI or R2 forms.

**Manual fallback:** Settings → Cloudflare R2 (same fields as desktop) → **Test connection** → **Sync now**, then enter or import an OpenAI API key.

## Voice dictation

| Action | How |
|--------|-----|
| Record in-app | Open the app (records on launch), or tap the circle on home → speak → stop |
| Record from the lock screen | Add the **Record** widget (microphone) to the lock screen; tapping it opens Harness already recording (`harness://record`) |
| Import Voice Memo | Settings → Voice recordings → **Import Voice Memo** |
| Review transcript | Swipe up → tap the capture in the list; the thread still offers **Continue** / **Polish** (same as desktop) |
| Manage recordings | Swipe up → Settings → Voice recordings (play, retranscribe; stored locally, not synced) |

**Transcription order:** (1) Apple's embedded Voice Memos transcript (`tsrp` atom in the `.m4a`), (2) on-device `SFSpeechRecognizer`, (3) OpenAI Whisper if an API key is set.

To import a memo recorded in Voice Memos: open the memo → **Share** → **Save to Files** (or pick it from iCloud Drive in Files), then import in Harness.

## Daily workflow (desktop ↔ phone)

| Step | Where |
|------|--------|
| Chat on phone | Harness Mobile |
| Cold launch, pull-to-refresh, Settings **Sync now**, or return from background | Phone pulls/pushes content-addressed `bundle-<hash>.json.gz` + `manifest.json` via R2 |
| **Sync now** | Desktop Harness → System → Accounts |

Backgrounding the app **flushes composer drafts** and allows an in-flight sync to finish via a short background task. It does **not** start a new sync by itself. Dictation uses the `audio` background mode so lock/home during a take can keep capture alive.

The phone does not keep desktop note bodies, the image library, or chat attachments it did not create in `local-data`. The bundle is a single object, so a push still has to send them back: they sit in a relay copy next to `local-data` (`local-data.passthrough/`, see `PassthroughStore`) that is only read while building a push. The bundle is downloaded only when the remote `bundleHash` differs from that copy, and a sync requested during a capture waits until the capture ends.

If both Mac and phone edited since the last sync, the app **auto-merges** both sides (combining conversations, messages, tasks, notes, and settings) and pushes the result. Mergeable JSON stores are unioned; binary files that cannot be merged keep this device's copy.

## Device QA

See [QA.md](QA.md) for the short manual checklist (nav, New Chat sheet, dictate, lock, Control Center).

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
| `HarnessMobile/Sync/` | gzip bundle codec, manifest, R2 remote backup |
| `HarnessMobile/Data/` | `conversations.json`, `messages_*.json`, `tasks.json` (desktop format) |
| `HarnessMobile/Chat/` | OpenAI streaming, task tools, chat history search, memory selection, Keychain |
| `HarnessMobile/Dictation/` | Audio capture, transcription, Voice Memos import, local recordings |
| `HarnessMobile/UI/` | SwiftUI list, thread, tasks, settings |

## Model

Chat uses `gpt-6.1-sol` over the Responses API—keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).

## Security notes

- API keys are stored in the **iOS Keychain** when entered on device.
- R2 secret access keys are stored in Keychain; other R2 fields live in UserDefaults.
- Settings secrets are redacted from sync bundles before upload.
