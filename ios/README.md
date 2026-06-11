# Harness Mobile (iOS)

Native SwiftUI chat companion for Harness desktop. It syncs through the **same iCloud (or cloud-folder) backup** as the Mac app and calls **OpenAI** with your API key. Chat supports **task tools** (create, update, list, delete, clear completed) with confirmation for destructive actions, **chat history search** (`memory_search_conversations`) so the agent can recall prior conversations, plus a dedicated **Tasks** view synced with desktop.

**Voice dictation** is back: tap the red mic on the home screen to record. **Import Voice Memo** lives in Settings for pulling in recordings from Apple's Voice Memos app (via Files).

## Prerequisites

1. **Desktop Harness** configured with a backup folder (Settings → Data), e.g. `iCloud Drive/Harness`.
2. At least one successful **Sync now** on the Mac so `bundle.json.gz` and `manifest.json` exist in that folder.
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

## First-run setup on iPhone

1. Build and run on a device or simulator (iOS 17+).
2. **Settings** (gear) → **Choose backup folder** → pick the **same folder** as desktop (e.g. `Harness` under iCloud Drive).
3. **Settings** → enter your OpenAI API key, or **Import from synced settings** after a pull.
4. Tap **Sync** (↻) to pull existing conversations.

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
| App backgrounds or you tap Sync | Phone pushes `bundle.json.gz` + `manifest.json` to the backup folder |
| iCloud syncs the folder | Automatic (may take a minute) |
| **Sync now** | Desktop Harness → Settings → Data |

If both Mac and phone edited since the last sync, the app **auto-merges** both sides (combining conversations, messages, tasks, notes, and settings) and pushes the result. Mergeable JSON stores are unioned; binary files that cannot be merged keep this device's copy.

## Run tests

```bash
cd ios
xcodebuild -scheme HarnessMobile \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=18.6' \
  test
```

Unit tests assert the sync **revision hash** matches desktop (`syncBundle.test.ts` fixture).

## Layout

| Path | Role |
|------|------|
| `HarnessMobile/Sync/` | `bundle.json.gz` codec, manifest, iCloud folder bookmarks |
| `HarnessMobile/Data/` | `conversations.json`, `messages_*.json`, `tasks.json` (desktop format) |
| `HarnessMobile/Chat/` | OpenAI streaming, task tools, chat history search, memory selection, Keychain |
| `HarnessMobile/Dictation/` | Audio capture, transcription, Voice Memos import, local recordings |
| `HarnessMobile/UI/` | SwiftUI list, thread, tasks, settings |

## Model

Chat uses `gpt-5.4`—keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).

## Security notes

- API keys are stored in the **iOS Keychain** when entered on device.
- Importing from synced settings reads `settings/settings.json` from the backup bundle (may contain your desktop key). Prefer Keychain-only on phone if you share the backup folder.
