import { app } from "electron";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";

const LOCAL_DATA_DIR = "local-data";
const APP_STATE_DIR = "app-state";
const SETTINGS_DIR = "settings";
const THEMES_DIR = "themes";
const SYNC_DIR = "sync";
const LEGACY_MEMORY_DIR = "memory";
const LEGACY_SETTINGS_FILE = "settings.json";
const MIGRATION_MARKER_FILE = ".migration-v1.json";

function ensureDir(path: string): string {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  return path;
}

export function getUserDataDir(): string {
  return app.getPath("userData");
}

export function getLegacyMemoryDir(): string {
  return join(getUserDataDir(), LEGACY_MEMORY_DIR);
}

export function getLocalDataDir(): string {
  return ensureDir(join(getUserDataDir(), LOCAL_DATA_DIR));
}

export function getAppStateDir(): string {
  ensureLocalDataMigration();
  return ensureDir(join(getLocalDataDir(), APP_STATE_DIR));
}

export function getLocalDataSettingsDir(): string {
  return ensureDir(join(getLocalDataDir(), SETTINGS_DIR));
}

export function getLocalDataSyncDir(): string {
  return ensureDir(join(getLocalDataDir(), SYNC_DIR));
}

export function getLocalDataSettingsPath(): string {
  return join(getLocalDataSettingsDir(), LEGACY_SETTINGS_FILE);
}

function copyIfMissing(fromPath: string, toPath: string): void {
  if (!existsSync(fromPath) || existsSync(toPath)) return;
  ensureDir(dirname(toPath));
  copyFileSync(fromPath, toPath);
}

function migrateLegacyAppState(): void {
  const legacyDir = getLegacyMemoryDir();
  const appStateDir = ensureDir(join(getLocalDataDir(), APP_STATE_DIR));
  if (!existsSync(legacyDir)) return;

  const files = readdirSync(legacyDir);
  for (const file of files) {
    if (
      file === "conversations.json" ||
      file === "user_memory.json" ||
      file === "tasks.json" ||
      file === "plans.json" ||
      file === "notes.json" ||
      file === "writing.md" ||
      file === "notes" ||
      file.startsWith("messages_")
    ) {
      const src = join(legacyDir, file);
      const dst = join(appStateDir, file);
      if (existsSync(dst)) continue;
      if (file === "notes") {
        cpSync(src, dst, { recursive: true });
      } else {
        copyFileSync(src, dst);
      }
    }
  }
}

function migrateLegacySettingsAndThemes(): void {
  const userData = getUserDataDir();
  copyIfMissing(join(userData, LEGACY_SETTINGS_FILE), getLocalDataSettingsPath());

  const legacyThemesDir = join(userData, THEMES_DIR);
  const localThemesDir = join(getLocalDataDir(), THEMES_DIR);
  for (const dir of [legacyThemesDir, localThemesDir]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

export function ensureLocalDataMigration(): void {
  const marker = join(getLocalDataDir(), MIGRATION_MARKER_FILE);
  if (existsSync(marker)) return;
  migrateLegacyAppState();
  migrateLegacySettingsAndThemes();
  writeFileSync(
    marker,
    JSON.stringify(
      {
        version: 1,
        migratedAt: Date.now(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

export function cleanupLegacyMemoryDir(): boolean {
  const legacyDir = getLegacyMemoryDir();
  if (!existsSync(legacyDir)) return false;
  rmSync(legacyDir, { recursive: true, force: true });
  return true;
}
