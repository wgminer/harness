# Harness Mobile (iOS)

Native SwiftUI chat companion for Harness desktop. It syncs through the **same iCloud (or cloud-folder) backup** as the Mac app and calls **OpenAI** with your API key—chat only, no tools or recording.

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

## Daily workflow (desktop ↔ phone)

| Step | Where |
|------|--------|
| Chat on phone | Harness Mobile |
| App backgrounds or you tap Sync | Phone pushes `bundle.json.gz` + `manifest.json` to the backup folder |
| iCloud syncs the folder | Automatic (may take a minute) |
| **Sync now** | Desktop Harness → Settings → Data |

If both Mac and phone edited since the last sync, the app **auto-merges** both sides (combining conversations, messages, tasks, clippings, and settings) and pushes the result. Mergeable JSON stores are unioned; binary files that cannot be merged keep this device's copy.

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
| `HarnessMobile/Data/` | `conversations.json` + `messages_*.json` (desktop format) |
| `HarnessMobile/Chat/` | OpenAI streaming, memory selection, Keychain |
| `HarnessMobile/UI/` | SwiftUI list, thread, settings |

## Model

Chat uses `gpt-5.4`—keep in sync with `src/shared/openaiModels.ts` (`OPENAI_CHAT_MODEL`).

## Security notes

- API keys are stored in the **iOS Keychain** when entered on device.
- Importing from synced settings reads `settings/settings.json` from the backup bundle (may contain your desktop key). Prefer Keychain-only on phone if you share the backup folder.
