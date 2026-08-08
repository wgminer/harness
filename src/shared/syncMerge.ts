import { canonicalJsonCompact, canonicalJsonPretty } from "./canonicalJson";
import { stripSettingsSecrets } from "./settingsSecrets";

/** Per-file resolution when merging a sync conflict. */
export type SyncFileChoice = "local" | "remote" | "merge";

export type SyncFileChangeKind = "unchanged" | "local-only" | "remote-only" | "conflict";

export interface SyncConflictFileEntry {
  path: string;
  kind: SyncFileChangeKind;
  defaultChoice: SyncFileChoice;
  supportsMerge: boolean;
  /** Short human label (e.g. conversation title, note name). */
  label: string;
  localPreview?: string;
  remotePreview?: string;
}

export interface SyncConflictReview {
  files: SyncConflictFileEntry[];
  summary: {
    unchanged: number;
    localOnly: number;
    remoteOnly: number;
    conflict: number;
  };
}

const MERGEABLE_PATHS = new Set([
  "app-state/conversations.json",
  "app-state/tasks.json",
  "app-state/user_memory.json",
  "settings/settings.json",
]);

/** Legacy paths that may appear in old sync bundles; ignore rather than fail. */
const IGNORED_SYNC_PATHS = new Set(["app-state/plans.json"]);

const IMAGES_INDEX_PATH = "app-state/images.json";
const IMAGES_DIR_PREFIX = "app-state/images/";

function fileBytesEqual(a: Buffer, b: Buffer): boolean {
  return a.byteLength === b.byteLength && a.equals(b);
}

function previewText(bytes: Buffer | undefined, maxLen = 120): string | undefined {
  if (!bytes || bytes.byteLength === 0) return undefined;
  const text = bytes.toString("utf-8").replace(/\s+/g, " ").trim();
  if (!text) return "(empty)";
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

function isImageLibraryPath(path: string): boolean {
  return path === IMAGES_INDEX_PATH || path.startsWith(IMAGES_DIR_PREFIX);
}

function labelForPath(path: string, _bytes: Buffer | undefined): string {
  if (path.startsWith("app-state/notes/")) {
    const name = path.slice("app-state/notes/".length);
    return name.endsWith(".md") ? name.slice(0, -3) : name;
  }
  if (path.startsWith("app-state/messages_")) {
    return path.slice("app-state/".length);
  }
  if (path === IMAGES_INDEX_PATH) return "Images library";
  if (path.startsWith(IMAGES_DIR_PREFIX)) {
    return `Image file ${path.slice(IMAGES_DIR_PREFIX.length)}`;
  }
  if (path === "app-state/conversations.json") return "Conversation list";
  if (path === "app-state/tasks.json") return "Tasks";
  if (path === "app-state/user_memory.json") return "User context";
  if (path === "app-state/writing.md") return "Writing surface";
  if (path === "settings/settings.json") return "App preferences";
  return path;
}

function supportsMergeForPath(path: string): boolean {
  if (isImageLibraryPath(path)) return false;
  if (MERGEABLE_PATHS.has(path)) return true;
  if (path.startsWith("app-state/messages_")) return true;
  return false;
}

function defaultChoiceForKind(kind: SyncFileChangeKind, path: string): SyncFileChoice {
  if (kind === "local-only") return "local";
  if (kind === "remote-only") return "remote";
  if (kind === "unchanged") return "local";
  return supportsMergeForPath(path) ? "merge" : "local";
}

function tsFromValue(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const obj = value as Record<string, unknown>;
  for (const key of ["updatedAt", "createdAt"] as const) {
    if (typeof obj[key] === "number") return obj[key] as number;
  }
  return 0;
}

function maxImageUpdatedAt(imagesJson: Buffer): number {
  try {
    const parsed = JSON.parse(imagesJson.toString("utf-8")) as { images?: unknown[] };
    const rows = Array.isArray(parsed.images) ? parsed.images : [];
    return rows.reduce((max, row) => Math.max(max, tsFromValue(row)), 0);
  } catch {
    return 0;
  }
}

function imageLibraryPaths(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): string[] {
  return [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])]
    .filter(isImageLibraryPath)
    .sort();
}

