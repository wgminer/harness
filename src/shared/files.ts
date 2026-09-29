/** A plain text file on disk, opened for in-place editing. */
export interface TextFile {
  path: string;
  name: string;
  content: string;
  modifiedMs: number;
}

/** Backend rejection when a save was based on an older version of the file. */
export const FILE_CONFLICT_ERROR = "file_conflict";

export function isFileConflictError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.includes(FILE_CONFLICT_ERROR);
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown"]);

export function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.has(ext);
}

const TEXT_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "csv",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "rs",
  "py",
  "swift",
  "css",
  "html",
  "sh",
]);

/** Paths Harness can reasonably open in its text editor. */
export function isEditableTextPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}
