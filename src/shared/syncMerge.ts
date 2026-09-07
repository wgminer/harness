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
  "app-state/notes.json",
  "app-state/images.json",
  "app-state/user_memory.json",
  "settings/settings.json",
]);

/** Legacy paths that may appear in old sync bundles; ignore rather than fail. */
const IGNORED_SYNC_PATHS = new Set(["app-state/plans.json"]);

const IMAGES_INDEX_PATH = "app-state/images.json";
const IMAGES_DIR_PREFIX = "app-state/images/";
const NOTES_INDEX_PATH = "app-state/notes.json";
const NOTES_DIR_PREFIX = "app-state/notes/";

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

function isNoteBodyPath(path: string): boolean {
  return path.startsWith(NOTES_DIR_PREFIX) && path.endsWith(".md");
}

function noteIdFromBodyPath(path: string): string | undefined {
  if (!isNoteBodyPath(path)) return undefined;
  const id = path.slice(NOTES_DIR_PREFIX.length, -3);
  return id || undefined;
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
  if (path === NOTES_INDEX_PATH) return "Notes";
  if (path === "app-state/user_memory.json") return "User context";
  if (path === "app-state/writing.md") return "Writing surface";
  if (path === "settings/settings.json") return "App preferences";
  return path;
}

function supportsMergeForPath(path: string): boolean {
  if (isImageLibraryPath(path)) return true;
  if (isNoteBodyPath(path)) return true;
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

function imageLibraryPaths(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): string[] {
  return [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])]
    .filter(isImageLibraryPath)
    .sort();
}

function noteBodyPaths(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): string[] {
  return [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])]
    .filter(isNoteBodyPath)
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

