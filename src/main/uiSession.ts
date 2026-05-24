import { ipcMain } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_UI_SESSION,
  normalizeUiSession,
  type UiSession,
} from "../shared/uiSession";
import { getAppStateDir } from "./localDataPaths";

const UI_SESSION_FILE = "ui-session.json";

export function getUiSessionPathIn(appStateDir: string): string {
  return join(appStateDir, UI_SESSION_FILE);
}

export function readUiSessionFromDir(appStateDir: string): UiSession {
  const path = getUiSessionPathIn(appStateDir);
  if (!existsSync(path)) return { ...DEFAULT_UI_SESSION };
  try {
    return normalizeUiSession(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return { ...DEFAULT_UI_SESSION };
  }
}

export function writeUiSessionToDir(appStateDir: string, session: UiSession): void {
  const next = normalizeUiSession(session);
  writeFileSync(getUiSessionPathIn(appStateDir), JSON.stringify(next, null, 2), "utf-8");
}

export function mergeUiSessionInDir(appStateDir: string, partial: Partial<UiSession>): UiSession {
  const current = readUiSessionFromDir(appStateDir);
  const next = normalizeUiSession({ ...current, ...partial });
  writeUiSessionToDir(appStateDir, next);
  return next;
}

function getUiSession(): UiSession {
  return readUiSessionFromDir(getAppStateDir());
}

function setUiSession(partial: Partial<UiSession>): UiSession {
  return mergeUiSessionInDir(getAppStateDir(), partial);
}

export function registerUiSessionHandlers(): void {
  ipcMain.handle("uiSession:get", () => getUiSession());
  ipcMain.handle("uiSession:set", (_e, partial: unknown) => {
    if (partial == null || typeof partial !== "object") return getUiSession();
    return setUiSession(partial as Partial<UiSession>);
  });
}