function imageLibraryIsDirty(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): boolean {
  for (const path of imageLibraryPaths(localFiles, remoteFiles)) {
    const local = localFiles[path];
    const remote = remoteFiles[path];
    if (local && remote) {
      if (!fileBytesEqual(local, remote)) return true;
    } else if (local || remote) {
      return true;
    }
  }
  return false;
}

function imageLibraryWinner(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): SyncFileChoice {
  const localTs = localFiles[IMAGES_INDEX_PATH]
    ? maxImageUpdatedAt(localFiles[IMAGES_INDEX_PATH])
    : 0;
  const remoteTs = remoteFiles[IMAGES_INDEX_PATH]
    ? maxImageUpdatedAt(remoteFiles[IMAGES_INDEX_PATH])
    : 0;
  if (remoteTs > localTs) return "remote";
  if (localTs > remoteTs) return "local";
  const localHas = Object.keys(localFiles).some(isImageLibraryPath);
  const remoteHas = Object.keys(remoteFiles).some(isImageLibraryPath);
  if (!localHas && remoteHas) return "remote";
  return "local";
}

function imageLibraryChoiceFromMap(
  choices: Record<string, SyncFileChoice>,
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): SyncFileChoice {
  const indexChoice = choices[IMAGES_INDEX_PATH];
  if (indexChoice === "remote" || indexChoice === "local") return indexChoice;
  return imageLibraryWinner(localFiles, remoteFiles);
}

function applyImageLibraryAtomicity(
  choices: Record<string, SyncFileChoice>,
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): void {
  if (!imageLibraryIsDirty(localFiles, remoteFiles)) return;
  const winner = imageLibraryChoiceFromMap(choices, localFiles, remoteFiles);
  for (const path of imageLibraryPaths(localFiles, remoteFiles)) {
    choices[path] = winner;
  }
}

export function buildSyncConflictReview(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): SyncConflictReview {
  const paths = [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])].sort();
  const files: SyncConflictFileEntry[] = [];
  const summary = { unchanged: 0, localOnly: 0, remoteOnly: 0, conflict: 0 };

  for (const path of paths) {
    if (IGNORED_SYNC_PATHS.has(path)) continue;
    const local = localFiles[path];
    const remote = remoteFiles[path];
    let kind: SyncFileChangeKind;
    if (local && remote) {
      kind = fileBytesEqual(local, remote) ? "unchanged" : "conflict";
    } else if (local) {
      kind = "local-only";
    } else {
      kind = "remote-only";
    }

    summary[kind === "unchanged" ? "unchanged" : kind === "local-only" ? "localOnly" : kind === "remote-only" ? "remoteOnly" : "conflict"] += 1;

    files.push({
      path,
      kind,
      defaultChoice: defaultChoiceForKind(kind, path),
      supportsMerge: supportsMergeForPath(path),
      label: labelForPath(path, local ?? remote),
      localPreview: previewText(local),
      remotePreview: previewText(remote),
    });
  }

  if (imageLibraryIsDirty(localFiles, remoteFiles)) {
    const winner = imageLibraryWinner(localFiles, remoteFiles);
    for (const file of files) {
      if (isImageLibraryPath(file.path)) {
        file.defaultChoice = winner;
        file.supportsMerge = false;
      }
    }
  }

  return { files, summary };
}

export function buildDefaultMergeChoices(
  review: SyncConflictReview,
  localFiles: Record<string, Buffer> = {},
  remoteFiles: Record<string, Buffer> = {},
): Record<string, SyncFileChoice> {
  const choices: Record<string, SyncFileChoice> = {};
  for (const file of review.files) {
    if (file.kind === "unchanged") {
      choices[file.path] = "local";
      continue;
    }
    choices[file.path] = file.defaultChoice;
  }
  applyImageLibraryAtomicity(choices, localFiles, remoteFiles);
  return choices;
}

function parseJson(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf-8"));
}

function mergeJsonRecords(local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...remote };
  for (const [key, localValue] of Object.entries(local)) {
    if (!(key in merged)) {
      merged[key] = localValue;
      continue;
    }
    const remoteValue = merged[key];
    if (canonicalJsonCompact(remoteValue) === canonicalJsonCompact(localValue)) continue;
    const localTs = tsFromValue(localValue);
    const remoteTs = tsFromValue(remoteValue);
    merged[key] = localTs >= remoteTs ? localValue : remoteValue;
  }
  return merged;
}