function notesAreDirty(
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): boolean {
  const localIndex = localFiles[NOTES_INDEX_PATH];
  const remoteIndex = remoteFiles[NOTES_INDEX_PATH];
  if (localIndex && remoteIndex) {
    if (!fileBytesEqual(localIndex, remoteIndex)) return true;
  } else if (localIndex || remoteIndex) {
    return true;
  }
  for (const path of noteBodyPaths(localFiles, remoteFiles)) {
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

function applyMergeableLibraryDefaults(
  choices: Record<string, SyncFileChoice>,
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): void {
  if (imageLibraryIsDirty(localFiles, remoteFiles)) {
    for (const path of imageLibraryPaths(localFiles, remoteFiles)) {
      const local = localFiles[path];
      const remote = remoteFiles[path];
      if (local && remote) choices[path] = "merge";
      else if (local) choices[path] = "local";
      else choices[path] = "remote";
    }
  }
  if (notesAreDirty(localFiles, remoteFiles)) {
    choices[NOTES_INDEX_PATH] = "merge";
    for (const path of noteBodyPaths(localFiles, remoteFiles)) {
      const local = localFiles[path];
      const remote = remoteFiles[path];
      if (local && remote) choices[path] = "merge";
      else if (local) choices[path] = "local";
      else choices[path] = "remote";
    }
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

    summary[
      kind === "unchanged"
        ? "unchanged"
        : kind === "local-only"
          ? "localOnly"
          : kind === "remote-only"
            ? "remoteOnly"
            : "conflict"
    ] += 1;

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
    for (const file of files) {
      if (isImageLibraryPath(file.path)) {
        file.supportsMerge = true;
        file.defaultChoice =
          file.kind === "local-only" ? "local" : file.kind === "remote-only" ? "remote" : "merge";
      }
    }
  }
  if (notesAreDirty(localFiles, remoteFiles)) {
    for (const file of files) {
      if (file.path === NOTES_INDEX_PATH || isNoteBodyPath(file.path)) {
        file.supportsMerge = true;
        file.defaultChoice =
          file.kind === "local-only" ? "local" : file.kind === "remote-only" ? "remote" : "merge";
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
  applyMergeableLibraryDefaults(choices, localFiles, remoteFiles);
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

function mergeIdArrayJson(local: Buffer, remote: Buffer, arrayKey: string): Buffer {
  const localState = parseJson(local) as Record<string, unknown>;
  const remoteState = parseJson(remote) as Record<string, unknown>;
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of (remoteState[arrayKey] as unknown[]) ?? []) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string") {
      byId.set((row as Record<string, unknown>).id as string, row as Record<string, unknown>);
    }
  }
  for (const row of (localState[arrayKey] as unknown[]) ?? []) {
    if (!row || typeof row !== "object" || typeof (row as Record<string, unknown>).id !== "string") continue;
    const id = (row as Record<string, unknown>).id as string;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row as Record<string, unknown>);
      continue;
    }
    byId.set(id, tsFromValue(row) >= tsFromValue(existing) ? (row as Record<string, unknown>) : existing);
  }
  const rows = [...byId.values()].sort((a, b) => tsFromValue(b) - tsFromValue(a));
  return Buffer.from(canonicalJsonPretty({ [arrayKey]: rows }), "utf-8");
}

function mergeTasksJson(local: Buffer, remote: Buffer): Buffer {
  return mergeIdArrayJson(local, remote, "tasks");
}

function mergeNotesJson(local: Buffer, remote: Buffer): Buffer {
  return mergeIdArrayJson(local, remote, "notes");
}

function noteTsById(indexBytes: Buffer | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!indexBytes) return out;
  try {
    const parsed = parseJson(indexBytes) as { notes?: unknown[] };
    for (const row of parsed.notes ?? []) {
      if (row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string") {
        out.set((row as Record<string, unknown>).id as string, tsFromValue(row));
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function deletedVersionIdsFromRecord(record: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const raw = record.deletedVersionIds;
  if (!Array.isArray(raw)) return out;
  for (const id of raw) {
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

function mergeImageRecord(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): Record<string, unknown> {
  const localIsNewer = tsFromValue(local) >= tsFromValue(remote);
  const newer = localIsNewer ? local : remote;
  const older = localIsNewer ? remote : local;
  const deletedVersionIds = new Set<string>([
    ...deletedVersionIdsFromRecord(local),
    ...deletedVersionIdsFromRecord(remote),
  ]);
  const versionsById = new Map<string, Record<string, unknown>>();
  for (const source of [older, newer]) {
    const versions = Array.isArray(source.versions) ? source.versions : [];
    for (const version of versions) {
      if (
        version &&
        typeof version === "object" &&
        typeof (version as Record<string, unknown>).id === "string"
      ) {
        const id = (version as Record<string, unknown>).id as string;
        if (deletedVersionIds.has(id)) continue;
        versionsById.set(id, version as Record<string, unknown>);
      }
    }
  }
  const versions = [...versionsById.values()].sort((a, b) => {
    const ta = typeof a.createdAt === "number" ? a.createdAt : 0;
    const tb = typeof b.createdAt === "number" ? b.createdAt : 0;
    if (ta !== tb) return ta - tb;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  const merged: Record<string, unknown> = { ...newer, versions };
  if (deletedVersionIds.size > 0) {
    merged.deletedVersionIds = [...deletedVersionIds].sort();
  } else {
    delete merged.deletedVersionIds;
  }
  const active = typeof merged.activeVersionId === "string" ? merged.activeVersionId : undefined;
  const activeOk =
    active && !deletedVersionIds.has(active)
      ? versions.some((v) => v.id === active)
      : false;
  if (!activeOk && versions.length > 0) {
    merged.activeVersionId = versions[versions.length - 1]?.id;
  }
  return merged;
}

function mergeImagesJson(local: Buffer, remote: Buffer): Buffer {
  const localState = parseJson(local) as { images?: unknown[] };
  const remoteState = parseJson(remote) as { images?: unknown[] };
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of remoteState.images ?? []) {
    if (row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string") {
      byId.set((row as Record<string, unknown>).id as string, row as Record<string, unknown>);
    }
  }
  for (const row of localState.images ?? []) {
    if (!row || typeof row !== "object" || typeof (row as Record<string, unknown>).id !== "string") continue;
    const id = (row as Record<string, unknown>).id as string;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, row as Record<string, unknown>);
      continue;
    }
    byId.set(id, mergeImageRecord(row as Record<string, unknown>, existing));
  }
  const images = [...byId.values()].sort((a, b) => tsFromValue(b) - tsFromValue(a));
  return Buffer.from(canonicalJsonPretty({ images }), "utf-8");
}

function referencedImageBlobPaths(imagesJson: Buffer): Set<string> {
  const out = new Set<string>();
  try {
    const parsed = parseJson(imagesJson) as { images?: unknown[] };
    for (const row of parsed.images ?? []) {
      if (!row || typeof row !== "object") continue;
      const img = row as Record<string, unknown>;
      if (typeof img.fileName === "string" && img.fileName) {
        out.add(`${IMAGES_DIR_PREFIX}${img.fileName}`);
      }
      const versions = Array.isArray(img.versions) ? img.versions : [];
      for (const version of versions) {
        if (
          version &&
          typeof version === "object" &&
          typeof (version as Record<string, unknown>).fileName === "string" &&
          (version as Record<string, unknown>).fileName
        ) {
          out.add(`${IMAGES_DIR_PREFIX}${(version as Record<string, unknown>).fileName as string}`);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function applyImageLibraryMerge(
  merged: Record<string, Buffer>,
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): void {
  if (!imageLibraryIsDirty(localFiles, remoteFiles)) {
    for (const path of imageLibraryPaths(localFiles, remoteFiles)) {
      const bytes = localFiles[path] ?? remoteFiles[path];
      if (bytes) merged[path] = bytes;
    }
    return;
  }
  const localIndex = localFiles[IMAGES_INDEX_PATH];
  const remoteIndex = remoteFiles[IMAGES_INDEX_PATH];
  let mergedIndex: Buffer;
  if (localIndex && remoteIndex) mergedIndex = mergeImagesJson(localIndex, remoteIndex);
  else if (localIndex) mergedIndex = localIndex;
  else if (remoteIndex) mergedIndex = remoteIndex;
  else return;

  const refs = referencedImageBlobPaths(mergedIndex);
  merged[IMAGES_INDEX_PATH] = mergedIndex;
  for (const path of imageLibraryPaths(localFiles, remoteFiles)) {
    if (path === IMAGES_INDEX_PATH) continue;
    if (!refs.has(path)) {
      delete merged[path];
      continue;
    }
    const local = localFiles[path];
    const remote = remoteFiles[path];
    if (local && remote) {
      merged[path] = local.byteLength >= remote.byteLength ? local : remote;
    } else if (local) {
      merged[path] = local;
    } else if (remote) {
      merged[path] = remote;
    }
  }
}

function applyNotesMerge(
  merged: Record<string, Buffer>,
  localFiles: Record<string, Buffer>,
  remoteFiles: Record<string, Buffer>,
): void {
  if (!notesAreDirty(localFiles, remoteFiles)) {
    const index = localFiles[NOTES_INDEX_PATH] ?? remoteFiles[NOTES_INDEX_PATH];
    if (index) merged[NOTES_INDEX_PATH] = index;
    for (const path of noteBodyPaths(localFiles, remoteFiles)) {
      const bytes = localFiles[path] ?? remoteFiles[path];
      if (bytes) merged[path] = bytes;
    }
    return;
  }
  const localIndex = localFiles[NOTES_INDEX_PATH];
  const remoteIndex = remoteFiles[NOTES_INDEX_PATH];
  let mergedIndex: Buffer | undefined;
  if (localIndex && remoteIndex) mergedIndex = mergeNotesJson(localIndex, remoteIndex);
  else if (localIndex) mergedIndex = localIndex;
  else if (remoteIndex) mergedIndex = remoteIndex;

  const keptIds = new Set<string>();
  if (mergedIndex) {
    try {
      const parsed = parseJson(mergedIndex) as { notes?: unknown[] };
      for (const row of parsed.notes ?? []) {
        if (row && typeof row === "object" && typeof (row as Record<string, unknown>).id === "string") {
          keptIds.add((row as Record<string, unknown>).id as string);
        }
      }
    } catch {
      /* ignore */
    }
    merged[NOTES_INDEX_PATH] = mergedIndex;
  }

  const localTs = noteTsById(localIndex);
  const remoteTs = noteTsById(remoteIndex);
  for (const path of noteBodyPaths(localFiles, remoteFiles)) {
    const id = noteIdFromBodyPath(path);
    if (!id) continue;
    if (keptIds.size > 0 && !keptIds.has(id)) {
      delete merged[path];
      continue;
    }
    const local = localFiles[path];
    const remote = remoteFiles[path];
    let bytes: Buffer | undefined;
    if (local && remote) {
      if (fileBytesEqual(local, remote)) bytes = local;
      else {
        const lt = localTs.get(id) ?? 0;
        const rt = remoteTs.get(id) ?? 0;
        bytes = lt >= rt ? local : remote;
      }
    } else {
      bytes = local ?? remote;
    }
    if (bytes) merged[path] = bytes;
  }
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
  if (path === NOTES_INDEX_PATH) return mergeNotesJson(local, remote);
  if (path === IMAGES_INDEX_PATH) return mergeImagesJson(local, remote);
  if (path.startsWith("app-state/messages_")) return mergeMessagesJson(local, remote);
  if (path === "settings/settings.json") return mergeSettingsJson(local, remote);
  if (isNoteBodyPath(path)) return local.byteLength >= remote.byteLength ? local : remote;
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
  applyMergeableLibraryDefaults(effectiveChoices, localFiles, remoteFiles);

  const paths = [...new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)])].sort();
  const merged: Record<string, Buffer> = {};
  for (const path of paths) {
    if (IGNORED_SYNC_PATHS.has(path)) continue;
    if (isImageLibraryPath(path) || path === NOTES_INDEX_PATH || isNoteBodyPath(path)) continue;
    const choice =
      effectiveChoices[path] ??
      defaultChoiceForKind(
        !localFiles[path] ? "remote-only" : !remoteFiles[path] ? "local-only" : "conflict",
        path,
      );
    const bytes = resolveFileBytes(path, choice, localFiles[path], remoteFiles[path]);
    if (bytes) merged[path] = bytes;
  }
  applyImageLibraryMerge(merged, localFiles, remoteFiles);
  applyNotesMerge(merged, localFiles, remoteFiles);
  return merged;
}
