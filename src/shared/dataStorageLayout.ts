/** Label for the Settings → Data action that reveals the app data folder. */
export function appDataFolderButtonLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "Show In Finder";
  if (platform === "win32") return "Show In File Explorer";
  return "Open Data Folder";
}

/** ASCII overview of Harness on-disk layout (shown on System → Data). */
export const DATA_STORAGE_DIAGRAM = `Harness app data folder
│
├─ local-data/ ........................ primary storage
│  ├─ app-state/
│  │  ├─ conversations.json
│  │  ├─ messages_<id>.json
│  │  ├─ user_memory.json, tasks.json, plans.json
│  │  ├─ writing.md
│  │  └─ notes/*.md
│  ├─ settings/settings.json
│  └─ sync/  (last sync state; local backups before pull)
│
├─ audio-recordings/ .... local-only — never backed up
└─ memory/ ................ legacy pre-migration copy (safe to remove)

        │  Sync packs app-state + settings
        ▼
Your backup folder (iCloud, Dropbox, Drive, …)
├─ bundle.json.gz
└─ manifest.json`;