function mergeTasksJson(local: Buffer, remote: Buffer): Buffer {
  const localState = parseJson(local) as { tasks?: unknown[] };
  const remoteState = parseJson(remote) as { tasks?: unknown[] };
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of remoteState.tasks ?? []) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string") {
      byId.set((row as Record<string, unknown>).id as string, row as Record<string, unknown>);
    }
  }
  for (const row of localState.tasks ?? []) {
    if (!row || typeof row !== "object" || typeof (row as Record<string, unknown>).id !== "string") continue;
    const id = (row as Record<string, unknown>).id as string;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row as Record<string, unknown>);
      continue;
    }
    byId.set(id, tsFromValue(row) >= tsFromValue(existing) ? (row as Record<string, unknown>) : existing);
  }
  const tasks = [...byId.values()].sort(
    (a, b) => tsFromValue(b) - tsFromValue(a),
  );
  return Buffer.from(canonicalJsonPretty({ tasks }), "utf-8");
}

function mergeMessagesJson(local: Buffer, remote: Buffer): Buffer {
  const localRows = Array.isArray(parseJson(local)) ? (parseJson(local) as unknown[]) : [];
  const remoteRows = Array.isArray(parseJson(remote)) ? (parseJson(remote) as unknown[]) : [];
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const row of [...remoteRows, ...localRows]) {
    if (!row || typeof row !== "object") continue;
    const stamp = canonicalJsonCompact(row);
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    merged.push(row);
  }
  merged.sort((a, b) => tsFromValue(a) - tsFromValue(b));
  return Buffer.from(canonicalJsonPretty(merged), "utf-8");
}

function mergeSettingsJson(local: Buffer, remote: Buffer): Buffer {
  const localObj = stripSettingsSecrets(parseJson(local) as Record<string, unknown>);
  const remoteObj = stripSettingsSecrets(parseJson(remote) as Record<string, unknown>);
  const merged = mergeJsonRecords(localObj, remoteObj) as Record<string, unknown>;
  if (localObj.sync && typeof localObj.sync === "object") {
    merged.sync = localObj.sync;
  }
  return Buffer.from(canonicalJsonPretty(stripSettingsSecrets(merged)), "utf-8");
}

export function mergeFileBytes(path: string, local: Buffer, remote: Buffer): Buffer {
  if (path === "app-state/tasks.json") return mergeTasksJson(local, remote);
  if (path.startsWith("app-state/messages_")) return mergeMessagesJson(local, remote);
  if (path === "settings/settings.json") return mergeSettingsJson(local, remote);
  if (path.endsWith(".json")) {
    const localObj = parseJson(local);
    const remoteObj = parseJson(remote);
    if (
      localObj &&
      remoteObj &&
      typeof localObj === "object" &&
      typeof remoteObj === "object" &&
      !Array.isArray(localObj) &&
      !Array.isArray(remoteObj)
    ) {
      return Buffer.from(
        canonicalJsonPretty(
          mergeJsonRecords(localObj as Record<string, unknown>, remoteObj as Record<string, unknown>),
        ),
        "utf-8",
      );
    }
  }
  return local.byteLength >= remote.byteLength ? local : remote;
}

export function resolveFileBytes(
  path: string,
  choice: SyncFileChoice,
  local: Buffer | undefined,
  remote: Buffer | undefined,
): Buffer | null {
  if (choice === "local") return local ?? null;
  if (choice === "remote") return remote ?? null;
  if (!local || !remote) return local ?? remote ?? null;
  return mergeFileBytes(path, local, remote);
}

export function buildMergedFileMap(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
  choices: Record<string, SyncFileChoice>,
): Record<string, Buffer> {
  const effectiveChoices = { ...choices };
  applyImageLibraryAtomicity(effectiveChoices, localFiles, remoteFiles);

  const paths = [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])].sort();
  const merged: Record<string, Buffer> = {};
  for (const path of paths) {
    if (IGNORED_SYNC_PATHS.has(path)) continue;
    const choice = effectiveChoices[path] ?? defaultChoiceForKind(
      !localFiles[path] ? "remote-only" : !remoteFiles[path] ? "local-only" : "conflict",
      path,
    );
    const bytes = resolveFileBytes(path, choice, localFiles[path], remoteFiles[path]);
    if (bytes) merged[path] = bytes;
  }
  return merged;
}
