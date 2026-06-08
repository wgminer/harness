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
│  ├─ themes/
│  └─ sync/  (last sync state; local backups before pull)
│
├─ recordings/ ........... local-only — never backed up
└─ memory/ ................ legacy pre-migration copy (safe to remove)

        │  Sync now packs app-state + settings + themes
        ▼
Your backup folder (iCloud, Dropbox, Drive, …)
├─ bundle.json.gz
└─ manifest.json`;
