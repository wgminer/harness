/** Label for the Settings → Data action that reveals the Electron userData folder. */
export function appDataFolderButtonLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "Show in Finder";
  if (platform === "win32") return "Show in File Explorer";
  return "Open data folder";
}

/** ASCII overview of Harness on-disk layout (shown on System → Data). */
export const DATA_STORAGE_DIAGRAM = `Harness app data folder (Electron userData)
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
