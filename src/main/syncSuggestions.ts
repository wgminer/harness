/**
 * Best-effort suggestions for known cloud-sync providers' folders. None of
 * this is required for sync to work — it just makes the folder picker friendly.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { SyncFolderSuggestion } from "../shared/sync";

const HARNESS_SUBFOLDER = "Harness";

function safeExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

function safeReadDir(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Build a list of suggested backup folder paths the user might want.
 * Only includes paths whose parent provider folder actually exists.
 */
export function listFolderSuggestions(): SyncFolderSuggestion[] {
  const home = homedir();
  const out: SyncFolderSuggestion[] = [];

  if (process.platform === "darwin") {
    const iCloud = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
    if (safeExists(iCloud)) {
      out.push({
        label: "iCloud Drive",
        path: join(iCloud, HARNESS_SUBFOLDER),
        exists: safeExists(join(iCloud, HARNESS_SUBFOLDER)),
      });
    }

    const cloudStorage = join(home, "Library", "CloudStorage");
    if (safeExists(cloudStorage)) {
      for (const entry of safeReadDir(cloudStorage)) {
        const abs = join(cloudStorage, entry);
        if (!isDir(abs)) continue;
        let label: string | null = null;
        if (entry.startsWith("GoogleDrive-")) label = "Google Drive";
        else if (entry.startsWith("OneDrive-") || entry === "OneDrive") label = "OneDrive";
        else if (entry.startsWith("Dropbox-") || entry === "Dropbox") label = "Dropbox";
        if (!label) continue;
        const target = join(abs, HARNESS_SUBFOLDER);
        out.push({ label, path: target, exists: safeExists(target) });
      }
    }
  }

  const homeDropbox = join(home, "Dropbox");
  if (safeExists(homeDropbox) && !out.some((s) => s.path.startsWith(homeDropbox))) {
    out.push({
      label: "Dropbox",
      path: join(homeDropbox, HARNESS_SUBFOLDER),
      exists: safeExists(join(homeDropbox, HARNESS_SUBFOLDER)),
    });
  }

  const homeOneDrive = join(home, "OneDrive");
  if (safeExists(homeOneDrive) && !out.some((s) => s.path.startsWith(homeOneDrive))) {
    out.push({
      label: "OneDrive",
      path: join(homeOneDrive, HARNESS_SUBFOLDER),
      exists: safeExists(join(homeOneDrive, HARNESS_SUBFOLDER)),
    });
  }

  return out;
}
